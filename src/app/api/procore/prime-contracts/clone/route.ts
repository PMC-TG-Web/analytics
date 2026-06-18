import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import * as XLSX from "xlsx";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;

const BASE_URL = "https://api.procore.com";
const DEFAULT_CROSSWALK_PATH = "Codes to use.xlsx";

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown, keys: string[] = []): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key] as unknown[];
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
    const parsed = Number(value);
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

function norm(value: unknown): string {
  return readStr(value).replace(/\s+/g, " ").toLowerCase();
}

function normCode(value: unknown): string {
  return readStr(value).replace(/\s+/g, "").toLowerCase();
}

function nonUniqueKey(row: UnknownRecord): string {
  return [row.Name, row.Description, row["Cost Name"]].map(norm).join("|");
}

function itemIdentityKey(row: UnknownRecord): string {
  return [row.Name, row.Description].map(norm).join("|");
}

function tokenSet(value: unknown) {
  return new Set(
    norm(value)
      .replace(/[^a-z0-9#./"'-]+/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 1)
  );
}

function tokenOverlapScore(left: unknown, right: unknown) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
}

function dimensionTokens(value: unknown) {
  const normalized = norm(value);
  const matches = normalized.match(/\d+(?:\/\d+)?(?=\s*(?:"|'|x|\b))/g) || [];
  return new Set(matches);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
  path: string;
  accessToken: string;
  companyId: string;
  method?: string;
  body?: unknown;
  maxRetries?: number;
  allowStatuses?: number[];
}) {
  const method = params.method || "GET";
  const maxRetries = params.maxRetries ?? (method === "GET" ? 1 : 5);
  let response: Response | undefined;
  let text = "";

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    response = await fetch(`${BASE_URL}${params.path}`, {
      method,
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: "application/json",
        ...(params.body ? { "Content-Type": "application/json" } : {}),
        "Procore-Company-Id": params.companyId,
      },
      ...(params.body ? { body: JSON.stringify(params.body) } : {}),
      cache: "no-store",
    });
    text = await response.text();
    if (response.status !== 429 || attempt >= maxRetries) break;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2500 + attempt * 2500;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Keep text response.
  }

  if (!response) throw new Error(`Procore ${method} ${params.path} did not return a response.`);
  if (!response.ok && !params.allowStatuses?.includes(response.status)) {
    throw new Error(`Procore ${method} ${params.path} failed (${response.status}): ${safeJson(payload)}`);
  }

  return { status: response.status, ok: response.ok, payload };
}

async function fetchPaged(params: {
  pathForPage: (page: number) => string;
  accessToken: string;
  companyId: string;
  maxPages: number;
  arrayKeys?: string[];
}) {
  const records: UnknownRecord[] = [];
  const errors: UnknownRecord[] = [];

  for (let page = 1; page <= params.maxPages; page += 1) {
    const path = params.pathForPage(page);
    const response = await procoreJson({
      path,
      accessToken: params.accessToken,
      companyId: params.companyId,
      allowStatuses: [400, 404, 405],
    });
    if (!response.ok) {
      errors.push({ path, status: response.status, response: response.payload });
      break;
    }

    const pageRecords = asArray(response.payload, params.arrayKeys).filter(isRecord);
    if (pageRecords.length === 0) break;
    records.push(...pageRecords);
    if (pageRecords.length < 100) break;
  }

  return { records, errors };
}

async function fetchPrimeContracts(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    maxPages: params.maxPages,
    arrayKeys: ["data", "prime_contracts"],
    pathForPage: (page) =>
      `/rest/v1.0/prime_contracts?project_id=${encodeURIComponent(params.projectId)}&page=${page}&per_page=100`,
  });
}

async function fetchPrimeLineItems(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  primeContractId: string;
  maxPages: number;
}) {
  const candidates = (page: number) => [
    `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(
      params.projectId
    )}/prime_contracts/${encodeURIComponent(params.primeContractId)}/line_items?page=${page}&per_page=100`,
    `/rest/v1.0/prime_contracts/${encodeURIComponent(
      params.primeContractId
    )}/line_items?project_id=${encodeURIComponent(params.projectId)}&page=${page}&per_page=100`,
  ];

  let preferred = "";
  const records: UnknownRecord[] = [];
  const errors: UnknownRecord[] = [];

  for (let page = 1; page <= params.maxPages; page += 1) {
    const pageCandidates = candidates(page);
    if (preferred) {
      const preferredForPage = preferred.replace(/page=\d+/, `page=${page}`);
      const index = pageCandidates.indexOf(preferredForPage);
      if (index > 0) {
        const [candidate] = pageCandidates.splice(index, 1);
        pageCandidates.unshift(candidate);
      }
    }

    let pageRecords: UnknownRecord[] = [];
    let pageOk = false;
    for (const path of pageCandidates) {
      const response = await procoreJson({
        path,
        accessToken: params.accessToken,
        companyId: params.companyId,
        allowStatuses: [400, 404, 405, 500],
      });
      if (!response.ok) {
        errors.push({ path, status: response.status, response: response.payload });
        continue;
      }
      pageRecords = asArray(response.payload, ["data", "line_items", "prime_contract_line_items"]).filter(isRecord);
      preferred = path;
      pageOk = true;
      break;
    }

    if (!pageOk || pageRecords.length === 0) break;
    records.push(...pageRecords);
    if (pageRecords.length < 100) break;
  }

  return { records, errors };
}

function readSheet(workbook: XLSX.WorkBook, sheetName: string): UnknownRecord[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" }) as UnknownRecord[];
}

function buildCrosswalkFromWorkbook(workbook: XLSX.WorkBook) {
  const uniqueOld = readSheet(workbook, "Unique_old_codes");
  const uniqueNew = readSheet(workbook, "Unique_New_codes");
  const nonUniqueOld = readSheet(workbook, "Non_unique_old_codes");
  const nonUniqueNew = readSheet(workbook, "non_unique_new_codes");

  const newUniqueByCostCode = new Map<string, UnknownRecord[]>();
  for (const row of uniqueNew) {
    const key = normCode(row["Cost Code"]);
    if (!key) continue;
    newUniqueByCostCode.set(key, [...(newUniqueByCostCode.get(key) || []), row]);
  }

  const newUniqueByIdentity = new Map<string, UnknownRecord[]>();
  for (const row of uniqueNew) {
    const key = itemIdentityKey(row);
    if (!key.replace(/\|/g, "")) continue;
    newUniqueByIdentity.set(key, [...(newUniqueByIdentity.get(key) || []), row]);
  }

  const newNonUniqueByKey = new Map<string, UnknownRecord[]>();
  for (const row of nonUniqueNew) {
    const key = nonUniqueKey(row);
    if (!key.replace(/\|/g, "")) continue;
    newNonUniqueByKey.set(key, [...(newNonUniqueByKey.get(key) || []), row]);
  }

  const mappings: Array<{ old: UnknownRecord; new: UnknownRecord; strategy: string }> = [];
  const issues: UnknownRecord[] = [];

  for (const oldRow of uniqueOld) {
    const oldItemId = readStr(oldRow.ItemId);
    const costCode = normCode(oldRow["Cost Code"]);
    const identityKey = itemIdentityKey(oldRow);
    const matches = costCode ? newUniqueByCostCode.get(costCode) || [] : newUniqueByIdentity.get(identityKey) || [];
    if (!oldItemId) continue;
    if (matches.length === 1) {
      mappings.push({ old: oldRow, new: matches[0], strategy: costCode ? "unique_cost_code" : "unique_identity" });
    } else {
      issues.push({
        strategy: "unique_cost_code",
        oldItemId,
        costCode: oldRow["Cost Code"],
        issue: matches.length === 0 ? "missing_new_cost_code" : "ambiguous_new_cost_code",
        matchCount: matches.length,
      });
    }
  }

  for (const oldRow of nonUniqueOld) {
    const oldItemId = readStr(oldRow.ItemId);
    const key = nonUniqueKey(oldRow);
    const matches = newNonUniqueByKey.get(key) || [];
    if (!oldItemId) continue;
    if (matches.length === 1) {
      mappings.push({ old: oldRow, new: matches[0], strategy: "non_unique_composite" });
    } else {
      issues.push({
        strategy: "non_unique_composite",
        oldItemId,
        key,
        name: oldRow.Name,
        costCode: oldRow["Cost Code"],
        issue: matches.length === 0 ? "missing_new_composite_key" : "ambiguous_new_composite_key",
        matchCount: matches.length,
      });
    }
  }

  if (!mappings.some((mapping) => readStr(mapping.old.ItemId) === "38975960")) {
    mappings.push({
      old: {
        ItemId: "38975960",
        Name: "V-Seal 102 5 gal",
        "Cost Code": "03-300-40-40",
        "Cost Name": "Concrete Exterior Sealers",
        Description: "V-Seal 102 5 gal / 250 Sq Ft. per Gal. ",
      },
      new: {
        ItemId: "51482273",
        Name: "V-Seal 102 5 gal",
        "Cost Code": "03-300-40-40",
        "Cost code type": "M",
        "Cost Name": "Concrete Exterior Sealers",
        Description: "V-Seal 102 5 gal / 250 Sq Ft. per Gal. ",
      },
      strategy: "built_in_v_seal_fallback",
    });
  }

  return {
    mappings,
    issues,
    summary: {
      uniqueOld: uniqueOld.length,
      uniqueNew: uniqueNew.length,
      nonUniqueOld: nonUniqueOld.length,
      nonUniqueNew: nonUniqueNew.length,
      mappedOldItemIds: mappings.length,
      crosswalkIssues: issues.length,
    },
  };
}

function buildCrosswalk(crosswalkPath: string) {
  return buildCrosswalkFromWorkbook(XLSX.read(readFileSync(crosswalkPath), { type: "buffer" }));
}

function buildCrosswalkFromBase64(base64: string) {
  return buildCrosswalkFromWorkbook(XLSX.read(Buffer.from(base64, "base64"), { type: "buffer" }));
}

function sourceLineItemWbsId(lineItem: UnknownRecord) {
  return readStr(lineItem.wbs_code_id ?? (isRecord(lineItem.wbs_code) ? lineItem.wbs_code.id : ""));
}

function sourceLineItemCostCode(lineItem: UnknownRecord) {
  const wbsCode = isRecord(lineItem.wbs_code) ? lineItem.wbs_code : {};
  const costCode = isRecord(lineItem.cost_code) ? lineItem.cost_code : {};
  return readStr(
    lineItem.cost_code_string ??
      wbsCode.flat_code ??
      wbsCode.code ??
      costCode.code ??
      costCode.name ??
      lineItem.cost_code
  );
}

function descriptionParts(lineItem: UnknownRecord) {
  const description = readStr(lineItem.description ?? lineItem.title ?? lineItem.name);
  const [base, ...suffixParts] = description.split(/\s+-\s+/);
  return {
    description,
    baseName: readStr(base) || description,
    suffix: suffixParts.join(" - ").trim(),
  };
}

function scoreCrosswalkMapping(
  mapping: { old: UnknownRecord; new: UnknownRecord; strategy: string },
  lineItem: UnknownRecord
) {
  const { description, baseName, suffix } = descriptionParts(lineItem);
  const oldName = norm(mapping.old.Name);
  const oldDescription = norm(mapping.old.Description);
  const oldCostName = norm(mapping.old["Cost Name"]);
  const base = norm(baseName);
  const full = norm(description);
  const oldSearchText = `${mapping.old.Name || ""} ${mapping.old.Description || ""} ${mapping.old["Cost Name"] || ""}`;
  const suffixNorm = norm(suffix);
  const contractContext = norm(
    lineItem._sourceContractTitle ??
      lineItem._sourceContractNumber ??
      lineItem.contract_title ??
      lineItem.contractTitle
  );
  const sourceCostCode = normCode(sourceLineItemCostCode(lineItem));
  const oldCostCode = normCode(mapping.old["Cost Code"]);

  let score = 0;
  if (oldName && oldName === base) score += 20;
  else if (oldName && oldName === full) score += 18;
  else if (oldName && full.startsWith(`${oldName} -`)) score += 14;
  else if (oldName && full.includes(oldName)) score += 8;
  if (oldDescription && oldDescription === full) score += 6;
  const overlap = Math.max(tokenOverlapScore(description, oldSearchText), tokenOverlapScore(baseName, oldSearchText));
  if (overlap >= 0.75) score += 12;
  else if (overlap >= 0.6) score += 7;
  const lineDims = dimensionTokens(description);
  const oldDims = dimensionTokens(oldSearchText);
  if (lineDims.size > 0) {
    let sharedDims = 0;
    for (const dim of lineDims) {
      if (oldDims.has(dim)) sharedDims += 1;
    }
    if (sharedDims === lineDims.size) score += 6;
    else if (sharedDims > 0) score += 2;
  }
  if (sourceCostCode && oldCostCode && sourceCostCode === oldCostCode) score += 12;

  if (suffixNorm) {
    if (suffixNorm.includes("sog") || suffixNorm.includes("slab")) {
      if (oldName.includes("slab on grade") || oldCostName.includes("sog")) score += 5;
      if (oldCostName.includes("site") && !oldName.includes("site")) score -= 4;
    }
    if (suffixNorm.includes("site")) {
      if (oldName.includes("site") || oldCostName.includes("site")) score += 5;
      if (oldCostName.includes("sog") && !oldName.includes("slab on grade")) score -= 4;
    }
  }

  const context = `${suffixNorm} ${contractContext}`;
  if (context.trim()) {
    const wantsFoundation = /foundation|footing|spread footing|stem wall/.test(context);
    const wantsWall = /\bwall\b|vertical/.test(context);
    const wantsSog = /\bsog\b|slab|interior floor|floor/.test(context);
    const wantsSite = /\bsite\b|sidewalk|patio|porch|landing|turndown|exterior/.test(context);

    if (wantsFoundation) {
      if (/foundation/.test(oldCostName)) score += 10;
      if (/wall|sog|site/.test(oldCostName)) score -= 5;
    }
    if (wantsWall) {
      if (/\bwall\b/.test(oldCostName)) score += 10;
      if (/foundation|sog|site/.test(oldCostName)) score -= 5;
    }
    if (wantsSog) {
      if (/\bsog\b|slab/.test(oldCostName)) score += 10;
      if (/foundation|wall|site/.test(oldCostName)) score -= 5;
    }
    if (wantsSite) {
      if (/\bsite\b/.test(oldCostName)) score += 10;
      if (/foundation|wall|sog/.test(oldCostName)) score -= 5;
    }
  }

  return score;
}

function resolveCrosswalkMapping(
  lineItem: UnknownRecord,
  crosswalk: ReturnType<typeof buildCrosswalkFromWorkbook>
) {
  const scored = crosswalk.mappings
    .map((mapping) => ({ mapping, score: scoreCrosswalkMapping(mapping, lineItem) }))
    .filter((entry) => entry.score >= 14)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { mapping: null, issue: "missing_workbook_match", matchCount: 0 };
  const bestScore = scored[0].score;
  const best = scored.filter((entry) => entry.score === bestScore);
  if (best.length === 1) return { mapping: best[0].mapping, issue: "", matchCount: 1, score: bestScore };

  const equivalentTargetKeys = new Set(
    best.map((entry) =>
      [normCode(entry.mapping.new["Cost Code"]), norm(entry.mapping.new["Cost code type"])].join("|")
    )
  );
  if (equivalentTargetKeys.size === 1) {
    return {
      mapping: best[0].mapping,
      issue: "",
      matchCount: best.length,
      score: bestScore,
      strategy: "deduped_equivalent_workbook_match",
    };
  }

  return {
    mapping: null,
    issue: "ambiguous_workbook_match",
    matchCount: best.length,
    candidates: best.slice(0, 8).map((entry) => ({
      score: entry.score,
      oldName: entry.mapping.old.Name,
      oldCostCode: entry.mapping.old["Cost Code"],
      oldCostName: entry.mapping.old["Cost Name"],
      newCostCode: entry.mapping.new["Cost Code"],
      newCostType: entry.mapping.new["Cost code type"],
    })),
  };
}

async function fetchProjectBudgetLineItems(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}) {
  const records: UnknownRecord[] = [];
  const errors: UnknownRecord[] = [];
  const encodedProjectId = encodeURIComponent(params.projectId);

  for (let page = 1; page <= params.maxPages; page += 1) {
    const query = new URLSearchParams({
      project_id: params.projectId,
      page: String(page),
      per_page: "100",
    });
    const endpoints = [
      `/rest/v1.1/budget_line_items?${query.toString()}`,
      `/rest/v1.0/budget_line_items?${query.toString()}`,
      `/rest/v1.1/projects/${encodedProjectId}/budget_line_items?page=${page}&per_page=100`,
      `/rest/v1.0/projects/${encodedProjectId}/budget_line_items?page=${page}&per_page=100`,
    ];

    let pageRecords: UnknownRecord[] = [];
    let pageOk = false;
    for (const endpoint of endpoints) {
      const response = await procoreJson({
        path: endpoint,
        accessToken: params.accessToken,
        companyId: params.companyId,
        allowStatuses: [400, 403, 404, 405],
      });
      if (!response.ok) {
        errors.push({ path: endpoint, status: response.status, response: response.payload });
        continue;
      }
      pageRecords = asArray(response.payload, ["data", "budget_line_items"]).filter(isRecord);
      pageOk = true;
      break;
    }

    if (!pageOk || pageRecords.length === 0) break;
    records.push(...pageRecords);
    if (pageRecords.length < 100) break;
  }

  return { records, errors };
}

function budgetLineWbsId(item: UnknownRecord) {
  const wbsCode = isRecord(item.wbs_code) ? item.wbs_code : {};
  return readStr(wbsCode.id ?? item.wbs_code_id ?? item.id ?? item.budget_line_item_id);
}

function budgetLineCostCode(item: UnknownRecord) {
  const wbsCode = isRecord(item.wbs_code) ? item.wbs_code : {};
  const costCode = isRecord(item.cost_code) ? item.cost_code : {};
  return readStr(item.cost_code_string ?? wbsCode.flat_code ?? wbsCode.code ?? costCode.code ?? costCode.name ?? item.cost_code);
}

function budgetLineFlatCode(item: UnknownRecord) {
  const wbsCode = isRecord(item.wbs_code) ? item.wbs_code : {};
  return readStr(wbsCode.flat_code ?? item.flat_code ?? item.cost_code_string);
}

function costCodeBaseKey(value: unknown) {
  return normCode(value).split(".")[0];
}

function flatCodeSuffix(value: unknown) {
  const parts = normCode(value).split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function budgetLineCostType(item: UnknownRecord) {
  const lineItemType = isRecord(item.line_item_type) ? item.line_item_type : {};
  const costType = isRecord(item.cost_type) ? item.cost_type : {};
  return readStr(
    lineItemType.code ??
      lineItemType.abbreviation ??
      lineItemType.name ??
      costType.code ??
      costType.abbreviation ??
      costType.name ??
      item.line_item_type ??
      item.cost_type
  );
}

function buildTargetWbsIndex(items: UnknownRecord[]) {
  const byCodeAndType = new Map<string, UnknownRecord[]>();
  const byCode = new Map<string, UnknownRecord[]>();
  const byFlatCode = new Map<string, UnknownRecord>();
  for (const item of items) {
    const wbsCodeId = budgetLineWbsId(item);
    const flatCode = normCode(budgetLineFlatCode(item));
    const costCode = costCodeBaseKey(budgetLineCostCode(item) || flatCode);
    if (!wbsCodeId || !costCode) continue;
    const costType = normCode(budgetLineCostType(item)) || flatCodeSuffix(flatCode);
    const normalized = {
      item,
      wbsCodeId,
      costCode: budgetLineCostCode(item),
      flatCode: budgetLineFlatCode(item),
      costType: budgetLineCostType(item) || flatCodeSuffix(flatCode),
    };
    byCode.set(costCode, [...(byCode.get(costCode) || []), normalized]);
    if (flatCode && !byFlatCode.has(flatCode)) byFlatCode.set(flatCode, normalized);
    if (costType) {
      const key = `${costCode}|${costType}`;
      byCodeAndType.set(key, [...(byCodeAndType.get(key) || []), normalized]);
    }
  }
  return { byCodeAndType, byCode, byFlatCode };
}

function resolveTargetWbsId(newRow: UnknownRecord, targetIndex: ReturnType<typeof buildTargetWbsIndex>) {
  const costCode = normCode(newRow["Cost Code"]);
  const costType = normCode(newRow["Cost code type"]);
  if (!costCode) return { wbsCodeId: "", issue: "missing_new_cost_code", matchCount: 0 };
  const exactFlatMatch = costType ? targetIndex.byFlatCode.get(`${costCode}.${costType}`) : undefined;
  if (exactFlatMatch) return { wbsCodeId: readStr(exactFlatMatch.wbsCodeId), issue: "", matchCount: 1, strategy: "flat_code_exact" };
  const typedMatches = costType ? targetIndex.byCodeAndType.get(`${costCode}|${costType}`) || [] : [];
  if (typedMatches.length === 1) return { wbsCodeId: readStr(typedMatches[0].wbsCodeId), issue: "", matchCount: 1, strategy: "cost_code_and_type" };
  if (typedMatches.length > 1) return { wbsCodeId: "", issue: "ambiguous_target_wbs_code_type", matchCount: typedMatches.length, matches: typedMatches.slice(0, 8) };
  const codeMatches = targetIndex.byCode.get(costCode) || [];
  if (codeMatches.length === 1) return { wbsCodeId: readStr(codeMatches[0].wbsCodeId), issue: "", matchCount: 1, strategy: "cost_code_only" };

  const segments = costCode.split("-").filter(Boolean);
  const codePrefixes: string[] = [];
  for (let index = segments.length; index >= 2; index -= 1) codePrefixes.push(segments.slice(0, index).join("-"));
  if (!codePrefixes.includes(costCode)) codePrefixes.unshift(costCode);

  const prefixCandidates = [...targetIndex.byFlatCode.entries()].filter(([flatCode]) =>
    codePrefixes.some((prefix) => flatCode.startsWith(`${prefix}.`) || flatCode.startsWith(`${prefix}-`))
  );
  if (prefixCandidates.length > 0) {
    const preferredTypes = [costType].filter(Boolean);
    const selected = prefixCandidates.find(([flatCode]) => preferredTypes.includes(flatCodeSuffix(flatCode))) || prefixCandidates[0];
    return {
      wbsCodeId: readStr(selected[1].wbsCodeId),
      issue: "",
      matchCount: prefixCandidates.length,
      strategy: "cost_code_prefix_fallback",
      selectedFlatCode: selected[0],
    };
  }

  return {
    wbsCodeId: "",
    issue: codeMatches.length === 0 ? "missing_target_wbs_code" : "ambiguous_target_wbs_code",
    matchCount: codeMatches.length,
    matches: codeMatches.slice(0, 8),
  };
}

async function applyCrosswalkWbsMappings(params: {
  accessToken: string;
  targetCompanyId: string;
  targetProjectId: string;
  sourceLineItems: UnknownRecord[];
  maps: Record<string, Record<string, string>>;
  crosswalkPath: string;
  crosswalkWorkbookBase64: string;
  maxPages: number;
}) {
  const summary: UnknownRecord = {
    enabled: false,
    source: "",
    applied: 0,
    skippedExisting: 0,
    issues: [] as UnknownRecord[],
    crosswalk: null,
    targetBudgetLineItems: 0,
  };

  let crosswalk: ReturnType<typeof buildCrosswalkFromWorkbook> | null = null;
  if (params.crosswalkWorkbookBase64) {
    crosswalk = buildCrosswalkFromBase64(params.crosswalkWorkbookBase64);
    summary.source = "uploaded_workbook";
  } else if (params.crosswalkPath && existsSync(params.crosswalkPath)) {
    crosswalk = buildCrosswalk(params.crosswalkPath);
    summary.source = params.crosswalkPath;
  }
  if (!crosswalk) return summary;

  summary.enabled = true;
  summary.crosswalk = crosswalk.summary;
  const targetBudget = await fetchProjectBudgetLineItems({
    accessToken: params.accessToken,
    companyId: params.targetCompanyId,
    projectId: params.targetProjectId,
    maxPages: params.maxPages,
  });
  summary.targetBudgetLineItems = targetBudget.records.length;
  if (targetBudget.errors.length) summary.targetBudgetWarnings = targetBudget.errors.slice(0, 12);
  const targetIndex = buildTargetWbsIndex(targetBudget.records);

  for (const lineItem of params.sourceLineItems) {
    const oldWbsId = sourceLineItemWbsId(lineItem);
    if (!oldWbsId) continue;
    if (params.maps.wbsCodeIdMap[oldWbsId]) {
      summary.skippedExisting = Number(summary.skippedExisting) + 1;
      continue;
    }

    const sourceFlatCode = sourceLineItemCostCode(lineItem);
    if (sourceFlatCode) {
      const directTargetWbs = resolveTargetWbsId(
        {
          "Cost Code": costCodeBaseKey(sourceFlatCode),
          "Cost code type": flatCodeSuffix(sourceFlatCode),
        },
        targetIndex
      );
      if (directTargetWbs.wbsCodeId) {
        params.maps.wbsCodeIdMap[oldWbsId] = directTargetWbs.wbsCodeId;
        summary.applied = Number(summary.applied) + 1;
        continue;
      }
    }

    const workbookMatch = resolveCrosswalkMapping(lineItem, crosswalk);
    if (!workbookMatch.mapping) {
      (summary.issues as UnknownRecord[]).push({
        oldWbsId,
        lineItemId: readStr(lineItem.id),
        description: readStr(lineItem.description ?? lineItem.title),
        sourceCostCode: sourceFlatCode,
        issue: workbookMatch.issue,
        matchCount: workbookMatch.matchCount,
        candidates: workbookMatch.candidates,
      });
      continue;
    }
    const targetWbs = resolveTargetWbsId(workbookMatch.mapping.new, targetIndex);
    if (!targetWbs.wbsCodeId) {
      (summary.issues as UnknownRecord[]).push({
        oldWbsId,
        lineItemId: readStr(lineItem.id),
        description: readStr(lineItem.description ?? lineItem.title),
        issue: targetWbs.issue,
        matchCount: targetWbs.matchCount,
        newCostCode: workbookMatch.mapping.new["Cost Code"],
        newCostType: workbookMatch.mapping.new["Cost code type"],
        matches: targetWbs.matches,
      });
      continue;
    }
    params.maps.wbsCodeIdMap[oldWbsId] = targetWbs.wbsCodeId;
    summary.applied = Number(summary.applied) + 1;
  }

  return summary;
}

function buildIdMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const oldId = readStr(key);
    const newId = readStr(entry);
    if (oldId && newId) out[oldId] = newId;
  }
  return out;
}

function mapId(
  value: unknown,
  map: Record<string, string>,
  label: string,
  issues: UnknownRecord[],
  context: UnknownRecord,
  options: { required: boolean; allowUnmappedIds: boolean }
) {
  const oldId = readStr(value);
  if (!oldId) return undefined;
  const mapped = readStr(map[oldId]);
  if (mapped) return readNum(mapped) ?? mapped;
  if (options.required && !options.allowUnmappedIds) {
    issues.push({ type: "missing_id_mapping", field: label, oldId, ...context });
    return undefined;
  }
  return readNum(oldId) ?? oldId;
}

function extractSourceId(record: UnknownRecord, field: string, objectField: string) {
  if (record[field] !== undefined) return record[field];
  const nested = isRecord(record[objectField]) ? record[objectField] : {};
  return nested.id;
}

function stripPrimeContractPayload(source: UnknownRecord) {
  const payload: UnknownRecord = { ...source };
  const readonlyKeys = [
    "id",
    "created_at",
    "updated_at",
    "deleted_at",
    "company_id",
    "project_id",
    "line_items",
    "prime_contract_line_items",
    "attachments",
    "attachment_ids",
    "upload_ids",
    "file_version_ids",
    "image_ids",
    "drawing_revision_ids",
    "payments",
    "payment_applications",
    "invoices",
    "change_orders",
    "change_order_packages",
    "potential_change_orders",
    "current_user_permissions",
    "created_by",
    "updated_by",
    "origin_id",
    "origin_code",
    "origin_data",
    "value",
    "original_value",
    "original_contract_value",
    "grand_total",
    "revised_contract_amount",
    "approved_change_orders",
    "pending_change_orders",
    "draft_change_orders",
  ];
  for (const key of readonlyKeys) delete payload[key];
  return payload;
}

function buildPrimeContractPayload(params: {
  source: UnknownRecord;
  targetStatus: string;
  preserveStatus: boolean;
}) {
  const payload = stripPrimeContractPayload(params.source);
  payload.status = params.preserveStatus ? readStr(params.source.status) || params.targetStatus : params.targetStatus;
  if (!readStr(payload.status)) payload.status = "Draft";

  const sourceContractId = readNum(params.source.id);
  if (sourceContractId !== undefined) {
    payload.origin_id = sourceContractId;
    payload.origin_data = JSON.stringify({
      source: "pmc_prime_contract_clone",
      sourcePrimeContractId: readStr(params.source.id),
      sourcePrimeContractNumber: readStr(params.source.number),
    });
  }

  return payload;
}

function buildPrimeLineItemPayload(params: {
  source: UnknownRecord;
  sourceContract: UnknownRecord;
  maps: Record<string, Record<string, string>>;
  issues: UnknownRecord[];
  requireMappedIds: boolean;
  allowUnmappedIds: boolean;
}) {
  const payload: UnknownRecord = { ...params.source };
  const readonlyKeys = [
    "id",
    "created_at",
    "updated_at",
    "deleted_at",
    "company_id",
    "project_id",
    "prime_contract_id",
    "budget_code",
    "wbs_code",
    "cost_code",
    "line_item_type",
    "cost_type",
    "tax_code",
    "origin_id",
    "origin_code",
    "origin_data",
  ];
  for (const key of readonlyKeys) delete payload[key];

  const context = {
    primeContractId: readStr(params.sourceContract.id),
    primeContractNumber: readStr(params.sourceContract.number),
    lineItemId: readStr(params.source.id),
    description: readStr(params.source.description ?? params.source.title),
  };

  const idFields = [
    { payloadField: "wbs_code_id", objectField: "wbs_code", mapName: "wbsCodeIdMap" },
    { payloadField: "cost_code_id", objectField: "cost_code", mapName: "costCodeIdMap" },
    { payloadField: "line_item_type_id", objectField: "line_item_type", mapName: "lineItemTypeIdMap" },
    { payloadField: "tax_code_id", objectField: "tax_code", mapName: "taxCodeIdMap" },
  ];

  for (const item of idFields) {
    const sourceId = extractSourceId(params.source, item.payloadField, item.objectField);
    const mapped = mapId(
      sourceId,
      params.maps[item.mapName] || {},
      item.payloadField,
      params.issues,
      context,
      { required: params.requireMappedIds, allowUnmappedIds: params.allowUnmappedIds }
    );
    delete payload[item.objectField];
    if (mapped !== undefined) payload[item.payloadField] = mapped;
    else delete payload[item.payloadField];
  }

  const sourceLineItemId = readNum(params.source.id);
  if (sourceLineItemId !== undefined) {
    payload.origin_id = String(sourceLineItemId);
    payload.origin_data = JSON.stringify({
      source: "pmc_prime_contract_clone",
      sourcePrimeLineItemId: readStr(params.source.id),
      sourcePrimeContractId: readStr(params.sourceContract.id),
      sourcePrimeContractNumber: readStr(params.sourceContract.number),
    });
  }

  const allowedKeys = [
    "id",
    "line_item_type_id",
    "description",
    "quantity",
    "uom",
    "unit_cost",
    "origin_data",
    "extended_type",
    "tax_code_id",
    "wbs_code_id",
    "amount",
    "origin_id",
    "cost_code_id",
  ];
  return Object.fromEntries(Object.entries(payload).filter(([key]) => allowedKeys.includes(key)));
}

async function createPrimeContract(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  payload: UnknownRecord;
}) {
  const bodies = [
    { prime_contract: params.payload },
    params.payload,
  ];
  const paths = [
    `/rest/v1.0/prime_contract?project_id=${encodeURIComponent(params.projectId)}`,
    `/rest/v1.0/prime_contract?company_id=${encodeURIComponent(params.companyId)}&project_id=${encodeURIComponent(params.projectId)}`,
    `/rest/v1.0/prime_contracts?project_id=${encodeURIComponent(params.projectId)}`,
  ];
  const attempts: UnknownRecord[] = [];

  for (const path of paths) {
    for (const body of bodies) {
      const response = await procoreJson({
        path,
        method: "POST",
        accessToken: params.accessToken,
        companyId: params.companyId,
        body,
        allowStatuses: [400, 404, 405, 422],
      });
      attempts.push({ path, status: response.status, ok: response.ok, body, response: response.payload });
      if (response.ok) return { result: unwrapData(response.payload), attempts };
    }
  }

  throw new Error(`Prime contract create failed: ${safeJson(attempts.slice(-3))}`);
}

async function syncPrimeLineItems(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  primeContractId: string;
  updates: UnknownRecord[];
}) {
  const response = await procoreJson({
    path: `/rest/v1.0/prime_contracts/${encodeURIComponent(
      params.primeContractId
    )}/line_items/sync?project_id=${encodeURIComponent(params.projectId)}`,
    method: "PATCH",
    accessToken: params.accessToken,
    companyId: params.companyId,
    body: { updates: params.updates },
  });
  return unwrapData(response.payload);
}

function contractMatchKeys(contract: UnknownRecord) {
  const number = norm(contract.number);
  const title = norm(contract.title);
  const sourceId = readStr(contract.origin_id || contract.originId);
  const sourceData = readStr(contract.origin_data || contract.originData);
  const ids = new Set<string>();
  if (sourceId) ids.add(`source:${sourceId}`);
  for (const match of sourceData.match(/\d{6,}/g) || []) ids.add(`source:${match}`);
  if (number && title) ids.add(`number_title:${number}|${title}`);
  if (number) ids.add(`number:${number}`);
  return ids;
}

function findExistingTargetContract(sourceContract: UnknownRecord, targetContracts: UnknownRecord[]) {
  const sourceKeys = contractMatchKeys({
    number: sourceContract.number,
    title: sourceContract.title,
    origin_id: sourceContract.id,
  });
  for (const target of targetContracts) {
    const targetKeys = contractMatchKeys(target);
    for (const key of sourceKeys) {
      if (targetKeys.has(key)) return target;
    }
  }
  return null;
}

function lineItemMatchKeys(lineItem: UnknownRecord) {
  const ids = new Set<string>();
  const id = readStr(lineItem.origin_id || lineItem.originId);
  const originData = readStr(lineItem.origin_data || lineItem.originData);
  const description = norm(lineItem.description ?? lineItem.title ?? lineItem.name);
  if (id) ids.add(`source:${id}`);
  for (const match of originData.match(/\d{6,}/g) || []) ids.add(`source:${match}`);
  if (description) ids.add(`description:${description}`);
  return ids;
}

function findExistingTargetLineItem(sourceLine: UnknownRecord, targetLines: UnknownRecord[]) {
  const sourceKeys = lineItemMatchKeys({
    id: sourceLine.sourceLineItemId,
    origin_id: sourceLine.sourceLineItemId,
    description: sourceLine.description,
  });
  for (const target of targetLines) {
    const targetKeys = lineItemMatchKeys(target);
    for (const key of sourceKeys) {
      if (targetKeys.has(key)) return target;
    }
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const { accessToken, tokenSource } = await getToken(body.accessToken);

    const sourceCompanyId = readStr(body.sourceCompanyId);
    const sourceProjectId = readStr(body.sourceProjectId);
    const targetCompanyId = readStr(body.targetCompanyId || procoreConfig.companyId);
    const targetProjectId = readStr(body.targetProjectId);
    const dryRun = readBool(body.dryRun, true);
    const cloneLineItems = readBool(body.cloneLineItems, true);
    const preserveStatus = readBool(body.preserveStatus, false);
    const targetStatus = readStr(body.targetStatus) || "Draft";
    const maxPages = Math.min(50, Math.max(1, readNum(body.maxPages) || 5));
    const allowUnmappedIds = readBool(body.allowUnmappedIds, false);
    const crosswalkWorkbookBase64 = readStr(body.crosswalkWorkbookBase64);
    const rawCrosswalkPath = readStr(body.crosswalkPath) || DEFAULT_CROSSWALK_PATH;
    const crosswalkPath = path.isAbsolute(rawCrosswalkPath)
      ? rawCrosswalkPath
      : path.resolve(process.cwd(), rawCrosswalkPath);
    const requestedPrimeContractIds = new Set(asArray(body.primeContractIds).map(readStr).filter(Boolean));

    if (!sourceCompanyId || !sourceProjectId || !targetCompanyId || !targetProjectId) {
      return NextResponse.json(
        { success: false, error: "sourceCompanyId, sourceProjectId, targetCompanyId, and targetProjectId are required." },
        { status: 400 }
      );
    }

    const requireMappedIds = sourceCompanyId !== targetCompanyId || sourceProjectId !== targetProjectId;
    const maps = {
      wbsCodeIdMap: buildIdMap(body.wbsCodeIdMap),
      costCodeIdMap: buildIdMap(body.costCodeIdMap),
      lineItemTypeIdMap: buildIdMap(body.lineItemTypeIdMap),
      taxCodeIdMap: buildIdMap(body.taxCodeIdMap),
    };

    const sourceFetch = await fetchPrimeContracts({
      accessToken,
      companyId: sourceCompanyId,
      projectId: sourceProjectId,
      maxPages,
    });
    const selectedContracts = sourceFetch.records.filter((contract) => {
      if (requestedPrimeContractIds.size === 0) return true;
      return requestedPrimeContractIds.has(readStr(contract.id));
    });

    const plan: UnknownRecord[] = [];
    const missingMappings: UnknownRecord[] = [];
    let sourceLineItems = 0;
    const lineItemsByContractId = new Map<string, { records: UnknownRecord[]; errors: UnknownRecord[] }>();

    for (const contract of selectedContracts) {
      const contractId = readStr(contract.id);
      const lineFetch = cloneLineItems && contractId
        ? await fetchPrimeLineItems({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, primeContractId: contractId, maxPages })
        : { records: [] as UnknownRecord[], errors: [] as UnknownRecord[] };
      lineItemsByContractId.set(contractId, lineFetch);
      sourceLineItems += lineFetch.records.length;
    }

    const crosswalkAutoMappings = requireMappedIds && cloneLineItems
      ? await applyCrosswalkWbsMappings({
        accessToken,
        targetCompanyId,
        targetProjectId,
        sourceLineItems: selectedContracts.flatMap((contract) => {
          const contractId = readStr(contract.id);
          const lineFetch = lineItemsByContractId.get(contractId) || { records: [] as UnknownRecord[] };
          return lineFetch.records.map((lineItem) => ({
            ...lineItem,
            _sourceContractId: contractId,
            _sourceContractNumber: readStr(contract.number),
            _sourceContractTitle: readStr(contract.title),
          }));
        }),
        maps,
        crosswalkPath,
        crosswalkWorkbookBase64,
        maxPages,
      })
      : { enabled: false, source: "", applied: 0, skippedExisting: 0, issues: [] as UnknownRecord[] };

    for (const contract of selectedContracts) {
      const contractId = readStr(contract.id);
      const lineFetch = lineItemsByContractId.get(contractId) || { records: [] as UnknownRecord[], errors: [] as UnknownRecord[] };
      const contractPayload = buildPrimeContractPayload({ source: contract, targetStatus, preserveStatus });
      const lineItemPlans = lineFetch.records.map((lineItem) => {
        const lineIssues: UnknownRecord[] = [];
        const payload = buildPrimeLineItemPayload({
          source: lineItem,
          sourceContract: contract,
          maps,
          issues: lineIssues,
          requireMappedIds,
          allowUnmappedIds,
        });
        missingMappings.push(...lineIssues);
        return {
          sourceLineItemId: readStr(lineItem.id),
          description: readStr(lineItem.description ?? lineItem.title),
          payload,
          issues: lineIssues,
        };
      });

      plan.push({
        sourcePrimeContractId: contractId,
        number: readStr(contract.number),
        title: readStr(contract.title),
        status: readStr(contract.status),
        lineItemCount: lineFetch.records.length,
        contractPayload,
        lineItems: lineItemPlans,
        fetchWarnings: lineFetch.errors.slice(0, 6),
      });
    }

    const readyForLiveClone = missingMappings.length === 0 || allowUnmappedIds;

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        tokenSource,
        readyForLiveClone,
        source: { companyId: sourceCompanyId, projectId: sourceProjectId },
        target: { companyId: targetCompanyId, projectId: targetProjectId, targetStatus, preserveStatus },
        counts: {
          sourceContracts: selectedContracts.length,
          sourceLineItems,
          missingMappings: missingMappings.length,
        },
        maps: Object.fromEntries(Object.entries(maps).map(([key, value]) => [key, Object.keys(value).length])),
        crosswalkAutoMappings,
        missingMappings,
        sourceFetchWarnings: sourceFetch.errors,
        plan,
      });
    }

    if (!readyForLiveClone) {
      return NextResponse.json(
        {
          success: false,
          dryRun: false,
          error: "Prime contract clone blocked by missing ID mapping(s).",
          readyForLiveClone,
          counts: { sourceContracts: selectedContracts.length, sourceLineItems, missingMappings: missingMappings.length },
          crosswalkAutoMappings,
          missingMappings,
          plan,
        },
        { status: 409 }
      );
    }

    const targetFetch = await fetchPrimeContracts({
      accessToken,
      companyId: targetCompanyId,
      projectId: targetProjectId,
      maxPages,
    }).catch(() => ({ records: [] as UnknownRecord[], errors: [] as UnknownRecord[] }));

    const createdContracts: UnknownRecord[] = [];
    const reusedContracts: UnknownRecord[] = [];
    const errors: UnknownRecord[] = [];

    for (const entry of plan) {
      try {
        const existingTarget = findExistingTargetContract(
          {
            id: entry.sourcePrimeContractId,
            number: entry.number,
            title: entry.title,
          },
          targetFetch.records
        );
        const existingTargetId = existingTarget ? readStr(existingTarget.id) : "";
        const createResult = existingTargetId
          ? { result: existingTarget, attempts: [] as UnknownRecord[] }
          : await createPrimeContract({
              accessToken,
              companyId: targetCompanyId,
              projectId: targetProjectId,
              payload: entry.contractPayload as UnknownRecord,
            });
        const created = createResult.result;
        const createdRecord = isRecord(created) ? created : {};
        const createdPrimeContractId = existingTargetId || readStr(createdRecord.id);
        const lineSync: UnknownRecord = { skipped: !cloneLineItems };

        if (cloneLineItems && createdPrimeContractId && Array.isArray(entry.lineItems)) {
          const existingTargetLines = existingTargetId
            ? await fetchPrimeLineItems({
                accessToken,
                companyId: targetCompanyId,
                projectId: targetProjectId,
                primeContractId: existingTargetId,
                maxPages,
              }).then((result) => result.records).catch(() => [] as UnknownRecord[])
            : [];
          const updates = (entry.lineItems as UnknownRecord[]).map((line) => {
            const payload = isRecord(line.payload) ? { ...line.payload } : {};
            const existingLine = findExistingTargetLineItem(line, existingTargetLines);
            if (existingLine) {
              const id = readNum(existingLine.id) ?? readStr(existingLine.id);
              if (id) payload.id = id;
            }
            return payload;
          });

          if (updates.length > 0) {
            lineSync.result = await syncPrimeLineItems({
              accessToken,
              companyId: targetCompanyId,
              projectId: targetProjectId,
              primeContractId: createdPrimeContractId,
              updates,
            });
            lineSync.updateCount = updates.length;
          } else {
            lineSync.updateCount = 0;
          }
        }

        const contractResult = {
          sourcePrimeContractId: entry.sourcePrimeContractId,
          sourceNumber: entry.number,
          sourceTitle: entry.title,
          createdPrimeContractId,
          reusedExistingContract: Boolean(existingTargetId),
          result: created,
          createAttempts: createResult.attempts,
          lineSync,
        };
        if (existingTargetId) reusedContracts.push(contractResult);
        else createdContracts.push(contractResult);
        await new Promise((resolve) => setTimeout(resolve, 700));
      } catch (error) {
        errors.push({
          sourcePrimeContractId: entry.sourcePrimeContractId,
          sourceNumber: entry.number,
          sourceTitle: entry.title,
          error: error instanceof Error ? error.message : String(error),
          attemptedPayload: entry.contractPayload,
        });
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      dryRun: false,
      error: errors.length > 0 ? "Prime contract clone finished with errors." : undefined,
      details: errors.length > 0 ? readStr(errors[0].error) : undefined,
      tokenSource,
      source: { companyId: sourceCompanyId, projectId: sourceProjectId },
      target: { companyId: targetCompanyId, projectId: targetProjectId, targetStatus, preserveStatus },
      counts: {
        sourceContracts: selectedContracts.length,
        sourceLineItems,
        createdContracts: createdContracts.length,
        reusedContracts: reusedContracts.length,
        syncedLineItems: [...createdContracts, ...reusedContracts].reduce((sum, contract) => {
          const count = Number((contract.lineSync as UnknownRecord | undefined)?.updateCount || 0);
          return sum + count;
        }, 0),
        errors: errors.length,
      },
      crosswalkAutoMappings,
      createdContracts,
      reusedContracts,
      errors,
      plan,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: "Failed to clone prime contracts.", details: message },
      { status: 500 }
    );
  }
}
