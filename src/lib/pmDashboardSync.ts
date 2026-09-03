import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getClientCredentialsToken, makeRequest } from "@/lib/procore";
import {
  normalizePmActionItem,
  type MemberIdentity,
  type PmActionItemInput,
  type PmActionItemType,
  type UnknownRecord,
  unwrapProcoreRows,
} from "@/lib/pmDashboard";
import { annotateMeetingGroups } from "@/lib/procoreMeetingSeries";

type SourceResult = {
  sourceType: PmActionItemType;
  supported: boolean;
  items: PmActionItemInput[];
  warning?: string;
};

type SyncProject = {
  companyId: string;
  procoreProjectId: string;
  projectName: string;
};

function errorStatus(error: unknown): number {
  return Number((error as { status?: number })?.status || 0);
}

async function fetchPaged(params: {
  token: string;
  companyId: string;
  path: string;
  keys: string[];
  maxPages?: number;
}): Promise<UnknownRecord[]> {
  const rows: UnknownRecord[] = [];
  const maxPages = Math.max(1, Math.min(params.maxPages || 10, 25));
  for (let page = 1; page <= maxPages; page += 1) {
    const separator = params.path.includes("?") ? "&" : "?";
    const payload = await makeRequest(
      `${params.path}${separator}page=${page}&per_page=100`,
      params.token,
      { cache: "no-store" },
      params.companyId,
      [403, 404],
    );
    const pageRows = unwrapProcoreRows(payload, params.keys);
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
  }
  return rows;
}

async function fetchFirstSupported(params: {
  token: string;
  companyId: string;
  paths: string[];
  keys: string[];
}): Promise<{ supported: boolean; rows: UnknownRecord[]; warning?: string }> {
  const unavailable: string[] = [];
  for (const path of params.paths) {
    try {
      const rows = await fetchPaged({ ...params, path });
      return { supported: true, rows };
    } catch (error) {
      const status = errorStatus(error);
      if (status === 403 || status === 404) {
        unavailable.push(`${path} (${status})`);
        continue;
      }
      throw error;
    }
  }
  return {
    supported: false,
    rows: [],
    warning: unavailable.length ? `Tool unavailable: ${unavailable.join(", ")}` : "Tool unavailable",
  };
}

async function taskMemberDirectory(params: {
  token: string;
  companyId: string;
  projectId: string;
}): Promise<Map<string, MemberIdentity>> {
  const rows = await fetchPaged({
    token: params.token,
    companyId: params.companyId,
    path: `/rest/v1.0/task_items/assignees?project_id=${encodeURIComponent(params.projectId)}`,
    keys: ["assignees", "task_items_assignees"],
  }).catch(() => []);
  const directory = new Map<string, MemberIdentity>();
  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    if (!id) continue;
    const user = row.user && typeof row.user === "object" && !Array.isArray(row.user)
      ? row.user as UnknownRecord
      : {};
    directory.set(id, {
      id,
      name: String(row.name || row.full_name || user.name || "").trim() || undefined,
      email: String(row.email || row.login || user.email || user.login || "").trim().toLowerCase() || undefined,
    });
  }
  return directory;
}

async function companyMemberDirectory(companyId: string): Promise<Map<string, MemberIdentity>> {
  const users: Array<{ user_id: string; name: string | null; login: string | null }> = await prisma.procore_company_users_live.findMany({
    where: { company_id: companyId },
    select: { user_id: true, name: true, login: true },
  }).catch(() => []);
  return new Map(users.map((user) => [user.user_id, {
    id: user.user_id,
    name: user.name || undefined,
    email: user.login?.trim().toLowerCase() || undefined,
  }]));
}

async function fetchMeetings(params: {
  token: string;
  companyId: string;
  projectId: string;
}): Promise<UnknownRecord[]> {
  const rows: UnknownRecord[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const payload = await makeRequest(
      `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/meetings?serializer_view=extended&page=${page}&per_page=100`,
      params.token,
      { cache: "no-store" },
      params.companyId,
      [403, 404],
    );
    const pageRows = annotateMeetingGroups(payload);
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
  }
  return rows;
}

async function readSource(params: {
  project: SyncProject;
  sourceType: PmActionItemType;
  token: string;
  memberDirectory: Map<string, MemberIdentity>;
}): Promise<SourceResult> {
  const projectId = encodeURIComponent(params.project.procoreProjectId);
  let result: { supported: boolean; rows: UnknownRecord[]; warning?: string };
  const directory = new Map(params.memberDirectory);

  if (params.sourceType === "task") {
    result = await fetchFirstSupported({
      token: params.token,
      companyId: params.project.companyId,
      paths: [`/rest/v1.0/task_items?project_id=${projectId}`],
      keys: ["task_items"],
    });
    if (result.supported) {
      const taskDirectory = await taskMemberDirectory({
        token: params.token,
        companyId: params.project.companyId,
        projectId: params.project.procoreProjectId,
      });
      for (const [id, identity] of taskDirectory) directory.set(id, identity);
    }
  } else if (params.sourceType === "rfi") {
    result = await fetchFirstSupported({
      token: params.token,
      companyId: params.project.companyId,
      paths: [
        `/rest/v1.0/projects/${projectId}/rfis`,
        `/rest/v1.0/rfis?project_id=${projectId}`,
      ],
      keys: ["rfis"],
    });
  } else {
    try {
      const rows = await fetchMeetings({
        token: params.token,
        companyId: params.project.companyId,
        projectId: params.project.procoreProjectId,
      });
      result = { supported: true, rows };
    } catch (error) {
      const status = errorStatus(error);
      if (status !== 403 && status !== 404) throw error;
      result = { supported: false, rows: [], warning: `Meetings tool unavailable (${status})` };
    }
  }

  return {
    sourceType: params.sourceType,
    supported: result.supported,
    warning: result.warning,
    items: result.rows
      .map((record) => normalizePmActionItem({
        sourceType: params.sourceType,
        record,
        projectId: params.project.procoreProjectId,
        procoreWebOrigin: process.env.PROCORE_WEB_ORIGIN,
        memberDirectory: directory,
      }))
      .filter((item): item is PmActionItemInput => item !== null),
  };
}

function actionItemUpsert(
  project: Pick<SyncProject, "companyId" | "procoreProjectId">,
  item: PmActionItemInput,
  syncedAt: Date,
) {
  return prisma.pmcActionItem.upsert({
    where: {
      companyId_procoreProjectId_sourceType_sourceId: {
        companyId: project.companyId,
        procoreProjectId: project.procoreProjectId,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
      },
    },
    create: {
      companyId: project.companyId,
      procoreProjectId: project.procoreProjectId,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      number: item.number,
      title: item.title,
      description: item.description,
      status: item.status,
      dueAt: item.dueAt,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      assigneeEmails: item.assigneeEmails,
      assigneeNames: item.assigneeNames,
      isOpen: item.isOpen,
      sourceUrl: item.sourceUrl,
      payload: item.payload as Prisma.InputJsonValue,
      syncedAt,
    },
    update: {
      number: item.number,
      title: item.title,
      description: item.description,
      status: item.status,
      dueAt: item.dueAt,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      assigneeEmails: item.assigneeEmails,
      assigneeNames: item.assigneeNames,
      isOpen: item.isOpen,
      sourceUrl: item.sourceUrl,
      payload: item.payload as Prisma.InputJsonValue,
      syncedAt,
    },
  });
}

async function persistSource(project: SyncProject, result: SourceResult): Promise<void> {
  if (!result.supported) return;
  const sourceIds = result.items.map((item) => item.sourceId);
  const syncedAt = new Date();
  const writes: Prisma.PrismaPromise<unknown>[] = result.items.map((item) => actionItemUpsert(project, item, syncedAt));
  writes.push(prisma.pmcActionItem.deleteMany({
    where: {
      companyId: project.companyId,
      procoreProjectId: project.procoreProjectId,
      sourceType: result.sourceType,
      ...(sourceIds.length ? { sourceId: { notIn: sourceIds } } : {}),
    },
  }));
  await prisma.$transaction(writes);
}

type ActionItemRef = {
  companyId: string;
  procoreProjectId: string;
  sourceType: PmActionItemType;
  sourceId: string;
};

function singleItemPaths(ref: ActionItemRef): string[] {
  const projectId = encodeURIComponent(ref.procoreProjectId);
  const sourceId = encodeURIComponent(ref.sourceId);
  if (ref.sourceType === "rfi") {
    return [
      `/rest/v1.0/projects/${projectId}/rfis/${sourceId}`,
      `/rest/v1.0/rfis/${sourceId}?project_id=${projectId}`,
    ];
  }
  if (ref.sourceType === "task") {
    return [`/rest/v1.0/task_items/${sourceId}?project_id=${projectId}`];
  }
  return [`/rest/v1.1/projects/${projectId}/meetings/${sourceId}`];
}

function unwrapSingleRecord(payload: unknown): UnknownRecord | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as UnknownRecord;
  for (const key of ["data", "rfi", "task_item", "meeting"]) {
    const nested = record[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested as UnknownRecord;
  }
  return record;
}

export async function deletePmDashboardActionItem(ref: ActionItemRef): Promise<number> {
  const result = await prisma.pmcActionItem.deleteMany({
    where: {
      companyId: ref.companyId,
      procoreProjectId: ref.procoreProjectId,
      sourceType: ref.sourceType,
      sourceId: ref.sourceId,
    },
  });
  return result.count;
}

/**
 * Webhook-driven single-record refresh. Costs one Procore request per event
 * instead of the multi-call per-project sweep used by syncPmDashboardProject.
 * A 404 removes the local mirror row; any other error propagates so the
 * webhook queue can retry.
 */
export async function syncPmDashboardActionItem(
  ref: ActionItemRef,
  options?: { token?: string },
): Promise<{ outcome: "upserted" | "deleted" | "skipped"; item?: PmActionItemInput }> {
  const token = options?.token || await getClientCredentialsToken();
  let record: UnknownRecord | null = null;
  let lastNotFound: unknown = null;

  for (const path of singleItemPaths(ref)) {
    try {
      record = unwrapSingleRecord(await makeRequest(
        path,
        token,
        { cache: "no-store" },
        ref.companyId,
        [404],
      ));
      if (record) break;
    } catch (error) {
      if (errorStatus(error) === 404) {
        lastNotFound = error;
        continue;
      }
      throw error;
    }
  }

  if (!record) {
    if (lastNotFound) {
      await deletePmDashboardActionItem(ref);
      return { outcome: "deleted" };
    }
    return { outcome: "skipped" };
  }

  if (ref.sourceType === "meeting") {
    const annotated = annotateMeetingGroups([record])[0] || record;
    // The show endpoint lacks list grouping; parent_id is the series root.
    const parentId = String(record.parent_id ?? record.parentId ?? "").trim();
    record = parentId ? { ...annotated, __meeting_series_group_id: parentId } : annotated;
  }

  const memberDirectory = await companyMemberDirectory(ref.companyId);
  const item = normalizePmActionItem({
    sourceType: ref.sourceType,
    record,
    projectId: ref.procoreProjectId,
    procoreWebOrigin: process.env.PROCORE_WEB_ORIGIN,
    memberDirectory,
  });
  if (!item) return { outcome: "skipped" };

  await actionItemUpsert(ref, item, new Date());
  return { outcome: "upserted", item };
}

export async function syncPmDashboardProject(project: SyncProject) {
  const attemptedAt = new Date();
  const token = await getClientCredentialsToken();
  const memberDirectory = await companyMemberDirectory(project.companyId);
  const sourceResults: SourceResult[] = [];
  const errors: Array<{ sourceType: PmActionItemType; error: string }> = [];

  for (const sourceType of ["rfi", "task", "meeting"] as const) {
    try {
      const result = await readSource({ project, sourceType, token, memberDirectory });
      await persistSource(project, result);
      sourceResults.push(result);
    } catch (error) {
      errors.push({ sourceType, error: error instanceof Error ? error.message : String(error) });
    }
  }

  await prisma.pmcActionItemSyncState.upsert({
    where: {
      companyId_procoreProjectId: {
        companyId: project.companyId,
        procoreProjectId: project.procoreProjectId,
      },
    },
    create: {
      companyId: project.companyId,
      procoreProjectId: project.procoreProjectId,
      lastAttemptAt: attemptedAt,
      lastSuccessAt: errors.length === 0 ? new Date() : null,
      lastError: errors.length ? JSON.stringify(errors).slice(0, 4000) : null,
    },
    update: {
      lastAttemptAt: attemptedAt,
      ...(errors.length === 0 ? { lastSuccessAt: new Date() } : {}),
      lastError: errors.length ? JSON.stringify(errors).slice(0, 4000) : null,
    },
  });

  return {
    projectId: project.procoreProjectId,
    projectName: project.projectName,
    success: errors.length === 0,
    counts: Object.fromEntries(sourceResults.map((result) => [result.sourceType, result.items.length])),
    warnings: sourceResults.flatMap((result) => result.warning ? [result.warning] : []),
    errors,
  };
}
