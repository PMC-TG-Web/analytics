import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

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
  timeTypes: UnknownRecord[];
  usersByName: Map<string, UnknownRecord>;
  usersByLogin: Map<string, UnknownRecord>;
  timeTypesByName: Map<string, UnknownRecord>;
  costCodesByFullCode: Map<string, UnknownRecord>;
  costCodesByName: Map<string, UnknownRecord>;
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

function normalizeDescriptionKey(value: unknown): string {
  let text = readStr(value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  text = text.replace(/^#\s*\d+\s*-\s*/i, "");
  text = text.replace(/\s*-\s*-?\d+(?:\.\d+)?\s*(?:ea|cy|sf|sq\s*ft|sq_ft|lf|ft|hr|hrs|hours|bag|bags|sheet|sheets|gal|gals|pc|pcs)\s*$/i, "");
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
}) {
  const rows: UnknownRecord[] = [];
  for (let page = 1; page <= params.maxPages; page += 1) {
    const payload = await procoreFetch({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: params.pathForPage(page),
    });
    const pageRows = unwrapArray(payload);
    if (pageRows.length === 0) break;
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return rows;
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
      return `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/timecard_entries?${query.toString()}`;
    },
  });
}

function isApprovedContract(contract: UnknownRecord) {
  const approved = contract.approved;
  if (typeof approved === "boolean") return approved;
  const status = normalizeKey(contract.status || contract.contract_status || contract.state);
  return !status || ["approved", "processing", "submitted", "executed", "complete", "active", "open"].includes(status);
}

async function fetchTargetProductivityLineItems(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
}) {
  const out: ProductivityTargetLineItem[] = [];

  const commitmentContracts = unwrapArray(
    await procoreFetch({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(params.projectId)}/commitment_contracts?page=1&per_page=100`,
    }).catch(() => [])
  ).filter(isApprovedContract);

  for (const contract of commitmentContracts) {
    const contractId = readStr(contract.id);
    if (!contractId) continue;
    const lineItems = unwrapArray(
      await procoreFetch({
        accessToken: params.accessToken,
        companyId: params.companyId,
        path: `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(params.projectId)}/commitment_contracts/${encodeURIComponent(contractId)}/line_items?view=extended&page=1&per_page=100`,
      }).catch(async () =>
        procoreFetch({
          accessToken: params.accessToken,
          companyId: params.companyId,
          path: `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(params.projectId)}/commitment_contracts/${encodeURIComponent(contractId)}/line_items?page=1&per_page=100`,
        }).catch(() => [])
      )
    );
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
    const contracts = unwrapArray(
      await procoreFetch({
        accessToken: params.accessToken,
        companyId: params.companyId,
        path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/${contractPath}?company_id=${encodeURIComponent(params.companyId)}&page=1&per_page=100`,
      }).catch(() => [])
    ).filter(isApprovedContract);

    for (const contract of contracts) {
      const contractId = readStr(contract.id);
      if (!contractId) continue;
      const contractSourceIds = targetContractSourceIds(contract);
      const lineItems = unwrapArray(
        await procoreFetch({
          accessToken: params.accessToken,
          companyId: params.companyId,
          path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/${contractPath}/${encodeURIComponent(contractId)}/line_items?company_id=${encodeURIComponent(params.companyId)}&page=1&per_page=200`,
        }).catch(() => [])
      );
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
}): Promise<TargetLookups> {
  const [productivityLineItems, users, timeTypes, costCodes] = await Promise.all([
    fetchTargetProductivityLineItems(params),
    procoreFetch({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/users?company_id=${encodeURIComponent(params.companyId)}&page=1&per_page=1000`,
    }).then(unwrapArray).catch(() => []),
    procoreFetch({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `/rest/v1.0/timecard_time_types?project_id=${encodeURIComponent(params.projectId)}&page=1&per_page=1000`,
    }).then(unwrapArray).catch(() => []),
    procoreFetch({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `/rest/v1.0/cost_codes?project_id=${encodeURIComponent(params.projectId)}&page=1&per_page=1000`,
    }).then(unwrapArray).catch(() => []),
  ]);

  const usersByName = new Map<string, UnknownRecord>();
  const usersByLogin = new Map<string, UnknownRecord>();
  for (const user of users) {
    const name = normalizeKey(user.name);
    const login = normalizeKey(user.login);
    if (name && !usersByName.has(name)) usersByName.set(name, user);
    if (login && !usersByLogin.has(login)) usersByLogin.set(login, user);
  }

  const timeTypesByName = new Map<string, UnknownRecord>();
  for (const timeType of timeTypes) {
    const name = normalizeKey(timeType.name || timeType.time_type || timeType.abbreviated_time_type);
    if (name && !timeTypesByName.has(name)) timeTypesByName.set(name, timeType);
  }

  const costCodesByFullCode = new Map<string, UnknownRecord>();
  const costCodesByName = new Map<string, UnknownRecord>();
  for (const costCode of costCodes) {
    const fullCode = readStr(costCode.full_code || costCode.code);
    const name = normalizeKey(costCode.name);
    if (fullCode && !costCodesByFullCode.has(fullCode)) costCodesByFullCode.set(fullCode, costCode);
    if (name && !costCodesByName.has(name)) costCodesByName.set(name, costCode);
  }

  return { productivityLineItems, timeTypes, usersByName, usersByLogin, timeTypesByName, costCodesByFullCode, costCodesByName };
}

function mapProductivityLog(log: UnknownRecord, lookups: TargetLookups) {
  const sourceLineItemId = readStr(log.line_item_id || log.lineItemId || firstRecord(log.line_item)?.id);
  const contractNumber = contractNumberFromLog(log);
  const contractTitle = contractTitleFromLog(log);
  const lineItemDescription = lineItemDescriptionFromLog(log);
  const lineNumber = lineNumberFromDescription(lineItemDescription);

  const descriptionKey = normalizeKey(lineItemDescription);
  const cleanDescriptionKey = normalizeDescriptionKey(lineItemDescription);
  const contractNumberKey = normalizeKey(contractNumber);
  const contractTitleKey = normalizeKey(contractTitle);

  let target = sourceLineItemId
    ? lookups.productivityLineItems.find((item) => item.sourceIds.includes(sourceLineItemId))
    : undefined;
  let matchStrategy = target ? "source_line_item_id" : "";
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
      .map((item) => ({ item, score: canonicalMaterialOverlap(lineItemDescription, item.description) }))
      .filter(({ item, score }) => score >= 0.6 && sourceContractId && item.sourceContractIds.includes(sourceContractId))
      .sort((a, b) => b.score - a.score);
    const bestSourceContractScore = sourceContractMatches[0]?.score || 0;
    const bestSourceContract = sourceContractMatches.filter((entry) => entry.score === bestSourceContractScore);
    if (bestSourceContract.length === 1) {
      target = bestSourceContract[0].item;
      matchStrategy = "source_contract_canonical_description";
    }
  }
  if (!target && cleanDescriptionKey) {
    const contractMatches = lookups.productivityLineItems
      .map((item) => ({ item, score: canonicalMaterialOverlap(lineItemDescription, item.description) }))
      .filter(({ item, score }) =>
        score >= 0.6 &&
        (contractNumbersMatch(item.contractNumber, contractNumber) || normalizeKey(item.contractTitle) === contractTitleKey)
      )
      .sort((a, b) => b.score - a.score);
    const bestScore = contractMatches[0]?.score || 0;
    const best = contractMatches.filter((entry) => entry.score === bestScore);
    if (best.length === 1) {
      target = best[0].item;
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
      .map((item) => ({ item, score: canonicalMaterialOverlap(lineItemDescription, item.description) }))
      .filter(({ score }) => score >= 0.75)
      .sort((a, b) => b.score - a.score);
    const bestScore = globalMatches[0]?.score || 0;
    const best = globalMatches.filter((entry) => entry.score === bestScore);
    if (best.length === 1) {
      target = best[0].item;
      matchStrategy = "unique_canonical_description";
    }
  }
  if (!target) {
    target = lookups.productivityLineItems.find((item) => normalizeKey(item.description) === descriptionKey);
    if (target) matchStrategy = "description_only";
  }

  const payload: UnknownRecord = {
    date: normalizeDate(log.log_date || log.date),
    notes: readStr(log.notes),
    quantity_delivered: readNum(log.quantity_delivered),
    quantity_used: readNum(log.quantity_used),
  };
  Object.keys(payload).forEach((key) => payload[key] === undefined || payload[key] === "" ? delete payload[key] : undefined);
  if (target) payload.line_item_id = target.id;

  return {
    sourceId: readStr(log.id),
    sourceContractId: contractIdFromLog(log),
    sourceLineItemId,
    contractNumber,
    contractTitle,
    lineItemDescription,
    lineNumber,
    mapped: Boolean(target),
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
  partyMap: Record<string, unknown> = {}
) {
  const party = sourcePartyFromEntry(entry);
  const timeType = sourceTimeTypeFromEntry(entry);
  const costCode = sourceCostCodeFromEntry(entry);

  const mappedPartyId =
    readNum(partyMap[party.id]) ??
    readNum(partyMap[party.name]) ??
    readNum(partyMap[normalizeKey(party.name)]) ??
    readNum(partyMap[party.login]) ??
    readNum(partyMap[normalizeKey(party.login)]);
  const targetUser =
    lookups.usersByLogin.get(normalizeKey(party.login)) ||
    lookups.usersByName.get(normalizeKey(party.name));
  const targetTimeType = lookups.timeTypesByName.get(normalizeKey(timeType.name));
  const mappedTimeTypeId =
    readNum(timecardTimeTypeMap[timeType.id]) ??
    readNum(timecardTimeTypeMap[timeType.name]) ??
    readNum(timecardTimeTypeMap[normalizeKey(timeType.name)]);
  const onlyTargetTimeType = lookups.timeTypes.length === 1 ? lookups.timeTypes[0] : undefined;
  const targetCostCode =
    lookups.costCodesByFullCode.get(readStr(costCode.fullCode)) ||
    lookups.costCodesByName.get(normalizeKey(costCode.name));

  const payload: UnknownRecord = {
    date: normalizeDate(entry.date || entry.log_date),
    description: readStr(entry.description),
    billable: typeof entry.billable === "boolean" ? entry.billable : undefined,
    hours: readNum(entry.hours || entry.total_hours_worked),
    lunch_time: readNum(entry.lunch_time),
    time_in: readStr(entry.time_in),
    time_out: readStr(entry.time_out),
    party_id: getNestedId(targetUser) ?? mappedPartyId,
    timecard_time_type_id: getNestedId(targetTimeType) ?? mappedTimeTypeId ?? defaultTimecardTimeTypeId ?? getNestedId(onlyTargetTimeType),
    cost_code_id: getNestedId(targetCostCode),
  };
  Object.keys(payload).forEach((key) => payload[key] === undefined || payload[key] === "" ? delete payload[key] : undefined);

  const issues = [
    payload.party_id ? "" : "missing_target_party",
    payload.timecard_time_type_id ? "" : "missing_target_time_type",
    payload.cost_code_id ? "" : "missing_target_cost_code",
  ].filter(Boolean);

  return {
    sourceId: readStr(entry.id),
    sourceParty: party,
    targetPartyFallbackUsed: !targetUser && mappedPartyId !== undefined,
    targetParty: targetUser || (mappedPartyId !== undefined ? { id: mappedPartyId, mapped: true } : null),
    sourceTimeType: timeType,
    targetTimeTypeFallbackUsed: !targetTimeType && (mappedTimeTypeId !== undefined || defaultTimecardTimeTypeId !== undefined || Boolean(onlyTargetTimeType)),
    targetTimeType: targetTimeType || (mappedTimeTypeId !== undefined ? { id: mappedTimeTypeId, mapped: true } : undefined) || onlyTargetTimeType || null,
    sourceCostCode: costCode,
    mapped: issues.length === 0,
    payload,
    issues,
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
  }

  return {
    missingSourceTimeTypes: Array.from(missingTimeTypes.values()),
    missingSourceParties: Array.from(missingParties.values()),
    availableTargetTimeTypes: lookups.timeTypes.map((timeType) => ({
      id: readStr(timeType.id),
      name: readStr(timeType.name || timeType.time_type || timeType.abbreviated_time_type),
      timeType: readStr(timeType.time_type),
      abbreviatedTimeType: readStr(timeType.abbreviated_time_type),
      keys: Object.keys(timeType).slice(0, 20),
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
    const createLimit = Math.max(1, Math.min(500, Math.trunc(readNum(body.createLimit) || 100)));
    const defaultTimecardTimeTypeId = readNum(body.defaultTimecardTimeTypeId);
    const timecardTimeTypeMap = isRecord(body.timecardTimeTypeMap) ? body.timecardTimeTypeMap : {};
    const partyMap = isRecord(body.partyMap) ? body.partyMap : {};

    if (!sourceCompanyId || !sourceProjectId || !targetCompanyId || !targetProjectId || !startDate || !endDate) {
      return NextResponse.json(
        { error: "Missing required fields: sourceCompanyId, sourceProjectId, targetCompanyId, targetProjectId, startDate, endDate." },
        { status: 400 }
      );
    }

    const [sourceProductivity, sourceTimecards, targetLookups] = await Promise.all([
      includeProductivity
        ? fetchSourceProductivityLogs({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, startDate, endDate, maxPages })
        : Promise.resolve([]),
      includeTimecards
        ? fetchSourceTimecards({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, startDate, endDate, maxPages })
        : Promise.resolve([]),
      fetchTargetLookups({ accessToken, companyId: targetCompanyId, projectId: targetProjectId }),
    ]);

    const productivity = sourceProductivity.map((log) => mapProductivityLog(log, targetLookups));
    const timecards = sourceTimecards.map((entry) => mapTimecardEntry(entry, targetLookups, defaultTimecardTimeTypeId, timecardTimeTypeMap, partyMap));

    const missingMappings = [
      ...productivity.filter((row) => !row.mapped).map((row) => ({ type: "productivity_line_item", ...row })),
      ...timecards.filter((row) => !row.mapped).map((row) => ({ type: "timecard_entry", ...row })),
    ];

    const createResults: UnknownRecord[] = [];
    if (!dryRun && missingMappings.length === 0) {
      for (const row of productivity.filter((item) => item.mapped).slice(0, createLimit)) {
        try {
          const result = await createProductivityLog({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, payload: row.payload });
          createResults.push({ type: "productivity_log", sourceId: row.sourceId, ok: true, result });
        } catch (error) {
          createResults.push({ type: "productivity_log", sourceId: row.sourceId, ok: false, error: error instanceof Error ? error.message : String(error), payload: row.payload });
        }
        await new Promise((resolve) => setTimeout(resolve, 350));
      }

      for (const row of timecards.filter((item) => item.mapped).slice(0, createLimit)) {
        try {
          const result = await createTimecardEntry({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, payload: row.payload });
          createResults.push({ type: "timecard_entry", sourceId: row.sourceId, ok: true, result });
        } catch (error) {
          createResults.push({ type: "timecard_entry", sourceId: row.sourceId, ok: false, error: error instanceof Error ? error.message : String(error), payload: row.payload });
        }
        await new Promise((resolve) => setTimeout(resolve, 350));
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
        timecardTimeTypeMap,
        partyMap,
      },
      counts: {
        sourceProductivity: sourceProductivity.length,
        sourceTimecards: sourceTimecards.length,
        targetProductivityLineItems: targetLookups.productivityLineItems.length,
        mappedProductivity: productivity.filter((row) => row.mapped).length,
        mappedTimecards: timecards.filter((row) => row.mapped).length,
        missingMappings: missingMappings.length,
        created: createResults.filter((row) => row.ok === true).length,
        failed: errors.length,
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
        })),
        targetTimeTypes: targetLookups.timeTypes,
      },
      nextStep: dryRun
        ? "Review missingMappings. If readyForLiveClone is true, rerun with dryRun=false."
        : errors.length
          ? "Some live creates failed. Review createResults before continuing."
          : "Live clone completed for this batch.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Daily activity clone failed.", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
