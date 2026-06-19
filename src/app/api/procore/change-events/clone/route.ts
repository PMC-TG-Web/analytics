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

function wordTokens(value: unknown) {
  return normalize(value)
    .replace(/[^a-z0-9#./"'-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/ing$/, "").trim())
    .filter((token) => token.length > 2);
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
  const descriptionMappings: Array<{ key: string; targetFlatCode: string; oldName: string; oldCostCode: string }> = [];
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
      for (const oldRow of allOld.filter((row) => normCode(row["Cost Code"]) === oldCostCode)) {
        for (const keyValue of [oldRow.Name, oldRow.Description]) {
          const key = normalize(keyValue);
          if (key) descriptionMappings.push({ key, targetFlatCode, oldName: readStr(oldRow.Name), oldCostCode: readStr(oldRow["Cost Code"]) });
        }
      }
    } else if (oldCount === 1 && targetFlatCodes.size === 0) {
      issues.push({ oldCostCode, issue: "missing_new_workbook_cost_code", matchCount: 0 });
    } else if (targetFlatCodes.size > 1) {
      issues.push({ oldCostCode, issue: "ambiguous_new_workbook_cost_type", matchCount: targetFlatCodes.size, candidates: [...targetFlatCodes] });
    }
  }

  return {
    flatCodeMap,
    descriptionMappings,
    issues,
    summary: {
      uniqueOld: uniqueOld.length,
      uniqueNew: uniqueNew.length,
      nonUniqueOld: nonUniqueOld.length,
      nonUniqueNew: nonUniqueNew.length,
      mappedCostCodes: Object.keys(flatCodeMap).length,
      descriptionMappings: descriptionMappings.length,
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

async function fetchChangeEventStatuses(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.1/change_events/statuses?project_id=${encodeURIComponent(params.projectId)}`,
    keys: ["statuses", "change_event_statuses"],
    maxPages: 5,
  });
}

async function fetchChangeEventTypes(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.1/change_events/change_types?project_id=${encodeURIComponent(params.projectId)}`,
    keys: ["change_types", "change_event_types"],
    maxPages: 5,
  });
}

async function fetchChangeReasons(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/change_order_change_reasons?project_id=${encodeURIComponent(params.projectId)}`,
    keys: ["change_order_change_reasons", "reasons"],
    maxPages: 5,
  });
}

function statusKey(status: UnknownRecord) {
  return normalize(status.mapped_to_status || status.name);
}

function resolveTargetStatus(sourceStatusValue: unknown, targetStatuses: UnknownRecord[]) {
  const sourceStatus = isRecord(sourceStatusValue)
    ? sourceStatusValue
    : { name: readStr(sourceStatusValue), mapped_to_status: readStr(sourceStatusValue) };
  const sourceMapped = statusKey(sourceStatus) || "open";
  const sourceName = normalize(sourceStatus.name) || sourceMapped;
  const target =
    targetStatuses.find((status) => statusKey(status) === sourceMapped) ||
    targetStatuses.find((status) => normalize(status.name) === sourceName) ||
    targetStatuses.find((status) => statusKey(status) === "open") ||
    targetStatuses[0];
  return target ? { id: readNum(target.id) || readStr(target.id) } : { name: "Open", mapped_to_status: "open" };
}

function resolveTargetChangeType(sourceTypeValue: unknown, targetTypes: UnknownRecord[]) {
  if (!isRecord(sourceTypeValue)) return undefined;
  const sourceName = normalize(sourceTypeValue.name || sourceTypeValue.change_type);
  if (!sourceName) return undefined;
  const target =
    targetTypes.find((type) => normalize(type.name || type.change_type) === sourceName) ||
    targetTypes.find((type) => normalize(type.name || type.change_type) === "tbd") ||
    targetTypes[0];
  return target ? { id: readNum(target.id) || readStr(target.id) } : undefined;
}

function resolveTargetChangeReason(sourceReasonValue: unknown, targetReasons: UnknownRecord[]) {
  if (!isRecord(sourceReasonValue)) return undefined;
  const sourceName = normalize(sourceReasonValue.change_reason || sourceReasonValue.name);
  if (!sourceName) return undefined;
  const target = targetReasons.find((reason) => normalize(reason.change_reason || reason.name) === sourceName);
  return target ? { id: readNum(target.id) || readStr(target.id) } : undefined;
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

function resolveDescriptionWorkbookMapping(
  description: unknown,
  mappings: Array<{ key: string; targetFlatCode: string; oldName: string; oldCostCode: string }>
) {
  const normalized = normalize(description);
  if (!normalized) return null;
  const exact = mappings.filter((mapping) => mapping.key === normalized);
  if (exact.length === 1) return { ...exact[0], strategy: "workbook_description_exact" };

  const descriptionTokens = new Set(wordTokens(description));
  if (descriptionTokens.size === 0) return null;
  const scored = mappings
    .map((mapping) => {
      const mappingTokens = new Set(wordTokens(mapping.key));
      let score = 0;
      for (const token of descriptionTokens) {
        if (mappingTokens.has(token)) score += 1;
      }
      if (mapping.key.includes(normalized) || normalized.includes(mapping.key)) score += 2;
      return { mapping, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  if (scored.length === 0) return null;
  const bestScore = scored[0].score;
  const best = scored.filter((entry) => entry.score === bestScore);
  const targetFlatCodes = new Set(best.map((entry) => entry.mapping.targetFlatCode));
  if (targetFlatCodes.size === 1) {
    return { ...best[0].mapping, strategy: "workbook_description_token" };
  }
  return {
    targetFlatCode: "",
    oldName: "",
    oldCostCode: "",
    strategy: "workbook_description_ambiguous",
    candidates: best.slice(0, 8).map((entry) => entry.mapping),
  };
}

function resolveBudgetCode(params: {
  sourceBudgetCode: UnknownRecord;
  description: string;
  targetIndex: ReturnType<typeof buildBudgetCodeIndexes>;
  budgetCodeIdMap: Record<string, string>;
  flatCodeMap: Record<string, string>;
  workbookFlatCodeMap: Record<string, string>;
  workbookDescriptionMappings: Array<{ key: string; targetFlatCode: string; oldName: string; oldCostCode: string }>;
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
    if (matches.length > 1) return { id: "", issue: "workbook_flat_code_ambiguous", matchCount: matches.length, mappedFlatCode: workbookMapped };
    return { id: "", issue: "workbook_target_budget_code_missing", matchCount: 0, mappedFlatCode: workbookMapped };
  }
  if (!sourceFlatCode) {
    const descriptionMapping = resolveDescriptionWorkbookMapping(params.description, params.workbookDescriptionMappings);
    if (descriptionMapping?.targetFlatCode) {
      const matches = params.targetIndex.byFlatCode.get(normalize(descriptionMapping.targetFlatCode)) || [];
      if (matches.length === 1) return { id: readStr(matches[0].id), strategy: descriptionMapping.strategy };
      if (matches.length > 1) {
        return {
          id: "",
          issue: "workbook_description_target_ambiguous",
          matchCount: matches.length,
          mappedFlatCode: descriptionMapping.targetFlatCode,
          workbookMatch: { oldName: descriptionMapping.oldName, oldCostCode: descriptionMapping.oldCostCode },
        };
      }
      return {
        id: "",
        issue: "workbook_description_target_missing",
        matchCount: 0,
        mappedFlatCode: descriptionMapping.targetFlatCode,
        workbookMatch: { oldName: descriptionMapping.oldName, oldCostCode: descriptionMapping.oldCostCode },
      };
    }
    if (descriptionMapping?.strategy === "workbook_description_ambiguous") {
      return {
        id: "",
        issue: "workbook_description_ambiguous",
        matchCount: Array.isArray(descriptionMapping.candidates) ? descriptionMapping.candidates.length : 0,
        candidates: descriptionMapping.candidates,
      };
    }
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
  const sourceOfRevenueRom = readStr(nestedRecord(item, "revenue_impact").source_of_revenue_rom);
  return compactPayload({
    description: readStr(item.description),
    budget_code: targetBudgetCodeId ? { id: Number(targetBudgetCodeId) || targetBudgetCodeId } : undefined,
    cost_impact: costImpact ? { estimate: costImpact } : undefined,
    revenue_impact: revenueImpact
      ? { estimate: revenueImpact, source_of_revenue_rom: sourceOfRevenueRom || undefined }
      : sourceOfRevenueRom
        ? { source_of_revenue_rom: sourceOfRevenueRom }
        : undefined,
  });
}

function buildChangeEventPayload(params: {
  event: UnknownRecord;
  changeItems: UnknownRecord[];
  preserveNumber: boolean;
  status: UnknownRecord;
  changeType?: UnknownRecord;
  changeReason?: UnknownRecord;
}) {
  return compactPayload({
    project_id: readNum(params.event.project_id),
    number: params.preserveNumber ? readStr(params.event.number) : undefined,
    title: readStr(params.event.title) || "Untitled Change Event",
    description: readStr(params.event.description),
    scope: readStr(params.event.scope),
    status: params.status,
    change_type: params.changeType,
    change_reason: params.changeReason,
    source_of_revenue_rom: readStr(params.event.source_of_revenue_rom),
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
  const projectId = Number(params.projectId) || params.projectId;
  const companyId = Number(params.companyId) || params.companyId;
  const query = new URLSearchParams({
    project_id: params.projectId,
    company_id: params.companyId,
  });
  const payload = { ...params.payload, project_id: projectId, company_id: companyId };
  return procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    method: "POST",
    path: `/rest/v1.1/change_events?${query.toString()}`,
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

    const [sourceEventsRaw, targetEventsRaw, targetBudgetLineItems, targetStatuses, targetTypes, targetReasons] = await Promise.all([
      fetchChangeEvents({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, maxPages }),
      fetchChangeEvents({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, maxPages: 50 }),
      fetchBudgetLineItems({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, maxPages: 50 }),
      fetchChangeEventStatuses({ accessToken, companyId: targetCompanyId, projectId: targetProjectId }),
      fetchChangeEventTypes({ accessToken, companyId: targetCompanyId, projectId: targetProjectId }),
      fetchChangeReasons({ accessToken, companyId: targetCompanyId, projectId: targetProjectId }),
    ]);
    const sourceEvents = changeEventIds.size
      ? sourceEventsRaw.filter((event) => changeEventIds.has(readStr(event.id)) || changeEventIds.has(readStr(event.number)))
      : sourceEventsRaw;
    const targetByNumber = new Map<string, UnknownRecord>();
    for (const event of targetEventsRaw) {
      const number = readStr(event.number);
      if (number) targetByNumber.set(number, event);
    }
    const targetBudgetIndex = buildBudgetCodeIndexes(targetBudgetLineItems);
    let workbookFlatCodeMap: Record<string, string> = {};
    let workbookDescriptionMappings: Array<{ key: string; targetFlatCode: string; oldName: string; oldCostCode: string }> = [];
    const workbookCrosswalk: UnknownRecord = { enabled: false, source: "", summary: null, issues: [] };
    if (crosswalkWorkbookBase64) {
      const built = buildWorkbookFlatCodeMapFromBase64(crosswalkWorkbookBase64);
      workbookFlatCodeMap = built.flatCodeMap;
      workbookDescriptionMappings = built.descriptionMappings;
      workbookCrosswalk.enabled = true;
      workbookCrosswalk.source = "uploaded_workbook";
      workbookCrosswalk.summary = built.summary;
      workbookCrosswalk.issues = built.issues.slice(0, 50);
    } else if (crosswalkPath && existsSync(crosswalkPath)) {
      const built = buildWorkbookFlatCodeMap(crosswalkPath);
      workbookFlatCodeMap = built.flatCodeMap;
      workbookDescriptionMappings = built.descriptionMappings;
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
          description: readStr(item.description),
          targetIndex: targetBudgetIndex,
          budgetCodeIdMap,
          flatCodeMap,
          workbookFlatCodeMap,
          workbookDescriptionMappings,
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
            mappedFlatCode: mapping.mappedFlatCode,
            workbookMatch: mapping.workbookMatch,
            candidates: mapping.candidates,
          });
        }
        return {
          sourceLineItemId: readStr(item.id),
          sourceFlatCode: readStr(sourceBudgetCode.flat_code),
          targetBudgetCodeId: mapping.id,
          matchStrategy: mapping.strategy || null,
          unmappedBudgetCodeAllowed: !mapping.id && allowUnmappedLineItems,
          payload: mapping.id || allowUnmappedLineItems ? buildChangeItemPayload(item, mapping.id) : null,
        };
      });
      const validItems = itemPlans.filter((item) => isRecord(item.payload)).map((item) => item.payload as UnknownRecord);
      const targetStatus = resolveTargetStatus(event.status, targetStatuses);
      const targetChangeType = resolveTargetChangeType(event.change_type, targetTypes);
      const targetChangeReason = resolveTargetChangeReason(event.change_reason, targetReasons);
      return {
        sourceId: readStr(event.id),
        sourceNumber: readStr(event.number),
        title: readStr(event.title),
        sourceChangeType: isRecord(event.change_type) ? readStr(event.change_type.name || event.change_type.change_type) : "",
        sourceChangeReason: isRecord(event.change_reason) ? readStr(event.change_reason.change_reason || event.change_reason.name) : "",
        lineItemCount: sourceItems.length,
        mappedLineItemCount: itemPlans.filter((item) => readStr(item.targetBudgetCodeId)).length,
        skipped: {
          attachments: nestedArray(event, "attachments").map((attachment) => ({
            id: readStr(attachment.id),
            name: readStr(attachment.name || attachment.filename),
            url: readStr(attachment.url),
          })),
          customFields: isRecord(event.custom_fields) ? Object.keys(event.custom_fields) : [],
        },
        lineItems: itemPlans,
        payload: buildChangeEventPayload({
          event,
          changeItems: validItems,
          preserveNumber,
          status: targetStatus,
          changeType: targetChangeType,
          changeReason: targetChangeReason,
        }),
      };
    });

    const blockers = allowUnmappedLineItems ? [] : missingMappings;
    const createResults: UnknownRecord[] = [];
    if (!dryRun && blockers.length === 0) {
      for (const entry of plan.slice(createOffset, createOffset + createLimit)) {
        try {
          const existingTarget = preserveNumber ? targetByNumber.get(readStr(entry.sourceNumber)) : undefined;
          if (existingTarget) {
            createResults.push({
              sourceId: entry.sourceId,
              sourceNumber: entry.sourceNumber,
              ok: true,
              reused: true,
              targetId: readStr(existingTarget.id),
              message: "Target change event number already exists; reused existing event.",
            });
            continue;
          }
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
    const firstFailure = failed.find(isRecord);
    const topLevelError = blockers.length
      ? "Change event clone blocked by missing line-item budget code mappings."
      : failed.length
        ? "Change event clone finished with create errors."
        : undefined;
    const topLevelDetails = firstFailure ? readStr(firstFailure.error) : undefined;
    return NextResponse.json({
      success: dryRun ? true : blockers.length === 0 && failed.length === 0,
      error: topLevelError,
      details: topLevelDetails,
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
        creatableLineItems: plan.reduce(
          (sum, entry) =>
            sum +
            (Array.isArray(entry.lineItems)
              ? entry.lineItems.filter((item) => isRecord(item) && isRecord(item.payload)).length
              : 0),
          0
        ),
        unmappedLineItemsAllowed: allowUnmappedLineItems ? missingMappings.length : 0,
        targetBudgetLineItems: targetBudgetLineItems.length,
        existingTargetChangeEvents: targetEventsRaw.length,
        targetStatuses: targetStatuses.length,
        targetChangeTypes: targetTypes.length,
        targetChangeReasons: targetReasons.length,
        missingMappings: missingMappings.length,
        createOffset,
        createLimit,
        created: createResults.filter((result) => result.ok === true).length,
        reused: createResults.filter((result) => result.ok === true && result.reused === true).length,
        failed: failed.length,
      },
      readyForLiveClone: blockers.length === 0,
      missingMappings,
      plan: plan.slice(0, 200),
      createResults,
      failedCreateResults: failed,
      nextStep: dryRun
        ? blockers.length
          ? "Resolve missingMappings or set allowUnmappedLineItems=true to try creating unmapped lines without budget_code."
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
