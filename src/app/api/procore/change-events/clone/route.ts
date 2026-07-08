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

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isBlankValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  return false;
}

function cloneForCreate(value: unknown): unknown {
  if (Array.isArray(value)) {
    const next = value
      .map((entry) => cloneForCreate(entry))
      .filter((entry) => !isBlankValue(entry));
    return next;
  }
  if (!isRecord(value)) return value;

  const next: UnknownRecord = {};
  for (const [key, nested] of Object.entries(value)) {
    if (
      [
        "id",
        "_id",
        "created_at",
        "updated_at",
        "deleted_at",
        "company_id",
        "project_id",
        "created_by",
        "updated_by",
        "attachments",
        "links",
        "origin_data",
        "lineage",
        "prime_contract_for_estimates",
      ].includes(key)
    ) {
      continue;
    }
    const cloned = cloneForCreate(nested);
    if (!isBlankValue(cloned)) next[key] = cloned;
  }
  return next;
}

function mergeMissingFields(candidate: unknown, target: unknown): unknown {
  if (isBlankValue(candidate)) return undefined;
  if (Array.isArray(candidate)) {
    if (Array.isArray(target) && target.length > 0) return undefined;
    return candidate;
  }
  if (isRecord(candidate)) {
    const next: UnknownRecord = {};
    for (const [key, value] of Object.entries(candidate)) {
      const merged = mergeMissingFields(value, isRecord(target) ? target[key] : undefined);
      if (!isBlankValue(merged)) next[key] = merged;
    }
    return Object.keys(next).length ? next : undefined;
  }
  return isBlankValue(target) ? candidate : undefined;
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

async function fetchGenericTools(params: { accessToken: string; companyId: string }) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/companies/${encodeURIComponent(params.companyId)}/generic_tools`,
    keys: ["generic_tools"],
    maxPages: 10,
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

async function createGenericToolItem(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  genericToolId: string;
  sourceItem: UnknownRecord;
}) {
  const title = readStr(params.sourceItem.title) || "Cloned Origin Item";
  const payload = compactPayload({
    title,
    description: readStr(params.sourceItem.description || params.sourceItem.body || params.sourceItem.note),
    position: readNum(params.sourceItem.position || params.sourceItem.unformatted_position),
  });

  const bodies = [
    { generic_tool_item: payload },
    { item: payload },
    payload,
  ];

  const path = `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/generic_tools/${encodeURIComponent(
    params.genericToolId
  )}/generic_tool_items`;

  const attempts: UnknownRecord[] = [];
  for (const body of bodies) {
    try {
      const response = await procoreJson({
        accessToken: params.accessToken,
        companyId: params.companyId,
        method: "POST",
        path,
        body,
      });
      const created = isRecord(response)
        ? isRecord(response.data)
          ? response.data
          : isRecord(response.generic_tool_item)
            ? response.generic_tool_item
            : response
        : {};
      const createdId = readNum(created.id) || readStr(created.id);
      attempts.push({ path, body, ok: true, createdId: createdId || null });
      if (createdId) return { ok: true, id: createdId, attempts };
    } catch (error) {
      attempts.push({ path, body, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const hadSuccessWithoutId = attempts.some((attempt) => attempt.ok === true);
  return {
    ok: false,
    error: hadSuccessWithoutId ? "generic_tool_item_create_missing_id" : "generic_tool_item_create_failed",
    attempts,
  };
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

function toolKey(tool: UnknownRecord) {
  return `${normalize(tool.title)}|${normalize(tool.abbreviation)}`;
}

function resolveTargetTool(sourceTool: UnknownRecord, targetTools: UnknownRecord[]) {
  const sourceId = readStr(sourceTool.id);
  const sourceTitle = normalize(sourceTool.title);
  const sourceAbbreviation = normalize(sourceTool.abbreviation);
  return (
    targetTools.find((tool) => readStr(tool.id) === sourceId) ||
    targetTools.find((tool) => toolKey(tool) === toolKey(sourceTool)) ||
    targetTools.find((tool) => normalize(tool.title) === sourceTitle && sourceTitle) ||
    targetTools.find((tool) => normalize(tool.abbreviation) === sourceAbbreviation && sourceAbbreviation)
  );
}

function genericToolIdFromOrigin(origin: UnknownRecord) {
  const url = readStr(origin.web_page_url);
  const match = url.match(/[?&]tool_id=(\d+)/);
  return match?.[1] || "";
}

function itemMatchKeys(item: UnknownRecord) {
  const title = normalize(item.title);
  const position = normalize(item.position || item.unformatted_position);
  return {
    title,
    titlePosition: title && position ? `${title}|${position}` : "",
  };
}

function normalizeItemDescription(item: UnknownRecord) {
  return normalize(item.description || item.body || item.note);
}

function resolveDeterministicOriginMatch(matches: UnknownRecord[], sourceItem: UnknownRecord) {
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0];

  const sourceDescription = normalizeItemDescription(sourceItem);
  if (sourceDescription) {
    const sameDescription = matches.filter((item) => normalizeItemDescription(item) === sourceDescription);
    if (sameDescription.length === 1) return sameDescription[0];
    if (sameDescription.length > 1) {
      return [...sameDescription].sort((a, b) => readStr(b.id).localeCompare(readStr(a.id), undefined, { numeric: true }))[0];
    }
  }

  return [...matches].sort((a, b) => readStr(b.id).localeCompare(readStr(a.id), undefined, { numeric: true }))[0];
}

async function buildEventOriginMap(params: {
  accessToken: string;
  sourceCompanyId: string;
  sourceProjectId: string;
  targetCompanyId: string;
  targetProjectId: string;
  sourceEvents: UnknownRecord[];
  maxPages: number;
  dryRun: boolean;
  autoCreateMissingOriginItems: boolean;
}) {
  const sourceOrigins = params.sourceEvents
    .map((event) => nestedRecord(event, "event_origin"))
    .filter((origin) => readStr(origin.origin_id) && readStr(origin.origin_type) === "generic_tools");
  const sourceToolIds = [...new Set(sourceOrigins.map(genericToolIdFromOrigin).filter(Boolean))];
  const originBySourceId = new Map<string, UnknownRecord>();
  const issues: UnknownRecord[] = [];

  if (sourceToolIds.length === 0) {
    return { originBySourceId, issues, sourceToolIds, targetToolIds: [] };
  }

  const [sourceTools, targetTools] = await Promise.all([
    fetchGenericTools({ accessToken: params.accessToken, companyId: params.sourceCompanyId }),
    fetchGenericTools({ accessToken: params.accessToken, companyId: params.targetCompanyId }),
  ]);
  const targetToolIds: string[] = [];

  for (const sourceToolId of sourceToolIds) {
    const sourceTool = sourceTools.find((tool) => readStr(tool.id) === sourceToolId);
    if (!sourceTool) {
      issues.push({ type: "event_origin", sourceGenericToolId: sourceToolId, issue: "source_generic_tool_missing" });
      continue;
    }
    const targetTool = resolveTargetTool(sourceTool, targetTools);
    const targetToolId = readStr(targetTool?.id);
    if (!targetToolId) {
      issues.push({
        type: "event_origin",
        sourceGenericToolId: sourceToolId,
        sourceToolTitle: readStr(sourceTool.title),
        issue: "target_generic_tool_missing",
      });
      continue;
    }
    targetToolIds.push(targetToolId);

    const [sourceItems, targetItems] = await Promise.all([
      fetchGenericToolItems({
        accessToken: params.accessToken,
        companyId: params.sourceCompanyId,
        projectId: params.sourceProjectId,
        genericToolId: sourceToolId,
        maxPages: params.maxPages,
      }),
      fetchGenericToolItems({
        accessToken: params.accessToken,
        companyId: params.targetCompanyId,
        projectId: params.targetProjectId,
        genericToolId: targetToolId,
        maxPages: params.maxPages,
      }),
    ]);

    const targetByTitlePosition = new Map<string, UnknownRecord[]>();
    const targetByTitle = new Map<string, UnknownRecord[]>();
    for (const targetItem of targetItems) {
      const keys = itemMatchKeys(targetItem);
      if (keys.titlePosition) targetByTitlePosition.set(keys.titlePosition, [...(targetByTitlePosition.get(keys.titlePosition) || []), targetItem]);
      if (keys.title) targetByTitle.set(keys.title, [...(targetByTitle.get(keys.title) || []), targetItem]);
    }

    for (const sourceItem of sourceItems) {
      const sourceItemId = readStr(sourceItem.id);
      if (!sourceItemId) continue;
      const keys = itemMatchKeys(sourceItem);
      const matches = (keys.titlePosition ? targetByTitlePosition.get(keys.titlePosition) : undefined) || (keys.title ? targetByTitle.get(keys.title) : undefined) || [];
      if (matches.length === 1) {
        originBySourceId.set(sourceItemId, {
          origin_id: readNum(matches[0].id) || readStr(matches[0].id),
          origin_type: "generic_tools",
        });
      } else if (sourceOrigins.some((origin) => readStr(origin.origin_id) === sourceItemId)) {
        const deterministicMatch = resolveDeterministicOriginMatch(matches, sourceItem);
        if (deterministicMatch) {
          originBySourceId.set(sourceItemId, {
            origin_id: readNum(deterministicMatch.id) || readStr(deterministicMatch.id),
            origin_type: "generic_tools",
          });
          if (matches.length > 1) {
            issues.push({
              type: "event_origin",
              sourceOriginId: sourceItemId,
              sourceTitle: readStr(sourceItem.title),
              issue: "target_origin_item_ambiguous_reused_existing",
              matchCount: matches.length,
            });
          }
          continue;
        }

        if (params.autoCreateMissingOriginItems && !params.dryRun) {
          const created = await createGenericToolItem({
            accessToken: params.accessToken,
            companyId: params.targetCompanyId,
            projectId: params.targetProjectId,
            genericToolId: targetToolId,
            sourceItem,
          });
          if (created.ok) {
            originBySourceId.set(sourceItemId, {
              origin_id: created.id,
              origin_type: "generic_tools",
            });
            if (matches.length > 1) {
              issues.push({
                type: "event_origin",
                sourceOriginId: sourceItemId,
                sourceTitle: readStr(sourceItem.title),
                issue: "target_origin_item_ambiguous_auto_created",
                matchCount: matches.length,
              });
            }
            continue;
          }
          issues.push({
            type: "event_origin",
            sourceOriginId: sourceItemId,
            sourceTitle: readStr(sourceItem.title),
            issue: matches.length === 0 ? "target_origin_item_create_failed" : "target_origin_item_ambiguous_create_failed",
            matchCount: matches.length,
            createError: created.error,
            attempts: created.attempts,
          });
          continue;
        }
        issues.push({
          type: "event_origin",
          sourceOriginId: sourceItemId,
          sourceTitle: readStr(sourceItem.title),
          issue: matches.length === 0 ? "target_origin_item_missing" : "target_origin_item_ambiguous",
          matchCount: matches.length,
        });
      }
    }
  }

  return { originBySourceId, issues, sourceToolIds, targetToolIds };
}

function buildBudgetCodeIndexes(budgetLineItems: UnknownRecord[]) {
  const byId = new Map<string, UnknownRecord>();
  const byFlatCode = new Map<string, UnknownRecord[]>();
  const byCostCode = new Map<string, UnknownRecord[]>();

  for (const item of budgetLineItems) {
    const wbsCode = nestedRecord(item, "wbs_code");
    const id = readStr(wbsCode.id || item.wbs_code_id || item.id);
    const flatCode = readStr(wbsCode.flat_code || item.flat_code);
    if (!id || !flatCode) continue;
    const costCode = flatCode.split(".")[0] || flatCode;
    const indexed = { id, flatCode, description: readStr(wbsCode.description) };
    byId.set(id, indexed);
    const budgetLineItemId = readStr(item.id);
    if (budgetLineItemId) byId.set(budgetLineItemId, indexed);
    const flatKey = normalize(flatCode);
    const costKey = normalize(costCode);
    byFlatCode.set(flatKey, [...(byFlatCode.get(flatKey) || []), indexed]);
    byCostCode.set(costKey, [...(byCostCode.get(costKey) || []), indexed]);
  }

  return { byId, byFlatCode, byCostCode };
}

function mappedFlatCode(sourceFlatCode: string, lineItemTypeCodeMap: Record<string, string>) {
  const [costCode, typeCode] = sourceFlatCode.split(".");
  if (!costCode || !typeCode) return sourceFlatCode;
  const mappedType = lineItemTypeCodeMap[typeCode] || lineItemTypeCodeMap[typeCode.toUpperCase()] || lineItemTypeCodeMap[typeCode.toLowerCase()];
  return mappedType ? `${costCode}.${mappedType}` : sourceFlatCode;
}

function resolveCostCodeFallback(flatCode: string, targetIndex: ReturnType<typeof buildBudgetCodeIndexes>, strategy: string) {
  const costCode = readStr(flatCode).split(".")[0] || readStr(flatCode);
  if (!costCode) return null;
  const costMatches = targetIndex.byCostCode.get(normalize(costCode)) || [];
  if (costMatches.length === 1) return { id: readStr(costMatches[0].id), strategy };
  if (costMatches.length > 1) return { id: "", issue: "target_cost_code_ambiguous", matchCount: costMatches.length, sourceFlatCode: flatCode };
  return { id: "", issue: "target_budget_code_missing", matchCount: 0, sourceFlatCode: flatCode };
}

function resolveMappedBudgetCodeValue(
  value: string,
  targetIndex: ReturnType<typeof buildBudgetCodeIndexes>,
  strategy: string
) {
  const mapped = readStr(value);
  if (!mapped) return null;
  if (/^\d+$/.test(mapped)) {
    const target = targetIndex.byId.get(mapped);
    if (target) return { id: readStr(target.id), strategy };
    return {
      id: "",
      strategy,
      issue: "manual_mapped_budget_code_id_not_found",
      matchCount: 0,
      mappedFlatCode: mapped,
    };
  }
  const matches = targetIndex.byFlatCode.get(normalize(mapped)) || [];
  if (matches.length === 1) return { id: readStr(matches[0].id), strategy: `${strategy}_flat_code` };
  if (matches.length === 0) {
    const fallback = resolveCostCodeFallback(mapped, targetIndex, `${strategy}_cost_code_fallback`);
    if (fallback && fallback.id) return fallback;
  }
  return {
    id: "",
    strategy,
    issue: matches.length === 0 ? "manual_mapped_flat_code_not_found" : "manual_mapped_flat_code_ambiguous",
    matchCount: matches.length,
    mappedFlatCode: mapped,
  };
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
  sourceLineItemId: string;
  sourceBudgetCode: UnknownRecord;
  description: string;
  targetIndex: ReturnType<typeof buildBudgetCodeIndexes>;
  budgetCodeIdMap: Record<string, string>;
  flatCodeMap: Record<string, string>;
  workbookFlatCodeMap: Record<string, string>;
  workbookDescriptionMappings: Array<{ key: string; targetFlatCode: string; oldName: string; oldCostCode: string }>;
  lineItemTypeCodeMap: Record<string, string>;
}): UnknownRecord {
  const sourceLineItemId = readStr(params.sourceLineItemId);
  const sourceId = readStr(params.sourceBudgetCode.id);
  const sourceFlatCode = readStr(params.sourceBudgetCode.flat_code);
  if (sourceLineItemId && params.budgetCodeIdMap[sourceLineItemId]) {
    const mapped = resolveMappedBudgetCodeValue(params.budgetCodeIdMap[sourceLineItemId], params.targetIndex, "line_item_budget_code_map");
    if (mapped) return mapped;
  }
  if (sourceId && params.budgetCodeIdMap[sourceId]) {
    const mapped = resolveMappedBudgetCodeValue(params.budgetCodeIdMap[sourceId], params.targetIndex, "budget_code_id_map");
    if (mapped) return mapped;
  }
  if (sourceFlatCode && params.flatCodeMap[sourceFlatCode]) {
    const mapped = params.flatCodeMap[sourceFlatCode];
    const matches = params.targetIndex.byFlatCode.get(normalize(mapped)) || [];
    if (matches.length === 1) return { id: readStr(matches[0].id), strategy: "flat_code_map" };
    if (/^\d+$/.test(mapped)) {
      const target = params.targetIndex.byId.get(mapped);
      if (target) return { id: readStr(target.id), strategy: "flat_code_map_to_id" };
      return { id: "", issue: "manual_mapped_budget_code_id_not_found", matchCount: 0, mappedFlatCode: mapped };
    }
    return { id: "", issue: matches.length === 0 ? "mapped_flat_code_not_found" : "mapped_flat_code_ambiguous", matchCount: matches.length };
  }
  const sourceCostCode = sourceFlatCode.split(".")[0] || sourceFlatCode;
  const workbookMapped = params.workbookFlatCodeMap[normCode(sourceCostCode)] || params.workbookFlatCodeMap[sourceCostCode];
  if (workbookMapped) {
    const matches = params.targetIndex.byFlatCode.get(normalize(workbookMapped)) || [];
    if (matches.length === 1) return { id: readStr(matches[0].id), strategy: "workbook_cost_code_type" };
    if (matches.length > 1) return { id: "", issue: "workbook_flat_code_ambiguous", matchCount: matches.length, mappedFlatCode: workbookMapped };
    const fallback = resolveCostCodeFallback(workbookMapped, params.targetIndex, "workbook_cost_code_fallback");
    if (fallback && fallback.id) return fallback;
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
      const fallback = resolveCostCodeFallback(
        descriptionMapping.targetFlatCode,
        params.targetIndex,
        `${descriptionMapping.strategy}_cost_code_fallback`
      );
      if (fallback && fallback.id) return fallback;
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
  const cloned = cloneForCreate(item);
  const clonedPayload = isRecord(cloned) ? (cloned as UnknownRecord) : {};
  const costImpact = getEstimateImpact(nestedRecord(item, "cost_impact"));
  const revenueImpact = getEstimateImpact(nestedRecord(item, "revenue_impact"));
  const sourceOfRevenueRom = readStr(nestedRecord(item, "revenue_impact").source_of_revenue_rom);
  return compactPayload({
    ...clonedPayload,
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
  numberOffset: number;
  status: UnknownRecord;
  changeType?: UnknownRecord;
  changeReason?: UnknownRecord;
  eventOrigin?: UnknownRecord;
}) {
  const cloned = cloneForCreate(params.event);
  const clonedPayload = isRecord(cloned) ? (cloned as UnknownRecord) : {};
  const sourceOrigin = nestedRecord(params.event, "event_origin");
  const sourceOriginDisplay = readStr(sourceOrigin.display_name || sourceOrigin.name || sourceOrigin.origin_id);
  const sourceOriginType = readStr(sourceOrigin.origin_type);
  const sourceDescription = readStr(params.event.description);
  const originFallback = !params.eventOrigin && sourceOriginDisplay
    ? `Source Origin${sourceOriginType ? ` (${sourceOriginType})` : ""}: ${sourceOriginDisplay}`
    : "";
  const description = originFallback
    ? sourceDescription.includes("<")
      ? `${sourceDescription}<p><strong>Source Origin:</strong> ${escapeHtml(sourceOriginDisplay)}${sourceOriginType ? ` (${escapeHtml(sourceOriginType)})` : ""}</p>`
      : [sourceDescription, originFallback].filter(Boolean).join("\n\n")
    : sourceDescription;

  return compactPayload({
    ...clonedPayload,
    number: params.preserveNumber ? offsetChangeEventNumber(params.event.number, params.numberOffset) : undefined,
    title: readStr(params.event.title) || "Untitled Change Event",
    description,
    scope: readStr(params.event.scope),
    status: params.status,
    change_type: params.changeType,
    change_reason: params.changeReason,
    event_origin: params.eventOrigin,
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

function clonePayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sanitizeCreatePayloadForError(payload: UnknownRecord, errorMessage: string) {
  const next = clonePayload(payload);
  let changed = false;

  if (/prime_contract_for_estimates/i.test(errorMessage) && /id.*missing|is missing/i.test(errorMessage)) {
    if ("prime_contract_for_estimates" in next) {
      delete next.prime_contract_for_estimates;
      changed = true;
    }
  }

  const badWbsIds = [...errorMessage.matchAll(/Wbs Code with ID\s+(\d+)\s+not found/gi)].map((m) => m[1]);
  if (badWbsIds.length && Array.isArray(next.change_items)) {
    next.change_items = next.change_items.map((item) => {
      if (!isRecord(item)) return item;
      if (!isRecord(item.budget_code)) return item;
      const budgetId = readStr(item.budget_code.id);
      if (budgetId && badWbsIds.includes(budgetId)) {
        const patched = { ...item };
        delete patched.budget_code;
        changed = true;
        return patched;
      }
      return item;
    });
  }

  return { changed, payload: compactPayload(next) };
}

async function createChangeEventWithFallback(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  payload: UnknownRecord;
}) {
  const attempts: UnknownRecord[] = [];
  let currentPayload = clonePayload(params.payload);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const created = await createChangeEvent({
        accessToken: params.accessToken,
        companyId: params.companyId,
        projectId: params.projectId,
        payload: currentPayload,
      });
      attempts.push({ attempt, ok: true, payload: currentPayload });
      return { created, attempts };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ attempt, ok: false, payload: currentPayload, error: message });
      const sanitized = sanitizeCreatePayloadForError(currentPayload, message);
      if (!sanitized.changed) {
        throw new Error(`${message} | attempts=${safeJson(attempts.slice(-3))}`);
      }
      currentPayload = sanitized.payload;
    }
  }

  throw new Error(`Change event create failed after retries: ${safeJson(attempts.slice(-3))}`);
}

async function updateChangeEvent(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  changeEventId: string;
  payload: UnknownRecord;
}) {
  const query = new URLSearchParams({
    project_id: params.projectId,
    company_id: params.companyId,
  });
  const attempts = [
    {
      method: "PATCH",
      path: `/rest/v1.1/change_events/${encodeURIComponent(params.changeEventId)}?${query.toString()}`,
      body: { change_event: params.payload },
    },
    {
      method: "PUT",
      path: `/rest/v1.1/change_events/${encodeURIComponent(params.changeEventId)}?${query.toString()}`,
      body: { change_event: params.payload },
    },
    {
      method: "PATCH",
      path: `/rest/v1.0/change_events/${encodeURIComponent(params.changeEventId)}?${query.toString()}`,
      body: { change_event: params.payload },
    },
  ];

  const errors: UnknownRecord[] = [];
  for (const attempt of attempts) {
    try {
      const updated = await procoreJson({
        accessToken: params.accessToken,
        companyId: params.companyId,
        method: attempt.method,
        path: attempt.path,
        body: attempt.body,
      });
      return { ok: true, method: attempt.method, path: attempt.path, updated, errors };
    } catch (error) {
      errors.push({
        method: attempt.method,
        path: attempt.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { ok: false, errors };
}

function isNumberTakenError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /number/i.test(message) && /already been taken/i.test(message);
}

function resolveExistingTargetByTitle(title: unknown, targetByTitle: Map<string, UnknownRecord[]>): UnknownRecord | undefined {
  const key = normalize(title);
  if (!key) return undefined;
  const matches = targetByTitle.get(key) || [];
  return matches.length === 1 ? matches[0] : undefined;
}

function offsetChangeEventNumber(value: unknown, offset: number) {
  const text = readStr(value);
  if (!text || !offset) return text;
  if (!/^\d+$/.test(text)) return text;
  const next = String(Number(text) + offset);
  return next.padStart(text.length, "0");
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
    const numberOffset = Math.trunc(readNum(body.numberOffset) || 0);
    const allowUnmappedLineItems = readBool(body.allowUnmappedLineItems, true);
    const autoCreateMissingOriginItems = readBool(body.autoCreateMissingOriginItems, true);
    const updateExisting = readBool(body.updateExisting, false);
    const updateOnlyBlankFields = readBool(body.updateOnlyBlankFields, true);
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
    const targetByTitle = new Map<string, UnknownRecord[]>();
    for (const event of targetEventsRaw) {
      const number = readStr(event.number);
      if (number) targetByNumber.set(number, event);
      const titleKey = normalize(event.title);
      if (titleKey) targetByTitle.set(titleKey, [...(targetByTitle.get(titleKey) || []), event]);
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

    const eventOriginMap = await buildEventOriginMap({
      accessToken,
      sourceCompanyId,
      sourceProjectId,
      targetCompanyId,
      targetProjectId,
      sourceEvents,
      maxPages,
      dryRun,
      autoCreateMissingOriginItems,
    });
    const missingMappings: UnknownRecord[] = [];
    const plan = sourceEvents.map((event) => {
      const sourceOrigin = nestedRecord(event, "event_origin");
      const sourceOriginId = readStr(sourceOrigin.origin_id);
      const targetOrigin = sourceOriginId ? eventOriginMap.originBySourceId.get(sourceOriginId) : undefined;
      if (sourceOriginId && !targetOrigin) {
        missingMappings.push({
          type: "change_event_origin",
          sourceChangeEventId: readStr(event.id),
          sourceChangeEventNumber: readStr(event.number),
          sourceOriginId,
          sourceOriginType: readStr(sourceOrigin.origin_type),
          sourceOriginDisplayName: readStr(sourceOrigin.display_name),
          issue: readStr(sourceOrigin.origin_type) === "generic_tools" ? "target_origin_not_mapped" : "unsupported_origin_type",
        });
      }
      const sourceItems = cloneLineItems ? asArray(event.change_items) : [];
      const itemPlans = sourceItems.map((item) => {
        const sourceBudgetCode = nestedRecord(item, "budget_code");
        const mapping = resolveBudgetCode({
          sourceLineItemId: readStr(item.id),
          sourceBudgetCode,
          description: readStr(item.description),
          targetIndex: targetBudgetIndex,
          budgetCodeIdMap,
          flatCodeMap,
          workbookFlatCodeMap,
          workbookDescriptionMappings,
          lineItemTypeCodeMap,
        });
        if (!mapping.id && !allowUnmappedLineItems) {
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
        const mappedBudgetCodeId = readStr(mapping.id);
        return {
          sourceLineItemId: readStr(item.id),
          sourceFlatCode: readStr(sourceBudgetCode.flat_code),
          targetBudgetCodeId: mappedBudgetCodeId,
          matchStrategy: mapping.strategy || null,
          unmappedBudgetCodeAllowed: !mappedBudgetCodeId && allowUnmappedLineItems,
          payload: mappedBudgetCodeId || allowUnmappedLineItems ? buildChangeItemPayload(item, mappedBudgetCodeId) : null,
        };
      });
      const validItems = itemPlans.filter((item) => isRecord(item.payload)).map((item) => item.payload as UnknownRecord);
      const targetStatus = resolveTargetStatus(event.status, targetStatuses);
      const targetChangeType = resolveTargetChangeType(event.change_type, targetTypes);
      const targetChangeReason = resolveTargetChangeReason(event.change_reason, targetReasons);
      return {
        sourceId: readStr(event.id),
        sourceNumber: readStr(event.number),
        targetNumber: preserveNumber ? offsetChangeEventNumber(event.number, numberOffset) : "",
        title: readStr(event.title),
        sourceChangeType: isRecord(event.change_type) ? readStr(event.change_type.name || event.change_type.change_type) : "",
        sourceChangeReason: isRecord(event.change_reason) ? readStr(event.change_reason.change_reason || event.change_reason.name) : "",
        sourceOrigin: sourceOriginId
          ? {
              id: sourceOriginId,
              type: readStr(sourceOrigin.origin_type),
              displayName: readStr(sourceOrigin.display_name),
            }
          : null,
        targetOrigin: targetOrigin || null,
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
          numberOffset,
          status: targetStatus,
          changeType: targetChangeType,
          changeReason: targetChangeReason,
          eventOrigin: targetOrigin,
        }),
      };
    });

    const blockers = missingMappings.filter((mapping) => mapping.type === "change_event_line_item_budget_code" && !allowUnmappedLineItems);
    const createResults: UnknownRecord[] = [];
    const updateResults: UnknownRecord[] = [];
    if (!dryRun && blockers.length === 0) {
      for (const entry of plan.slice(createOffset, createOffset + createLimit)) {
        try {
          const targetNumber = readStr(entry.targetNumber || entry.sourceNumber);
          const existingTarget = preserveNumber
            ? targetByNumber.get(targetNumber)
            : updateExisting
              ? resolveExistingTargetByTitle(entry.title, targetByTitle)
              : undefined;
          if (existingTarget) {
            const targetId = readStr(existingTarget.id);
            if (updateExisting && targetId && isRecord(entry.payload)) {
              const sourcePayload = entry.payload as UnknownRecord;
              const updatePayload = updateOnlyBlankFields
                ? mergeMissingFields(sourcePayload, existingTarget)
                : sourcePayload;
              if (isRecord(updatePayload) && Object.keys(updatePayload).length) {
                const updated = await updateChangeEvent({
                  accessToken,
                  companyId: targetCompanyId,
                  projectId: targetProjectId,
                  changeEventId: targetId,
                  payload: updatePayload,
                });
                updateResults.push({
                  sourceId: entry.sourceId,
                  sourceNumber: entry.sourceNumber,
                  targetId,
                  targetNumber,
                  updateMode: updateOnlyBlankFields ? "missing_only" : "full",
                  ok: updated.ok,
                  updated,
                });
              } else {
                updateResults.push({
                  sourceId: entry.sourceId,
                  sourceNumber: entry.sourceNumber,
                  targetId,
                  targetNumber,
                  updateMode: updateOnlyBlankFields ? "missing_only" : "full",
                  ok: true,
                  skipped: true,
                  reason: "No missing fields detected for update.",
                });
              }
            }
            createResults.push({
              sourceId: entry.sourceId,
              sourceNumber: entry.sourceNumber,
              targetNumber,
              ok: true,
              reused: true,
              targetId,
              message: "Target change event number already exists; reused existing event.",
            });
            continue;
          }
          const created = await createChangeEventWithFallback({
            accessToken,
            companyId: targetCompanyId,
            projectId: targetProjectId,
            payload: isRecord(entry.payload) ? entry.payload : {},
          });
          createResults.push({ sourceId: entry.sourceId, ok: true, created: created.created, createAttempts: created.attempts });
        } catch (error) {
          if (isNumberTakenError(error)) {
            const refreshedTargetEvents = await fetchChangeEvents({
              accessToken,
              companyId: targetCompanyId,
              projectId: targetProjectId,
              maxPages: 50,
            });
            const targetNumber = readStr(entry.targetNumber || entry.sourceNumber);
            let existingTarget = preserveNumber
              ? refreshedTargetEvents.find((event) => readStr(event.number) === targetNumber)
              : undefined;
            if (!existingTarget && updateExisting) {
              const refreshedTargetByTitle = new Map<string, UnknownRecord[]>();
              for (const event of refreshedTargetEvents) {
                const titleKey = normalize(event.title);
                if (titleKey) refreshedTargetByTitle.set(titleKey, [...(refreshedTargetByTitle.get(titleKey) || []), event]);
              }
              existingTarget = resolveExistingTargetByTitle(entry.title, refreshedTargetByTitle);
            }
            if (existingTarget) {
              const targetId = readStr(existingTarget.id);
              if (updateExisting && targetId && isRecord(entry.payload)) {
                const sourcePayload = entry.payload as UnknownRecord;
                const updatePayload = updateOnlyBlankFields
                  ? mergeMissingFields(sourcePayload, existingTarget)
                  : sourcePayload;
                if (isRecord(updatePayload) && Object.keys(updatePayload).length) {
                  const updated = await updateChangeEvent({
                    accessToken,
                    companyId: targetCompanyId,
                    projectId: targetProjectId,
                    changeEventId: targetId,
                    payload: updatePayload,
                  });
                  updateResults.push({
                    sourceId: entry.sourceId,
                    sourceNumber: entry.sourceNumber,
                    targetId,
                    targetNumber,
                    updateMode: updateOnlyBlankFields ? "missing_only" : "full",
                    ok: updated.ok,
                    updated,
                  });
                }
              }
              createResults.push({
                sourceId: entry.sourceId,
                sourceNumber: entry.sourceNumber,
                targetNumber,
                ok: true,
                reused: true,
                targetId,
                warning: "Procore reported this number already exists; treated as reused.",
                originalError: error instanceof Error ? error.message : String(error),
              });
              continue;
            }
          }
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
      options: { cloneLineItems, preserveNumber, numberOffset, allowUnmappedLineItems, autoCreateMissingOriginItems },
      updateOptions: { updateExisting, updateOnlyBlankFields },
      workbookCrosswalk,
      eventOriginMapping: {
        sourceGenericToolIds: eventOriginMap.sourceToolIds,
        targetGenericToolIds: eventOriginMap.targetToolIds,
        mappedOrigins: eventOriginMap.originBySourceId.size,
        issues: eventOriginMap.issues,
      },
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
        unmappedLineItemsAllowed: allowUnmappedLineItems
          ? plan.reduce(
              (sum, entry) =>
                sum +
                (Array.isArray(entry.lineItems)
                  ? entry.lineItems.filter((item) => isRecord(item) && !readStr(item.targetBudgetCodeId)).length
                  : 0),
              0
            )
          : 0,
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
        updatedExisting: updateResults.filter((result) => result.ok === true && result.skipped !== true).length,
        skippedExistingUpdates: updateResults.filter((result) => result.skipped === true).length,
        failedExistingUpdates: updateResults.filter((result) => result.ok === false).length,
      },
      readyForLiveClone: blockers.length === 0,
      missingMappings,
      plan: plan.slice(0, 200),
      createResults,
      updateResults,
      failedCreateResults: failed,
      nextStep: dryRun
        ? blockers.length
          ? "Missing budget-code mappings are allowed; unmapped request lines will be created without budget_code."
          : "Review plan. If ready, rerun live."
        : blockers.length
          ? "Live clone blocked by missing line-item budget code mappings."
          : failed.length
            ? "Some change events failed. Review createResults."
            : updateResults.some((result) => result.ok === false)
              ? "Clone batch complete, but some existing-event updates failed. Review updateResults."
              : "Change event clone batch complete.",
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Failed to clone change events.", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
