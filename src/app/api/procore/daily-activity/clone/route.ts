import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";
import {
  allocateExistingProductivityRows,
  countProductivityFingerprints,
  productivityCloneFingerprint,
} from "@/lib/procore/dailyProductivityClone";

type UnknownRecord = Record<string, unknown>;

type ProductivityTargetLineItem = {
  id: number;
  sourceIds: string[];
  sourceContractIds: string[];
  lineNumber: number | null;
  lineNumbers: number[];
  description: string;
  contractId: string;
  contractNumber: string;
  contractTitle: string;
  contractType: "commitment_contract" | "purchase_order_contract" | "work_order_contract";
};

type TargetLookups = {
  productivityLineItems: ProductivityTargetLineItem[];
  existingProductivityCounts: Map<string, number>;
  existingProductivityRows: number;
  existingTimecardKeys: Set<string>;
  existingTimecardRows: number;
  timeTypes: UnknownRecord[];
  people: UnknownRecord[];
  peopleById: Map<string, UnknownRecord>;
  peopleByName: Map<string, UnknownRecord>;
  peopleByCompactName: Map<string, UnknownRecord>;
  peopleByNameTokens: Map<string, UnknownRecord>;
  peopleByUserId: Map<string, UnknownRecord>;
  peopleByContactId: Map<string, UnknownRecord>;
  users: UnknownRecord[];
  usersByName: Map<string, UnknownRecord>;
  usersByCompactName: Map<string, UnknownRecord>;
  usersByNameTokens: Map<string, UnknownRecord>;
  usersByLogin: Map<string, UnknownRecord>;
  timeTypesByName: Map<string, UnknownRecord>;
  workClassifications: UnknownRecord[];
  workClassificationsById: Map<string, UnknownRecord>;
  workClassificationsByName: Map<string, UnknownRecord>;
  workClassificationsByCompactName: Map<string, UnknownRecord>;
  workClassificationsByAbbreviation: Map<string, UnknownRecord>;
  costCodesByFullCode: Map<string, UnknownRecord>;
  costCodesByName: Map<string, UnknownRecord>;
};

const BUILT_IN_PARTY_FALLBACK_BY_SOURCE_ID: Record<string, number> = {
  // Source person Kevin Buch -> target person Kevin Buch
  "598134334003737": 598134335893533,
};

const BUILT_IN_PARTY_FALLBACK_BY_NAME: Record<string, number> = {
  "kevin buch": 598134335893533,
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

function normalizeKey(value: unknown): string {
  return readStr(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function compactKey(value: unknown): string {
  return normalizeKey(value).replace(/[^a-z0-9]+/g, "");
}

function nameTokenKey(value: unknown): string {
  return normalizeKey(value)
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .sort()
    .join("|");
}

function normalizeDescriptionKey(value: unknown): string {
  let text = readStr(value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  text = text.replace(/^#\s*\d+\s*-\s*/i, "");
  text = text.replace(/\s*-\s*-?\d+(?:\.\d+)?\s*(?:ea|cy|sf|sq\s*ft|sq_ft|lf|ft|hr|hrs|hours|bag|bags|sheet|sheets|gal|gals|pc|pcs|day|days|month|months|ls)\s*$/i, "");
  text = text.replace(/\s+/g, " ").trim();

  return normalizeKey(text);
}

function tokenSet(value: unknown) {
  return new Set(
    normalizeDescriptionKey(value)
      .replace(/[^a-z0-9#./"'-]+/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 1)
  );
}

function canonicalMaterialTokens(value: unknown): Set<string> {
  const raw = normalizeDescriptionKey(value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9#./"'-]+/g, " ");
  const out = new Set<string>();
  const noise = new Set(["for", "the", "and", "with", "our", "cost", "material", "materials", "ready", "mix", "by"]);
  for (let token of raw.split(/\s+/).map((item) => item.trim()).filter(Boolean)) {
    if (noise.has(token)) continue;
    if (token === "sog") {
      out.add("slab");
      out.add("grade");
      continue;
    }
    if (token === "slabs") token = "slab";
    if (token === "forms") token = "form";
    if (token === "chairs") token = "chair";
    if (token === "sheets") token = "sheet";
    if (token === "pcs") token = "pc";
    if (token === "piece" || token === "pieces") token = "pc";
    if (token.length > 2) out.add(token);
  }
  return out;
}

function canonicalMaterialOverlap(left: unknown, right: unknown) {
  const leftTokens = canonicalMaterialTokens(left);
  const rightTokens = canonicalMaterialTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
}

function rebarSizeFromDescription(value: unknown): string {
  const match = normalizeDescriptionKey(value).match(/#\s*(\d+)\s+rebar\b/i);
  return match?.[1] || "";
}

function descriptionOverlapScore(left: unknown, right: unknown) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
}

function bestDescriptionMatch<T extends { item: ProductivityTargetLineItem; score: number; tokenScore: number; cleanMatch: boolean }>(matches: T[]) {
  if (matches.length === 0) return undefined;
  const sorted = [...matches].sort(
    (a, b) =>
      Number(b.cleanMatch) - Number(a.cleanMatch) ||
      b.score - a.score ||
      b.tokenScore - a.tokenScore
  );
  const best = sorted[0];
  const tied = sorted.filter(
    (entry) =>
      entry.cleanMatch === best.cleanMatch &&
      entry.score === best.score &&
      entry.tokenScore === best.tokenScore
  );
  const uniqueDescriptions = new Set(tied.map((entry) => normalizeDescriptionKey(entry.item.description)));
  return tied.length === 1 || uniqueDescriptions.size === 1 ? best : undefined;
}

function uniqueNumbers(values: Array<number | null | undefined>): number[] {
  const seen = new Set<number>();
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const intValue = Math.trunc(value);
    if (intValue > 0) seen.add(intValue);
  }
  return Array.from(seen);
}

function contractNumberKeys(value: unknown): string[] {
  const raw = normalizeKey(value);
  if (!raw) return [];
  const compact = raw.replace(/\s+/g, "").replace(/#/g, "");
  const loose = compact.replace(/[^a-z0-9]/g, "");
  const keys = new Set([raw, compact, loose]);
  const match = loose.match(/^([a-z]+)0*(\d+)$/);
  if (match) keys.add(`${match[1]}${Number.parseInt(match[2], 10)}`);
  return Array.from(keys).filter(Boolean);
}

function contractNumbersMatch(a: unknown, b: unknown): boolean {
  const aKeys = contractNumberKeys(a);
  const bKeys = new Set(contractNumberKeys(b));
  return aKeys.some((key) => bKeys.has(key));
}

function normalizeDate(value: unknown): string {
  const token = readStr(value);
  if (!token) return "";
  const match = token.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(token);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(readStr).filter(Boolean);
  }
  return readStr(value)
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function compareStableSourceIds(a: string, b: string): number {
  const aNum = Number(a);
  const bNum = Number(b);
  const aIsNum = Number.isFinite(aNum);
  const bIsNum = Number.isFinite(bNum);
  if (aIsNum && bIsNum && aNum !== bNum) return aNum - bNum;
  return a.localeCompare(b);
}

function unwrapArray(value: unknown): UnknownRecord[] {
  if (Array.isArray(value)) return value.filter((item): item is UnknownRecord => isRecord(item));
  if (isRecord(value)) {
    if (Array.isArray(value.data)) return value.data.filter((item): item is UnknownRecord => isRecord(item));
    if (Array.isArray(value.results)) return value.results.filter((item): item is UnknownRecord => isRecord(item));
  }
  return [];
}

function firstRecord(...values: unknown[]): UnknownRecord | null {
  for (const value of values) {
    if (isRecord(value)) return value;
  }
  return null;
}

function contractNumberFromLog(log: UnknownRecord): string {
  const holder = firstRecord(log.line_item_holder, log.line_item_holder_info);
  const lineItem = firstRecord(log.line_item);
  return readStr(
    log.line_item_holder_number ||
      log.contract_number ||
      log.contractNumber ||
      log.holder_number ||
      holder?.number ||
      holder?.contract_number ||
      lineItem?.line_item_holder_number
  );
}

function contractIdFromLog(log: UnknownRecord): string {
  const holder = firstRecord(log.line_item_holder, log.line_item_holder_info);
  const lineItem = firstRecord(log.line_item);
  return readStr(
    log.line_item_holder_id ||
      log.contract_id ||
      log.contractId ||
      log.holder_id ||
      holder?.id ||
      lineItem?.line_item_holder_id ||
      lineItem?.contract_id
  );
}

function contractTitleFromLog(log: UnknownRecord): string {
  const holder = firstRecord(log.line_item_holder, log.line_item_holder_info);
  return readStr(
    log.line_item_holder_title ||
      log.contract_title ||
      log.contractTitle ||
      log.holder_title ||
      holder?.title ||
      holder?.name
  );
}

function lineItemDescriptionFromLog(log: UnknownRecord): string {
  const lineItem = firstRecord(log.line_item);
  return readStr(
    log.line_item_description ||
      log.lineItemDescription ||
      log.description ||
      log.line_item_name ||
      lineItem?.description ||
      lineItem?.name
  );
}

function getNestedId(value: unknown): number | undefined {
  if (isRecord(value)) return readNum(value.id);
  return readNum(value);
}

function getTargetPartyId(value: unknown): number | undefined {
  if (!isRecord(value)) return readNum(value);
  return readNum(
    value.id ||
      value.person_id ||
      value.personId ||
      value.contact_id ||
      value.contactId ||
      value.party_id ||
      value.partyId ||
      firstRecord(value.party)?.id
  );
}

function getNestedName(value: unknown): string {
  if (isRecord(value)) return readStr(value.name);
  return readStr(value);
}

function sourcePartyFromEntry(entry: UnknownRecord) {
  const nested = firstRecord(entry.party, entry.employee, entry.user, entry.worker);
  return {
    id: readStr(nested?.id || entry.party_id || entry.partyId || entry.employee_id || entry.employeeId || entry.user_id || entry.userId),
    name: readStr(nested?.name || entry.party_name || entry.partyName || entry.employee_name || entry.employeeName || entry.user_name || entry.userName || entry.worker_name || entry.workerName),
    login: readStr(nested?.login || nested?.email || entry.party_login || entry.partyLogin || entry.employee_login || entry.employeeLogin || entry.login || entry.email),
  };
}

function sourceTimeTypeFromEntry(entry: UnknownRecord) {
  const nested = firstRecord(entry.timecard_time_type, entry.timecardTimeType, entry.time_type, entry.timeType);
  return {
    id: readStr(nested?.id || entry.timecard_time_type_id || entry.timecardTimeTypeId || entry.time_type_id || entry.timeTypeId),
    name: readStr(
      nested?.name ||
        nested?.time_type ||
        nested?.abbreviated_time_type ||
        entry.timecard_time_type_name ||
        entry.timecardTimeTypeName ||
        entry.time_type_name ||
        entry.timeTypeName ||
        entry.time_type ||
        entry.timeType ||
        entry.abbreviated_time_type ||
        entry.abbreviatedTimeType
    ),
  };
}

function sourceCostCodeFromEntry(entry: UnknownRecord) {
  const nested = firstRecord(entry.cost_code, entry.costCode);
  return {
    id: readStr(nested?.id || entry.cost_code_id || entry.costCodeId),
    fullCode: readStr(nested?.full_code || nested?.code || entry.cost_code_full_code || entry.costCodeFullCode || entry.cost_code || entry.costCode),
    name: readStr(nested?.name || entry.cost_code_name || entry.costCodeName),
  };
}

function fallbackTimeTypeForSource(sourceName: unknown, lookups: TargetLookups) {
  const sourceKey = normalizeKey(sourceName);
  if (!["travel", "shop"].includes(sourceKey)) return undefined;
  return (
    lookups.timeTypesByName.get("regular time") ||
    lookups.timeTypes.find((timeType) => normalizeKey(timeType.abbreviated_time_type) === "reg")
  );
}

function fallbackCostCodeForSource(costCode: { fullCode: string; name: string }, lookups: TargetLookups) {
  if (readStr(costCode.fullCode) || readStr(costCode.name)) return undefined;
  return (
    lookups.costCodesByFullCode.get("01-300-10-70.L") ||
    lookups.costCodesByFullCode.get("01-300-10-70") ||
    lookups.costCodesByName.get("shop labor")
  );
}

function sourceClassificationFromEntry(entry: UnknownRecord) {
  const nested = firstRecord(
    entry.work_classification,
    entry.workClassification,
    entry.classification,
    entry.classification_type,
    entry.classificationType
  );
  return {
    id: readStr(
      nested?.id ||
        entry.work_classification_id ||
        entry.workClassificationId ||
        entry.classification_id ||
        entry.classificationId ||
        entry.classification_type_id ||
        entry.classificationTypeId
    ),
    name: readStr(
      nested?.name ||
        nested?.classification ||
        nested?.classification_type ||
        nested?.label ||
        entry.work_classification_name ||
        entry.workClassificationName ||
        entry.classification_name ||
        entry.classificationName ||
        entry.classification ||
        entry.classification_type ||
        entry.classificationType
    ),
    abbreviation: readStr(
      nested?.abbreviation ||
        nested?.abbr ||
        entry.work_classification_abbreviation ||
        entry.workClassificationAbbreviation ||
        entry.classification_abbreviation ||
        entry.classificationAbbreviation
    ),
  };
}

function lineNumberFromDescription(value: unknown): number | null {
  const text = readStr(value);
  const match = text.match(/#\s*(\d+)/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function targetLineNumbers(item: UnknownRecord, returnedIndex: number): number[] {
  const parsed = lineNumberFromDescription(item.description || item.name);
  const lineNumber = readNum(item.line_number ?? item.lineNumber ?? item.number);
  const position = readNum(item.position);
  const order = readNum(item.order);
  return uniqueNumbers([
    lineNumber,
    parsed,
    position,
    order,
  ]);
}

function targetSourceIds(item: UnknownRecord): string[] {
  const ids = new Set<string>();
  for (const value of [item.origin_id, item.originId, item.source_id, item.sourceId]) {
    const text = readStr(value);
    if (text) ids.add(text);
  }

  const originData = readStr(item.origin_data || item.originData);
  if (originData) {
    ids.add(originData);
    const matches = originData.match(/\d{6,}/g) || [];
    for (const match of matches) ids.add(match);
  }

  return Array.from(ids);
}

function targetContractSourceIds(contract: UnknownRecord): string[] {
  const ids = new Set<string>();
  for (const value of [contract.origin_id, contract.originId, contract.source_id, contract.sourceId]) {
    const text = readStr(value);
    if (text) ids.add(text);
  }
  const originData = readStr(contract.origin_data || contract.originData);
  if (originData) {
    ids.add(originData);
    const matches = originData.match(/\d{6,}/g) || [];
    for (const match of matches) ids.add(match);
  }
  return Array.from(ids);
}

function resolveTargetPersonId(lookups: TargetLookups, value: unknown): number | undefined {
  const raw = readStr(value);
  if (!raw) return undefined;
  const person =
    lookups.peopleById.get(raw) ||
    lookups.peopleByContactId.get(raw) ||
    lookups.peopleByUserId.get(raw);
  return getTargetPartyId(person);
}

function timecardPayloadKey(payload: UnknownRecord) {
  const hours = readNum(payload.hours);
  return [
    normalizeDate(payload.date),
    readStr(payload.party_id),
    readStr(payload.timecard_time_type_id),
    readStr(payload.cost_code_id),
    readStr(payload.time_in),
    readStr(payload.time_out),
    hours === undefined ? "" : String(hours),
    typeof payload.billable === "boolean" ? String(payload.billable) : "",
  ].join("|");
}

function timecardEntryKey(entry: UnknownRecord) {
  return timecardPayloadKey({
    date: entry.date,
    party_id: entry.party_id || firstRecord(entry.party)?.id,
    timecard_time_type_id: entry.timecard_time_type_id || firstRecord(entry.timecard_time_type)?.id,
    cost_code_id: entry.cost_code_id || firstRecord(entry.cost_code)?.id,
    time_in: entry.time_in,
    time_out: entry.time_out,
    hours: entry.hours,
    billable: entry.billable,
  });
}

function productivityEntryFingerprint(entry: UnknownRecord) {
  return productivityCloneFingerprint({
    date: entry.log_date || entry.date,
    contractNumber: contractNumberFromLog(entry),
    lineItemDescription: lineItemDescriptionFromLog(entry),
    quantityDelivered: entry.quantity_delivered,
    quantityUsed: entry.quantity_used,
    notes: entry.notes,
  });
}

function productivityCandidateTargets(params: {
  lineItemDescription: string;
  contractNumber: string;
  contractTitle: string;
  lookups: TargetLookups;
}) {
  return params.lookups.productivityLineItems
    .map((item) => ({
      id: item.id,
      contractId: item.contractId,
      contractNumber: item.contractNumber,
      contractTitle: item.contractTitle,
      lineNumbers: item.lineNumbers,
      description: item.description,
      canonicalScore: canonicalMaterialOverlap(params.lineItemDescription, item.description),
      tokenScore: descriptionOverlapScore(params.lineItemDescription, item.description),
      sameContractNumber: contractNumbersMatch(item.contractNumber, params.contractNumber),
      sameContractTitle: normalizeKey(item.contractTitle) === normalizeKey(params.contractTitle),
    }))
    .filter((item) => item.sameContractNumber || item.sameContractTitle || item.canonicalScore >= 0.5 || item.tokenScore >= 0.35)
    .sort((a, b) => {
      const aContract = a.sameContractNumber || a.sameContractTitle ? 1 : 0;
      const bContract = b.sameContractNumber || b.sameContractTitle ? 1 : 0;
      return bContract - aContract || b.canonicalScore - a.canonicalScore || b.tokenScore - a.tokenScore;
    })
    .slice(0, 8);
}

function resolveProductivityFallbackTarget(params: {
  lineItemDescription: string;
  contractNumber: string;
  contractTitle: string;
  lookups: TargetLookups;
}) {
  const candidates = productivityCandidateTargets(params);
  const top = candidates[0];
  const second = candidates[1];
  if (!top) return null;

  const sameContract = top.sameContractNumber || top.sameContractTitle;
  const clearlyBest = !second || top.canonicalScore - second.canonicalScore >= 0.15 || top.tokenScore - second.tokenScore >= 0.2;

  if (sameContract && top.canonicalScore >= 0.25 && clearlyBest) {
    const target = params.lookups.productivityLineItems.find((item) => item.id === top.id);
    return target || null;
  }

  if (top.canonicalScore >= 0.8 && clearlyBest) {
    const target = params.lookups.productivityLineItems.find((item) => item.id === top.id);
    return target || null;
  }

  return null;
}

async function procoreFetch(params: {
  accessToken: string;
  companyId: string;
  path: string;
  method?: string;
  body?: unknown;
}) {
  const response = await fetch(`${procoreConfig.apiUrl}${params.path}`, {
    method: params.method || "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Procore-Company-Id": params.companyId,
    },
    body: params.body === undefined ? undefined : JSON.stringify(params.body),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    throw new Error(`Procore ${params.method || "GET"} ${params.path} failed (${response.status}): ${text}`);
  }

  return parsed;
}

async function fetchPaged(params: {
  accessToken: string;
  companyId: string;
  pathForPage: (page: number) => string;
  maxPages: number;
  perPage?: number;
}) {
  const rows: UnknownRecord[] = [];
  const perPage = params.perPage || 100;
  for (let page = 1; page <= params.maxPages; page += 1) {
    const payload = await procoreFetch({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: params.pathForPage(page),
    });
    const pageRows = unwrapArray(payload);
    if (pageRows.length === 0) break;
    rows.push(...pageRows);
    if (pageRows.length < perPage) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return rows;
}

function addDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function minDate(left: string, right: string): string {
  return left <= right ? left : right;
}

async function fetchSourceProductivityLogs(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  startDate: string;
  endDate: string;
  maxPages: number;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    maxPages: params.maxPages,
    pathForPage: (page) => {
      const query = new URLSearchParams({
        start_date: params.startDate,
        end_date: params.endDate,
        page: String(page),
        per_page: "100",
      });
      return `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/productivity_logs?${query.toString()}`;
    },
  });
}

async function fetchSourceTimecards(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  startDate: string;
  endDate: string;
  maxPages: number;
}) {
  const fetchRange = (startDate: string, endDate: string, maxPages = params.maxPages) =>
    fetchPaged({
      accessToken: params.accessToken,
      companyId: params.companyId,
      maxPages,
      perPage: 100,
      pathForPage: (page) => {
        const query = new URLSearchParams({
          start_date: startDate,
          end_date: endDate,
          page: String(page),
          per_page: "100",
        });
        return `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/timecard_entries?${query.toString()}`;
      },
    });

  try {
    return await fetchRange(params.startDate, params.endDate);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/\(500\)/.test(message)) throw error;
  }

  const rowsById = new Map<string, UnknownRecord>();
  for (let cursor = params.startDate; cursor <= params.endDate; cursor = addDays(cursor, 7)) {
    const rangeEnd = minDate(addDays(cursor, 6), params.endDate);
    let chunkRows: UnknownRecord[] = [];
    try {
      chunkRows = await fetchRange(cursor, rangeEnd, 5);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/\(500\)/.test(message)) throw error;
      for (let day = cursor; day <= rangeEnd; day = addDays(day, 1)) {
        const dayRows = await fetchRange(day, day, 5);
        chunkRows.push(...dayRows);
      }
    }
    for (const row of chunkRows) {
      const id = readStr(row.id);
      rowsById.set(id || `${rowsById.size}`, row);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return Array.from(rowsById.values());
}

async function fetchWorkClassifications(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
}) {
  const paths = [
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/work_classifications?company_id=${encodeURIComponent(params.companyId)}&page=1&per_page=1000`,
    `/rest/v1.0/companies/${encodeURIComponent(params.companyId)}/work_classifications?page=1&per_page=1000`,
    `/rest/v1.0/work_classifications?company_id=${encodeURIComponent(params.companyId)}&project_id=${encodeURIComponent(params.projectId)}&page=1&per_page=1000`,
    `/rest/v1.0/work_classifications?company_id=${encodeURIComponent(params.companyId)}&page=1&per_page=1000`,
  ];

  for (const path of paths) {
    const rows = await procoreFetch({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path,
    }).then(unwrapArray).catch(() => []);
    if (rows.length > 0) return rows;
  }
  return [];
}

function isApprovedContract(contract: UnknownRecord) {
  const approved = contract.approved;
  if (typeof approved === "boolean") return approved;
  const status = normalizeKey(contract.status || contract.contract_status || contract.state);
  return !status || ["approved", "processing", "submitted", "executed", "complete", "active", "open"].includes(status);
}

function preferApprovedContracts(contracts: UnknownRecord[]) {
  const approved = contracts.filter(isApprovedContract);
  return approved.length > 0 ? approved : contracts;
}

async function fetchTargetProductivityLineItems(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
}) {
  const fetchFirstNonEmpty = async (paths: string[]) => {
    for (const path of paths) {
      const rows = await procoreFetch({
        accessToken: params.accessToken,
        companyId: params.companyId,
        path,
      }).then(unwrapArray).catch(() => []);
      if (rows.length > 0) return rows;
    }
    return [] as UnknownRecord[];
  };

  const out: ProductivityTargetLineItem[] = [];

  const commitmentContractRows = unwrapArray(
    await procoreFetch({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(params.projectId)}/commitment_contracts?page=1&per_page=100`,
    }).catch(() => [])
  );
  const commitmentContracts = preferApprovedContracts(commitmentContractRows);

  for (const contract of commitmentContracts) {
    const contractId = readStr(contract.id);
    if (!contractId) continue;
    const lineItems = await fetchFirstNonEmpty([
      `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(params.projectId)}/commitment_contracts/${encodeURIComponent(contractId)}/line_items?page=1&per_page=100`,
      `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(params.projectId)}/commitment_contracts/${encodeURIComponent(contractId)}/line_items?view=extended&page=1&per_page=100`,
      `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/commitment_contracts/${encodeURIComponent(contractId)}/line_items?page=1&per_page=100`,
    ]);
    const contractSourceIds = targetContractSourceIds(contract);
    for (const [index, item] of lineItems.entries()) {
      const id = readNum(item.id);
      if (id === undefined) continue;
      const lineNumbers = targetLineNumbers(item, index);
      out.push({
        id,
        sourceIds: targetSourceIds(item),
        sourceContractIds: contractSourceIds,
        lineNumber: lineNumbers[0] ?? null,
        lineNumbers,
        description: readStr(item.description || item.name),
        contractId,
        contractNumber: readStr(contract.number),
        contractTitle: readStr(contract.title || contract.name),
        contractType: "commitment_contract",
      });
    }
  }

  for (const contractPath of ["purchase_order_contracts", "work_order_contracts"] as const) {
    const contractRows = await fetchFirstNonEmpty([
      `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/${contractPath}?company_id=${encodeURIComponent(params.companyId)}&filters[status]=Approved&page=1&per_page=100`,
      `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/${contractPath}?company_id=${encodeURIComponent(params.companyId)}&page=1&per_page=100`,
    ]);
    const contracts = preferApprovedContracts(contractRows);

    for (const contract of contracts) {
      const contractId = readStr(contract.id);
      if (!contractId) continue;
      const contractSourceIds = targetContractSourceIds(contract);
      const lineItems = await fetchFirstNonEmpty([
        `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/${contractPath}/${encodeURIComponent(contractId)}/line_items?company_id=${encodeURIComponent(params.companyId)}&page=1&per_page=200`,
        `/rest/v1.0/${contractPath}/${encodeURIComponent(contractId)}/line_items?project_id=${encodeURIComponent(params.projectId)}&company_id=${encodeURIComponent(params.companyId)}&page=1&per_page=200`,
        `/rest/v1.0/${contractPath}/${encodeURIComponent(contractId)}/line_items?company_id=${encodeURIComponent(params.companyId)}&page=1&per_page=200`,
      ]);
      for (const [index, item] of lineItems.entries()) {
        const id = readNum(item.id);
        if (id === undefined) continue;
        const lineNumbers = targetLineNumbers(item, index);
        out.push({
          id,
          sourceIds: targetSourceIds(item),
          sourceContractIds: contractSourceIds,
          lineNumber: lineNumbers[0] ?? null,
          lineNumbers,
          description: readStr(item.description || item.name),
          contractId,
          contractNumber: readStr(contract.number),
          contractTitle: readStr(contract.title || contract.name),
          contractType: contractPath === "purchase_order_contracts" ? "purchase_order_contract" : "work_order_contract",
        });
      }
    }
  }

  return out;
}

async function fetchTargetLookups(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  startDate: string;
  endDate: string;
  includeProductivity: boolean;
}): Promise<TargetLookups> {
  const [productivityLineItems, existingProductivity, existingTimecards, users, companyUsers, people, timeTypes, workClassifications, costCodes] = await Promise.all([
    params.includeProductivity
      ? fetchTargetProductivityLineItems(params)
      : Promise.resolve([]),
    params.includeProductivity
      ? fetchSourceProductivityLogs({
          accessToken: params.accessToken,
          companyId: params.companyId,
          projectId: params.projectId,
          startDate: params.startDate,
          endDate: params.endDate,
          maxPages: 100,
        })
      : Promise.resolve([]),
    fetchPaged({
      accessToken: params.accessToken,
      companyId: params.companyId,
      maxPages: 25,
      pathForPage: (page) => {
        const query = new URLSearchParams({
          company_id: params.companyId,
          start_date: params.startDate,
          end_date: params.endDate,
          page: String(page),
          per_page: "100",
        });
        return `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/timecard_entries?${query.toString()}`;
      },
    }),
    procoreFetch({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/users?company_id=${encodeURIComponent(params.companyId)}&page=1&per_page=1000`,
    }).then(unwrapArray).catch(() => []),
    procoreFetch({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `/rest/v1.0/companies/${encodeURIComponent(params.companyId)}/users?page=1&per_page=1000`,
    }).then(unwrapArray).catch(() => []),
    procoreFetch({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/people?company_id=${encodeURIComponent(params.companyId)}&page=1&per_page=1000`,
    }).then(unwrapArray).catch(() => []),
    procoreFetch({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `/rest/v1.0/timecard_time_types?project_id=${encodeURIComponent(params.projectId)}&page=1&per_page=1000`,
    }).then(unwrapArray).catch(() => []),
    fetchWorkClassifications(params),
    procoreFetch({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `/rest/v1.0/cost_codes?project_id=${encodeURIComponent(params.projectId)}&page=1&per_page=1000`,
    }).then(unwrapArray).catch(() => []),
  ]);

  const usersByName = new Map<string, UnknownRecord>();
  const usersByCompactName = new Map<string, UnknownRecord>();
  const usersByNameTokens = new Map<string, UnknownRecord>();
  const usersByLogin = new Map<string, UnknownRecord>();
  for (const user of [...users, ...companyUsers]) {
    const name = normalizeKey(user.name);
    const compactName = compactKey(user.name);
    const tokenName = nameTokenKey(user.name);
    const login = normalizeKey(user.login || user.email_address || user.email);
    if (name && !usersByName.has(name)) usersByName.set(name, user);
    if (compactName && !usersByCompactName.has(compactName)) usersByCompactName.set(compactName, user);
    if (tokenName && !usersByNameTokens.has(tokenName)) usersByNameTokens.set(tokenName, user);
    if (login && !usersByLogin.has(login)) usersByLogin.set(login, user);
  }

  const peopleById = new Map<string, UnknownRecord>();
  const peopleByName = new Map<string, UnknownRecord>();
  const peopleByCompactName = new Map<string, UnknownRecord>();
  const peopleByNameTokens = new Map<string, UnknownRecord>();
  const peopleByUserId = new Map<string, UnknownRecord>();
  const peopleByContactId = new Map<string, UnknownRecord>();
  for (const person of people) {
    const id = readStr(person.id);
    const name = normalizeKey(person.name || `${readStr(person.first_name)} ${readStr(person.last_name)}`);
    const compactName = compactKey(person.name || `${readStr(person.first_name)} ${readStr(person.last_name)}`);
    const tokenName = nameTokenKey(person.name || `${readStr(person.first_name)} ${readStr(person.last_name)}`);
    const userId = readStr(person.user_id || person.userId);
    const contactId = readStr(person.contact_id || person.contactId);
    if (id) peopleById.set(id, person);
    if (name && !peopleByName.has(name)) peopleByName.set(name, person);
    if (compactName && !peopleByCompactName.has(compactName)) peopleByCompactName.set(compactName, person);
    if (tokenName && !peopleByNameTokens.has(tokenName)) peopleByNameTokens.set(tokenName, person);
    if (userId) peopleByUserId.set(userId, person);
    if (contactId) peopleByContactId.set(contactId, person);
  }

  const timeTypesByName = new Map<string, UnknownRecord>();
  for (const timeType of timeTypes) {
    const name = normalizeKey(timeType.name || timeType.time_type || timeType.abbreviated_time_type);
    if (name && !timeTypesByName.has(name)) timeTypesByName.set(name, timeType);
  }

  const workClassificationsById = new Map<string, UnknownRecord>();
  const workClassificationsByName = new Map<string, UnknownRecord>();
  const workClassificationsByCompactName = new Map<string, UnknownRecord>();
  const workClassificationsByAbbreviation = new Map<string, UnknownRecord>();
  for (const classification of workClassifications) {
    const id = readStr(classification.id);
    const name = normalizeKey(
      classification.name ||
        classification.classification ||
        classification.classification_type ||
        classification.work_classification ||
        classification.label
    );
    const compactName = compactKey(name);
    const abbreviation = normalizeKey(classification.abbreviation || classification.abbr);
    if (id) workClassificationsById.set(id, classification);
    if (name && !workClassificationsByName.has(name)) workClassificationsByName.set(name, classification);
    if (compactName && !workClassificationsByCompactName.has(compactName)) workClassificationsByCompactName.set(compactName, classification);
    if (abbreviation && !workClassificationsByAbbreviation.has(abbreviation)) workClassificationsByAbbreviation.set(abbreviation, classification);
  }

  const costCodesByFullCode = new Map<string, UnknownRecord>();
  const costCodesByName = new Map<string, UnknownRecord>();
  for (const costCode of costCodes) {
    const fullCode = readStr(costCode.full_code || costCode.code);
    const name = normalizeKey(costCode.name);
    if (fullCode && !costCodesByFullCode.has(fullCode)) costCodesByFullCode.set(fullCode, costCode);
    if (name && !costCodesByName.has(name)) costCodesByName.set(name, costCode);
  }

  const existingTimecardKeys = new Set(existingTimecards.map(timecardEntryKey).filter(Boolean));
  const existingProductivityCounts = countProductivityFingerprints(
    existingProductivity.map(productivityEntryFingerprint).filter(Boolean)
  );

  return {
    productivityLineItems,
    existingProductivityCounts,
    existingProductivityRows: existingProductivity.length,
    existingTimecardKeys,
    existingTimecardRows: existingTimecards.length,
    timeTypes,
    people,
    peopleById,
    peopleByName,
    peopleByCompactName,
    peopleByNameTokens,
    peopleByUserId,
    peopleByContactId,
    users: [...users, ...companyUsers],
    usersByName,
    usersByCompactName,
    usersByNameTokens,
    usersByLogin,
    timeTypesByName,
    workClassifications,
    workClassificationsById,
    workClassificationsByName,
    workClassificationsByCompactName,
    workClassificationsByAbbreviation,
    costCodesByFullCode,
    costCodesByName,
  };
}

function mapProductivityLog(
  log: UnknownRecord,
  lookups: TargetLookups,
  options?: { allowFallbackMatch?: boolean; productivityLineItemMap?: Record<string, unknown> }
) {
  const sourceLineItemId = readStr(log.line_item_id || log.lineItemId || firstRecord(log.line_item)?.id);
  const contractNumber = contractNumberFromLog(log);
  const contractTitle = contractTitleFromLog(log);
  const lineItemDescription = lineItemDescriptionFromLog(log);
  const lineNumber = lineNumberFromDescription(lineItemDescription);

  const descriptionKey = normalizeKey(lineItemDescription);
  const cleanDescriptionKey = normalizeDescriptionKey(lineItemDescription);
  const contractNumberKey = normalizeKey(contractNumber);
  const contractTitleKey = normalizeKey(contractTitle);
  const sourceContractId = contractIdFromLog(log);

  const overrideMap = options?.productivityLineItemMap || {};
  const overrideKey = `${sourceContractId}|${sourceLineItemId}`;
  const overrideValue =
    (sourceLineItemId
      ? readNum(overrideMap[sourceLineItemId]) ?? readStr(overrideMap[sourceLineItemId])
      : undefined) ??
    (sourceLineItemId
      ? readNum(overrideMap[overrideKey]) ?? readStr(overrideMap[overrideKey])
      : undefined) ??
    readNum(overrideMap[lineItemDescription]) ?? readStr(overrideMap[lineItemDescription]) ??
    readNum(overrideMap[cleanDescriptionKey]) ?? readStr(overrideMap[cleanDescriptionKey]) ??
    readNum(overrideMap[`${contractNumber}|${lineNumber ?? ""}`]) ?? readStr(overrideMap[`${contractNumber}|${lineNumber ?? ""}`]);

  let target =
    overrideValue !== undefined && String(overrideValue).trim()
      ? lookups.productivityLineItems.find((item) => String(item.id) === String(overrideValue).trim())
      : undefined;
  let matchStrategy = target ? "override_map" : "";

  if (!target) {
    target = sourceLineItemId
    ? lookups.productivityLineItems.find((item) => item.sourceIds.includes(sourceLineItemId))
    : undefined;
    if (target) matchStrategy = "source_line_item_id";
  }
  if (!target) target = lookups.productivityLineItems.find(
    (item) => contractNumbersMatch(item.contractNumber, contractNumber) && normalizeKey(item.description) === descriptionKey
  );
  if (target && !matchStrategy) matchStrategy = "contract_number_description";
  if (!target && contractTitleKey) {
    target = lookups.productivityLineItems.find(
      (item) => normalizeKey(item.contractTitle) === contractTitleKey && normalizeKey(item.description) === descriptionKey
    );
    if (target) matchStrategy = "contract_title_description";
  }
  if (!target && contractNumberKey && lineNumber !== null) {
    const lineMatches = lookups.productivityLineItems.filter(
      (item) => contractNumbersMatch(item.contractNumber, contractNumber) && item.lineNumbers.includes(lineNumber)
    );
    if (lineMatches.length === 1 && descriptionOverlapScore(lineItemDescription, lineMatches[0].description) >= 0.35) {
      target = lineMatches[0];
      matchStrategy = "contract_number_line_number";
    }
  }
  if (!target && contractTitleKey && lineNumber !== null) {
    const lineMatches = lookups.productivityLineItems.filter(
      (item) => normalizeKey(item.contractTitle) === contractTitleKey && item.lineNumbers.includes(lineNumber)
    );
    if (lineMatches.length === 1 && descriptionOverlapScore(lineItemDescription, lineMatches[0].description) >= 0.35) {
      target = lineMatches[0];
      matchStrategy = "contract_title_line_number";
    }
  }
  if (!target && cleanDescriptionKey) {
    const cleanMatches = lookups.productivityLineItems.filter(
      (item) => normalizeDescriptionKey(item.description) === cleanDescriptionKey
    );
    if (cleanMatches.length === 1) {
      target = cleanMatches[0];
      matchStrategy = "unique_clean_description";
    }
  }
  if (!target && cleanDescriptionKey) {
    const sourceContractId = contractIdFromLog(log);
    const sourceContractMatches = lookups.productivityLineItems
      .map((item) => ({
        item,
        score: canonicalMaterialOverlap(lineItemDescription, item.description),
        tokenScore: descriptionOverlapScore(lineItemDescription, item.description),
        cleanMatch: normalizeDescriptionKey(item.description) === cleanDescriptionKey,
      }))
      .filter(({ item, score }) => score >= 0.6 && sourceContractId && item.sourceContractIds.includes(sourceContractId))
    const bestSourceContract = bestDescriptionMatch(sourceContractMatches);
    if (bestSourceContract) {
      target = bestSourceContract.item;
      matchStrategy = "source_contract_canonical_description";
    }
  }
  if (!target && cleanDescriptionKey) {
    const contractMatches = lookups.productivityLineItems
      .map((item) => ({
        item,
        score: canonicalMaterialOverlap(lineItemDescription, item.description),
        tokenScore: descriptionOverlapScore(lineItemDescription, item.description),
        cleanMatch: normalizeDescriptionKey(item.description) === cleanDescriptionKey,
      }))
      .filter(({ item, score }) =>
        score >= 0.6 &&
        (contractNumbersMatch(item.contractNumber, contractNumber) || normalizeKey(item.contractTitle) === contractTitleKey)
      );
    const best = bestDescriptionMatch(contractMatches);
    if (best) {
      target = best.item;
      matchStrategy = "contract_canonical_description";
    }
  }
  if (!target && cleanDescriptionKey) {
    const sourceRebarSize = rebarSizeFromDescription(lineItemDescription);
    if (sourceRebarSize) {
      const sourceContractId = contractIdFromLog(log);
      const rebarMatches = lookups.productivityLineItems
        .map((item) => ({
          item,
          score: canonicalMaterialOverlap(lineItemDescription, item.description),
          sameSourceContract: Boolean(sourceContractId && item.sourceContractIds.includes(sourceContractId)),
          sameContract: contractNumbersMatch(item.contractNumber, contractNumber) || normalizeKey(item.contractTitle) === contractTitleKey,
        }))
        .filter(({ item, score, sameSourceContract, sameContract }) =>
          (sameSourceContract || sameContract) &&
          score >= 0.5 &&
          rebarSizeFromDescription(item.description) === sourceRebarSize
        )
        .sort((a, b) => Number(b.sameSourceContract) - Number(a.sameSourceContract) || b.score - a.score);
      const bestScore = rebarMatches[0]?.score || 0;
      const bestSourceScoped = rebarMatches.filter((entry) => entry.sameSourceContract && entry.score === bestScore);
      const best = bestSourceScoped.length ? bestSourceScoped : rebarMatches.filter((entry) => entry.score === bestScore);
      const uniqueDescriptions = new Set(best.map((entry) => normalizeDescriptionKey(entry.item.description)));
      if (best.length === 1 || uniqueDescriptions.size === 1) {
        target = best[0].item;
        matchStrategy = best[0].sameSourceContract ? "source_contract_rebar_size" : "contract_rebar_size";
      }
    }
  }
  if (!target && cleanDescriptionKey) {
    const globalMatches = lookups.productivityLineItems
      .map((item) => ({
        item,
        score: canonicalMaterialOverlap(lineItemDescription, item.description),
        tokenScore: descriptionOverlapScore(lineItemDescription, item.description),
        cleanMatch: normalizeDescriptionKey(item.description) === cleanDescriptionKey,
      }))
      .filter(({ score }) => score >= 0.75)
    const best = bestDescriptionMatch(globalMatches);
    if (best) {
      target = best.item;
      matchStrategy = "unique_canonical_description";
    }
  }
  if (!target) {
    target = lookups.productivityLineItems.find((item) => normalizeKey(item.description) === descriptionKey);
    if (target) matchStrategy = "description_only";
  }

  if (!target && options?.allowFallbackMatch) {
    target = resolveProductivityFallbackTarget({ lineItemDescription, contractNumber, contractTitle, lookups }) || undefined;
    if (target) matchStrategy = "fallback_best_candidate";
  }

  const payload: UnknownRecord = {
    date: normalizeDate(log.log_date || log.date),
    notes: readStr(log.notes),
    quantity_delivered: readNum(log.quantity_delivered),
    quantity_used: readNum(log.quantity_used),
  };
  Object.keys(payload).forEach((key) => payload[key] === undefined || payload[key] === "" ? delete payload[key] : undefined);
  if (target) payload.line_item_id = target.id;
  const productivityFingerprint = target
    ? productivityCloneFingerprint({
        date: payload.date,
        contractNumber: target.contractNumber || contractNumber,
        lineItemDescription: target.description || lineItemDescription,
        quantityDelivered: payload.quantity_delivered,
        quantityUsed: payload.quantity_used,
        notes: payload.notes,
      })
    : "";

  return {
    sourceId: readStr(log.id),
    sourceContractId,
    sourceLineItemId,
    contractNumber,
    contractTitle,
    lineItemDescription,
    lineNumber,
    mapped: Boolean(target),
    productivityFingerprint,
    matchStrategy: matchStrategy || null,
    targetLineItem: target || null,
    payload,
    issue: target ? null : "missing_target_line_item",
    candidateTargets: target ? [] : productivityCandidateTargets({ lineItemDescription, contractNumber, contractTitle, lookups }),
  };
}

function mapTimecardEntry(
  entry: UnknownRecord,
  lookups: TargetLookups,
  defaultTimecardTimeTypeId?: number,
  timecardTimeTypeMap: Record<string, unknown> = {},
  partyMap: Record<string, unknown> = {},
  timecardClassificationMap: Record<string, unknown> = {},
  options?: { allowPartyNameFallback?: boolean; defaultPartyId?: number; allowBuiltInPartyFallback?: boolean }
) {
  const party = sourcePartyFromEntry(entry);
  const timeType = sourceTimeTypeFromEntry(entry);
  const costCode = sourceCostCodeFromEntry(entry);
  const classification = sourceClassificationFromEntry(entry);

  const mappedPartyValue =
    readNum(partyMap[party.id]) ??
    readNum(partyMap[party.name]) ??
    readNum(partyMap[normalizeKey(party.name)]) ??
    readNum(partyMap[party.login]) ??
    readNum(partyMap[normalizeKey(party.login)]);
  const mappedPartyId = resolveTargetPersonId(lookups, mappedPartyValue);
  const sameIdPerson = party.id ? lookups.peopleById.get(party.id) : undefined;
  const exactPerson = lookups.peopleByName.get(normalizeKey(party.name));
  const compactPerson = lookups.peopleByCompactName.get(compactKey(party.name));
  const tokenPerson = lookups.peopleByNameTokens.get(nameTokenKey(party.name));
  const targetPerson = exactPerson || (options?.allowPartyNameFallback ? (compactPerson || tokenPerson) : undefined);
  const targetUser =
    lookups.usersByLogin.get(normalizeKey(party.login)) ||
    lookups.usersByName.get(normalizeKey(party.name)) ||
    (options?.allowPartyNameFallback
      ? lookups.usersByCompactName.get(compactKey(party.name)) || lookups.usersByNameTokens.get(nameTokenKey(party.name))
      : undefined);
  const targetTimeType = lookups.timeTypesByName.get(normalizeKey(timeType.name));
  const sourceTimeTypeBlank = !readStr(timeType.id) && !readStr(timeType.name);
  const mappedTimeTypeId =
    readNum(timecardTimeTypeMap[timeType.id]) ??
    readNum(timecardTimeTypeMap[timeType.name]) ??
    readNum(timecardTimeTypeMap[normalizeKey(timeType.name)]);
  const fallbackTimeType = fallbackTimeTypeForSource(timeType.name, lookups);
  const onlyTargetTimeType = lookups.timeTypes.length === 1 ? lookups.timeTypes[0] : undefined;
  const targetCostCode =
    lookups.costCodesByFullCode.get(readStr(costCode.fullCode)) ||
    lookups.costCodesByName.get(normalizeKey(costCode.name)) ||
    fallbackCostCodeForSource(costCode, lookups);
  const mappedClassificationId =
    readNum(timecardClassificationMap[classification.id]) ??
    readNum(timecardClassificationMap[classification.name]) ??
    readNum(timecardClassificationMap[normalizeKey(classification.name)]);
  const targetClassification =
    (mappedClassificationId !== undefined ? lookups.workClassificationsById.get(String(mappedClassificationId)) : undefined) ||
    (classification.id ? lookups.workClassificationsById.get(classification.id) : undefined) ||
    lookups.workClassificationsByName.get(normalizeKey(classification.name)) ||
    lookups.workClassificationsByCompactName.get(compactKey(classification.name)) ||
    lookups.workClassificationsByAbbreviation.get(normalizeKey(classification.abbreviation));
  const targetClassificationId = getNestedId(targetClassification) ?? mappedClassificationId;
  const targetUserId = getTargetPartyId(targetUser);
  const builtInFallbackPartyId = options?.allowBuiltInPartyFallback === false
    ? undefined
    : BUILT_IN_PARTY_FALLBACK_BY_SOURCE_ID[party.id] ?? BUILT_IN_PARTY_FALLBACK_BY_NAME[normalizeKey(party.name)];
  const partyId =
    mappedPartyId ??
    mappedPartyValue ??
    getTargetPartyId(sameIdPerson) ??
    getTargetPartyId(targetPerson) ??
    targetUserId ??
    builtInFallbackPartyId ??
    options?.defaultPartyId;

  const payload: UnknownRecord = {
    date: normalizeDate(entry.date || entry.log_date),
    description: readStr(entry.description),
    billable: typeof entry.billable === "boolean" ? entry.billable : undefined,
    hours: readNum(entry.hours || entry.total_hours_worked),
    lunch_time: readNum(entry.lunch_time),
    time_in: readStr(entry.time_in),
    time_out: readStr(entry.time_out),
    party_id: partyId,
    timecard_time_type_id: sourceTimeTypeBlank
      ? undefined
      : mappedTimeTypeId ?? getNestedId(targetTimeType) ?? getNestedId(fallbackTimeType) ?? defaultTimecardTimeTypeId ?? getNestedId(onlyTargetTimeType),
    cost_code_id: getNestedId(targetCostCode),
    work_classification_id: targetClassificationId,
  };
  Object.keys(payload).forEach((key) => payload[key] === undefined || payload[key] === "" ? delete payload[key] : undefined);
  const existingTargetTimecard = Boolean(payload.party_id && lookups.existingTimecardKeys.has(timecardPayloadKey(payload)));

  const issues = [
    payload.party_id ? "" : "missing_target_party",
    payload.cost_code_id ? "" : "missing_target_cost_code",
  ].filter(Boolean);

  const warnings = [
    sourceTimeTypeBlank || payload.timecard_time_type_id ? "" : "missing_target_time_type",
    classification.id || classification.name ? (payload.work_classification_id ? "" : "missing_target_classification") : "",
  ].filter(Boolean);

  return {
    sourceId: readStr(entry.id),
    sourceParty: party,
    targetPartyFallbackUsed:
      (options?.allowPartyNameFallback && !exactPerson && (Boolean(compactPerson) || Boolean(tokenPerson))) ||
      (!targetPerson && partyId !== undefined),
    targetParty:
      sameIdPerson ||
      targetPerson ||
      (partyId !== undefined
        ? {
            id: partyId,
            mapped: true,
            source:
              mappedPartyValue !== undefined
                ? "map"
                : getTargetPartyId(sameIdPerson) !== undefined
                  ? "same_person_id"
                  : targetUserId !== undefined
                    ? "company_user"
                    : builtInFallbackPartyId !== undefined
                      ? "built_in_fallback"
                    : options?.defaultPartyId !== undefined
                      ? "default_party_id"
                      : "company_user",
          }
        : null),
    targetUser: targetUser || null,
    sourceTimeType: timeType,
    targetTimeTypeFallbackUsed: sourceTimeTypeBlank ? false : mappedTimeTypeId !== undefined || (!targetTimeType && (Boolean(fallbackTimeType) || defaultTimecardTimeTypeId !== undefined || Boolean(onlyTargetTimeType))),
    targetTimeType: sourceTimeTypeBlank ? null : (mappedTimeTypeId !== undefined ? { id: mappedTimeTypeId, mapped: true } : undefined) || targetTimeType || fallbackTimeType || onlyTargetTimeType || null,
    sourceCostCode: costCode,
    sourceClassification: classification,
    targetClassificationFallbackUsed: !targetClassification && mappedClassificationId !== undefined,
    targetClassification: targetClassification || (mappedClassificationId !== undefined ? { id: mappedClassificationId, mapped: true } : null),
    mapped: issues.length === 0,
    existingTargetTimecard,
    payload,
    issues,
    warnings,
  };
}

function productivityDiagnostics(productivity: ReturnType<typeof mapProductivityLog>[], lookups: TargetLookups) {
  const missingByContract = new Map<string, { sourceContractId: string; contractNumber: string; contractTitle: string; rows: number; lineNumbers: number[]; descriptions: string[] }>();
  const missingRows: ReturnType<typeof mapProductivityLog>[] = [];
  for (const row of productivity) {
    if (row.mapped) continue;
    const key = `${row.contractNumber}||${row.contractTitle}`;
    const existing =
      missingByContract.get(key) ||
      { sourceContractId: row.sourceContractId, contractNumber: row.contractNumber, contractTitle: row.contractTitle, rows: 0, lineNumbers: [], descriptions: [] };
    if (!existing.sourceContractId && row.sourceContractId) existing.sourceContractId = row.sourceContractId;
    existing.rows += 1;
    if (row.lineNumber !== null && !existing.lineNumbers.includes(row.lineNumber)) existing.lineNumbers.push(row.lineNumber);
    if (row.lineItemDescription && !existing.descriptions.includes(row.lineItemDescription)) {
      existing.descriptions.push(row.lineItemDescription);
    }
    missingByContract.set(key, existing);

    missingRows.push(row);
  }

  const targetByContract = new Map<string, { contractNumber: string; contractTitle: string; rows: number; lineNumbers: number[]; descriptions: string[] }>();
  for (const item of lookups.productivityLineItems) {
    const key = `${item.contractNumber}||${item.contractTitle}`;
    const existing =
      targetByContract.get(key) ||
      { contractNumber: item.contractNumber, contractTitle: item.contractTitle, rows: 0, lineNumbers: [], descriptions: [] };
    existing.rows += 1;
    for (const lineNumber of item.lineNumbers) {
      if (!existing.lineNumbers.includes(lineNumber)) existing.lineNumbers.push(lineNumber);
    }
    if (item.description && !existing.descriptions.includes(item.description)) existing.descriptions.push(item.description);
    targetByContract.set(key, existing);
  }

  return {
    missingSourceContracts: Array.from(missingByContract.values()).map((row) => ({
      ...row,
      lineNumbers: row.lineNumbers.sort((a, b) => a - b),
      descriptions: row.descriptions.slice(0, 10),
    })),
    targetContracts: Array.from(targetByContract.values()).map((row) => ({
      ...row,
      lineNumbers: row.lineNumbers.sort((a, b) => a - b),
      descriptions: row.descriptions.slice(0, 10),
    })),
    missingRows,
  };
}

function timecardDiagnostics(timecards: ReturnType<typeof mapTimecardEntry>[], lookups: TargetLookups) {
  const missingTimeTypes = new Map<string, { id: string; name: string; rows: number }>();
  const missingParties = new Map<string, { id: string; name: string; login: string; rows: number }>();
  const missingClassifications = new Map<string, { id: string; name: string; rows: number }>();
  for (const row of timecards) {
    if (row.issues.includes("missing_target_time_type")) {
      const key = `${row.sourceTimeType.id}||${row.sourceTimeType.name}`;
      const existing = missingTimeTypes.get(key) || { id: row.sourceTimeType.id, name: row.sourceTimeType.name, rows: 0 };
      existing.rows += 1;
      missingTimeTypes.set(key, existing);
    }
    if (row.issues.includes("missing_target_party")) {
      const key = `${row.sourceParty.id}||${row.sourceParty.name}||${row.sourceParty.login}`;
      const existing = missingParties.get(key) || { id: row.sourceParty.id, name: row.sourceParty.name, login: row.sourceParty.login, rows: 0 };
      existing.rows += 1;
      missingParties.set(key, existing);
    }
    if (row.issues.includes("missing_target_classification")) {
      const key = `${row.sourceClassification.id}||${row.sourceClassification.name}`;
      const existing = missingClassifications.get(key) || { id: row.sourceClassification.id, name: row.sourceClassification.name, rows: 0 };
      existing.rows += 1;
      missingClassifications.set(key, existing);
    }
  }

  return {
    missingSourceTimeTypes: Array.from(missingTimeTypes.values()),
    missingSourceParties: Array.from(missingParties.values()),
    missingSourceClassifications: Array.from(missingClassifications.values()),
    availableTargetTimeTypes: lookups.timeTypes.map((timeType) => ({
      id: readStr(timeType.id),
      name: readStr(timeType.name || timeType.time_type || timeType.abbreviated_time_type),
      timeType: readStr(timeType.time_type),
      abbreviatedTimeType: readStr(timeType.abbreviated_time_type),
      keys: Object.keys(timeType).slice(0, 20),
    })),
    availableTargetClassifications: lookups.workClassifications.map((classification) => ({
      id: readStr(classification.id),
      name: readStr(
        classification.name ||
          classification.classification ||
          classification.classification_type ||
          classification.work_classification ||
          classification.label
      ),
      keys: Object.keys(classification).slice(0, 20),
    })),
  };
}

async function createProductivityLog(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  payload: UnknownRecord;
}) {
  return procoreFetch({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/productivity_logs`,
    method: "POST",
    body: { productivity_log: params.payload },
  });
}

async function createTimecardEntry(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  payload: UnknownRecord;
}) {
  return procoreFetch({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/timecard_entries`,
    method: "POST",
    body: { timecard_entry: params.payload },
  });
}

async function addCompanyUserToProject(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  userId: number;
}) {
  return procoreFetch({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/users/${encodeURIComponent(String(params.userId))}/actions/add`,
    method: "POST",
    body: { user: {} },
  });
}

function retryDelayMsFromError(message: string) {
  const retryAfterMatch = message.match(/"retry_after"\s*:\s*(\d+)/i);
  const retryAfterSeconds = retryAfterMatch ? Number.parseInt(retryAfterMatch[1], 10) : 0;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 20000);
  }
  return 15000;
}

function isRetryableProcoreCreateError(message: string) {
  return /\((429|500|502|503|504)\)/.test(message) || /"retryable"\s*:\s*true/i.test(message);
}

function isRateLimitProcoreCreateError(message: string) {
  return /\(429\)/.test(message) || /rate limit|too many requests|surpassed the max number of requests/i.test(message);
}

async function retryProcoreCreate<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= maxAttempts || !isRetryableProcoreCreateError(message)) throw error;
      const delayMs = retryDelayMsFromError(message);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const cookieStore = await cookies();

    const cookieToken = readStr(cookieStore.get("procore_access_token")?.value);
    const bodyToken = readStr(body.accessToken);
    let accessToken = cookieToken || bodyToken;
    let tokenSource: "cookie" | "explicit" | "client_credentials" = cookieToken ? "cookie" : "explicit";
    if (!accessToken) {
      accessToken = await getClientCredentialsToken();
      tokenSource = "client_credentials";
    }

    const sourceCompanyId = readStr(body.sourceCompanyId);
    const sourceProjectId = readStr(body.sourceProjectId);
    const targetCompanyId = readStr(body.targetCompanyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId);
    const targetProjectId = readStr(body.targetProjectId);
    const startDate = normalizeDate(body.startDate);
    const endDate = normalizeDate(body.endDate || body.startDate);
    const dryRun = body.dryRun !== false;
    const includeProductivity = body.includeProductivity !== false;
    const includeTimecards = body.includeTimecards !== false;
    const maxPages = Math.max(1, Math.min(100, Math.trunc(readNum(body.maxPages) || 10)));
    const createOffset = Math.max(0, Math.trunc(readNum(body.createOffset) || 0));
    const createLimit = Math.max(1, Math.min(500, Math.trunc(readNum(body.createLimit) || 100)));
    const maxCreateMs = Math.max(5000, Math.min(25000, Math.trunc(readNum(body.maxCreateMs) || 18000)));
    const defaultTimecardTimeTypeId = readNum(body.defaultTimecardTimeTypeId);
    const defaultPartyId = readNum(body.defaultPartyId);
    const allowProductivityFallback = body.allowProductivityFallback !== false;
    const allowPartyNameFallback = body.allowPartyNameFallback !== false;
    const allowBuiltInPartyFallback = body.allowBuiltInPartyFallback !== false;
    const productivityLineItemMap = isRecord(body.productivityLineItemMap) ? body.productivityLineItemMap : {};
    const timecardTimeTypeMap = isRecord(body.timecardTimeTypeMap) ? body.timecardTimeTypeMap : {};
    const partyMap = isRecord(body.partyMap) ? body.partyMap : {};
    const timecardClassificationMap = isRecord(body.timecardClassificationMap) ? body.timecardClassificationMap : {};
    const productivitySourceIds = parseStringArray(body.productivitySourceIds || body.sourceProductivityIds);
    const productivitySourceIdSet = new Set(productivitySourceIds);
    const repairMode = productivitySourceIdSet.size > 0;
    const effectiveIncludeTimecards = includeTimecards && !repairMode;

    if (!sourceCompanyId || !sourceProjectId || !targetCompanyId || !targetProjectId || !startDate || !endDate) {
      return NextResponse.json(
        { error: "Missing required fields: sourceCompanyId, sourceProjectId, targetCompanyId, targetProjectId, startDate, endDate." },
        { status: 400 }
      );
    }

    if (!dryRun && includeProductivity && effectiveIncludeTimecards) {
      return NextResponse.json(
        {
          error: "Run productivity and timecards separately for live clones so each data set has an independent continuation offset.",
          nextStep: "Uncheck either Productivity or Timecards, then rerun the live clone at createOffset 0.",
        },
        { status: 400 }
      );
    }

    const [sourceProductivity, sourceTimecards, targetLookups] = await Promise.all([
      includeProductivity
        ? fetchSourceProductivityLogs({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, startDate, endDate, maxPages })
        : Promise.resolve([]),
      effectiveIncludeTimecards
        ? fetchSourceTimecards({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, startDate, endDate, maxPages })
        : Promise.resolve([]),
      fetchTargetLookups({
        accessToken,
        companyId: targetCompanyId,
        projectId: targetProjectId,
        startDate,
        endDate,
        includeProductivity,
      }),
    ]);

    const lookupHealth = {
      targetProductivityLineItems: targetLookups.productivityLineItems.length,
      targetProductivityLogs: targetLookups.existingProductivityRows,
      targetTimecards: targetLookups.existingTimecardRows,
      targetPeople: targetLookups.peopleById.size,
      targetCostCodes: targetLookups.costCodesByFullCode.size,
      targetTimeTypes: targetLookups.timeTypes.length,
      targetClassifications: targetLookups.workClassifications.length,
    };

    // When target lookups come back empty, mapping would incorrectly show everything as missing.
    // Return a retryable infrastructure-style response instead of a misleading mapping response.
    if (
      (effectiveIncludeTimecards && sourceTimecards.length > 0 && lookupHealth.targetPeople === 0 && lookupHealth.targetCostCodes === 0) ||
      (includeProductivity && sourceProductivity.length > 0 && lookupHealth.targetProductivityLineItems === 0)
    ) {
      return NextResponse.json(
        {
          error: "Target lookup fetch returned empty data. This is usually a transient Procore API/permission/rate-limit issue.",
          retryable: true,
          source: { companyId: sourceCompanyId, projectId: sourceProjectId, startDate, endDate },
          target: { companyId: targetCompanyId, projectId: targetProjectId },
          createOffset,
          createLimit,
          lookupHealth,
          nextStep: `Retry with the same createOffset (${createOffset}) after a short wait.`,
        },
        { status: 503 }
      );
    }

    const mappedProductivity = sourceProductivity
      .map((log) =>
        mapProductivityLog(log, targetLookups, {
          allowFallbackMatch: allowProductivityFallback,
          productivityLineItemMap,
        })
      )
      .sort((a, b) => compareStableSourceIds(a.sourceId, b.sourceId));
    const productivity = allocateExistingProductivityRows(
      mappedProductivity,
      targetLookups.existingProductivityCounts,
      productivitySourceIdSet
    );
    const mappedTimecards = sourceTimecards.map((entry) =>
      mapTimecardEntry(
        entry,
        targetLookups,
        defaultTimecardTimeTypeId,
        timecardTimeTypeMap,
        partyMap,
        timecardClassificationMap,
        { allowPartyNameFallback, defaultPartyId, allowBuiltInPartyFallback }
      )
    );
    const sourceTimecardKeys = new Set<string>();
    const timecards = mappedTimecards.map((row) => {
      const targetKey = row.mapped ? timecardPayloadKey(row.payload) : "";
      const duplicateSourceTimecard = Boolean(targetKey && sourceTimecardKeys.has(targetKey));
      if (targetKey && !duplicateSourceTimecard) sourceTimecardKeys.add(targetKey);
      return { ...row, duplicateSourceTimecard };
    });

    const missingMappings = [
      ...productivity.filter((row) => !row.mapped).map((row) => ({ type: "productivity_line_item", ...row })),
      ...timecards.filter((row) => !row.mapped).map((row) => ({ type: "timecard_entry", ...row })),
    ];

    const requestedProductivityRows = repairMode
      ? productivity.filter((row) => productivitySourceIdSet.has(row.sourceId))
      : [];
    const foundRequestedProductivityIds = new Set(requestedProductivityRows.map((row) => row.sourceId));
    const unresolvedProductivitySourceIds = repairMode
      ? productivitySourceIds.filter((id) => !foundRequestedProductivityIds.has(id))
      : [];
    const requestedMissingMappings = requestedProductivityRows.filter((row) => !row.mapped);

    if (!dryRun && repairMode && (unresolvedProductivitySourceIds.length > 0 || requestedMissingMappings.length > 0)) {
      return NextResponse.json(
        {
          error: "Productivity repair validation failed before any live creates were attempted.",
          source: { companyId: sourceCompanyId, projectId: sourceProjectId, startDate, endDate },
          target: { companyId: targetCompanyId, projectId: targetProjectId },
          repair: {
            requested: productivitySourceIds.length,
            found: requestedProductivityRows.length,
            unresolvedProductivitySourceIds,
            missingMappings: requestedMissingMappings,
          },
          nextStep: "Correct the requested source IDs or target line-item mappings, then rerun the repair dry run.",
        },
        { status: 409 }
      );
    }

    const mappedProductivityRows = productivity.filter((row) => row.mapped);
    const selectedProductivityRows = productivitySourceIdSet.size > 0
      ? mappedProductivityRows.filter((row) => productivitySourceIdSet.has(row.sourceId))
      : mappedProductivityRows;
    const selectedCreatableProductivityRows = selectedProductivityRows.filter(
      (row) => !row.existingTargetProductivity
    );
    const selectedTimecardRows = (repairMode ? [] : timecards)
      .filter((row) => row.mapped && !row.duplicateSourceTimecard)
      .sort((a, b) => compareStableSourceIds(a.sourceId, b.sourceId));
    const creatableTimecardRows = selectedTimecardRows.filter((row) => !row.existingTargetTimecard);

    const createResults: UnknownRecord[] = [];
    const createStartedAt = Date.now();
    let attemptedCreateRows = 0;
    let pausedBeforeTimeout = false;
    let rateLimited = false;
    let pauseReason = "";
    if (!dryRun) {
      const addedProjectUserIds = new Set<number>();
      const liveTimecardKeys = new Set(targetLookups.existingTimecardKeys);
      for (const row of selectedProductivityRows.slice(createOffset, createOffset + createLimit)) {
        if (Date.now() - createStartedAt > maxCreateMs) {
          pausedBeforeTimeout = true;
          pauseReason = `Stopped before gateway timeout. Continue at create offset ${createOffset + attemptedCreateRows}.`;
          break;
        }
        attemptedCreateRows += 1;
        if (row.existingTargetProductivity) {
          createResults.push({
            type: "productivity_log",
            sourceId: row.sourceId,
            ok: true,
            skipped: true,
            reason: "Matching target productivity row already exists.",
          });
          continue;
        }
        try {
          const result = await retryProcoreCreate(() =>
            createProductivityLog({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, payload: row.payload })
          );
          createResults.push({ type: "productivity_log", sourceId: row.sourceId, ok: true, result });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const retryable = isRetryableProcoreCreateError(message);
          rateLimited = isRateLimitProcoreCreateError(message);
          createResults.push({ type: "productivity_log", sourceId: row.sourceId, ok: false, error: message, retryable, rateLimited, payload: row.payload });
          if (retryable) {
            attemptedCreateRows -= 1;
            pauseReason = rateLimited
              ? `Paused after Procore rate limit. Continue at create offset ${createOffset + attemptedCreateRows}.`
              : `Paused after transient Procore error. Continue at create offset ${createOffset + attemptedCreateRows}.`;
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      for (const row of selectedTimecardRows.slice(createOffset, createOffset + createLimit)) {
        if (Date.now() - createStartedAt > maxCreateMs) {
          pausedBeforeTimeout = true;
          pauseReason = `Stopped before gateway timeout. Continue at create offset ${createOffset + attemptedCreateRows}.`;
          break;
        }
        attemptedCreateRows += 1;
        const targetTimecardKey = timecardPayloadKey(row.payload);
        if (row.existingTargetTimecard || liveTimecardKeys.has(targetTimecardKey)) {
          createResults.push({
            type: "timecard_entry",
            sourceId: row.sourceId,
            ok: true,
            skipped: true,
            reason: "Matching target timecard already exists.",
          });
          continue;
        }
        try {
          const targetParty = isRecord(row.targetParty) ? row.targetParty : null;
          const shouldAddProjectUser = readStr(targetParty?.source) === "company_user";
          const partyId = readNum(row.payload.party_id);
          if (shouldAddProjectUser && partyId !== undefined && !addedProjectUserIds.has(partyId)) {
            await retryProcoreCreate(() =>
              addCompanyUserToProject({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, userId: partyId })
            ).catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              if (!/already|taken|exists|has already/i.test(message)) throw error;
              return null;
            });
            addedProjectUserIds.add(partyId);
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          const result = await retryProcoreCreate(() =>
            createTimecardEntry({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, payload: row.payload })
          );
          liveTimecardKeys.add(targetTimecardKey);
          createResults.push({ type: "timecard_entry", sourceId: row.sourceId, ok: true, result });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const retryable = isRetryableProcoreCreateError(message);
          rateLimited = isRateLimitProcoreCreateError(message);
          createResults.push({ type: "timecard_entry", sourceId: row.sourceId, ok: false, error: message, retryable, rateLimited, payload: row.payload });
          if (retryable) {
            attemptedCreateRows -= 1;
            pauseReason = rateLimited
              ? `Paused after Procore rate limit. Continue at create offset ${createOffset + attemptedCreateRows}.`
              : `Paused after transient Procore error. Continue at create offset ${createOffset + attemptedCreateRows}.`;
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    const errors = createResults.filter((row) => row.ok === false);

    return NextResponse.json({
      success: dryRun ? true : errors.length === 0,
      dryRun,
      tokenSource,
      source: { companyId: sourceCompanyId, projectId: sourceProjectId, startDate, endDate },
      target: { companyId: targetCompanyId, projectId: targetProjectId },
      defaults: {
        defaultTimecardTimeTypeId: defaultTimecardTimeTypeId ?? null,
        defaultPartyId: defaultPartyId ?? null,
        allowProductivityFallback,
        allowPartyNameFallback,
        allowBuiltInPartyFallback,
        repairMode,
        productivitySourceIds,
        productivityLineItemMap,
        timecardTimeTypeMap,
        partyMap,
        timecardClassificationMap,
      },
      counts: {
        sourceProductivity: sourceProductivity.length,
        sourceTimecards: sourceTimecards.length,
        targetProductivityLineItems: targetLookups.productivityLineItems.length,
        mappedProductivity: mappedProductivityRows.length,
        mappedTimecards: timecards.filter((row) => row.mapped).length,
        selectedProductivity: selectedProductivityRows.length,
        creatableProductivity: selectedCreatableProductivityRows.length,
        selectedTimecards: selectedTimecardRows.length,
        creatableTimecards: creatableTimecardRows.length,
        skippedExistingProductivity: productivity.filter((row) => row.existingTargetProductivity).length,
        skippedExistingTimecards: timecards.filter((row) => row.existingTargetTimecard).length,
        skippedDuplicateSourceTimecards: timecards.filter((row) => row.duplicateSourceTimecard).length,
        requestedProductivitySourceIds: productivitySourceIds.length,
        foundRequestedProductivitySourceIds: requestedProductivityRows.length,
        unresolvedProductivitySourceIds: unresolvedProductivitySourceIds.length,
        requestedExistingProductivity: requestedProductivityRows.filter((row) => row.existingTargetProductivity).length,
        requestedMissingProductivityMappings: requestedMissingMappings.length,
        missingMappings: missingMappings.length,
        createOffset,
        createLimit,
        nextCreateOffset: dryRun ? null : createOffset + attemptedCreateRows,
        hasMoreCreatableRows: dryRun
          ? false
          : createOffset + attemptedCreateRows < (
              effectiveIncludeTimecards
                ? selectedTimecardRows.length
                : selectedProductivityRows.length
            ),
        pausedBeforeTimeout,
        rateLimited,
        created: createResults.filter((row) => row.ok === true && row.skipped !== true).length,
        skippedExistingInBatch: createResults.filter((row) => row.skipped === true).length,
        failed: errors.length,
        lookupHealth,
      },
      readyForLiveClone: missingMappings.length === 0,
      productivity,
      timecards,
      missingMappings,
      createResults,
      diagnostics: {
        productivity: productivityDiagnostics(productivity, targetLookups),
        timecards: timecardDiagnostics(timecards, targetLookups),
      },
      previews: {
        sourceProductivity: sourceProductivity.slice(0, 3).map((log) => ({
          id: readStr(log.id),
          keys: Object.keys(log).slice(0, 40),
          lineItemId: readStr(log.line_item_id || log.lineItemId || firstRecord(log.line_item)?.id),
          contractNumber: contractNumberFromLog(log),
          contractTitle: contractTitleFromLog(log),
          lineItemDescription: lineItemDescriptionFromLog(log),
        })),
        targetProductivityLineItems: targetLookups.productivityLineItems.slice(0, 10),
        sourceTimecards: sourceTimecards.slice(0, 3).map((entry) => ({
          id: readStr(entry.id),
          keys: Object.keys(entry).slice(0, 40),
          party: sourcePartyFromEntry(entry),
          timeType: sourceTimeTypeFromEntry(entry),
          costCode: sourceCostCodeFromEntry(entry),
          classification: sourceClassificationFromEntry(entry),
        })),
        targetTimeTypes: targetLookups.timeTypes,
        targetClassifications: targetLookups.workClassifications,
      },
      nextStep: dryRun
        ? "Review missingMappings. If readyForLiveClone is true, rerun with dryRun=false."
        : pauseReason
          ? pauseReason
        : errors.length
          ? "Some live creates failed. Review createResults before continuing."
          : missingMappings.length
            ? `Live clone completed for this batch, but ${missingMappings.length} row(s) still need required mappings. Review diagnostics and continue after filling party or cost code mappings.`
          : "Live clone completed for this batch.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Daily activity clone failed.", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
