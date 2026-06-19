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

      const items = await fetchGenericToolItems({
        accessToken,
        companyId: sourceCompanyId,
        projectId: sourceProjectId,
        genericToolId: sourceToolId,
        maxPages,
      });

      for (const item of items) {
        plans.push({
          sourceGenericToolId: sourceToolId,
          targetGenericToolId: readStr(targetTool.id),
          sourceToolTitle: readStr(sourceTool.title),
          targetToolTitle: readStr(targetTool.title),
          sourceId: readStr(item.id),
          title: readStr(item.title),
          position: readStr(item.position || item.unformatted_position),
          status: readStr(item.status),
          payload: buildGenericToolItemPayload(item),
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
          const created = await createGenericToolItem({
            accessToken,
            companyId: targetCompanyId,
            projectId: targetProjectId,
            genericToolId: readStr(plan.targetGenericToolId),
            payload: isRecord(plan.payload) ? plan.payload : {},
          });
          createResults.push({ sourceId: plan.sourceId, ok: true, created });
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
        createOffset,
        createLimit,
        created: createResults.filter((result) => result.ok === true).length,
        failed: failed.length,
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
