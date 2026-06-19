import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;
const DEFAULT_CROSSWALK_PATH = "Codes to use.xlsx";

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown, keys: string[] = []): UnknownRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["data", ...keys]) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested.filter(isRecord);
  }
  return [];
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

function readBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return fallback;
}

function normalize(value: unknown): string {
  return readStr(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function normCode(value: unknown): string {
  return readStr(value).replace(/\s+/g, "").toLowerCase();
}

function buildStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, mapValue] of Object.entries(value)) {
    const normalizedKey = readStr(key);
    const normalizedValue = readStr(mapValue);
    if (normalizedKey && normalizedValue) out[normalizedKey] = normalizedValue;
  }
  return out;
}

function readSheet(workbook: XLSX.WorkBook, sheetName: string): UnknownRecord[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" }) as UnknownRecord[];
}

function buildWorkbookFlatCodeMapFromWorkbook(workbook: XLSX.WorkBook) {
  const uniqueOld = readSheet(workbook, "Unique_old_codes");
  const uniqueNew = readSheet(workbook, "Unique_New_codes");
  const nonUniqueOld = readSheet(workbook, "Non_unique_old_codes");
  const nonUniqueNew = readSheet(workbook, "non_unique_new_codes");
  const allOld = [...uniqueOld, ...nonUniqueOld];
  const allNew = [...uniqueNew, ...nonUniqueNew];

  const oldCostCodeCounts = new Map<string, number>();
  for (const row of allOld) {
    const key = normCode(row["Cost Code"]);
    if (key) oldCostCodeCounts.set(key, (oldCostCodeCounts.get(key) || 0) + 1);
  }

  const newRowsByCostCode = new Map<string, UnknownRecord[]>();
  for (const row of allNew) {
    const key = normCode(row["Cost Code"]);
    if (key) newRowsByCostCode.set(key, [...(newRowsByCostCode.get(key) || []), row]);
  }

  const flatCodeMap: Record<string, string> = {};
  const issues: UnknownRecord[] = [];
  for (const [oldCostCode, oldCount] of oldCostCodeCounts.entries()) {
    const newRows = newRowsByCostCode.get(oldCostCode) || [];
    const targetFlatCodes = new Set(
      newRows
        .map((row) => {
          const costCode = readStr(row["Cost Code"]);
          const costType = readStr(row["Cost code type"]);
          return costCode && costType ? `${costCode}.${costType}` : "";
        })
        .filter(Boolean)
    );
    if (targetFlatCodes.size === 1) {
      const targetFlatCode = [...targetFlatCodes][0];
      flatCodeMap[oldCostCode] = targetFlatCode;
      flatCodeMap[oldCostCode.toUpperCase()] = targetFlatCode;
    } else if (oldCount === 1 && targetFlatCodes.size === 0) {
      issues.push({ oldCostCode, issue: "missing_new_workbook_cost_code", matchCount: 0 });
    } else if (targetFlatCodes.size > 1) {
      issues.push({ oldCostCode, issue: "ambiguous_new_workbook_cost_type", matchCount: targetFlatCodes.size, candidates: [...targetFlatCodes] });
    }
  }

  return {
    flatCodeMap,
    issues,
    summary: {
      uniqueOld: uniqueOld.length,
      uniqueNew: uniqueNew.length,
      nonUniqueOld: nonUniqueOld.length,
      nonUniqueNew: nonUniqueNew.length,
      mappedCostCodes: Object.keys(flatCodeMap).length,
      crosswalkIssues: issues.length,
    },
  };
}

function buildWorkbookFlatCodeMap(crosswalkPath: string) {
  return buildWorkbookFlatCodeMapFromWorkbook(XLSX.read(readFileSync(crosswalkPath), { type: "buffer" }));
}

function buildWorkbookFlatCodeMapFromBase64(base64: string) {
  return buildWorkbookFlatCodeMapFromWorkbook(XLSX.read(Buffer.from(base64, "base64"), { type: "buffer" }));
}

function parseIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(readStr).filter(Boolean);
  return readStr(value)
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function nestedRecord(value: unknown, key: string): UnknownRecord {
  return isRecord(value) && isRecord(value[key]) ? value[key] as UnknownRecord : {};
}

function nestedArray(value: unknown, key: string): UnknownRecord[] {
  return isRecord(value) ? asArray(value[key]) : [];
}

function getEstimateImpact(impact: UnknownRecord) {
  const estimate = nestedRecord(impact, "estimate");
  const payload: UnknownRecord = {};
  const quantity = readStr(estimate.quantity);
  const unitCost = readStr(estimate.unit_cost);
  const amount = readStr(estimate.amount);
  const uom = readStr(estimate.unit_of_measure || nestedRecord(estimate, "uom").id || nestedRecord(estimate, "uom").name);
  const calculationStrategy = readStr(estimate.calculation_strategy);
  if (quantity) payload.quantity = quantity;
  if (unitCost) payload.unit_cost = unitCost;
  if (amount) payload.amount = amount;
  if (uom) payload.unit_of_measure = uom;
  if (calculationStrategy) payload.calculation_strategy = calculationStrategy;
  return Object.keys(payload).length ? payload : undefined;
}

function compactPayload(payload: UnknownRecord) {
  for (const key of Object.keys(payload)) {
    const value = payload[key];
    if (value === undefined || value === null || value === "") delete payload[key];
    if (isRecord(value)) {
      compactPayload(value);
      if (Object.keys(value).length === 0) delete payload[key];
    }
  }
  return payload;
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
    const pageRows = asArray(payload, params.keys || []);
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
  }
  return rows;
}

async function fetchChangeEvents(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.1/change_events?project_id=${encodeURIComponent(params.projectId)}`,
    maxPages: params.maxPages,
  });
}

async function fetchBudgetLineItems(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.1/budget_line_items?project_id=${encodeURIComponent(params.projectId)}`,
    keys: ["budget_line_items"],
    maxPages: params.maxPages,
  });
}

function buildBudgetCodeIndexes(budgetLineItems: UnknownRecord[]) {
  const byFlatCode = new Map<string, UnknownRecord[]>();
  const byCostCode = new Map<string, UnknownRecord[]>();

  for (const item of budgetLineItems) {
    const wbsCode = nestedRecord(item, "wbs_code");
    const id = readStr(wbsCode.id || item.wbs_code_id || item.id);
    const flatCode = readStr(wbsCode.flat_code || item.flat_code);
    if (!id || !flatCode) continue;
    const costCode = flatCode.split(".")[0] || flatCode;
    const indexed = { id, flatCode, description: readStr(wbsCode.description) };
    const flatKey = normalize(flatCode);
    const costKey = normalize(costCode);
    byFlatCode.set(flatKey, [...(byFlatCode.get(flatKey) || []), indexed]);
    byCostCode.set(costKey, [...(byCostCode.get(costKey) || []), indexed]);
  }

  return { byFlatCode, byCostCode };
}

function mappedFlatCode(sourceFlatCode: string, lineItemTypeCodeMap: Record<string, string>) {
  const [costCode, typeCode] = sourceFlatCode.split(".");
  if (!costCode || !typeCode) return sourceFlatCode;
  const mappedType = lineItemTypeCodeMap[typeCode] || lineItemTypeCodeMap[typeCode.toUpperCase()] || lineItemTypeCodeMap[typeCode.toLowerCase()];
  return mappedType ? `${costCode}.${mappedType}` : sourceFlatCode;
}

function resolveBudgetCode(params: {
  sourceBudgetCode: UnknownRecord;
  targetIndex: ReturnType<typeof buildBudgetCodeIndexes>;
  budgetCodeIdMap: Record<string, string>;
  flatCodeMap: Record<string, string>;
  workbookFlatCodeMap: Record<string, string>;
  lineItemTypeCodeMap: Record<string, string>;
}) {
  const sourceId = readStr(params.sourceBudgetCode.id);
  const sourceFlatCode = readStr(params.sourceBudgetCode.flat_code);
  if (sourceId && params.budgetCodeIdMap[sourceId]) {
    return { id: params.budgetCodeIdMap[sourceId], strategy: "budget_code_id_map" };
  }
  if (sourceFlatCode && params.flatCodeMap[sourceFlatCode]) {
    const mapped = params.flatCodeMap[sourceFlatCode];
    const matches = params.targetIndex.byFlatCode.get(normalize(mapped)) || [];
    if (matches.length === 1) return { id: readStr(matches[0].id), strategy: "flat_code_map" };
    if (/^\d+$/.test(mapped)) return { id: mapped, strategy: "flat_code_map_to_id" };
    return { id: "", issue: matches.length === 0 ? "mapped_flat_code_not_found" : "mapped_flat_code_ambiguous", matchCount: matches.length };
  }
  const sourceCostCode = sourceFlatCode.split(".")[0] || sourceFlatCode;
  const workbookMapped = params.workbookFlatCodeMap[normCode(sourceCostCode)] || params.workbookFlatCodeMap[sourceCostCode];
  if (workbookMapped) {
    const matches = params.targetIndex.byFlatCode.get(normalize(workbookMapped)) || [];
    if (matches.length === 1) return { id: readStr(matches[0].id), strategy: "workbook_cost_code_type" };
    if (matches.length > 1) return { id: "", issue: "workbook_flat_code_ambiguous", matchCount: matches.length };
  }
  const targetFlatCode = mappedFlatCode(sourceFlatCode, params.lineItemTypeCodeMap);
  const flatMatches = params.targetIndex.byFlatCode.get(normalize(targetFlatCode)) || [];
  if (flatMatches.length === 1) return { id: readStr(flatMatches[0].id), strategy: targetFlatCode === sourceFlatCode ? "flat_code_exact" : "line_item_type_code_map" };
  if (flatMatches.length > 1) return { id: "", issue: "target_flat_code_ambiguous", matchCount: flatMatches.length };

  const costCode = sourceCostCode;
  const costMatches = params.targetIndex.byCostCode.get(normalize(costCode)) || [];
  if (costMatches.length === 1) return { id: readStr(costMatches[0].id), strategy: "unique_cost_code_fallback" };
  return {
    id: "",
    issue: costMatches.length === 0 ? "target_budget_code_missing" : "target_cost_code_ambiguous",
    matchCount: costMatches.length,
    sourceFlatCode,
  };
}

function buildChangeItemPayload(item: UnknownRecord, targetBudgetCodeId: string) {
  const costImpact = getEstimateImpact(nestedRecord(item, "cost_impact"));
  const revenueImpact = getEstimateImpact(nestedRecord(item, "revenue_impact"));
  return compactPayload({
    description: readStr(item.description),
    budget_code: targetBudgetCodeId ? { id: Number(targetBudgetCodeId) || targetBudgetCodeId } : undefined,
    cost_impact: costImpact ? { estimate: costImpact } : undefined,
    revenue_impact: revenueImpact ? { estimate: revenueImpact } : undefined,
  });
}

function buildChangeEventPayload(params: {
  event: UnknownRecord;
  changeItems: UnknownRecord[];
  preserveNumber: boolean;
}) {
  return compactPayload({
    project_id: readNum(params.event.project_id),
    number: params.preserveNumber ? readStr(params.event.number) : undefined,
    title: readStr(params.event.title) || "Untitled Change Event",
    description: readStr(params.event.description),
    scope: readStr(params.event.scope),
    status: readStr(params.event.status),
    comments_enabled: typeof params.event.comments_enabled === "boolean" ? params.event.comments_enabled : undefined,
    change_items: params.changeItems,
  });
}

async function createChangeEvent(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  payload: UnknownRecord;
}) {
  const payload = { ...params.payload, project_id: Number(params.projectId) || params.projectId };
  return procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    method: "POST",
    path: "/rest/v1.1/change_events",
    body: { change_event: payload },
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
    const dryRun = body.dryRun !== false;
    const cloneLineItems = readBool(body.cloneLineItems, true);
    const preserveNumber = readBool(body.preserveNumber, false);
    const allowUnmappedLineItems = readBool(body.allowUnmappedLineItems, false);
    const changeEventIds = new Set(parseIds(body.changeEventIds || body.ids));
    const createOffset = Math.max(0, Math.trunc(readNum(body.createOffset) || 0));
    const createLimit = Math.max(1, Math.min(100, Math.trunc(readNum(body.createLimit) || 25)));
    const maxPages = Math.max(1, Math.min(50, Math.trunc(readNum(body.maxPages) || 10)));
    const budgetCodeIdMap = buildStringMap(body.budgetCodeIdMap);
    const flatCodeMap = buildStringMap(body.flatCodeMap);
    const lineItemTypeCodeMap = buildStringMap(body.lineItemTypeCodeMap);
    const crosswalkWorkbookBase64 = readStr(body.crosswalkWorkbookBase64);
    const rawCrosswalkPath = readStr(body.crosswalkPath) || DEFAULT_CROSSWALK_PATH;
    const crosswalkPath = path.isAbsolute(rawCrosswalkPath)
      ? rawCrosswalkPath
      : path.join(process.cwd(), rawCrosswalkPath);

    if (!sourceCompanyId || !sourceProjectId || !targetCompanyId || !targetProjectId) {
      return NextResponse.json(
        { error: "Missing required fields: sourceCompanyId, sourceProjectId, targetCompanyId, targetProjectId." },
        { status: 400 }
      );
    }

    const [sourceEventsRaw, targetBudgetLineItems] = await Promise.all([
      fetchChangeEvents({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, maxPages }),
      fetchBudgetLineItems({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, maxPages: 50 }),
    ]);
    const sourceEvents = changeEventIds.size
      ? sourceEventsRaw.filter((event) => changeEventIds.has(readStr(event.id)) || changeEventIds.has(readStr(event.number)))
      : sourceEventsRaw;
    const targetBudgetIndex = buildBudgetCodeIndexes(targetBudgetLineItems);
    let workbookFlatCodeMap: Record<string, string> = {};
    const workbookCrosswalk: UnknownRecord = { enabled: false, source: "", summary: null, issues: [] };
    if (crosswalkWorkbookBase64) {
      const built = buildWorkbookFlatCodeMapFromBase64(crosswalkWorkbookBase64);
      workbookFlatCodeMap = built.flatCodeMap;
      workbookCrosswalk.enabled = true;
      workbookCrosswalk.source = "uploaded_workbook";
      workbookCrosswalk.summary = built.summary;
      workbookCrosswalk.issues = built.issues.slice(0, 50);
    } else if (crosswalkPath && existsSync(crosswalkPath)) {
      const built = buildWorkbookFlatCodeMap(crosswalkPath);
      workbookFlatCodeMap = built.flatCodeMap;
      workbookCrosswalk.enabled = true;
      workbookCrosswalk.source = crosswalkPath;
      workbookCrosswalk.summary = built.summary;
      workbookCrosswalk.issues = built.issues.slice(0, 50);
    } else {
      workbookCrosswalk.source = crosswalkPath;
      workbookCrosswalk.warning = "Crosswalk workbook not found.";
    }

    const missingMappings: UnknownRecord[] = [];
    const plan = sourceEvents.map((event) => {
      const sourceItems = cloneLineItems ? asArray(event.change_items) : [];
      const itemPlans = sourceItems.map((item) => {
        const sourceBudgetCode = nestedRecord(item, "budget_code");
        const mapping = resolveBudgetCode({
          sourceBudgetCode,
          targetIndex: targetBudgetIndex,
          budgetCodeIdMap,
          flatCodeMap,
          workbookFlatCodeMap,
          lineItemTypeCodeMap,
        });
        if (!mapping.id) {
          missingMappings.push({
            type: "change_event_line_item_budget_code",
            sourceChangeEventId: readStr(event.id),
            sourceChangeEventNumber: readStr(event.number),
            sourceLineItemId: readStr(item.id),
            description: readStr(item.description),
            sourceBudgetCodeId: readStr(sourceBudgetCode.id),
            sourceFlatCode: readStr(sourceBudgetCode.flat_code),
            issue: mapping.issue || "missing_budget_code_mapping",
            matchCount: mapping.matchCount || 0,
          });
        }
        return {
          sourceLineItemId: readStr(item.id),
          sourceFlatCode: readStr(sourceBudgetCode.flat_code),
          targetBudgetCodeId: mapping.id,
          matchStrategy: mapping.strategy || null,
          payload: mapping.id ? buildChangeItemPayload(item, mapping.id) : null,
        };
      });
      const validItems = itemPlans.filter((item) => isRecord(item.payload)).map((item) => item.payload as UnknownRecord);
      return {
        sourceId: readStr(event.id),
        sourceNumber: readStr(event.number),
        title: readStr(event.title),
        lineItemCount: sourceItems.length,
        mappedLineItemCount: validItems.length,
        skipped: {
          attachments: nestedArray(event, "attachments").map((attachment) => ({
            id: readStr(attachment.id),
            name: readStr(attachment.name || attachment.filename),
            url: readStr(attachment.url),
          })),
          customFields: isRecord(event.custom_fields) ? Object.keys(event.custom_fields) : [],
        },
        lineItems: itemPlans,
        payload: buildChangeEventPayload({ event, changeItems: validItems, preserveNumber }),
      };
    });

    const blockers = allowUnmappedLineItems ? [] : missingMappings;
    const createResults: UnknownRecord[] = [];
    if (!dryRun && blockers.length === 0) {
      for (const entry of plan.slice(createOffset, createOffset + createLimit)) {
        try {
          const created = await createChangeEvent({
            accessToken,
            companyId: targetCompanyId,
            projectId: targetProjectId,
            payload: isRecord(entry.payload) ? entry.payload : {},
          });
          createResults.push({ sourceId: entry.sourceId, ok: true, created });
        } catch (error) {
          createResults.push({
            sourceId: entry.sourceId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            attemptedPayload: entry.payload,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    }

    const failed = createResults.filter((result) => result.ok === false);
    return NextResponse.json({
      success: dryRun ? true : blockers.length === 0 && failed.length === 0,
      dryRun,
      tokenSource,
      source: { companyId: sourceCompanyId, projectId: sourceProjectId },
      target: { companyId: targetCompanyId, projectId: targetProjectId },
      options: { cloneLineItems, preserveNumber, allowUnmappedLineItems },
      workbookCrosswalk,
      counts: {
        sourceChangeEvents: sourceEvents.length,
        sourceLineItems: plan.reduce((sum, entry) => sum + (readNum(entry.lineItemCount) || 0), 0),
        mappedLineItems: plan.reduce((sum, entry) => sum + (readNum(entry.mappedLineItemCount) || 0), 0),
        targetBudgetLineItems: targetBudgetLineItems.length,
        missingMappings: missingMappings.length,
        createOffset,
        createLimit,
        created: createResults.filter((result) => result.ok === true).length,
        failed: failed.length,
      },
      readyForLiveClone: blockers.length === 0,
      missingMappings,
      plan: plan.slice(0, 200),
      createResults,
      nextStep: dryRun
        ? blockers.length
          ? "Resolve missingMappings or set allowUnmappedLineItems=true to clone headers and mapped lines only."
          : "Review plan. If ready, rerun live."
        : blockers.length
          ? "Live clone blocked by missing line-item budget code mappings."
          : failed.length
            ? "Some change events failed. Review createResults."
            : "Change event clone batch complete.",
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Failed to clone change events.", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
