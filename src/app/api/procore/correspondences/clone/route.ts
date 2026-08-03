import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

type UnknownRecord = Record<string, unknown>;

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

function normalizeKey(value: unknown): string {
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

function unwrapData(value: unknown): unknown {
  if (isRecord(value) && isRecord(value.data)) return value.data;
  return value;
}

async function getToken(bodyToken: unknown) {
  const cookieStore = await cookies();
  const explicitToken = readStr(bodyToken);
  const cookieToken = readStr(cookieStore.get("procore_access_token")?.value);
  if (explicitToken) return { accessToken: explicitToken, tokenSource: "body" };
  if (cookieToken) return { accessToken: cookieToken, tokenSource: "cookie" };
  return { accessToken: await getClientCredentialsToken(), tokenSource: "client_credentials" };
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
    // Keep text response.
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

async function fetchGenericTools(params: { accessToken: string; companyId: string }) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/companies/${encodeURIComponent(params.companyId)}/generic_tools`,
    keys: ["generic_tools"],
    maxPages: 10,
  });
}

function toolKey(tool: UnknownRecord) {
  return `${normalizeKey(tool.title)}|${normalizeKey(tool.abbreviation)}`;
}

function resolveTargetTool(sourceTool: UnknownRecord, targetTools: UnknownRecord[]) {
  const sourceId = readStr(sourceTool.id);
  const sourceTitle = normalizeKey(sourceTool.title);
  const sourceAbbreviation = normalizeKey(sourceTool.abbreviation);
  return (
    targetTools.find((tool) => readStr(tool.id) === sourceId) ||
    targetTools.find((tool) => toolKey(tool) === toolKey(sourceTool)) ||
    targetTools.find((tool) => normalizeKey(tool.title) === sourceTitle && sourceTitle) ||
    targetTools.find((tool) => normalizeKey(tool.abbreviation) === sourceAbbreviation && sourceAbbreviation)
  );
}

function impactPayload(value: unknown) {
  if (!isRecord(value)) return undefined;
  const status = readStr(value.status);
  const amount = readStr(value.value);
  const payload: UnknownRecord = {};
  if (status) payload.status = status;
  if (amount) payload.value = amount;
  return Object.keys(payload).length ? payload : undefined;
}

function idFromNested(value: unknown): number | undefined {
  if (!isRecord(value)) return readNum(value);
  return readNum(value.id);
}

function buildGenericToolItemPayload(item: UnknownRecord) {
  const payload: UnknownRecord = {
    title: readStr(item.title) || "Untitled Correspondence",
    description: readStr(item.description),
    status: readStr(item.status),
    private: typeof item.private === "boolean" ? item.private : undefined,
    due_date: readStr(item.due_date),
    issued_at: readStr(item.issued_at),
    position: readStr(item.position || item.unformatted_position),
    quantity: readNum(item.quantity),
    cost_impact: impactPayload(item.cost_impact),
    schedule_impact: impactPayload(item.schedule_impact),
    uom_id: idFromNested(item.uom),
  };

  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined || payload[key] === "" || payload[key] === null) delete payload[key];
  }
  return payload;
}

function canonicalPosition(value: unknown, tool: UnknownRecord) {
  let position = normalizeKey(value).replace(/\s+/g, "");
  const abbreviation = normalizeKey(tool.abbreviation).replace(/\s+/g, "");
  if (!abbreviation) return position;
  const prefix = `${abbreviation}-`;
  while (position.startsWith(prefix)) position = position.slice(prefix.length);
  return position;
}

function resolveTargetItem(
  sourceItem: UnknownRecord,
  sourceTool: UnknownRecord,
  targetTool: UnknownRecord,
  targetItems: UnknownRecord[]
) {
  const sourceTitle = normalizeKey(sourceItem.title);
  const sourcePosition = canonicalPosition(
    sourceItem.position || sourceItem.unformatted_position,
    sourceTool
  );
  const exact = targetItems.find((targetItem) => {
    const targetTitle = normalizeKey(targetItem.title);
    const targetPosition = canonicalPosition(
      targetItem.position || targetItem.unformatted_position,
      targetTool
    );
    return Boolean(sourceTitle) && targetTitle === sourceTitle && targetPosition === sourcePosition;
  });
  if (exact) return exact;

  const titleMatches = targetItems.filter((targetItem) => normalizeKey(targetItem.title) === sourceTitle);
  return titleMatches.length === 1 ? titleMatches[0] : undefined;
}

function hasOriginalResponseAttribution(notes: unknown) {
  return /^Original response by [^\r\n]+/i.test(readStr(notes));
}

function stripClonedResponseAttribution(notes: unknown) {
  return readStr(notes).replace(/^Original response by [^\r\n]+(?:\r?\n){1,2}/i, "");
}

function responseKey(response: UnknownRecord) {
  return `${normalizeKey(stripClonedResponseAttribution(response.notes))}|${
    response.official === true ? "official" : "unofficial"
  }`;
}

function clonedResponseNotes(response: UnknownRecord) {
  const createdBy = isRecord(response.created_by) ? response.created_by : {};
  const responder = readStr(createdBy.name || createdBy.login) || "Unknown responder";
  const createdAtValue = readStr(response.created_at);
  const parsedCreatedAt = createdAtValue ? new Date(createdAtValue) : null;
  const createdAt = parsedCreatedAt && !Number.isNaN(parsedCreatedAt.getTime())
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(parsedCreatedAt)
    : "unknown date";
  const attribution = `Original response by ${responder} on ${createdAt}`;
  const notes = readStr(response.notes);
  return notes ? `${attribution}\n\n${notes}` : attribution;
}

function buildResponsePlans(sourceResponses: UnknownRecord[], targetResponses: UnknownRecord[]) {
  const targetResponsesByKey = new Map<string, UnknownRecord[]>();
  for (const response of targetResponses) {
    const key = responseKey(response);
    const matches = targetResponsesByKey.get(key) || [];
    matches.push(response);
    targetResponsesByKey.set(key, matches);
  }

  const consumedTargetIds = new Set<string>();
  return sourceResponses.map((response) => {
    const sourceId = readStr(response.id);
    const key = responseKey(response);
    const contentMatch = targetResponsesByKey
      .get(key)
      ?.find((candidate) => !consumedTargetIds.has(readStr(candidate.id)));
    const existingTargetResponse = contentMatch;
    const existingTargetResponseId = readStr(existingTargetResponse?.id) || null;
    if (existingTargetResponseId) consumedTargetIds.add(existingTargetResponseId);
    return {
      sourceId,
      position: readNum(response.position) ?? null,
      createdAt: readStr(response.created_at) || null,
      createdBy: isRecord(response.created_by)
        ? {
            id: readStr(response.created_by.id),
            name: readStr(response.created_by.name),
            login: readStr(response.created_by.login),
          }
        : null,
      payload: {
        notes: clonedResponseNotes(response),
        official: response.official === true,
        skip_emails: true,
      },
      sourceNotes: readStr(response.notes),
      existingTargetResponseId,
      needsAttributionUpdate: Boolean(
        existingTargetResponseId && !hasOriginalResponseAttribution(existingTargetResponse?.notes)
      ),
      skippedAttachments: unwrapArray(response.attachments).map((attachment) => ({
        id: readStr(attachment.id),
        name: readStr(attachment.name || attachment.filename),
        url: readStr(attachment.url),
      })),
    };
  });
}

async function fetchGenericToolItems(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  genericToolId: string;
  maxPages: number;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/generic_tools/${encodeURIComponent(
      params.genericToolId
    )}/generic_tool_items`,
    keys: ["generic_tool_items", "items"],
    maxPages: params.maxPages,
  });
}

async function fetchGenericToolItemResponses(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  genericToolId: string;
  genericToolItemId: string;
  maxPages: number;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/generic_tools/${encodeURIComponent(
      params.genericToolId
    )}/generic_tool_items/${encodeURIComponent(params.genericToolItemId)}/generic_tool_item_responses`,
    keys: ["generic_tool_item_responses", "responses"],
    maxPages: params.maxPages,
  });
}

async function createGenericToolItem(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  genericToolId: string;
  payload: UnknownRecord;
}) {
  return procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    method: "POST",
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/generic_tools/${encodeURIComponent(
      params.genericToolId
    )}/generic_tool_items`,
    body: { generic_tool_item: params.payload },
  });
}

async function updateGenericToolItem(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  genericToolId: string;
  genericToolItemId: string;
  payload: UnknownRecord;
}) {
  return procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    method: "PATCH",
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/generic_tools/${encodeURIComponent(
      params.genericToolId
    )}/generic_tool_items/${encodeURIComponent(params.genericToolItemId)}`,
    body: { generic_tool_item: params.payload },
  });
}

async function createGenericToolItemResponse(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  genericToolId: string;
  genericToolItemId: string;
  payload: UnknownRecord;
}) {
  return procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    method: "POST",
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/generic_tools/${encodeURIComponent(
      params.genericToolId
    )}/generic_tool_items/${encodeURIComponent(params.genericToolItemId)}/generic_tool_item_responses`,
    body: { generic_tool_item_response: params.payload },
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const { accessToken, tokenSource } = await getToken(body.accessToken);

    const sourceCompanyId = readStr(body.sourceCompanyId || body.companyId);
    const sourceProjectId = readStr(body.sourceProjectId || body.projectId);
    const targetCompanyId = readStr(body.targetCompanyId || procoreConfig.companyId);
    const targetProjectId = readStr(body.targetProjectId);
    const sourceGenericToolId = readStr(body.sourceGenericToolId || body.genericToolId);
    const genericToolTitle = normalizeKey(body.genericToolTitle || body.toolTitle);
    const dryRun = body.dryRun !== false;
    const createOffset = Math.max(0, Math.trunc(readNum(body.createOffset) || 0));
    const createLimit = Math.max(1, Math.min(100, Math.trunc(readNum(body.createLimit) || 25)));
    const maxPages = Math.max(1, Math.min(50, Math.trunc(readNum(body.maxPages) || 10)));

    if (!sourceCompanyId || !sourceProjectId || !targetCompanyId || !targetProjectId) {
      return NextResponse.json(
        { error: "Missing required fields: sourceCompanyId, sourceProjectId, targetCompanyId, targetProjectId." },
        { status: 400 }
      );
    }

    const [sourceTools, targetTools] = await Promise.all([
      fetchGenericTools({ accessToken, companyId: sourceCompanyId }),
      fetchGenericTools({ accessToken, companyId: targetCompanyId }),
    ]);
    const selectedSourceTools = sourceTools.filter((tool) => {
      if (sourceGenericToolId) return readStr(tool.id) === sourceGenericToolId;
      if (genericToolTitle) return normalizeKey(tool.title) === genericToolTitle || normalizeKey(tool.abbreviation) === genericToolTitle;
      return true;
    });

    const plans: UnknownRecord[] = [];
    const missingTools: UnknownRecord[] = [];
    for (const sourceTool of selectedSourceTools) {
      const sourceToolId = readStr(sourceTool.id);
      if (!sourceToolId) continue;
      const targetTool = resolveTargetTool(sourceTool, targetTools);
      if (!targetTool) {
        missingTools.push({
          sourceGenericToolId: sourceToolId,
          title: readStr(sourceTool.title),
          abbreviation: readStr(sourceTool.abbreviation),
        });
        continue;
      }

      const [items, targetItems] = await Promise.all([
        fetchGenericToolItems({
          accessToken,
          companyId: sourceCompanyId,
          projectId: sourceProjectId,
          genericToolId: sourceToolId,
          maxPages,
        }),
        fetchGenericToolItems({
          accessToken,
          companyId: targetCompanyId,
          projectId: targetProjectId,
          genericToolId: readStr(targetTool.id),
          maxPages,
        }),
      ]);

      for (const item of items) {
        const sourceItemId = readStr(item.id);
        if (!sourceItemId) continue;
        const targetItem = resolveTargetItem(item, sourceTool, targetTool, targetItems);
        const targetItemId = readStr(targetItem?.id);
        const [sourceResponses, targetResponses] = await Promise.all([
          fetchGenericToolItemResponses({
            accessToken,
            companyId: sourceCompanyId,
            projectId: sourceProjectId,
            genericToolId: sourceToolId,
            genericToolItemId: sourceItemId,
            maxPages,
          }),
          targetItemId
            ? fetchGenericToolItemResponses({
                accessToken,
                companyId: targetCompanyId,
                projectId: targetProjectId,
                genericToolId: readStr(targetTool.id),
                genericToolItemId: targetItemId,
                maxPages,
              })
            : Promise.resolve([]),
        ]);
        plans.push({
          sourceGenericToolId: sourceToolId,
          targetGenericToolId: readStr(targetTool.id),
          sourceToolTitle: readStr(sourceTool.title),
          targetToolTitle: readStr(targetTool.title),
          sourceId: sourceItemId,
          existingTargetId: targetItemId || null,
          existingTargetStatus: readStr(targetItem?.status) || null,
          title: readStr(item.title),
          position: readStr(item.position || item.unformatted_position),
          status: readStr(item.status),
          payload: buildGenericToolItemPayload(item),
          responses: buildResponsePlans(sourceResponses, targetResponses),
          skipped: {
            attachments: unwrapArray(item.attachments).map((attachment) => ({
              id: readStr(attachment.id),
              name: readStr(attachment.name),
              url: readStr(attachment.url),
            })),
            assignees: unwrapArray(item.assignees).map((assignee) => ({ id: readStr(assignee.id), name: readStr(assignee.name) })),
            distributionMembers: unwrapArray(item.distribution_members).map((member) => ({ id: readStr(member.id), name: readStr(member.name) })),
            customFields: isRecord(item.custom_fields) ? Object.keys(item.custom_fields) : [],
          },
        });
      }
    }

    const createResults: UnknownRecord[] = [];
    if (!dryRun) {
      for (const plan of plans.slice(createOffset, createOffset + createLimit)) {
        try {
          let targetItemId = readStr(plan.existingTargetId);
          let created: unknown = null;
          const responseResults: UnknownRecord[] = [];
          const responsePlans = Array.isArray(plan.responses) ? plan.responses.filter(isRecord) : [];
          const missingResponsePlans = responsePlans.filter((responsePlan) =>
            !readStr(responsePlan.existingTargetResponseId)
            && readStr(responsePlan.sourceNotes)
          );
          const desiredStatus = readStr(plan.status);
          const existingTargetStatus = readStr(plan.existingTargetStatus);
          let restoreStatus = "";
          if (!targetItemId) {
            const createPayload = isRecord(plan.payload) ? { ...plan.payload } : {};
            if (missingResponsePlans.length > 0 && normalizeKey(desiredStatus) === "closed") {
              createPayload.status = "Open";
              restoreStatus = desiredStatus;
            }
            created = await createGenericToolItem({
              accessToken,
              companyId: targetCompanyId,
              projectId: targetProjectId,
              genericToolId: readStr(plan.targetGenericToolId),
              payload: createPayload,
            });
            const createdRecord = unwrapData(created);
            targetItemId = isRecord(createdRecord) ? readStr(createdRecord.id) : "";
            if (!targetItemId) throw new Error("Procore created the correspondence but did not return its item id.");
          } else if (missingResponsePlans.length > 0 && normalizeKey(existingTargetStatus) === "closed") {
            await updateGenericToolItem({
              accessToken,
              companyId: targetCompanyId,
              projectId: targetProjectId,
              genericToolId: readStr(plan.targetGenericToolId),
              genericToolItemId: targetItemId,
              payload: { status: "Open", skip_emails: true },
            });
            restoreStatus = existingTargetStatus;
          }

          for (const responsePlan of responsePlans) {
            const existingTargetResponseId = readStr(responsePlan.existingTargetResponseId);
            if (existingTargetResponseId) {
              responseResults.push({
                sourceId: responsePlan.sourceId,
                ok: true,
                skippedExisting: true,
                missingOriginalAttribution: responsePlan.needsAttributionUpdate === true,
                targetResponseId: existingTargetResponseId,
              });
              continue;
            }
            try {
              const responsePayload = isRecord(responsePlan.payload) ? responsePlan.payload : {};
              if (!readStr(responsePlan.sourceNotes)) {
                responseResults.push({ sourceId: responsePlan.sourceId, ok: true, skippedBlank: true });
                continue;
              }
              const responseCreated = await createGenericToolItemResponse({
                accessToken,
                companyId: targetCompanyId,
                projectId: targetProjectId,
                genericToolId: readStr(plan.targetGenericToolId),
                genericToolItemId: targetItemId,
                payload: responsePayload,
              });
              responseResults.push({ sourceId: responsePlan.sourceId, ok: true, created: responseCreated });
            } catch (responseError) {
              responseResults.push({
                sourceId: responsePlan.sourceId,
                ok: false,
                error: responseError instanceof Error ? responseError.message : String(responseError),
                attemptedPayload: responsePlan.payload,
              });
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          if (restoreStatus) {
            try {
              const restored = await updateGenericToolItem({
                accessToken,
                companyId: targetCompanyId,
                projectId: targetProjectId,
                genericToolId: readStr(plan.targetGenericToolId),
                genericToolItemId: targetItemId,
                payload: { status: restoreStatus, skip_emails: true },
              });
              responseResults.push({ ok: true, statusRestored: restoreStatus, updated: restored });
            } catch (restoreError) {
              responseResults.push({
                ok: false,
                statusRestoreFailed: true,
                error: restoreError instanceof Error ? restoreError.message : String(restoreError),
                attemptedStatus: restoreStatus,
              });
            }
          }
          const responseFailures = responseResults.filter((result) => result.ok === false);
          createResults.push({
            sourceId: plan.sourceId,
            ok: responseFailures.length === 0,
            skippedExisting: Boolean(plan.existingTargetId),
            targetItemId,
            created,
            responseResults,
          });
        } catch (error) {
          createResults.push({
            sourceId: plan.sourceId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            attemptedPayload: plan.payload,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    const failed = createResults.filter((result) => result.ok === false);
    const sourceResponseCount = plans.reduce(
      (sum, plan) => sum + (Array.isArray(plan.responses) ? plan.responses.length : 0),
      0
    );
    const missingResponseCount = plans.reduce(
      (sum, plan) => sum + (Array.isArray(plan.responses)
        ? plan.responses.filter((response) => isRecord(response) && !readStr(response.existingTargetResponseId)).length
        : 0),
      0
    );
    const missingResponseAttributionCount = plans.reduce(
      (sum, plan) => sum + (Array.isArray(plan.responses)
        ? plan.responses.filter((response) => isRecord(response) && response.needsAttributionUpdate === true).length
        : 0),
      0
    );
    const responseResults = createResults.flatMap((result) =>
      Array.isArray(result.responseResults) ? result.responseResults.filter(isRecord) : []
    );
    return NextResponse.json({
      success: dryRun ? true : failed.length === 0,
      dryRun,
      tokenSource,
      source: { companyId: sourceCompanyId, projectId: sourceProjectId, genericToolId: sourceGenericToolId || null, genericToolTitle: genericToolTitle || null },
      target: { companyId: targetCompanyId, projectId: targetProjectId },
      counts: {
        sourceTools: selectedSourceTools.length,
        targetTools: targetTools.length,
        missingTools: missingTools.length,
        sourceItems: plans.length,
        existingTargetItems: plans.filter((plan) => readStr(plan.existingTargetId)).length,
        sourceResponses: sourceResponseCount,
        missingResponses: missingResponseCount,
        createOffset,
        createLimit,
        processed: createResults.length,
        created: createResults.filter((result) => result.ok === true && Boolean(result.created)).length,
        skippedExisting: createResults.filter((result) => result.skippedExisting === true).length,
        failed: failed.length,
        responsesCreated: responseResults.filter((result) => result.ok === true && Boolean(result.created)).length,
        responsesSkippedExisting: responseResults.filter((result) => result.skippedExisting === true).length,
        responsesMissingOriginalAttribution: missingResponseAttributionCount,
        responsesFailed: responseResults.filter((result) => result.ok === false).length,
      },
      readyForLiveClone: missingTools.length === 0,
      missingTools,
      plan: plans.slice(0, 200),
      createResults,
      nextStep: dryRun
        ? "Review plan and skipped attachments/custom fields. If ready, rerun live."
        : failed.length
          ? "Some correspondences failed. Review createResults."
          : "Correspondence clone batch complete.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Correspondence clone failed.", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
