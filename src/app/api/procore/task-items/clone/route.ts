import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;

type TaskClonePlanRow = {
  sourceTaskId: number;
  title: string;
  status: string;
  payload: UnknownRecord;
  unresolved: {
    category?: string;
    assigned?: string;
    assignees: string[];
    distributionMembers: string[];
  };
};

type MemberOption = {
  id: number;
  name: string;
  email: string;
};

type DistributionOption = {
  id: number;
  name: string;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStr(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

function readNum(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalize(value: unknown): string {
  return readStr(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function unwrapArray(value: unknown, keys: string[] = []): UnknownRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["data", ...keys]) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested.filter(isRecord);
  }
  return [];
}

function toUniqueNums(values: unknown[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    const n = readNum(value);
    if (n === undefined || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

async function getToken(bodyToken: unknown) {
  const cookieStore = await cookies();
  const explicitToken = readStr(bodyToken);
  const cookieToken = readStr(cookieStore.get("procore_access_token")?.value);
  if (explicitToken) return { accessToken: explicitToken, tokenSource: "body" as const };
  if (cookieToken) return { accessToken: cookieToken, tokenSource: "cookie" as const };
  return { accessToken: await getClientCredentialsToken(), tokenSource: "client_credentials" as const };
}

async function procoreJson(params: {
  accessToken: string;
  companyId: string;
  path: string;
  method?: string;
  body?: unknown;
}) {
  const method = params.method || "GET";
  const response = await fetch(`${procoreConfig.apiUrl}${params.path}`, {
    method,
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
      ...(params.body === undefined ? {} : { "Content-Type": "application/json" }),
      "Procore-Company-Id": params.companyId,
    },
    body: params.body === undefined ? undefined : JSON.stringify(params.body),
    cache: "no-store",
  });

  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Keep plain text payload when non-JSON.
  }

  if (!response.ok) {
    const message = typeof payload === "string" ? payload : JSON.stringify(payload);
    throw new Error(`Procore ${method} ${params.path} failed (${response.status}): ${message}`);
  }

  return payload;
}

async function fetchPaged(params: {
  accessToken: string;
  companyId: string;
  path: string;
  keys?: string[];
  maxPages: number;
}) {
  const rows: UnknownRecord[] = [];
  for (let page = 1; page <= params.maxPages; page += 1) {
    const separator = params.path.includes("?") ? "&" : "?";
    const payload = await procoreJson({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `${params.path}${separator}page=${page}&per_page=100`,
    });
    const pageRows = unwrapArray(payload, params.keys || []);
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
  }
  return rows;
}

async function fetchTaskItems(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/task_items?project_id=${encodeURIComponent(params.projectId)}`,
    keys: ["task_items"],
    maxPages: params.maxPages,
  });
}

async function fetchTaskItemCategories(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(params.projectId)}/task_item_categories`,
    keys: ["task_item_categories", "categories"],
    maxPages: params.maxPages,
  });
}

function parseMemberOption(row: UnknownRecord): MemberOption | null {
  const id = readNum(row.id);
  const user = isRecord(row.user) ? row.user : null;
  const person = isRecord(row.person) ? row.person : null;
  const name = readStr(
    row.name ||
      row.full_name ||
      row.label ||
      (user ? user.name : undefined) ||
      (person ? person.name : undefined) ||
      `${readStr(row.first_name)} ${readStr(row.last_name)}`
  );
  const email = readStr(
    row.email ||
      row.login ||
      row.email_address ||
      (user ? user.email || user.login : undefined) ||
      (person ? person.email || person.login : undefined)
  );

  if (id === undefined) return null;
  return { id, name, email };
}

async function fetchTaskAssigneeOptions(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}) {
  const rows = await fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/task_items/assignees?project_id=${encodeURIComponent(params.projectId)}`,
    keys: ["assignees", "task_items_assignees"],
    maxPages: params.maxPages,
  });

  return rows.map(parseMemberOption).filter((row): row is MemberOption => row !== null);
}

function parseDistributionOption(row: UnknownRecord): DistributionOption | null {
  const id = readNum(row.id);
  const member = isRecord(row.member) ? row.member : null;
  const name = readStr(
    row.name ||
      row.full_name ||
      row.label ||
      row.email ||
      (member ? member.name || member.email : undefined)
  );
  if (id === undefined) return null;
  return { id, name };
}

async function fetchDistributionOptions(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}) {
  const rows = await fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(params.projectId)}/task_items_project_distribution_members/options`,
    keys: ["task_items_project_distribution_members", "distribution_members", "members"],
    maxPages: params.maxPages,
  });

  return rows.map(parseDistributionOption).filter((row): row is DistributionOption => row !== null);
}

async function fetchTaskComments(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(params.projectId)}/task_item_comments`,
    keys: ["task_item_comments", "comments"],
    maxPages: params.maxPages,
  });
}

async function createTaskItem(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  payload: UnknownRecord;
}) {
  return procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    method: "POST",
    path: `/rest/v1.0/task_items?project_id=${encodeURIComponent(params.projectId)}`,
    body: { task_item: params.payload },
  });
}

async function createTaskComment(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  payload: UnknownRecord;
}) {
  return procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    method: "POST",
    path: `/rest/v1.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(params.projectId)}/task_item_comments`,
    body: { task_item_comment: params.payload },
  });
}

function makeMemberKeys(member: MemberOption): string[] {
  const keys: string[] = [];
  const nameKey = normalize(member.name);
  const emailKey = normalize(member.email);
  if (emailKey) keys.push(`email:${emailKey}`);
  if (nameKey) keys.push(`name:${nameKey}`);
  return keys;
}

function makeDistributionKeys(member: DistributionOption): string[] {
  const keys: string[] = [];
  const nameKey = normalize(member.name);
  if (nameKey) keys.push(`name:${nameKey}`);
  return keys;
}

function pickFirstMappedId(
  sourceId: number | undefined,
  sourceById: Map<number, string[]>,
  targetByKey: Map<string, number>
): { id: number | undefined; unresolved: string } {
  if (sourceId === undefined) return { id: undefined, unresolved: "" };
  const keys = sourceById.get(sourceId) || [];
  for (const key of keys) {
    const mapped = targetByKey.get(key);
    if (mapped !== undefined) return { id: mapped, unresolved: "" };
  }
  return { id: undefined, unresolved: keys[0] || String(sourceId) };
}

function mapManyIds(
  sourceIds: number[],
  sourceById: Map<number, string[]>,
  targetByKey: Map<string, number>
): { ids: number[]; unresolved: string[] } {
  const mapped: number[] = [];
  const unresolved: string[] = [];

  for (const sourceId of sourceIds) {
    const keys = sourceById.get(sourceId) || [];
    let found: number | undefined;
    for (const key of keys) {
      const mappedId = targetByKey.get(key);
      if (mappedId !== undefined) {
        found = mappedId;
        break;
      }
    }

    if (found !== undefined) {
      mapped.push(found);
    } else {
      unresolved.push(keys[0] || String(sourceId));
    }
  }

  return { ids: toUniqueNums(mapped), unresolved };
}

function parseTaskIds(value: unknown): number[] {
  if (Array.isArray(value)) return toUniqueNums(value);
  if (isRecord(value)) return toUniqueNums(value.ids as unknown[]);
  return [];
}

function taskCommentsByTaskId(rows: UnknownRecord[]) {
  const map = new Map<number, UnknownRecord[]>();
  for (const row of rows) {
    const taskId = readNum(row.task_item_id);
    if (taskId === undefined) continue;
    const bucket = map.get(taskId) || [];
    bucket.push(row);
    map.set(taskId, bucket);
  }
  return map;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const { accessToken, tokenSource } = await getToken(body.accessToken);

    const fallbackCompanyId = readStr(body.companyId || procoreConfig.companyId);
    const sourceCompanyId = readStr(body.sourceCompanyId || body.companyId || fallbackCompanyId);
    const sourceProjectId = readStr(body.sourceProjectId || body.projectId);
    const targetCompanyId = readStr(body.targetCompanyId || body.companyId || fallbackCompanyId);
    const targetProjectId = readStr(body.targetProjectId);
    const taskIds = parseTaskIds(body.taskIds);
    const dryRun = body.dryRun !== false;
    const cloneComments = body.cloneComments !== false;
    const createOffset = Math.max(0, Math.trunc(readNum(body.createOffset) || 0));
    const createLimit = Math.max(1, Math.min(100, Math.trunc(readNum(body.createLimit) || 25)));
    const maxPages = Math.max(1, Math.min(50, Math.trunc(readNum(body.maxPages) || 10)));

    if (!sourceCompanyId || !sourceProjectId || !targetCompanyId || !targetProjectId) {
      return NextResponse.json(
        {
          success: false,
          error: "sourceCompanyId, sourceProjectId, targetCompanyId, and targetProjectId are required.",
        },
        { status: 400 }
      );
    }

    const [sourceTasks, sourceCategories, targetCategories, sourceAssignees, targetAssignees, sourceDistribution, targetDistribution, sourceComments] =
      await Promise.all([
        fetchTaskItems({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, maxPages }),
        fetchTaskItemCategories({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, maxPages }),
        fetchTaskItemCategories({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, maxPages }),
        fetchTaskAssigneeOptions({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, maxPages }),
        fetchTaskAssigneeOptions({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, maxPages }),
        fetchDistributionOptions({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, maxPages }),
        fetchDistributionOptions({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, maxPages }),
        cloneComments
          ? fetchTaskComments({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, maxPages })
          : Promise.resolve([]),
      ]);

    const sourceCategoryById = new Map<number, string>();
    for (const row of sourceCategories) {
      const id = readNum(row.id);
      const name = readStr(row.name || row.title);
      if (id !== undefined && name) sourceCategoryById.set(id, name);
    }

    const targetCategoryIdByName = new Map<string, number>();
    for (const row of targetCategories) {
      const id = readNum(row.id);
      const name = normalize(row.name || row.title);
      if (id !== undefined && name) targetCategoryIdByName.set(name, id);
    }

    const sourceAssigneeKeysById = new Map<number, string[]>();
    for (const row of sourceAssignees) {
      sourceAssigneeKeysById.set(row.id, makeMemberKeys(row));
    }
    const targetAssigneeIdByKey = new Map<string, number>();
    for (const row of targetAssignees) {
      for (const key of makeMemberKeys(row)) {
        if (!targetAssigneeIdByKey.has(key)) targetAssigneeIdByKey.set(key, row.id);
      }
    }

    const sourceDistributionKeysById = new Map<number, string[]>();
    for (const row of sourceDistribution) {
      sourceDistributionKeysById.set(row.id, makeDistributionKeys(row));
    }
    const targetDistributionIdByKey = new Map<string, number>();
    for (const row of targetDistribution) {
      for (const key of makeDistributionKeys(row)) {
        if (!targetDistributionIdByKey.has(key)) targetDistributionIdByKey.set(key, row.id);
      }
    }

    const selectedSourceTasks = sourceTasks
      .filter((row) => {
        if (taskIds.length === 0) return true;
        const id = readNum(row.id);
        return id !== undefined && taskIds.includes(id);
      })
      .sort((a, b) => {
        const left = readNum(a.id) || 0;
        const right = readNum(b.id) || 0;
        return left - right;
      });

    const plan: TaskClonePlanRow[] = [];
    for (const sourceTask of selectedSourceTasks) {
      const sourceTaskId = readNum(sourceTask.id);
      if (sourceTaskId === undefined) continue;

      const sourceCategoryId = readNum(sourceTask.task_item_category_id || sourceTask.category_id);
      const sourceCategoryName = sourceCategoryId === undefined ? "" : readStr(sourceCategoryById.get(sourceCategoryId));
      const mappedCategoryId = sourceCategoryName ? targetCategoryIdByName.get(normalize(sourceCategoryName)) : undefined;

      const assignedResult = pickFirstMappedId(
        readNum(sourceTask.assigned_id),
        sourceAssigneeKeysById,
        targetAssigneeIdByKey
      );

      const sourceAssigneeIds = toUniqueNums([
        ...(Array.isArray(sourceTask.assignee_ids) ? sourceTask.assignee_ids : []),
        ...unwrapArray(sourceTask.assignees).map((entry) => readNum(entry.id)).filter((value) => value !== undefined),
      ]);
      const mappedAssignees = mapManyIds(sourceAssigneeIds, sourceAssigneeKeysById, targetAssigneeIdByKey);

      const sourceDistributionIds = toUniqueNums([
        ...(Array.isArray(sourceTask.distribution_member_ids) ? sourceTask.distribution_member_ids : []),
        ...unwrapArray(sourceTask.distribution_members).map((entry) => readNum(entry.id)).filter((value) => value !== undefined),
      ]);
      const mappedDistribution = mapManyIds(sourceDistributionIds, sourceDistributionKeysById, targetDistributionIdByKey);

      const payload: UnknownRecord = {
        title: readStr(sourceTask.title),
        description: readStr(sourceTask.description),
        due_date: readStr(sourceTask.due_date),
        status: readStr(sourceTask.status),
        private: typeof sourceTask.private === "boolean" ? sourceTask.private : undefined,
        task_item_category_id: mappedCategoryId,
        assigned_id: assignedResult.id,
        assignee_ids: mappedAssignees.ids,
        distribution_member_ids: mappedDistribution.ids,
      };

      for (const key of Object.keys(payload)) {
        if (payload[key] === undefined || payload[key] === "") delete payload[key];
      }

      plan.push({
        sourceTaskId,
        title: readStr(sourceTask.title) || `Task ${sourceTaskId}`,
        status: readStr(sourceTask.status),
        payload,
        unresolved: {
          ...(sourceCategoryName && mappedCategoryId === undefined ? { category: sourceCategoryName } : {}),
          ...(assignedResult.unresolved ? { assigned: assignedResult.unresolved } : {}),
          assignees: mappedAssignees.unresolved,
          distributionMembers: mappedDistribution.unresolved,
        },
      });
    }

    const sourceCommentMap = taskCommentsByTaskId(sourceComments);

    const createRows = plan.slice(createOffset, createOffset + createLimit);
    const createResults: Array<UnknownRecord> = [];
    const createdTaskIdBySourceTaskId = new Map<number, number>();

    if (!dryRun) {
      for (const row of createRows) {
        try {
          const created = await createTaskItem({
            accessToken,
            companyId: targetCompanyId,
            projectId: targetProjectId,
            payload: row.payload,
          });

          const createdId = readNum(isRecord(created) ? created.id : undefined);
          if (createdId !== undefined) {
            createdTaskIdBySourceTaskId.set(row.sourceTaskId, createdId);
          }

          createResults.push({
            sourceTaskId: row.sourceTaskId,
            ok: true,
            created,
          });
        } catch (error) {
          createResults.push({
            sourceTaskId: row.sourceTaskId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            attemptedPayload: row.payload,
          });
        }
      }
    }

    const commentResults: Array<UnknownRecord> = [];
    if (!dryRun && cloneComments) {
      for (const [sourceTaskId, targetTaskId] of createdTaskIdBySourceTaskId.entries()) {
        const comments = sourceCommentMap.get(sourceTaskId) || [];
        for (const comment of comments) {
          const commentText = readStr(comment.comment || comment.body || comment.description);
          if (!commentText) continue;
          const payload: UnknownRecord = {
            task_item_id: targetTaskId,
            comment: commentText,
            status: readStr(comment.status),
          };
          for (const key of Object.keys(payload)) {
            if (payload[key] === undefined || payload[key] === "") delete payload[key];
          }

          try {
            const created = await createTaskComment({
              accessToken,
              companyId: targetCompanyId,
              projectId: targetProjectId,
              payload,
            });
            commentResults.push({ sourceTaskId, targetTaskId, ok: true, created });
          } catch (error) {
            commentResults.push({
              sourceTaskId,
              targetTaskId,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              attemptedPayload: payload,
            });
          }
        }
      }
    }

    const failedCreates = createResults.filter((row) => row.ok === false);
    const failedComments = commentResults.filter((row) => row.ok === false);

    return NextResponse.json({
      success: dryRun ? true : failedCreates.length === 0 && failedComments.length === 0,
      dryRun,
      cloneComments,
      tokenSource,
      sourceLookupPath: `/rest/v1.0/task_items?project_id=${sourceProjectId}`,
      targetLookupPath: `/rest/v1.0/task_items?project_id=${targetProjectId}`,
      counts: {
        sourceTasks: selectedSourceTasks.length,
        planned: plan.length,
        createOffset,
        createLimit,
        created: createResults.filter((row) => row.ok === true).length,
        createFailed: failedCreates.length,
        commentsPlanned: cloneComments
          ? [...createdTaskIdBySourceTaskId.keys()].reduce((total, sourceTaskId) => total + (sourceCommentMap.get(sourceTaskId)?.length || 0), 0)
          : 0,
        commentsCreated: commentResults.filter((row) => row.ok === true).length,
        commentsFailed: failedComments.length,
        unresolvedCategoryMappings: plan.filter((row) => Boolean(row.unresolved.category)).length,
      },
      plan: plan.slice(0, 200),
      createResults,
      commentResults,
      readyForLiveClone: plan.length > 0,
      nextStep: dryRun
        ? "Review unresolved mappings and rerun with dryRun=false when ready."
        : failedCreates.length || failedComments.length
          ? "Task clone finished with errors. Review createResults/commentResults."
          : "Task clone batch complete.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Task clone failed.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
