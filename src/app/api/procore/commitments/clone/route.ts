import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import * as XLSX from "xlsx";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

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

function unwrapData(value: unknown): unknown {
  if (isRecord(value) && isRecord(value.data)) return value.data;
  return value;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isBlankValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  return false;
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

function compactPayload(payload: UnknownRecord) {
  for (const key of Object.keys(payload)) {
    const value = payload[key];
    if (value === undefined || value === null || value === "") {
      delete payload[key];
      continue;
    }
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
  path: string;
  accessToken: string;
  companyId: string;
  method?: string;
  body?: unknown;
  maxRetries?: number;
  allowStatuses?: number[];
}) {
  const method = params.method || "GET";
  const maxRetries = params.maxRetries ?? (method === "GET" ? 1 : 6);
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
    // Keep text payload.
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

function readSheet(workbook: XLSX.WorkBook, sheetName: string): UnknownRecord[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" }) as UnknownRecord[];
}

function buildCommitmentCrosswalkFromWorkbook(workbook: XLSX.WorkBook) {
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

function buildCommitmentCrosswalk(crosswalkPath: string) {
  return buildCommitmentCrosswalkFromWorkbook(XLSX.read(readFileSync(crosswalkPath), { type: "buffer" }));
}

function buildCommitmentCrosswalkFromBase64(base64: string) {
  return buildCommitmentCrosswalkFromWorkbook(XLSX.read(Buffer.from(base64, "base64"), { type: "buffer" }));
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

function commitmentDescriptionParts(lineItem: UnknownRecord) {
  const description = readStr(lineItem.description ?? lineItem.title ?? lineItem.name);
  const [base, ...suffixParts] = description.split(/\s+-\s+/);
  return {
    description,
    baseName: readStr(base) || description,
    suffix: suffixParts.join(" - ").trim(),
  };
}

function scoreCommitmentMapping(
  mapping: { old: UnknownRecord; new: UnknownRecord; strategy: string },
  lineItem: UnknownRecord
) {
  const { description, baseName, suffix } = commitmentDescriptionParts(lineItem);
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

function resolveCommitmentCrosswalkMapping(
  lineItem: UnknownRecord,
  crosswalk: ReturnType<typeof buildCommitmentCrosswalkFromWorkbook>
) {
  const scored = crosswalk.mappings
    .map((mapping) => ({ mapping, score: scoreCommitmentMapping(mapping, lineItem) }))
    .filter((entry) => entry.score >= 14)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) {
    return { mapping: null, issue: "missing_workbook_match", matchCount: 0 };
  }
  const bestScore = scored[0].score;
  const best = scored.filter((entry) => entry.score === bestScore);
  if (best.length === 1) {
    return { mapping: best[0].mapping, issue: "", matchCount: 1, score: bestScore };
  }
  const equivalentTargetKeys = new Set(
    best.map((entry) =>
      [
        normCode(entry.mapping.new["Cost Code"]),
        norm(entry.mapping.new["Cost code type"]),
      ].join("|")
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
  return readStr(wbsCode.id ?? item.wbs_code_id);
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

function budgetLineDescription(item: UnknownRecord) {
  const wbsCode = isRecord(item.wbs_code) ? item.wbs_code : {};
  const costCode = isRecord(item.cost_code) ? item.cost_code : {};
  return readStr(
    item.description ??
      item.name ??
      item.title ??
      wbsCode.description ??
      wbsCode.name ??
      costCode.description ??
      costCode.name ??
      item.cost_code_description
  );
}

function buildTargetWbsIndex(items: UnknownRecord[]) {
  const byCodeAndType = new Map<string, UnknownRecord[]>();
  const byCode = new Map<string, UnknownRecord[]>();
  const byFlatCode = new Map<string, UnknownRecord>();
  const byDescription = new Map<string, UnknownRecord[]>();
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
      description: budgetLineDescription(item),
    };
    byCode.set(costCode, [...(byCode.get(costCode) || []), normalized]);
    if (flatCode && !byFlatCode.has(flatCode)) byFlatCode.set(flatCode, normalized);
    const descriptionKey = norm(normalized.description);
    if (descriptionKey) {
      byDescription.set(descriptionKey, [...(byDescription.get(descriptionKey) || []), normalized]);
    }
    if (costType) {
      const key = `${costCode}|${costType}`;
      byCodeAndType.set(key, [...(byCodeAndType.get(key) || []), normalized]);
    }
  }
  return { byCodeAndType, byCode, byFlatCode, byDescription };
}

function resolveTargetWbsId(newRow: UnknownRecord, targetIndex: ReturnType<typeof buildTargetWbsIndex>) {
  const costCode = normCode(newRow["Cost Code"]);
  const costType = normCode(newRow["Cost code type"]);
  const descriptionKey = norm(newRow.Description || newRow.Name || newRow["Cost Name"]);
  if (!costCode) return { wbsCodeId: "", issue: "missing_new_cost_code", matchCount: 0 };

  const matchesRequestedType = (candidate: UnknownRecord) => {
    if (!costType) return true;
    return normCode(candidate.costType) === costType || flatCodeSuffix(candidate.flatCode) === costType;
  };

  // First resolve by cost code alone. Use type only when code is ambiguous.
  const codeMatches = targetIndex.byCode.get(costCode) || [];
  if (codeMatches.length === 1) {
    return {
      wbsCodeId: readStr(codeMatches[0].wbsCodeId),
      issue: "",
      matchCount: 1,
      strategy: matchesRequestedType(codeMatches[0]) ? "cost_code_only" : "cost_code_only_type_mismatch_ignored",
      requestedCostType: costType,
      matchedCostType: readStr(codeMatches[0].costType),
      matchedFlatCode: readStr(codeMatches[0].flatCode),
    };
  }

  if (codeMatches.length > 1 && costType) {
    const exactFlatMatch = targetIndex.byFlatCode.get(`${costCode}.${costType}`);
    if (exactFlatMatch) {
      return { wbsCodeId: readStr(exactFlatMatch.wbsCodeId), issue: "", matchCount: 1, strategy: "flat_code_exact" };
    }

    const typedMatches = targetIndex.byCodeAndType.get(`${costCode}|${costType}`) || [];
    if (typedMatches.length === 1) {
      return { wbsCodeId: readStr(typedMatches[0].wbsCodeId), issue: "", matchCount: 1, strategy: "cost_code_and_type" };
    }
    if (typedMatches.length > 1) {
      return { wbsCodeId: "", issue: "ambiguous_target_wbs_code_type", matchCount: typedMatches.length, matches: typedMatches.slice(0, 8) };
    }

    return {
      wbsCodeId: "",
      issue: "missing_target_wbs_code_type",
      matchCount: 0,
      requestedCostType: costType,
      matches: codeMatches.slice(0, 8),
    };
  }

  const segments = costCode.split("-").filter(Boolean);
  const codePrefixes: string[] = [];
  for (let index = segments.length; index >= 2; index -= 1) {
    codePrefixes.push(segments.slice(0, index).join("-"));
  }
  if (!codePrefixes.includes(costCode)) codePrefixes.unshift(costCode);

  const prefixCandidates = [...targetIndex.byFlatCode.entries()].filter(([flatCode]) =>
    codePrefixes.some((prefix) => flatCode.startsWith(`${prefix}.`) || flatCode.startsWith(`${prefix}-`))
  );
  if (prefixCandidates.length > 0) {
    let selected = prefixCandidates[0];
    if (costType) {
      const typeMatch = prefixCandidates.find(([flatCode]) => costType === flatCodeSuffix(flatCode));
      if (!typeMatch) {
        return {
          wbsCodeId: "",
          issue: "missing_target_wbs_code_type",
          matchCount: prefixCandidates.length,
          requestedCostType: costType,
          matches: prefixCandidates.slice(0, 8).map(([flatCode, row]) => ({ flatCode, costType: row.costType, wbsCodeId: row.wbsCodeId })),
        };
      }
      selected = typeMatch;
    }
    return {
      wbsCodeId: readStr(selected[1].wbsCodeId),
      issue: "",
      matchCount: prefixCandidates.length,
      strategy: "cost_code_prefix_fallback",
      selectedFlatCode: selected[0],
    };
  }

  // If code lookup cannot find a match, use description as a final disambiguation aid.
  const descriptionMatches = descriptionKey ? targetIndex.byDescription.get(descriptionKey) || [] : [];
  const descriptionMatchesTyped = costType
    ? descriptionMatches.filter((match) => matchesRequestedType(match))
    : descriptionMatches;
  if (descriptionMatchesTyped.length === 1) {
    return {
      wbsCodeId: readStr(descriptionMatchesTyped[0].wbsCodeId),
      issue: "",
      matchCount: 1,
      strategy: "description_exact",
      matchedCostCode: descriptionMatchesTyped[0].costCode,
    };
  }
  if (descriptionMatchesTyped.length > 1) {
    return {
      wbsCodeId: "",
      issue: "ambiguous_target_description_match",
      matchCount: descriptionMatchesTyped.length,
      matches: descriptionMatchesTyped.slice(0, 8),
    };
  }

  if (descriptionMatches.length > 0 && costType) {
    return {
      wbsCodeId: "",
      issue: "missing_target_description_cost_type",
      matchCount: descriptionMatches.length,
      requestedCostType: costType,
      matches: descriptionMatches.slice(0, 8),
    };
  }

  return {
    wbsCodeId: "",
    issue: codeMatches.length === 0 ? "missing_target_wbs_code" : "ambiguous_target_wbs_code",
    matchCount: codeMatches.length,
    matches: codeMatches.slice(0, 8),
  };
}

async function applyCommitmentCrosswalkWbsMappings(params: {
  accessToken: string;
  sourceCompanyId: string;
  sourceProjectId: string;
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

  let crosswalk: ReturnType<typeof buildCommitmentCrosswalkFromWorkbook> | null = null;
  if (params.crosswalkWorkbookBase64) {
    crosswalk = buildCommitmentCrosswalkFromBase64(params.crosswalkWorkbookBase64);
    summary.source = "uploaded_workbook";
  } else if (params.crosswalkPath && existsSync(params.crosswalkPath)) {
    crosswalk = buildCommitmentCrosswalk(params.crosswalkPath);
    summary.source = params.crosswalkPath;
  }
  if (!crosswalk) return summary;

  summary.enabled = true;
  summary.crosswalk = crosswalk.summary;
  const sourceBudget = await fetchProjectBudgetLineItems({
    accessToken: params.accessToken,
    companyId: params.sourceCompanyId,
    projectId: params.sourceProjectId,
    maxPages: params.maxPages,
  });
  const sourceBudgetByWbsId = new Map<string, UnknownRecord>();
  for (const row of sourceBudget.records) {
    const wbsId = budgetLineWbsId(row);
    if (wbsId && !sourceBudgetByWbsId.has(wbsId)) sourceBudgetByWbsId.set(wbsId, row);
  }
  summary.sourceBudgetLineItems = sourceBudget.records.length;
  if (sourceBudget.errors.length) summary.sourceBudgetWarnings = sourceBudget.errors.slice(0, 12);

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

    const sourceBudgetRow = sourceBudgetByWbsId.get(oldWbsId);
    if (sourceBudgetRow) {
      const directTargetWbs = resolveTargetWbsId(sourceBudgetRow, targetIndex);
      if (directTargetWbs.wbsCodeId) {
        params.maps.wbsCodeIdMap[oldWbsId] = directTargetWbs.wbsCodeId;
        summary.applied = Number(summary.applied) + 1;
        continue;
      }
    }

    const workbookMatch = resolveCommitmentCrosswalkMapping(lineItem, crosswalk);
    if (!workbookMatch.mapping) {
      (summary.issues as UnknownRecord[]).push({
        oldWbsId,
        lineItemId: readStr(lineItem.id),
        description: readStr(lineItem.description ?? lineItem.title),
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

async function autoMapPotentialChangeOrderParentContracts(params: {
  accessToken: string;
  sourceCompanyId: string;
  sourceProjectId: string;
  targetCompanyId: string;
  targetProjectId: string;
  maxPages: number;
  potentialChangeOrders: UnknownRecord[];
  contractIdMap: Record<string, string>;
}) {
  const summary: UnknownRecord = {
    enabled: false,
    sourceParentContracts: 0,
    applied: 0,
    skippedExisting: 0,
    issues: [] as UnknownRecord[],
  };

  const sourceParentIds = new Set(
    params.potentialChangeOrders
      .map((row) => readStr(row.contract_id))
      .filter(Boolean)
  );
  summary.sourceParentContracts = sourceParentIds.size;
  if (sourceParentIds.size === 0) return summary;

  summary.enabled = true;

  const [sourceContractsResult, targetContractsResult] = await Promise.all([
    fetchPaged({
      accessToken: params.accessToken,
      companyId: params.sourceCompanyId,
      maxPages: params.maxPages,
      arrayKeys: ["data", "commitment_contracts"],
      pathForPage: (page) =>
        `/rest/v2.0/companies/${encodeURIComponent(params.sourceCompanyId)}/projects/${encodeURIComponent(
          params.sourceProjectId
        )}/commitment_contracts?page=${page}&per_page=100`,
    }),
    fetchPaged({
      accessToken: params.accessToken,
      companyId: params.targetCompanyId,
      maxPages: params.maxPages,
      arrayKeys: ["data", "commitment_contracts"],
      pathForPage: (page) =>
        `/rest/v2.0/companies/${encodeURIComponent(params.targetCompanyId)}/projects/${encodeURIComponent(
          params.targetProjectId
        )}/commitment_contracts?page=${page}&per_page=100`,
    }),
  ]);

  const sourceById = new Map<string, UnknownRecord>();
  for (const row of sourceContractsResult.records) {
    const id = readStr(row.id);
    if (id && !sourceById.has(id)) sourceById.set(id, row);
  }

  const targetBySourceId = new Map<string, string>();
  const targetByNumberTitle = new Map<string, string[]>();
  for (const row of targetContractsResult.records) {
    const targetId = readStr(row.id);
    if (!targetId) continue;
    const originSourceId = readStr(row.origin_id || row.originId);
    if (originSourceId && !targetBySourceId.has(originSourceId)) targetBySourceId.set(originSourceId, targetId);
    const key = `${norm(row.number)}|${norm(row.title)}`;
    if (key !== "|") targetByNumberTitle.set(key, [...(targetByNumberTitle.get(key) || []), targetId]);
  }

  for (const sourceParentId of sourceParentIds) {
    if (params.contractIdMap[sourceParentId]) {
      summary.skippedExisting = Number(summary.skippedExisting) + 1;
      continue;
    }

    const mappedFromOrigin = targetBySourceId.get(sourceParentId);
    if (mappedFromOrigin) {
      params.contractIdMap[sourceParentId] = mappedFromOrigin;
      summary.applied = Number(summary.applied) + 1;
      continue;
    }

    const sourceContract = sourceById.get(sourceParentId);
    if (sourceContract) {
      const key = `${norm(sourceContract.number)}|${norm(sourceContract.title)}`;
      const candidates = key !== "|" ? targetByNumberTitle.get(key) || [] : [];
      if (candidates.length === 1) {
        params.contractIdMap[sourceParentId] = candidates[0];
        summary.applied = Number(summary.applied) + 1;
        continue;
      }
      if (candidates.length > 1) {
        (summary.issues as UnknownRecord[]).push({
          type: "ambiguous_parent_contract_match",
          sourceParentId,
          sourceNumber: readStr(sourceContract.number),
          sourceTitle: readStr(sourceContract.title),
          candidateCount: candidates.length,
        });
        continue;
      }
    }

    (summary.issues as UnknownRecord[]).push({
      type: "missing_parent_contract_match",
      sourceParentId,
    });
  }

  if (sourceContractsResult.errors.length) summary.sourceContractWarnings = sourceContractsResult.errors.slice(0, 12);
  if (targetContractsResult.errors.length) summary.targetContractWarnings = targetContractsResult.errors.slice(0, 12);
  return summary;
}

function mapId(
  value: unknown,
  map: Record<string, string>,
  label: string,
  issues: UnknownRecord[],
  context: UnknownRecord,
  options: { required: boolean; allowUnmappedIds: boolean; omitWhenUnmapped?: boolean }
) {
  const oldId = readStr(value);
  if (!oldId) return undefined;
  const mapped = readStr(map[oldId]);
  if (mapped) return readNum(mapped) ?? mapped;
  if (options.required && !options.allowUnmappedIds) {
    issues.push({ type: "missing_id_mapping", field: label, oldId, ...context });
    return undefined;
  }
  if (options.omitWhenUnmapped) return undefined;
  return readNum(oldId) ?? oldId;
}

function stripContractPayload(source: UnknownRecord) {
  const payload: UnknownRecord = { ...source };
  const readonlyKeys = [
    "id",
    "created_at",
    "updated_at",
    "deleted_at",
    "company_id",
    "project_id",
    "line_items",
    "line_item_contract_details",
    "attachments",
    "attachment_ids",
    "upload_ids",
    "file_version_ids",
    "image_ids",
    "drawing_revision_ids",
    "forms",
    "form_ids",
    "payments",
    "payment_applications",
    "requisitions",
    "base",
    "base_id",
    "base_type",
    "base_ancestry",
    "ancestry",
    "root",
    "root_id",
    "change_orders",
    "potential_change_orders",
    "commitment_change_orders",
    "current_user_permissions",
    "created_by",
    "updated_by",
    "origin_id",
    "origin_code",
    "origin_data",
    "value",
    "original_value",
    "original_contract_value",
  ];
  for (const key of readonlyKeys) delete payload[key];
  return payload;
}

function sourceContractType(source: UnknownRecord) {
  const raw = readStr(source.type ?? source.contract_type ?? source.kind).toLowerCase();
  if (raw.includes("potential") && raw.includes("change")) return "PotentialChangeOrder";
  if (raw.includes("work")) return "WorkOrderContract";
  if (raw.includes("purchase")) return "PurchaseOrderContract";
  if (raw.includes("sub")) return "CommitmentContract";
  return readStr(source.type) || "PurchaseOrderContract";
}

function isPotentialChangeOrderSource(source: UnknownRecord) {
  return readStr(source._cloneSourceEndpoint) === "potential_change_orders";
}

function buildPotentialChangeOrderPayload(params: {
  source: UnknownRecord;
  targetStatus: string;
  preserveStatus: boolean;
  contractIdMap: Record<string, string>;
  changeOrderRequestIdMap: Record<string, string>;
  commitmentChangeEventIdMap: Record<string, string>;
  primeChangeEventIdMap: Record<string, string>;
  issues: UnknownRecord[];
  requireMappedIds: boolean;
  allowUnmappedIds: boolean;
  passthroughIds: boolean;
  targetProjectId: string;
}) {
  const sourceContractId = readStr(params.source.contract_id);
  const targetProjectIdNormalized = readStr(params.targetProjectId);
  const sourceProjectIdNormalized = readStr(params.source.project_id || params.source.projectId);
  const sameProject = sourceProjectIdNormalized && targetProjectIdNormalized && sourceProjectIdNormalized === targetProjectIdNormalized;
  const context = {
    contractId: readStr(params.source.id),
    contractNumber: readStr(params.source.number),
    contractTitle: readStr(params.source.title),
    sourceContractId,
  };

  const mappedContractId = params.passthroughIds
    ? (readNum(sourceContractId) ?? sourceContractId)
    : mapId(sourceContractId, params.contractIdMap, "contract_id", params.issues, context, {
      required: params.requireMappedIds,
      allowUnmappedIds: params.allowUnmappedIds,
    });

  const sourceOriginId = readStr(params.source.origin_id);
  const sourceOriginData = readStr(params.source.origin_data);
  const sourceId = readStr(params.source.id);
  const number = readStr(params.source.number);
  const title = readStr(params.source.title) || number || "Untitled Potential Change Order";
  const status = params.preserveStatus ? readStr(params.source.status) || params.targetStatus : params.targetStatus;

  const sourceCorId = params.source.change_order_request_id;
  const mappedCorId = sameProject
    ? (readNum(sourceCorId) ?? readStr(sourceCorId)) || undefined
    : params.passthroughIds
      ? undefined
      : mapId(
        sourceCorId,
        params.changeOrderRequestIdMap,
        "change_order_request_id",
        params.issues,
        context,
        {
          required: false,
          allowUnmappedIds: true,
          omitWhenUnmapped: true,
        }
      );

  const sourceCommitmentChangeEventId = params.source.commitment_change_event_id;
  const mappedCommitmentChangeEventId = sameProject
    ? (readNum(sourceCommitmentChangeEventId) ?? readStr(sourceCommitmentChangeEventId)) || undefined
    : params.passthroughIds
      ? undefined
      : mapId(
        sourceCommitmentChangeEventId,
        params.commitmentChangeEventIdMap,
        "commitment_change_event_id",
        params.issues,
        context,
        {
          required: false,
          allowUnmappedIds: true,
          omitWhenUnmapped: true,
        }
      );

  const sourcePrimeChangeEventId = params.source.prime_change_event_id;
  const mappedPrimeChangeEventId = sameProject
    ? (readNum(sourcePrimeChangeEventId) ?? readStr(sourcePrimeChangeEventId)) || undefined
    : params.passthroughIds
      ? undefined
      : mapId(
        sourcePrimeChangeEventId,
        params.primeChangeEventIdMap,
        "prime_change_event_id",
        params.issues,
        context,
        {
          required: false,
          allowUnmappedIds: true,
          omitWhenUnmapped: true,
        }
      );

  const changeOrder = compactPayload({
    // Cross-project links are only preserved when explicitly mapped to target IDs.
    change_order_request_id: mappedCorId,
    commitment_change_event_id: mappedCommitmentChangeEventId,
    prime_change_event_id: mappedPrimeChangeEventId,
    description: readStr(params.source.description),
    due_date: readStr(params.source.due_date),
    grand_total: readStr(params.source.grand_total),
    invoiced_date: readStr(params.source.invoiced_date),
    number,
    origin_id: sourceOriginId || sourceId || undefined,
    origin_data: sourceOriginData || (sourceId ? `pmc_pco_clone:${sourceId}` : undefined),
    paid_date: readStr(params.source.paid_date),
    schedule_impact_amount: readNum(params.source.schedule_impact_amount),
    status: status || "draft",
    title,
    currency_exchange_rate: readStr(params.source.currency_exchange_rate),
  });

  return compactPayload({
    project_id: readNum(params.targetProjectId) ?? params.targetProjectId,
    contract_id: mappedContractId,
    change_order: changeOrder,
  });
}

function buildContractPayload(params: {
  source: UnknownRecord;
  targetStatus: string;
  preserveStatus: boolean;
  vendorIdMap: Record<string, string>;
  contractIdMap: Record<string, string>;
  changeOrderRequestIdMap: Record<string, string>;
  commitmentChangeEventIdMap: Record<string, string>;
  primeChangeEventIdMap: Record<string, string>;
  targetVendorIdOverride: string;
  issues: UnknownRecord[];
  requireMappedIds: boolean;
  allowUnmappedIds: boolean;
  passthroughIds: boolean;
  targetProjectId: string;
}) {
  if (isPotentialChangeOrderSource(params.source)) {
    return buildPotentialChangeOrderPayload({
      source: params.source,
      targetStatus: params.targetStatus,
      preserveStatus: params.preserveStatus,
      contractIdMap: params.contractIdMap,
      changeOrderRequestIdMap: params.changeOrderRequestIdMap,
      commitmentChangeEventIdMap: params.commitmentChangeEventIdMap,
      primeChangeEventIdMap: params.primeChangeEventIdMap,
      issues: params.issues,
      requireMappedIds: params.requireMappedIds,
      allowUnmappedIds: params.allowUnmappedIds,
      passthroughIds: params.passthroughIds,
      targetProjectId: params.targetProjectId,
    });
  }

  const payload = stripContractPayload(params.source);
  const vendor = isRecord(params.source.vendor) ? params.source.vendor : {};
  const sourceVendorId = readStr(params.source.vendor_id ?? vendor.id);
  const context = {
    contractId: readStr(params.source.id),
    contractNumber: readStr(params.source.number),
    contractTitle: readStr(params.source.title),
    vendorName: readStr(vendor.name ?? params.source.vendor_name),
  };

  payload.type = sourceContractType(params.source);
  payload.status = params.preserveStatus ? readStr(params.source.status) || params.targetStatus : params.targetStatus;
  if (!readStr(payload.status)) payload.status = "Draft";

  const mappedVendorId = params.passthroughIds
    ? (readNum(sourceVendorId) ?? sourceVendorId)
    : params.targetVendorIdOverride
      ? (readNum(params.targetVendorIdOverride) ?? params.targetVendorIdOverride)
      : mapId(sourceVendorId, params.vendorIdMap, "vendor_id", params.issues, context, {
        required: params.requireMappedIds && readStr(payload.status).toLowerCase() !== "draft",
        allowUnmappedIds: params.allowUnmappedIds,
      });
  delete payload.vendor;
  delete payload.vendor_name;
  if (mappedVendorId !== undefined) payload.vendor_id = mappedVendorId;
  else delete payload.vendor_id;

  const sourceContractId = readNum(params.source.id);
  if (sourceContractId !== undefined) {
    payload.origin_id = sourceContractId;
    payload.origin_data = JSON.stringify({
      source: "pmc_commitment_clone",
      sourceContractId: readStr(params.source.id),
      sourceContractNumber: readStr(params.source.number),
    });
  }

  return payload;
}

function extractSourceId(record: UnknownRecord, field: string, objectField: string) {
  if (record[field] !== undefined) return record[field];
  const nested = isRecord(record[objectField]) ? record[objectField] : {};
  return nested.id;
}

function buildLineItemPayload(params: {
  source: UnknownRecord;
  sourceContract: UnknownRecord;
  sourceEndpoint?: string;
  maps: Record<string, Record<string, string>>;
  issues: UnknownRecord[];
  requireMappedIds: boolean;
  allowUnmappedIds: boolean;
  passthroughIds: boolean;
}) {
  const payload: UnknownRecord = { ...params.source };
  const readonlyKeys = [
    "id",
    "created_at",
    "updated_at",
    "deleted_at",
    "company_id",
    "project_id",
    "contract_id",
    "purchase_order_contract_id",
    "commitment_contract_id",
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
    contractId: readStr(params.sourceContract.id),
    contractNumber: readStr(params.sourceContract.number),
    lineItemId: readStr(params.source.id),
    description: readStr(params.source.description ?? params.source.title),
  };

  const idFields = [
    { payloadField: "budget_line_item_id", objectField: "budget_line_item", mapName: "budgetLineItemIdMap" },
    { payloadField: "wbs_code_id", objectField: "wbs_code", mapName: "wbsCodeIdMap" },
    { payloadField: "cost_code_id", objectField: "cost_code", mapName: "costCodeIdMap" },
    { payloadField: "line_item_type_id", objectField: "line_item_type", mapName: "lineItemTypeIdMap" },
    { payloadField: "tax_code_id", objectField: "tax_code", mapName: "taxCodeIdMap" },
  ];

  for (const item of idFields) {
    const sourceId = extractSourceId(params.source, item.payloadField, item.objectField);
    const isBudgetCodeField = item.payloadField === "wbs_code_id" || item.payloadField === "budget_line_item_id";
    const isPotentialChangeOrder = params.sourceEndpoint === "potential_change_orders";
    const isPcoOptionalField = isPotentialChangeOrder
      && (item.payloadField === "cost_code_id" || item.payloadField === "line_item_type_id" || item.payloadField === "tax_code_id");
    let mapped: string | number | undefined;
    if (params.passthroughIds) {
      mapped = readNum(sourceId) ?? (readStr(sourceId) || undefined);
    } else {
      mapped = mapId(
        sourceId,
        params.maps[item.mapName] || {},
        item.payloadField,
        params.issues,
        context,
        {
          required: isPcoOptionalField ? false : params.requireMappedIds,
          allowUnmappedIds: isBudgetCodeField ? false : (isPcoOptionalField ? true : params.allowUnmappedIds),
          omitWhenUnmapped: isBudgetCodeField || isPcoOptionalField,
        }
      );
    }
    if (!params.passthroughIds && isBudgetCodeField && mapped !== undefined && !/^598\d{12}$/.test(String(mapped))) {
      params.issues.push({
        type: "invalid_id_mapping",
        field: item.payloadField,
        oldId: readStr(sourceId),
        mappedId: readStr(mapped),
        issue: "mapped_budget_code_id_is_not_target_wbs_id",
        ...context,
      });
      mapped = undefined;
    }
    delete payload[item.objectField];
    if (mapped !== undefined) payload[item.payloadField] = mapped;
    else delete payload[item.payloadField];
  }

  const sourceLineItemId = readNum(params.source.id);
  if (sourceLineItemId !== undefined) {
    payload.origin_id = sourceLineItemId;
    payload.origin_data = JSON.stringify({
      source: "pmc_commitment_clone",
      sourceLineItemId: readStr(params.source.id),
      sourceContractId: readStr(params.sourceContract.id),
      sourceContractNumber: readStr(params.sourceContract.number),
    });
  }

  return payload;
}

async function fetchCommitments(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
  sourceMode: string;
}) {
  const contracts: Array<UnknownRecord & { _cloneSourceEndpoint?: string }> = [];
  const errors: UnknownRecord[] = [];

  if (params.sourceMode === "all" || params.sourceMode === "commitment_contracts") {
    const result = await fetchPaged({
      accessToken: params.accessToken,
      companyId: params.companyId,
      maxPages: params.maxPages,
      arrayKeys: ["data", "commitment_contracts"],
      pathForPage: (page) =>
        `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(
          params.projectId
        )}/commitment_contracts?page=${page}&per_page=100`,
    });
    contracts.push(...result.records.map((record) => ({ ...record, _cloneSourceEndpoint: "commitment_contracts" })));
    errors.push(...result.errors);
  }

  if (params.sourceMode === "all" || params.sourceMode === "purchase_order_contracts") {
    const result = await fetchPaged({
      accessToken: params.accessToken,
      companyId: params.companyId,
      maxPages: params.maxPages,
      arrayKeys: ["data", "purchase_order_contracts"],
      pathForPage: (page) =>
        `/rest/v1.0/purchase_order_contracts?company_id=${encodeURIComponent(
          params.companyId
        )}&project_id=${encodeURIComponent(params.projectId)}&page=${page}&per_page=100`,
    });
    contracts.push(...result.records.map((record) => ({ ...record, _cloneSourceEndpoint: "purchase_order_contracts" })));
    errors.push(...result.errors);
  }

  if (params.sourceMode === "all" || params.sourceMode === "potential_change_orders") {
    const result = await fetchPaged({
      accessToken: params.accessToken,
      companyId: params.companyId,
      maxPages: params.maxPages,
      arrayKeys: ["potential_change_orders", "data"],
      pathForPage: (page) =>
        `/rest/v1.0/potential_change_orders?project_id=${encodeURIComponent(params.projectId)}&page=${page}&per_page=100`,
    });
    contracts.push(...result.records.map((record) => ({ ...record, _cloneSourceEndpoint: "potential_change_orders" })));
    errors.push(...result.errors);
  }

  const deduped = new Map<string, UnknownRecord & { _cloneSourceEndpoint?: string }>();
  for (const contract of contracts) {
    const key = readStr(contract.id) || `${readStr(contract.number)}|${readStr(contract.title)}`;
    if (!key || deduped.has(key)) continue;
    deduped.set(key, contract);
  }

  return { contracts: [...deduped.values()], errors };
}

async function fetchLineItems(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  contractId: string;
  sourceEndpoint?: string;
  maxPages: number;
}) {
  const isPotentialChangeOrder = params.sourceEndpoint === "potential_change_orders";
  const candidates = (page: number) => [
    ...(isPotentialChangeOrder
      ? [
        `/rest/v1.0/potential_change_orders/${encodeURIComponent(
          params.contractId
        )}/line_items?project_id=${encodeURIComponent(params.projectId)}&page=${page}&per_page=100`,
        `/rest/v1.0/potential_change_orders/${encodeURIComponent(
          params.contractId
        )}/line_item_contract_details?project_id=${encodeURIComponent(params.projectId)}&page=${page}&per_page=100`,
      ]
      : [
        `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(
          params.projectId
        )}/commitment_contracts/${encodeURIComponent(params.contractId)}/line_items?page=${page}&per_page=100`,
        `/rest/v1.0/purchase_order_contracts/${encodeURIComponent(
          params.contractId
        )}/line_item_contract_details?company_id=${encodeURIComponent(params.companyId)}&project_id=${encodeURIComponent(
          params.projectId
        )}&page=${page}&per_page=100`,
        `/rest/v1.0/purchase_order_contracts/${encodeURIComponent(
          params.contractId
        )}/line_items?company_id=${encodeURIComponent(params.companyId)}&project_id=${encodeURIComponent(
          params.projectId
        )}&page=${page}&per_page=100`,
      ]),
  ];

  let preferred: string | undefined;
  const records: UnknownRecord[] = [];
  const errors: UnknownRecord[] = [];

  for (let page = 1; page <= params.maxPages; page += 1) {
    const pageCandidates = candidates(page);
    if (preferred) {
      const index = pageCandidates.indexOf(preferred.replace(/page=\d+/, `page=${page}`));
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
      pageRecords = asArray(response.payload, ["data", "line_items", "line_item_contract_details"]).filter(isRecord);
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

async function createContract(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  payload: UnknownRecord;
  sourceEndpoint?: string;
}) {
  if (params.sourceEndpoint === "potential_change_orders") {
    const response = await procoreJson({
      path: `/rest/v1.0/potential_change_orders`,
      method: "POST",
      accessToken: params.accessToken,
      companyId: params.companyId,
      body: params.payload,
    });
    return unwrapData(response.payload);
  }

  const response = await procoreJson({
    path: `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(
      params.projectId
    )}/commitment_contracts`,
    method: "POST",
    accessToken: params.accessToken,
    companyId: params.companyId,
    body: params.payload,
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

async function fetchTargetContractsForDuplicateCheck(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
  includePotentialChangeOrders?: boolean;
}) {
  const result = await fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    maxPages: params.maxPages,
    arrayKeys: ["data", "commitment_contracts"],
    pathForPage: (page) =>
      `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(
        params.projectId
      )}/commitment_contracts?page=${page}&per_page=100`,
  });
  const records = [...result.records];

  if (params.includePotentialChangeOrders) {
    const pcoResult = await fetchPaged({
      accessToken: params.accessToken,
      companyId: params.companyId,
      maxPages: params.maxPages,
      arrayKeys: ["potential_change_orders", "data"],
      pathForPage: (page) =>
        `/rest/v1.0/potential_change_orders?project_id=${encodeURIComponent(params.projectId)}&page=${page}&per_page=100`,
    });
    records.push(...pcoResult.records.map((record) => ({ ...record, _cloneSourceEndpoint: "potential_change_orders" })));
  }

  return records;
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

async function addVendorToProject(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  vendorId: string;
}) {
  const paths = [
    `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/vendors/${encodeURIComponent(params.vendorId)}/actions/add?view=normal`,
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/vendors/${encodeURIComponent(params.vendorId)}/actions/add?view=normal`,
  ];
  const attempts: UnknownRecord[] = [];

  for (const path of paths) {
    const response = await procoreJson({
      path,
      accessToken: params.accessToken,
      companyId: params.companyId,
      method: "POST",
      allowStatuses: [400, 404, 405, 409, 422],
    });
    attempts.push({ path, status: response.status, ok: response.ok, response: response.payload });
    if (response.ok) return { ok: true, path, status: response.status, response: response.payload, attempts };

    const text = safeJson(response.payload).toLowerCase();
    if (response.status === 409 || (response.status === 422 && /already|exists|added/.test(text))) {
      return { ok: true, alreadyAdded: true, path, status: response.status, response: response.payload, attempts };
    }
  }

  return { ok: false, attempts };
}

async function createLineItem(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  contractId: string;
  payload: UnknownRecord;
  sourceEndpoint?: string;
}) {
  if (params.sourceEndpoint === "potential_change_orders") {
    const attempts = [
      {
        path: `/rest/v1.0/potential_change_orders/${encodeURIComponent(params.contractId)}/line_items?project_id=${encodeURIComponent(
          params.projectId
        )}`,
        body: params.payload,
      },
      {
        path: `/rest/v1.0/potential_change_orders/${encodeURIComponent(params.contractId)}/line_item_contract_details?project_id=${encodeURIComponent(
          params.projectId
        )}`,
        body: params.payload,
      },
      {
        path: `/rest/v1.0/potential_change_orders/${encodeURIComponent(params.contractId)}/line_items?project_id=${encodeURIComponent(
          params.projectId
        )}`,
        body: { line_item: params.payload },
      },
      {
        path: `/rest/v1.0/potential_change_orders/${encodeURIComponent(params.contractId)}/line_item_contract_details?project_id=${encodeURIComponent(
          params.projectId
        )}`,
        body: { line_item_contract_detail: params.payload },
      },
    ];

    const errors: UnknownRecord[] = [];
    for (const attempt of attempts) {
      try {
        const response = await procoreJson({
          path: attempt.path,
          method: "POST",
          accessToken: params.accessToken,
          companyId: params.companyId,
          body: attempt.body,
        });
        return { created: unwrapData(response.payload), path: attempt.path, wrapperUsed: attempt.body === params.payload ? "none" : "wrapped" };
      } catch (error) {
        errors.push({
          path: attempt.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    throw new Error(`Procore PCO line-item create failed: ${safeJson(errors)}`);
  }

  const requestPath = `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(
    params.projectId
  )}/commitment_contracts/${encodeURIComponent(params.contractId)}/line_items`;
  const response = await procoreJson({
    path: requestPath,
    method: "POST",
    accessToken: params.accessToken,
    companyId: params.companyId,
    body: params.payload,
    allowStatuses: [400, 422],
  });
  if (response.ok) return unwrapData(response.payload);

  const responseText = safeJson(response.payload).toLowerCase();
  if (/budget code (?:was not found|is missing)|wbs code .*not found|attributes\.wbs_code_id/.test(responseText)) {
    const fallbackPayload = { ...params.payload };
    delete fallbackPayload.wbs_code_id;
    delete fallbackPayload.wbs_code;
    delete fallbackPayload.budget_line_item_id;
    delete fallbackPayload.budget_line_item;
    const fallbackResponse = await procoreJson({
      path: requestPath,
      method: "POST",
      accessToken: params.accessToken,
      companyId: params.companyId,
      body: fallbackPayload,
    });
    const created = unwrapData(fallbackResponse.payload);
    return { created, fallbackUsed: "removed_invalid_budget_code", originalError: response.payload, attemptedPayload: fallbackPayload };
  }

  throw new Error(`Procore POST ${requestPath} failed (${response.status}): ${safeJson(response.payload)}`);
}

async function updateContract(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  contractId: string;
  payload: UnknownRecord;
  sourceEndpoint?: string;
}) {
  if (params.sourceEndpoint === "potential_change_orders") {
    const attempts = [
      {
        method: "PATCH",
        path: `/rest/v1.0/potential_change_orders/${encodeURIComponent(params.contractId)}`,
        body: params.payload,
      },
    ];

    const errors: UnknownRecord[] = [];
    for (const attempt of attempts) {
      try {
        const updated = await procoreJson({
          path: attempt.path,
          method: attempt.method,
          accessToken: params.accessToken,
          companyId: params.companyId,
          body: attempt.body,
        });
        return {
          ok: true,
          method: attempt.method,
          path: attempt.path,
          updated: unwrapData(updated.payload),
          errors,
        };
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

  const attempts = [
    {
      method: "PATCH",
      path: `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(
        params.projectId
      )}/commitment_contracts/${encodeURIComponent(params.contractId)}`,
      body: params.payload,
    },
    {
      method: "PUT",
      path: `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(
        params.projectId
      )}/commitment_contracts/${encodeURIComponent(params.contractId)}`,
      body: params.payload,
    },
  ];

  const errors: UnknownRecord[] = [];
  for (const attempt of attempts) {
    try {
      const updated = await procoreJson({
        path: attempt.path,
        method: attempt.method,
        accessToken: params.accessToken,
        companyId: params.companyId,
        body: attempt.body,
      });
      return {
        ok: true,
        method: attempt.method,
        path: attempt.path,
        updated: unwrapData(updated.payload),
        errors,
      };
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

async function updateLineItem(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  contractId: string;
  lineItemId: string;
  payload: UnknownRecord;
  sourceEndpoint?: string;
}) {
  if (params.sourceEndpoint === "potential_change_orders") {
    const attempts = [
      {
        method: "PATCH",
        path: `/rest/v1.0/potential_change_orders/${encodeURIComponent(params.contractId)}/line_items/${encodeURIComponent(
          params.lineItemId
        )}?project_id=${encodeURIComponent(params.projectId)}`,
        body: params.payload,
      },
      {
        method: "PATCH",
        path: `/rest/v1.0/potential_change_orders/${encodeURIComponent(params.contractId)}/line_item_contract_details/${encodeURIComponent(
          params.lineItemId
        )}?project_id=${encodeURIComponent(params.projectId)}`,
        body: params.payload,
      },
      {
        method: "PUT",
        path: `/rest/v1.0/potential_change_orders/${encodeURIComponent(params.contractId)}/line_items/${encodeURIComponent(
          params.lineItemId
        )}?project_id=${encodeURIComponent(params.projectId)}`,
        body: params.payload,
      },
      {
        method: "PUT",
        path: `/rest/v1.0/potential_change_orders/${encodeURIComponent(params.contractId)}/line_item_contract_details/${encodeURIComponent(
          params.lineItemId
        )}?project_id=${encodeURIComponent(params.projectId)}`,
        body: params.payload,
      },
    ];

    const errors: UnknownRecord[] = [];
    for (const attempt of attempts) {
      try {
        const updated = await procoreJson({
          path: attempt.path,
          method: attempt.method,
          accessToken: params.accessToken,
          companyId: params.companyId,
          body: attempt.body,
        });
        return {
          ok: true,
          method: attempt.method,
          path: attempt.path,
          updated: unwrapData(updated.payload),
          errors,
        };
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

  const attempts = [
    {
      method: "PATCH",
      path: `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(
        params.projectId
      )}/commitment_contracts/${encodeURIComponent(params.contractId)}/line_items/${encodeURIComponent(params.lineItemId)}`,
      body: params.payload,
    },
    {
      method: "PUT",
      path: `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(
        params.projectId
      )}/commitment_contracts/${encodeURIComponent(params.contractId)}/line_items/${encodeURIComponent(params.lineItemId)}`,
      body: params.payload,
    },
  ];

  const errors: UnknownRecord[] = [];
  for (const attempt of attempts) {
    try {
      const updated = await procoreJson({
        path: attempt.path,
        method: attempt.method,
        accessToken: params.accessToken,
        companyId: params.companyId,
        body: attempt.body,
      });
      return {
        ok: true,
        method: attempt.method,
        path: attempt.path,
        updated: unwrapData(updated.payload),
        errors,
      };
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
    const sourceMode = readStr(body.sourceMode) || "all";
    const maxPages = Math.min(50, Math.max(1, readNum(body.maxPages) || 5));
    const createOffset = Math.max(0, Math.trunc(readNum(body.createOffset) || 0));
    const requestedCreateLimit = Math.max(1, Math.min(100, Math.trunc(readNum(body.createLimit) || 1)));
    const createLimit = dryRun ? requestedCreateLimit : Math.min(requestedCreateLimit, 1);
    const lineItemCreateOffset = Math.max(0, Math.trunc(readNum(body.lineItemCreateOffset) || 0));
    const lineItemCreateLimit = Math.max(1, Math.min(100, Math.trunc(readNum(body.lineItemCreateLimit) || 10)));
    const updateExisting = readBool(body.updateExisting, true);
    const updateOnlyBlankFields = readBool(body.updateOnlyBlankFields, true);
    const allowUnmappedIds = readBool(body.allowUnmappedIds, false);
    const passthroughIds = readBool(body.passthroughIds || body.rawPassthroughIds, false);
    const crosswalkWorkbookBase64 = readStr(body.crosswalkWorkbookBase64);
    const rawCrosswalkPath = readStr(body.crosswalkPath) || DEFAULT_CROSSWALK_PATH;
    const crosswalkPath = path.isAbsolute(rawCrosswalkPath)
      ? rawCrosswalkPath
      : path.resolve(process.cwd(), rawCrosswalkPath);
    const targetVendorIdOverride = readStr(body.targetVendorIdOverride);
    const requestedCommitmentIds = new Set(
      asArray(body.commitmentIds)
        .map(readStr)
        .filter(Boolean)
    );

    if (!sourceCompanyId || !sourceProjectId || !targetCompanyId || !targetProjectId) {
      return NextResponse.json(
        { success: false, error: "sourceCompanyId, sourceProjectId, targetCompanyId, and targetProjectId are required." },
        { status: 400 }
      );
    }

    const requireMappedIds = !passthroughIds && (sourceCompanyId !== targetCompanyId || sourceProjectId !== targetProjectId);
    const maps = {
      vendorIdMap: buildIdMap(body.vendorIdMap),
      contractIdMap: buildIdMap(body.contractIdMap),
      changeOrderRequestIdMap: buildIdMap(body.changeOrderRequestIdMap),
      commitmentChangeEventIdMap: buildIdMap(body.commitmentChangeEventIdMap),
      primeChangeEventIdMap: buildIdMap(body.primeChangeEventIdMap),
      budgetLineItemIdMap: buildIdMap(body.budgetLineItemIdMap),
      wbsCodeIdMap: buildIdMap(body.wbsCodeIdMap),
      costCodeIdMap: buildIdMap(body.costCodeIdMap),
      lineItemTypeIdMap: buildIdMap(body.lineItemTypeIdMap),
      taxCodeIdMap: buildIdMap(body.taxCodeIdMap),
    };

    const sourceFetch = await fetchCommitments({
      accessToken,
      companyId: sourceCompanyId,
      projectId: sourceProjectId,
      maxPages,
      sourceMode,
    });

    const selectedContracts = sourceFetch.contracts.filter((contract) => {
      if (requestedCommitmentIds.size === 0) return true;
      return requestedCommitmentIds.has(readStr(contract.id));
    });
    const contractsForPlan = dryRun ? selectedContracts : selectedContracts.slice(createOffset, createOffset + createLimit);

    const plan: UnknownRecord[] = [];
    const missingMappings: UnknownRecord[] = [];
    let sourceLineItems = 0;
    const lineItemsByContractId = new Map<string, { records: UnknownRecord[]; errors: UnknownRecord[] }>();

    for (const contract of contractsForPlan) {
      const contractId = readStr(contract.id);
      const sourceEndpoint = readStr(contract._cloneSourceEndpoint);
      const lineFetch = cloneLineItems && contractId
        ? await fetchLineItems({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, contractId, sourceEndpoint, maxPages })
        : { records: [] as UnknownRecord[], errors: [] as UnknownRecord[] };
      lineItemsByContractId.set(contractId, lineFetch);
      sourceLineItems += lineFetch.records.length;
    }

    const crosswalkAutoMappings = requireMappedIds && cloneLineItems && !passthroughIds
      ? await applyCommitmentCrosswalkWbsMappings({
        accessToken,
        sourceCompanyId,
        sourceProjectId,
        targetCompanyId,
        targetProjectId,
        sourceLineItems: contractsForPlan.flatMap((contract) => {
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

    const parentContractAutoMappings = requireMappedIds && !passthroughIds
      ? await autoMapPotentialChangeOrderParentContracts({
        accessToken,
        sourceCompanyId,
        sourceProjectId,
        targetCompanyId,
        targetProjectId,
        maxPages,
        potentialChangeOrders: contractsForPlan.filter((contract) => readStr(contract._cloneSourceEndpoint) === "potential_change_orders"),
        contractIdMap: maps.contractIdMap,
      })
      : { enabled: false, sourceParentContracts: 0, applied: 0, skippedExisting: 0, issues: [] as UnknownRecord[] };

    for (const contract of contractsForPlan) {
      const contractId = readStr(contract.id);
      const sourceEndpoint = readStr(contract._cloneSourceEndpoint);
      const lineFetch = lineItemsByContractId.get(contractId) || { records: [] as UnknownRecord[], errors: [] as UnknownRecord[] };
      const contractIssues: UnknownRecord[] = [];
      const contractPayload = buildContractPayload({
        source: contract,
        targetStatus,
        preserveStatus,
        vendorIdMap: maps.vendorIdMap,
        contractIdMap: maps.contractIdMap,
        changeOrderRequestIdMap: maps.changeOrderRequestIdMap,
        commitmentChangeEventIdMap: maps.commitmentChangeEventIdMap,
        primeChangeEventIdMap: maps.primeChangeEventIdMap,
        targetVendorIdOverride,
        issues: contractIssues,
        requireMappedIds,
        allowUnmappedIds,
        passthroughIds,
        targetProjectId,
      });
      const lineItemPlans = lineFetch.records.map((lineItem) => {
        const lineIssues: UnknownRecord[] = [];
        const payload = buildLineItemPayload({
          source: lineItem,
          sourceContract: contract,
          sourceEndpoint,
          maps,
          issues: lineIssues,
          requireMappedIds,
          allowUnmappedIds,
          passthroughIds,
        });
        missingMappings.push(...lineIssues);
        return {
          sourceLineItemId: readStr(lineItem.id),
          description: readStr(lineItem.description ?? lineItem.title),
          payload,
          issues: lineIssues,
        };
      });
      missingMappings.push(...contractIssues);
      plan.push({
        sourceContractId: contractId,
        sourceEndpoint,
        number: readStr(contract.number),
        title: readStr(contract.title),
        status: readStr(contract.status),
        type: sourceContractType(contract),
        vendorId: readStr(contract.vendor_id ?? (isRecord(contract.vendor) ? contract.vendor.id : "")),
        vendorName: readStr(isRecord(contract.vendor) ? contract.vendor.name : contract.vendor_name),
        lineItemCount: lineFetch.records.length,
        contractPayload,
        lineItems: lineItemPlans,
        fetchWarnings: lineFetch.errors.slice(0, 6),
        issues: contractIssues,
      });
    }

    const criticalMissingMappings = missingMappings.filter((mapping) => {
      const field = readStr(mapping.field);
      return field === "wbs_code_id" || field === "budget_line_item_id" || readStr(mapping.type) === "invalid_id_mapping";
    });
    const readyForLiveClone = passthroughIds || missingMappings.length === 0 || (allowUnmappedIds && criticalMissingMappings.length === 0);

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        tokenSource,
        readyForLiveClone,
        source: { companyId: sourceCompanyId, projectId: sourceProjectId, sourceMode },
        target: { companyId: targetCompanyId, projectId: targetProjectId, targetStatus, preserveStatus, targetVendorIdOverride: passthroughIds ? "" : targetVendorIdOverride },
        updateOptions: { updateExisting, updateOnlyBlankFields },
        options: { passthroughIds },
        counts: {
          sourceContracts: selectedContracts.length,
          plannedContracts: contractsForPlan.length,
          sourceLineItems,
          missingMappings: missingMappings.length,
          criticalMissingMappings: criticalMissingMappings.length,
          createOffset,
          createLimit,
          lineItemCreateOffset,
          lineItemCreateLimit,
        },
        maps: Object.fromEntries(Object.entries(maps).map(([key, value]) => [key, Object.keys(value).length])),
        crosswalkAutoMappings,
        parentContractAutoMappings,
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
          error: "Commitment clone blocked by missing ID mapping(s).",
          readyForLiveClone,
          updateOptions: { updateExisting, updateOnlyBlankFields },
          counts: { sourceContracts: selectedContracts.length, plannedContracts: contractsForPlan.length, sourceLineItems, missingMappings: missingMappings.length, criticalMissingMappings: criticalMissingMappings.length, createOffset, createLimit, lineItemCreateOffset, lineItemCreateLimit },
          options: { passthroughIds },
          crosswalkAutoMappings,
          parentContractAutoMappings,
          missingMappings,
          plan,
        },
        { status: 409 }
      );
    }

    const targetContracts = await fetchTargetContractsForDuplicateCheck({
      accessToken,
      companyId: targetCompanyId,
      projectId: targetProjectId,
      maxPages,
      includePotentialChangeOrders:
        sourceMode === "all" ||
        sourceMode === "potential_change_orders" ||
        plan.some((entry) => readStr(entry.sourceEndpoint) === "potential_change_orders"),
    }).catch(() => [] as UnknownRecord[]);

    const createdContracts: UnknownRecord[] = [];
    const reusedContracts: UnknownRecord[] = [];
    const contractUpdateResults: UnknownRecord[] = [];
    const lineItemUpdateResults: UnknownRecord[] = [];
    const errors: UnknownRecord[] = [];
    const projectVendorAdds: UnknownRecord[] = [];
    for (const entry of plan) {
      try {
        const existingTarget = findExistingTargetContract(
          {
            id: entry.sourceContractId,
            number: entry.number,
            title: entry.title,
          },
          targetContracts
        );
        const existingTargetId = existingTarget ? readStr(existingTarget.id) : "";

        const targetVendorId = passthroughIds ? "" : readStr((entry.contractPayload as UnknownRecord)?.vendor_id);
        if (targetVendorId && !existingTargetId && readStr(entry.sourceEndpoint) !== "potential_change_orders") {
          const addResult = await addVendorToProject({
            accessToken,
            companyId: targetCompanyId,
            projectId: targetProjectId,
            vendorId: targetVendorId,
          });
          projectVendorAdds.push({
            sourceContractId: entry.sourceContractId,
            sourceNumber: entry.number,
            vendorId: targetVendorId,
            ...addResult,
          });
          if (!addResult.ok) {
            errors.push({
              sourceContractId: entry.sourceContractId,
              sourceNumber: entry.number,
              sourceTitle: entry.title,
              error: `Failed to add vendor ${targetVendorId} to target project ${targetProjectId}.`,
              projectVendorAdd: addResult,
              attemptedPayload: entry.contractPayload,
            });
            continue;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }

        const created = existingTargetId
          ? existingTarget
          : await createContract({
              accessToken,
              companyId: targetCompanyId,
              projectId: targetProjectId,
              payload: entry.contractPayload as UnknownRecord,
              sourceEndpoint: readStr(entry.sourceEndpoint),
            });
        const createdRecord = isRecord(created) ? created : {};
        const createdContractId = existingTargetId || readStr(createdRecord.id);
        if (existingTargetId && updateExisting && isRecord(entry.contractPayload)) {
          let updatePayload: unknown;
          if (readStr(entry.sourceEndpoint) === "potential_change_orders") {
            const sourcePayload = entry.contractPayload as UnknownRecord;
            const sourceChange = isRecord(sourcePayload.change_order) ? sourcePayload.change_order : {};
            const mergedChange = updateOnlyBlankFields
              ? mergeMissingFields(sourceChange, existingTarget)
              : sourceChange;
            updatePayload = isRecord(mergedChange)
              ? compactPayload({
                project_id: readNum(targetProjectId) ?? targetProjectId,
                contract_id: sourcePayload.contract_id ?? existingTarget.contract_id,
                change_order: mergedChange,
              })
              : undefined;
          } else {
            updatePayload = updateOnlyBlankFields
              ? mergeMissingFields(entry.contractPayload, existingTarget)
              : (entry.contractPayload as UnknownRecord);
          }
          if (isRecord(updatePayload) && Object.keys(updatePayload).length > 0) {
            const updated = await updateContract({
              accessToken,
              companyId: targetCompanyId,
              projectId: targetProjectId,
              contractId: createdContractId,
              payload: updatePayload,
              sourceEndpoint: readStr(entry.sourceEndpoint),
            });
            contractUpdateResults.push({
              sourceContractId: entry.sourceContractId,
              sourceNumber: entry.number,
              targetContractId: createdContractId,
              updateMode: updateOnlyBlankFields ? "missing_only" : "full",
              ok: updated.ok,
              updated,
            });
          } else {
            contractUpdateResults.push({
              sourceContractId: entry.sourceContractId,
              sourceNumber: entry.number,
              targetContractId: createdContractId,
              updateMode: updateOnlyBlankFields ? "missing_only" : "full",
              ok: true,
              skipped: true,
              reason: "No missing fields detected for contract update.",
            });
          }
        }
        const createdLineItems: UnknownRecord[] = [];
        const reusedLineItems: UnknownRecord[] = [];
        const existingTargetLines = existingTargetId && cloneLineItems
          ? await fetchLineItems({
              accessToken,
              companyId: targetCompanyId,
              projectId: targetProjectId,
              contractId: existingTargetId,
              sourceEndpoint: readStr(entry.sourceEndpoint),
              maxPages,
            }).then((result) => result.records).catch(() => [] as UnknownRecord[])
          : [];

        const allEntryLineItems = Array.isArray(entry.lineItems) ? entry.lineItems as UnknownRecord[] : [];
        const lineItemsForBatch = allEntryLineItems.slice(lineItemCreateOffset, lineItemCreateOffset + lineItemCreateLimit);
        if (cloneLineItems && createdContractId && allEntryLineItems.length > 0) {
          for (const line of lineItemsForBatch) {
            try {
              const existingLine = findExistingTargetLineItem(line, existingTargetLines);
              if (existingLine) {
                if (updateExisting && isRecord(line.payload)) {
                  const linePayload = line.payload as UnknownRecord;
                  const lineUpdatePayload = updateOnlyBlankFields
                    ? mergeMissingFields(linePayload, existingLine)
                    : linePayload;
                  const targetLineId = readStr(existingLine.id);
                  if (targetLineId && isRecord(lineUpdatePayload) && Object.keys(lineUpdatePayload).length > 0) {
                    const updatedLine = await updateLineItem({
                      accessToken,
                      companyId: targetCompanyId,
                      projectId: targetProjectId,
                      contractId: createdContractId,
                      lineItemId: targetLineId,
                      payload: lineUpdatePayload,
                      sourceEndpoint: readStr(entry.sourceEndpoint),
                    });
                    lineItemUpdateResults.push({
                      sourceContractId: entry.sourceContractId,
                      sourceLineItemId: line.sourceLineItemId,
                      targetContractId: createdContractId,
                      targetLineItemId: targetLineId,
                      updateMode: updateOnlyBlankFields ? "missing_only" : "full",
                      ok: updatedLine.ok,
                      updated: updatedLine,
                    });
                  } else {
                    lineItemUpdateResults.push({
                      sourceContractId: entry.sourceContractId,
                      sourceLineItemId: line.sourceLineItemId,
                      targetContractId: createdContractId,
                      targetLineItemId: targetLineId || null,
                      updateMode: updateOnlyBlankFields ? "missing_only" : "full",
                      ok: true,
                      skipped: true,
                      reason: "No missing fields detected for line-item update.",
                    });
                  }
                }
                reusedLineItems.push({
                  sourceLineItemId: line.sourceLineItemId,
                  result: existingLine,
                });
                continue;
              }
              const createdLineItem = await createLineItem({
                accessToken,
                companyId: targetCompanyId,
                projectId: targetProjectId,
                contractId: createdContractId,
                payload: line.payload as UnknownRecord,
                sourceEndpoint: readStr(entry.sourceEndpoint),
              });
              createdLineItems.push({
                sourceLineItemId: line.sourceLineItemId,
                result: createdLineItem,
              });
              await new Promise((resolve) => setTimeout(resolve, 450));
            } catch (error) {
              errors.push({
                sourceContractId: entry.sourceContractId,
                sourceLineItemId: line.sourceLineItemId,
                error: error instanceof Error ? error.message : String(error),
                attemptedPayload: line.payload,
              });
            }
          }
        }

        const contractResult = {
          sourceContractId: entry.sourceContractId,
          sourceNumber: entry.number,
          sourceTitle: entry.title,
          createdContractId,
          reusedExistingContract: Boolean(existingTargetId),
          result: created,
          createdLineItems,
          reusedLineItems,
        };
        if (existingTargetId) reusedContracts.push(contractResult);
        else createdContracts.push(contractResult);
        await new Promise((resolve) => setTimeout(resolve, 700));
      } catch (error) {
        errors.push({
          sourceContractId: entry.sourceContractId,
          sourceNumber: entry.number,
          sourceTitle: entry.title,
          error: error instanceof Error ? error.message : String(error),
          attemptedPayload: entry.contractPayload,
        });
      }
    }

    const activeContractLineCount = plan.reduce((sum, entry) => {
      const rows = Array.isArray(entry.lineItems) ? entry.lineItems.length : 0;
      return Math.max(sum, rows);
    }, 0);
    const nextLineItemCreateOffset = cloneLineItems && lineItemCreateOffset + lineItemCreateLimit < activeContractLineCount
      ? lineItemCreateOffset + lineItemCreateLimit
      : null;
    const batchEndOffset = Math.min(selectedContracts.length, createOffset + createLimit);
    const nextCreateOffset = nextLineItemCreateOffset === null && batchEndOffset < selectedContracts.length ? batchEndOffset : null;

    return NextResponse.json({
      success: errors.length === 0,
      dryRun: false,
      error: errors.length > 0 ? "Commitment clone finished with errors." : undefined,
      details: errors.length > 0 ? readStr(errors[0].error) : undefined,
      tokenSource,
      source: { companyId: sourceCompanyId, projectId: sourceProjectId, sourceMode },
      target: { companyId: targetCompanyId, projectId: targetProjectId, targetStatus, preserveStatus, targetVendorIdOverride },
      updateOptions: { updateExisting, updateOnlyBlankFields },
      counts: {
        sourceContracts: selectedContracts.length,
        attemptedContracts: contractsForPlan.length,
        sourceLineItems,
        createOffset,
        createLimit,
        lineItemCreateOffset,
        lineItemCreateLimit,
        attemptedLineItems: plan.reduce((sum, entry) => {
          const rows = Array.isArray(entry.lineItems) ? entry.lineItems.length : 0;
          return sum + Math.min(lineItemCreateLimit, Math.max(0, rows - lineItemCreateOffset));
        }, 0),
        nextLineItemCreateOffset,
        nextCreateOffset,
        createdContracts: createdContracts.length,
        reusedContracts: reusedContracts.length,
        updatedContracts: contractUpdateResults.filter((result) => result.ok === true && result.skipped !== true).length,
        skippedContractUpdates: contractUpdateResults.filter((result) => result.skipped === true).length,
        failedContractUpdates: contractUpdateResults.filter((result) => result.ok === false).length,
        createdLineItems: createdContracts.reduce((sum, contract) => {
          const lines = Array.isArray(contract.createdLineItems) ? contract.createdLineItems.length : 0;
          return sum + lines;
        }, 0) + reusedContracts.reduce((sum, contract) => {
          const lines = Array.isArray(contract.createdLineItems) ? contract.createdLineItems.length : 0;
          return sum + lines;
        }, 0),
        updatedLineItems: lineItemUpdateResults.filter((result) => result.ok === true && result.skipped !== true).length,
        skippedLineItemUpdates: lineItemUpdateResults.filter((result) => result.skipped === true).length,
        failedLineItemUpdates: lineItemUpdateResults.filter((result) => result.ok === false).length,
        errors: errors.length,
      },
      crosswalkAutoMappings,
      parentContractAutoMappings,
      projectVendorAdds,
      createdContracts,
      reusedContracts,
      contractUpdateResults,
      lineItemUpdateResults,
      errors,
      plan,
      nextStep: errors.length
        ? "Commitment clone batch finished with errors. Review errors before continuing."
        : nextLineItemCreateOffset !== null
          ? `Commitment line-item batch complete. Continue same contract with lineItemCreateOffset=${nextLineItemCreateOffset}.`
          : nextCreateOffset === null
          ? "Commitment clone complete."
          : `Commitment clone batch complete. Continue with createOffset=${nextCreateOffset}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: "Failed to clone commitments.", details: message },
      { status: 500 }
    );
  }
}
