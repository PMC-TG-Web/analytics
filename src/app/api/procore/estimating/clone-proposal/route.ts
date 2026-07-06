import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import * as XLSX from "xlsx";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

type UnknownRecord = Record<string, unknown>;

const BASE_URL = "https://api.procore.com";
const DEFAULT_CROSSWALK_PATH = "Codes to use.xlsx";
const PROCORE_PAGE_SIZE = 100;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function asArray(value: unknown, keys: string[] = []): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of keys) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

function readStr(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
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

function norm(value: unknown): string {
  return readStr(value).replace(/\s+/g, " ").toLowerCase();
}

function normLoose(value: unknown): string {
  return norm(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function nonUniqueKey(row: UnknownRecord): string {
  return [row.Name, row.Description, row["Cost Name"]].map(norm).join("|");
}

function itemIdentityKey(row: UnknownRecord): string {
  return [row.Name, row.Description].map(norm).join("|");
}

function itemIdentityLooseKey(row: UnknownRecord): string {
  return [row.Name, row.Description].map(normLoose).join("|");
}

function itemNameLooseKey(row: UnknownRecord): string {
  return normLoose(row.Name);
}

function appendMapping(map: Map<string, UnknownRecord[]>, key: string, mapping: UnknownRecord) {
  if (!key) return;
  map.set(key, [...(map.get(key) || []), mapping]);
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
}) {
  const method = params.method || "GET";
  const maxRetries = params.maxRetries ?? (method === "GET" ? 1 : 5);
  let response: Response;
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
    const retryableStatus = response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504;
    if (!retryableStatus || attempt >= maxRetries) break;
    const retryAfter = Number(response.headers.get("retry-after"));
    const exponentialDelay = Math.min(60000, 1500 * 2 ** attempt);
    const jitter = Math.floor(Math.random() * 750);
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : exponentialDelay + jitter;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  // TypeScript cannot see that the loop always assigns response.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const finalResponse = response!;
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Keep text response.
  }
  if (!finalResponse.ok) {
    const message = typeof payload === "string" ? payload : JSON.stringify(payload);
    const requestId =
      finalResponse.headers.get("x-request-id") ||
      finalResponse.headers.get("procore-request-id") ||
      finalResponse.headers.get("x-correlation-id") ||
      finalResponse.headers.get("cf-ray") ||
      "";
    throw new Error(
      `Procore ${method} ${params.path} failed (${finalResponse.status})${requestId ? ` requestId=${requestId}` : ""}: ${message}`
    );
  }
  return payload;
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bfailed \(429\)\b/i.test(message) || /rate limit|too many requests|surpassed the max number of requests/i.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readInt(value: unknown, fallback: number): number {
  const parsed = readNum(value);
  if (parsed === undefined) return fallback;
  return Math.trunc(parsed);
}

function mapFromObject(value: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!isRecord(value)) return map;
  for (const [key, entry] of Object.entries(value)) {
    const mapped = readStr(entry);
    if (key && mapped) map.set(key, mapped);
  }
  return map;
}

function objectFromMap(map: Map<string, string>): Record<string, string> {
  return Object.fromEntries(map.entries());
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
    const key = norm(row["Cost Code"]);
    if (!key) continue;
    newUniqueByCostCode.set(key, [...(newUniqueByCostCode.get(key) || []), row]);
  }

  const newNonUniqueByKey = new Map<string, UnknownRecord[]>();
  for (const row of nonUniqueNew) {
    const key = nonUniqueKey(row);
    if (!key.replace(/\|/g, "")) continue;
    newNonUniqueByKey.set(key, [...(newNonUniqueByKey.get(key) || []), row]);
  }

  const byOldItemId = new Map<string, UnknownRecord>();
  const byOldUniqueCostCode = new Map<string, UnknownRecord[]>();
  const byOldUniqueIdentity = new Map<string, UnknownRecord[]>();
  const byOldNonUniqueKey = new Map<string, UnknownRecord[]>();
  const byOldAnyIdentity = new Map<string, UnknownRecord[]>();
  const byOldAnyLooseIdentity = new Map<string, UnknownRecord[]>();
  const byOldAnyLooseName = new Map<string, UnknownRecord[]>();
  const manualOverrideByIdentity = new Map<string, UnknownRecord>();
  const manualOverrideByGroupIdentity = new Map<string, UnknownRecord>();
  const manualOverrideByName = new Map<string, UnknownRecord>();
  const manualOverrideByGroupName = new Map<string, UnknownRecord>();
  const issues: UnknownRecord[] = [];
  const newUniqueByIdentity = new Map<string, UnknownRecord[]>();
  for (const row of uniqueNew) {
    const key = itemIdentityKey(row);
    if (!key.replace(/\|/g, "")) continue;
    newUniqueByIdentity.set(key, [...(newUniqueByIdentity.get(key) || []), row]);
  }

  for (const oldRow of uniqueOld) {
    const oldItemId = readStr(oldRow.ItemId);
    const costCode = norm(oldRow["Cost Code"]);
    const identityKey = itemIdentityKey(oldRow);
    const matches = costCode ? newUniqueByCostCode.get(costCode) || [] : newUniqueByIdentity.get(identityKey) || [];
    if (!oldItemId) continue;
    if (matches.length === 1) {
      const mapping = { old: oldRow, new: matches[0], strategy: costCode ? "unique_cost_code" : "unique_identity" };
      byOldItemId.set(oldItemId, mapping);
      if (costCode) byOldUniqueCostCode.set(costCode, [...(byOldUniqueCostCode.get(costCode) || []), mapping]);
      byOldUniqueIdentity.set(identityKey, [...(byOldUniqueIdentity.get(identityKey) || []), mapping]);
      appendMapping(byOldAnyIdentity, identityKey, mapping);
      appendMapping(byOldAnyLooseIdentity, itemIdentityLooseKey(oldRow), mapping);
      appendMapping(byOldAnyLooseName, itemNameLooseKey(oldRow), mapping);
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
      const mapping = { old: oldRow, new: matches[0], strategy: "non_unique_composite" };
      byOldItemId.set(oldItemId, mapping);
      byOldNonUniqueKey.set(key, [...(byOldNonUniqueKey.get(key) || []), mapping]);
      appendMapping(byOldAnyIdentity, itemIdentityKey(oldRow), mapping);
      appendMapping(byOldAnyLooseIdentity, itemIdentityLooseKey(oldRow), mapping);
      appendMapping(byOldAnyLooseName, itemNameLooseKey(oldRow), mapping);
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

  return {
    byOldItemId,
    byOldUniqueCostCode,
    byOldUniqueIdentity,
    byOldNonUniqueKey,
    byOldAnyIdentity,
    byOldAnyLooseIdentity,
    byOldAnyLooseName,
    manualOverrideByIdentity,
    manualOverrideByGroupIdentity,
    manualOverrideByName,
    manualOverrideByGroupName,
    issues,
    summary: {
      uniqueOld: uniqueOld.length,
      uniqueNew: uniqueNew.length,
      nonUniqueOld: nonUniqueOld.length,
      nonUniqueNew: nonUniqueNew.length,
      mappedOldItemIds: byOldItemId.size,
      crosswalkIssues: issues.length,
    },
  };
}

function buildCrosswalk(crosswalkPath: string) {
  return applyBuiltInCrosswalkFallbacks(buildCrosswalkFromWorkbook(XLSX.read(readFileSync(crosswalkPath), { type: "buffer" })));
}

function buildCrosswalkFromBase64(base64: string) {
  return applyBuiltInCrosswalkFallbacks(buildCrosswalkFromWorkbook(XLSX.read(Buffer.from(base64, "base64"), { type: "buffer" })));
}

function applyBuiltInCrosswalkFallbacks(crosswalk: ReturnType<typeof buildCrosswalkFromWorkbook>) {
  const oldItemId = "38975960";
  if (!crosswalk.byOldItemId.has(oldItemId)) {
    const mapping = {
      old: {
        ItemId: oldItemId,
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
    };
    crosswalk.byOldItemId.set(oldItemId, mapping);
    const key = nonUniqueKey(mapping.old);
    crosswalk.byOldNonUniqueKey.set(key, [mapping]);
    appendMapping(crosswalk.byOldAnyIdentity, itemIdentityKey(mapping.old), mapping);
    appendMapping(crosswalk.byOldAnyLooseIdentity, itemIdentityLooseKey(mapping.old), mapping);
    appendMapping(crosswalk.byOldAnyLooseName, itemNameLooseKey(mapping.old), mapping);
    crosswalk.summary.mappedOldItemIds = crosswalk.byOldItemId.size;
  }
  return crosswalk;
}

function applyMappingOverrides(
  crosswalk: ReturnType<typeof buildCrosswalk>,
  overrides: unknown
) {
  const rows = Array.isArray(overrides) ? overrides : [];
  let applied = 0;
  const skipped: UnknownRecord[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const oldItemId = readStr(row.oldItemId || row.old_item_id || row.sourceItemId || row.source_item_id);
    const newItemId = readStr(row.newItemId || row.new_item_id || row.targetItemId || row.target_item_id);
    const oldName = readStr(row.oldName || row.sourceName || row.name);
    const oldDescription = readStr(row.oldDescription || row.sourceDescription);
    const oldCostCode = readStr(row.oldCostCode || row.sourceCostCode || row.costCode || row.cost_code);
    const oldCostName = readStr(row.oldCostName || row.sourceCostName || row.costName || row.cost_name);
    const oldGroupId = readStr(row.oldGroupId || row.groupId || row.sourceGroupId || row.group_id);
    if (!newItemId) {
      skipped.push({ row, issue: "missing_new_item_id" });
      continue;
    }
    if (!oldItemId && !oldName && !oldDescription) {
      skipped.push({ row, issue: "missing_old_selector_or_item_id" });
      continue;
    }

    const mapping = {
      old: {
        ...(oldItemId ? { ItemId: oldItemId } : {}),
        ...(oldName ? { Name: oldName } : {}),
        ...(oldDescription ? { Description: oldDescription } : {}),
        ...(oldCostCode ? { "Cost Code": oldCostCode } : {}),
        ...(oldCostName ? { "Cost Name": oldCostName } : {}),
      },
      new: {
        ItemId: newItemId,
        Name: readStr(row.newName || row.name),
        "Cost Code": readStr(row.newCostCode || row.costCode || row.cost_code),
        "Cost Name": readStr(row.newCostName || row.costName || row.cost_name),
        "Cost code type": readStr(row.costCodeType || row.cost_code_type),
        Description: readStr(row.newDescription || row.description),
      },
      strategy: "manual_override",
    };

    if (oldItemId) {
      crosswalk.byOldItemId.set(oldItemId, mapping);
    }
    if (isRecord(mapping.old)) {
      appendMapping(crosswalk.byOldAnyIdentity, itemIdentityKey(mapping.old), mapping);
      appendMapping(crosswalk.byOldAnyLooseIdentity, itemIdentityLooseKey(mapping.old), mapping);
      appendMapping(crosswalk.byOldAnyLooseName, itemNameLooseKey(mapping.old), mapping);
      const looseIdentity = itemIdentityLooseKey(mapping.old);
      if (looseIdentity) {
        crosswalk.manualOverrideByIdentity.set(looseIdentity, mapping);
        if (oldGroupId) {
          crosswalk.manualOverrideByGroupIdentity.set(`${oldGroupId}|${looseIdentity}`, mapping);
        }
      }
      const looseName = itemNameLooseKey(mapping.old);
      if (looseName) {
        crosswalk.manualOverrideByName.set(looseName, mapping);
        if (oldGroupId) {
          crosswalk.manualOverrideByGroupName.set(`${oldGroupId}|${looseName}`, mapping);
        }
      }
    }
    applied += 1;
  }
  return { applied, skipped };
}

function lineItemOldCostItemId(lineItem: UnknownRecord): string {
  const costItem = isRecord(lineItem.cost_item) ? lineItem.cost_item : {};
  const directId = readStr(costItem.id || costItem.item_id || lineItem.cost_item_id || lineItem.item_id);
  if (directId && directId !== "0") return directId;
  return readStr(costItem.based_on_item_id || costItem.basedOnItemId);
}

function readCostCodeValue(value: unknown): string {
  if (isRecord(value)) {
    return readStr(value.code || value.name || value.value);
  }
  return readStr(value);
}

function lineItemOldCrosswalkRow(lineItem: UnknownRecord): UnknownRecord {
  const costItem = isRecord(lineItem.cost_item) ? lineItem.cost_item : {};
  const costCode = isRecord(lineItem.cost_code) ? lineItem.cost_code : {};
  return {
    Name: readStr(costItem.name || lineItem.name),
    "Cost Code": readCostCodeValue(lineItem.cost_code || lineItem.costCode || lineItem.cost_code_code),
    "Cost Name": readStr(costCode.name || lineItem.cost_code_name || lineItem.costName),
    Description: readStr(costItem.description || lineItem.description),
  };
}

function mappingOldCostCode(mapping: UnknownRecord): string {
  const oldRow = isRecord(mapping.old) ? mapping.old : {};
  return norm(oldRow["Cost Code"]);
}

function chooseByGroupCostCodeHint(matches: UnknownRecord[], groupCostCodeHint: string): UnknownRecord | null {
  if (!groupCostCodeHint || matches.length < 2) return null;
  const hinted = matches.filter((entry) => mappingOldCostCode(entry) === groupCostCodeHint);
  return hinted.length === 1 ? hinted[0] : null;
}

function mappingOldCostName(mapping: UnknownRecord): string {
  const oldRow = isRecord(mapping.old) ? mapping.old : {};
  return norm(oldRow["Cost Name"]);
}

function guessGroupCostNameHint(groupName: string): string {
  const value = norm(groupName);
  if (!value) return "";
  if (/\bsog\b|slab on grade/.test(value)) return "sog rebar material";
  if (/\bsite\b/.test(value)) return "site rebar material";
  if (/\bwall\b|wf\d/.test(value)) return "wall rebar material";
  if (/\bfooting\b|\bspread\b|\bmat\b|foundation/.test(value)) return "foundation rebar material";
  return "";
}

function chooseByGroupNameCostNameHint(matches: UnknownRecord[], groupNameHint: string): UnknownRecord | null {
  if (!groupNameHint || matches.length < 2) return null;
  const costNameHint = guessGroupCostNameHint(groupNameHint);
  if (!costNameHint) return null;
  const hinted = matches.filter((entry) => mappingOldCostName(entry) === costNameHint);
  return hinted.length === 1 ? hinted[0] : null;
}

function buildGroupCostCodeHints(
  mappedLineItems: Array<{ lineItem: UnknownRecord; mapping: UnknownRecord | null }>
): Map<string, string> {
  const perGroup = new Map<string, Map<string, number>>();
  for (const entry of mappedLineItems) {
    if (!isRecord(entry.mapping)) continue;
    const groupId = lineItemGroupId(entry.lineItem);
    if (!groupId) continue;
    const costCode = mappingOldCostCode(entry.mapping);
    if (!costCode) continue;
    const bucket = perGroup.get(groupId) || new Map<string, number>();
    bucket.set(costCode, (bucket.get(costCode) || 0) + 1);
    perGroup.set(groupId, bucket);
  }

  const hints = new Map<string, string>();
  for (const [groupId, bucket] of perGroup.entries()) {
    const sorted = [...bucket.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) continue;
    const [topCode, topCount] = sorted[0];
    const tied = sorted.filter((entry) => entry[1] === topCount);
    if (tied.length === 1) hints.set(groupId, topCode);
  }
  return hints;
}

function resolveLineItemMapping(
  lineItem: UnknownRecord,
  crosswalk: ReturnType<typeof buildCrosswalk>,
  groupId = "",
  groupCostCodeHint = "",
  groupNameHint = ""
) {
  const oldRow = lineItemOldCrosswalkRow(lineItem);
  const manualLooseIdentityKey = itemIdentityLooseKey(oldRow);
  const manualLooseNameKey = itemNameLooseKey(oldRow);
  if (groupId && manualLooseIdentityKey) {
    const groupOverride = crosswalk.manualOverrideByGroupIdentity.get(`${groupId}|${manualLooseIdentityKey}`);
    if (groupOverride) {
      return {
        mapping: groupOverride,
        strategy: "manual_override_group_identity",
        oldCostItemId: lineItemOldCostItemId(lineItem),
        groupId,
        manualLooseIdentityKey,
      };
    }
  }
  if (groupId && manualLooseNameKey) {
    const groupNameOverride = crosswalk.manualOverrideByGroupName.get(`${groupId}|${manualLooseNameKey}`);
    if (groupNameOverride) {
      return {
        mapping: groupNameOverride,
        strategy: "manual_override_group_name",
        oldCostItemId: lineItemOldCostItemId(lineItem),
        groupId,
        manualLooseNameKey,
      };
    }
  }
  if (manualLooseIdentityKey) {
    const manualOverride = crosswalk.manualOverrideByIdentity.get(manualLooseIdentityKey);
    if (manualOverride) {
      return {
        mapping: manualOverride,
        strategy: "manual_override_identity",
        oldCostItemId: lineItemOldCostItemId(lineItem),
        manualLooseIdentityKey,
      };
    }
  }
  if (manualLooseNameKey) {
    const manualNameOverride = crosswalk.manualOverrideByName.get(manualLooseNameKey);
    if (manualNameOverride) {
      return {
        mapping: manualNameOverride,
        strategy: "manual_override_name",
        oldCostItemId: lineItemOldCostItemId(lineItem),
        manualLooseNameKey,
      };
    }
  }

  const oldCostItemId = lineItemOldCostItemId(lineItem);
  if (oldCostItemId) {
    const byId = crosswalk.byOldItemId.get(oldCostItemId);
    if (byId) return { mapping: byId, strategy: "old_item_id", oldCostItemId };
  }

  const compositeKey = nonUniqueKey(oldRow);
  const nonUniqueMatches = crosswalk.byOldNonUniqueKey.get(compositeKey) || [];
  if (nonUniqueMatches.length === 1) {
    return { mapping: nonUniqueMatches[0], strategy: "line_item_composite", oldCostItemId, compositeKey };
  }

  const costCode = norm(oldRow["Cost Code"]);
  const uniqueMatches = crosswalk.byOldUniqueCostCode.get(costCode) || [];
  if (uniqueMatches.length === 1) {
    return { mapping: uniqueMatches[0], strategy: "line_item_unique_cost_code", oldCostItemId, costCode };
  }

  const identityKey = itemIdentityKey(oldRow);
  const uniqueIdentityMatches = crosswalk.byOldUniqueIdentity.get(identityKey) || [];
  if (uniqueIdentityMatches.length === 1) {
    return { mapping: uniqueIdentityMatches[0], strategy: "line_item_unique_identity", oldCostItemId, identityKey };
  }

  // Fallback only when the source line item is missing both stable mapping keys.
  if (!oldCostItemId && !costCode) {
    const anyIdentityMatches = crosswalk.byOldAnyIdentity.get(identityKey) || [];
    if (anyIdentityMatches.length === 1) {
      return { mapping: anyIdentityMatches[0], strategy: "line_item_any_identity", oldCostItemId, identityKey };
    }
    const hintedIdentity = chooseByGroupCostCodeHint(anyIdentityMatches, groupCostCodeHint);
    if (hintedIdentity) {
      return {
        mapping: hintedIdentity,
        strategy: "line_item_any_identity_group_cost_code_hint",
        oldCostItemId,
        identityKey,
        groupCostCodeHint,
      };
    }
    const groupNameHintedIdentity = chooseByGroupNameCostNameHint(anyIdentityMatches, groupNameHint);
    if (groupNameHintedIdentity) {
      return {
        mapping: groupNameHintedIdentity,
        strategy: "line_item_any_identity_group_name_hint",
        oldCostItemId,
        identityKey,
        groupNameHint,
      };
    }

    const looseIdentityKey = itemIdentityLooseKey(oldRow);
    const anyLooseIdentityMatches = crosswalk.byOldAnyLooseIdentity.get(looseIdentityKey) || [];
    if (anyLooseIdentityMatches.length === 1) {
      return {
        mapping: anyLooseIdentityMatches[0],
        strategy: "line_item_any_loose_identity",
        oldCostItemId,
        looseIdentityKey,
      };
    }
    const hintedLooseIdentity = chooseByGroupCostCodeHint(anyLooseIdentityMatches, groupCostCodeHint);
    if (hintedLooseIdentity) {
      return {
        mapping: hintedLooseIdentity,
        strategy: "line_item_any_loose_identity_group_cost_code_hint",
        oldCostItemId,
        looseIdentityKey,
        groupCostCodeHint,
      };
    }
    const groupNameHintedLooseIdentity = chooseByGroupNameCostNameHint(anyLooseIdentityMatches, groupNameHint);
    if (groupNameHintedLooseIdentity) {
      return {
        mapping: groupNameHintedLooseIdentity,
        strategy: "line_item_any_loose_identity_group_name_hint",
        oldCostItemId,
        looseIdentityKey,
        groupNameHint,
      };
    }

    const looseNameKey = itemNameLooseKey(oldRow);
    const anyLooseNameMatches = crosswalk.byOldAnyLooseName.get(looseNameKey) || [];
    if (anyLooseNameMatches.length === 1) {
      return { mapping: anyLooseNameMatches[0], strategy: "line_item_any_loose_name", oldCostItemId, looseNameKey };
    }
    const hintedLooseName = chooseByGroupCostCodeHint(anyLooseNameMatches, groupCostCodeHint);
    if (hintedLooseName) {
      return {
        mapping: hintedLooseName,
        strategy: "line_item_any_loose_name_group_cost_code_hint",
        oldCostItemId,
        looseNameKey,
        groupCostCodeHint,
      };
    }
    const groupNameHintedLooseName = chooseByGroupNameCostNameHint(anyLooseNameMatches, groupNameHint);
    if (groupNameHintedLooseName) {
      return {
        mapping: groupNameHintedLooseName,
        strategy: "line_item_any_loose_name_group_name_hint",
        oldCostItemId,
        looseNameKey,
        groupNameHint,
      };
    }
  }

  return {
    mapping: null,
    strategy: "missing",
    oldCostItemId,
    compositeKey,
    costCode,
    nonUniqueMatchCount: nonUniqueMatches.length,
    uniqueMatchCount: uniqueMatches.length,
    uniqueIdentityMatchCount: uniqueIdentityMatches.length,
    inferredOldRow: oldRow,
  };
}

function lineItemGroupId(lineItem: UnknownRecord): string {
  return readStr(lineItem.group_id || lineItem.groupId || lineItem.line_item_group_id);
}

function buildProposalPayload(sourceProposal: UnknownRecord, targetProposalName: string, targetProposalType: string): UnknownRecord {
  const description = readStr(sourceProposal.description);
  const sourceType = readStr(sourceProposal.type || sourceProposal.proposal_type || sourceProposal.estimate_type);
  const type = targetProposalType && targetProposalType !== "SOURCE" ? targetProposalType : sourceType;
  return {
    name: targetProposalName || `${readStr(sourceProposal.name || sourceProposal.title) || "Cloned Proposal"} (Cloned)`,
    ...(type ? { type } : {}),
    ...(description ? { description } : {}),
  };
}

const CREATE_OMIT_KEYS = new Set([
  "id",
  "line_item_id",
  "lineItemId",
  "line_item_group_id",
  "lineItemGroupId",
  "group_id",
  "groupId",
  "proposal_id",
  "proposalId",
  "bid_board_project_id",
  "bidBoardProjectId",
  "project_id",
  "projectId",
  "company_id",
  "companyId",
  "created_at",
  "createdAt",
  "updated_at",
  "updatedAt",
  "deleted_at",
  "deletedAt",
  "synced_at",
  "syncedAt",
  "url",
  "links",
  "_links",
]);

function cloneForCreate(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneForCreate);
  if (!isRecord(value)) return value;

  const next: UnknownRecord = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (CREATE_OMIT_KEYS.has(key)) continue;
    if (nestedValue === null || nestedValue === undefined) continue;
    next[key] = cloneForCreate(nestedValue);
  }
  return next;
}

function buildGroupPayload(group: UnknownRecord): UnknownRecord {
  const cloned = cloneForCreate(group);
  const payload = isRecord(cloned) ? cloned : {};
  payload.name = readStr(payload.name || group.name) || "Imported Group";
  return payload;
}

function copyPricingField(target: UnknownRecord, key: string, ...sources: unknown[]) {
  for (const source of sources) {
    const value = readNum(source);
    if (value !== undefined) {
      target[key] = value;
      return;
    }
  }
}

function buildLineItemPayload(params: {
  lineItem: UnknownRecord;
  mapping: UnknownRecord;
  groupIdMap: Map<string, string>;
}) {
  const { lineItem, mapping, groupIdMap } = params;
  const newRow = isRecord(mapping.new) ? mapping.new : {};
  const oldGroupId = lineItemGroupId(lineItem);
  const sourceCostItem = isRecord(lineItem.cost_item) ? lineItem.cost_item : {};
  const cloned = cloneForCreate(lineItem);
  const payload = isRecord(cloned) ? cloned : {};
  const clonedCostItem = cloneForCreate(sourceCostItem);
  const costItemPayload = isRecord(clonedCostItem) ? clonedCostItem : {};
  const newItemId = readStr(newRow.ItemId);

  payload.name = readStr(payload.name || lineItem.name || sourceCostItem.name || newRow.Name) || "Imported Line Item";
  costItemPayload.id = newItemId;
  costItemPayload.based_on_item_id = newItemId;
  costItemPayload.name = readStr(costItemPayload.name || sourceCostItem.name || newRow.Name);
  costItemPayload.description = readStr(costItemPayload.description || sourceCostItem.description || newRow.Description);
  costItemPayload.type = readStr(costItemPayload.type || sourceCostItem.type || sourceCostItem.item_type || "Custom");
  payload.cost_item = costItemPayload;

  const clonedCostCode = isRecord(payload.cost_code) ? payload.cost_code : {};
  const newCostCode = readStr(newRow["Cost Code"]);
  const newCostName = readStr(newRow["Cost Name"]);
  payload.cost_code = {
    ...clonedCostCode,
    ...(newCostCode ? { code: newCostCode } : {}),
    ...(newCostName ? { name: newCostName } : {}),
  };

  const mappedGroupId = oldGroupId ? groupIdMap.get(oldGroupId) : "";
  if (mappedGroupId) payload.group_id = mappedGroupId;

  const costCodeType = readStr(newRow["Cost code type"]);
  if (costCodeType) payload.cost_code_type = costCodeType;

  const existingPricingOverride = isRecord(payload.pricing_override) ? payload.pricing_override : {};
  const pricingOverride: UnknownRecord = { ...existingPricingOverride };
  copyPricingField(pricingOverride, "unit_material_cost", lineItem.unit_material_cost, lineItem.unitMaterialCost, sourceCostItem.unit_cost);
  copyPricingField(pricingOverride, "material_margin", lineItem.material_margin, lineItem.materialMargin, sourceCostItem.material_margin, sourceCostItem.item_margin);
  copyPricingField(pricingOverride, "item_margin", lineItem.item_margin, lineItem.itemMargin, sourceCostItem.item_margin);
  copyPricingField(pricingOverride, "unit_labor", lineItem.unit_labor, lineItem.unitLabor, sourceCostItem.unit_labor);
  copyPricingField(pricingOverride, "labor_factor", lineItem.labor_factor, lineItem.laborFactor);
  copyPricingField(pricingOverride, "unit_labor_rate", lineItem.unit_labor_rate, lineItem.unitLaborRate, sourceCostItem.unit_labor_rate);
  copyPricingField(pricingOverride, "unit_labor_cost", lineItem.unit_labor_cost, lineItem.unitLaborCost, sourceCostItem.unit_labor_cost);
  copyPricingField(pricingOverride, "labor_margin", lineItem.labor_margin, lineItem.laborMargin, sourceCostItem.labor_margin);
  if (typeof sourceCostItem.is_untaxed === "boolean" && typeof pricingOverride.is_untaxed !== "boolean") {
    pricingOverride.is_untaxed = sourceCostItem.is_untaxed;
  }
  if (Object.keys(pricingOverride).length > 0) {
    payload.pricing_override = pricingOverride;
  }

  copyPricingField(payload, "ci_item_margin", lineItem.ci_item_margin, lineItem.item_margin, lineItem.itemMargin, sourceCostItem.item_margin);
  copyPricingField(payload, "ci_labor_margin", lineItem.ci_labor_margin, lineItem.labor_margin, lineItem.laborMargin, sourceCostItem.labor_margin);
  copyPricingField(payload, "item_margin", lineItem.item_margin, lineItem.itemMargin, sourceCostItem.item_margin);
  copyPricingField(payload, "labor_margin", lineItem.labor_margin, lineItem.laborMargin, sourceCostItem.labor_margin);
  copyPricingField(costItemPayload, "item_margin", lineItem.ci_item_margin, lineItem.item_margin, lineItem.itemMargin, sourceCostItem.item_margin);
  copyPricingField(costItemPayload, "labor_margin", lineItem.ci_labor_margin, lineItem.labor_margin, lineItem.laborMargin, sourceCostItem.labor_margin);
  copyPricingField(costItemPayload, "material_margin", lineItem.material_margin, lineItem.materialMargin, sourceCostItem.material_margin, sourceCostItem.item_margin);

  return payload;
}

async function fetchPaged(params: {
  accessToken: string;
  companyId: string;
  path: string;
  arrayKeys: string[];
}) {
  const rows: unknown[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const separator = params.path.includes("?") ? "&" : "?";
    const payload = await procoreJson({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `${params.path}${separator}page=${page}&per_page=${PROCORE_PAGE_SIZE}`,
    });
    const items = asArray(payload, params.arrayKeys);
    rows.push(...items);
    if (items.length < PROCORE_PAGE_SIZE) break;
  }
  return rows;
}

async function resolveBidBoardProjectId(params: {
  accessToken: string;
  companyId: string;
  candidateId: string;
}) {
  const attempts: UnknownRecord[] = [];
  const showPath = `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/estimating/bid_board_projects/${encodeURIComponent(
    params.candidateId
  )}`;

  try {
    const showPayload = await procoreJson({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: showPath,
      maxRetries: 0,
    });
    const showRecord = isRecord(unwrapData(showPayload)) ? (unwrapData(showPayload) as UnknownRecord) : {};
    const id = readStr(showRecord.id || showRecord.bid_board_project_id || showRecord.bidBoardProjectId);
    attempts.push({ strategy: "show_bid_board_project", path: showPath, ok: true, id: id || null });
    if (id) {
      return {
        bidBoardProjectId: id,
        inputId: params.candidateId,
        resolvedBy: id === params.candidateId ? "bid_board_project_id" : "bid_board_project_show",
        projectId: readStr(showRecord.project_id || showRecord.projectId) || null,
        record: showRecord,
        attempts,
      };
    }
  } catch (error) {
    attempts.push({
      strategy: "show_bid_board_project",
      path: showPath,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  for (let page = 1; page <= 20; page += 1) {
    const listPath = `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/estimating/bid_board_projects?page=${page}&per_page=${PROCORE_PAGE_SIZE}`;
    const payload = await procoreJson({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: listPath,
    });
    const rows = asArray(payload, ["data", "projects", "bid_board_projects"]).filter(isRecord);
    attempts.push({ strategy: "list_bid_board_projects", path: listPath, ok: true, count: rows.length });
    const match = rows.find((row) => {
      const id = readStr(row.id || row.bid_board_project_id || row.bidBoardProjectId);
      const projectId = readStr(row.project_id || row.projectId);
      return id === params.candidateId || projectId === params.candidateId;
    });
    if (match) {
      const id = readStr(match.id || match.bid_board_project_id || match.bidBoardProjectId);
      if (id) {
        return {
          bidBoardProjectId: id,
          inputId: params.candidateId,
          resolvedBy: id === params.candidateId ? "bid_board_project_id_from_list" : "project_id_lookup",
          projectId: readStr(match.project_id || match.projectId) || null,
          record: match,
          attempts,
        };
      }
    }
    if (rows.length < PROCORE_PAGE_SIZE) break;
  }

  return {
    bidBoardProjectId: params.candidateId,
    inputId: params.candidateId,
    resolvedBy: "unresolved",
    projectId: null,
    record: null,
    attempts,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const { accessToken, tokenSource } = await getToken(body.accessToken);

    const sourceCompanyId = readStr(body.sourceCompanyId || body.companyId || procoreConfig.companyId);
    const sourceProjectId = readStr(body.sourceProjectId || body.projectId);
    const sourceBidBoardProjectId = readStr(body.sourceBidBoardProjectId || body.sourceBidBoardId || body.bidBoardProjectId);
    const sourceProposalId = readStr(body.sourceProposalId || body.proposalId);
    const targetCompanyId = readStr(body.targetCompanyId || sourceCompanyId);
    const targetBidBoardProjectIdInput = readStr(body.targetBidBoardProjectId || body.targetBidBoardId);
    const targetProjectId = readStr(body.targetProjectId || body.procoreProjectId);
    const targetProposalName = readStr(body.targetProposalName || body.newProposalName);
    const targetProposalType = readStr(body.targetProposalType || body.proposalType || "SOURCE").toUpperCase();
    const dryRun = body.dryRun !== false;
    const allowPartial = body.allowPartial === true;
    const targetProposalIdFromBody = readStr(body.targetProposalId || body.createdProposalId);
    const lineItemOffset = Math.max(0, readInt(body.lineItemOffset, 0));
    const requestedLineItemLimit = Math.max(1, readInt(body.lineItemLimit, dryRun ? 20 : 1));
    const lineItemLimit = dryRun
      ? Math.min(25, requestedLineItemLimit)
      : Math.min(5, requestedLineItemLimit);
    const continuationGroupIdMap = mapFromObject(body.groupIdMap);
    const crosswalkWorkbookBase64 = readStr(body.crosswalkWorkbookBase64);
    const requestedCrosswalkPath = readStr(body.crosswalkPath || DEFAULT_CROSSWALK_PATH);
    const crosswalkPath = path.isAbsolute(requestedCrosswalkPath)
      ? requestedCrosswalkPath
      : path.join(process.cwd(), requestedCrosswalkPath);

    if (!sourceCompanyId || !sourceProjectId || !sourceProposalId || !targetCompanyId || !targetBidBoardProjectIdInput) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: sourceCompanyId, sourceProjectId, sourceProposalId, targetCompanyId, targetBidBoardProjectId",
        },
        { status: 400 }
      );
    }
    if (!crosswalkWorkbookBase64 && !existsSync(crosswalkPath)) {
      return NextResponse.json({ error: "Crosswalk workbook not found.", crosswalkPath }, { status: 400 });
    }

    const crosswalk = crosswalkWorkbookBase64
      ? buildCrosswalkFromBase64(crosswalkWorkbookBase64)
      : buildCrosswalk(crosswalkPath);
    const mappingOverrides = applyMappingOverrides(crosswalk, body.mappingOverrides);
    const targetBidBoardResolution = await resolveBidBoardProjectId({
      accessToken,
      companyId: targetCompanyId,
      candidateId: targetBidBoardProjectIdInput,
    });
    const targetBidBoardProjectId = targetBidBoardResolution.bidBoardProjectId;
    const sourceProposalPayload = await procoreJson({
      accessToken,
      companyId: sourceCompanyId,
      path: `/rest/v2.0/companies/${encodeURIComponent(sourceCompanyId)}/projects/${encodeURIComponent(
        sourceProjectId
      )}/estimating/proposals/${encodeURIComponent(sourceProposalId)}`,
    });
    const sourceProposal = isRecord(unwrapData(sourceProposalPayload)) ? (unwrapData(sourceProposalPayload) as UnknownRecord) : {};

    const lineItemPaths = [
      ...(sourceBidBoardProjectId
        ? [
            `/rest/v2.0/companies/${encodeURIComponent(sourceCompanyId)}/estimating/bid_board_projects/${encodeURIComponent(
              sourceBidBoardProjectId
            )}/proposals/${encodeURIComponent(sourceProposalId)}/line_items`,
          ]
        : []),
      `/rest/v2.0/companies/${encodeURIComponent(sourceCompanyId)}/projects/${encodeURIComponent(
        sourceProjectId
      )}/estimating/proposals/${encodeURIComponent(sourceProposalId)}/line_items`,
    ];
    const groupPaths = [
      ...(sourceBidBoardProjectId
        ? [
            `/rest/v2.0/companies/${encodeURIComponent(sourceCompanyId)}/estimating/bid_board_projects/${encodeURIComponent(
              sourceBidBoardProjectId
            )}/proposals/${encodeURIComponent(sourceProposalId)}/line_item_groups`,
          ]
        : []),
      `/rest/v2.0/companies/${encodeURIComponent(sourceCompanyId)}/projects/${encodeURIComponent(
        sourceProjectId
      )}/estimating/proposals/${encodeURIComponent(sourceProposalId)}/line_item_groups`,
    ];

    let sourceLineItems: unknown[] = [];
    let sourceGroups: unknown[] = [];
    const fetchAttempts: UnknownRecord[] = [];
    for (const candidatePath of lineItemPaths) {
      try {
        sourceLineItems = await fetchPaged({
          accessToken,
          companyId: sourceCompanyId,
          path: candidatePath,
          arrayKeys: ["data", "line_items", "items"],
        });
        fetchAttempts.push({ kind: "line_items", path: candidatePath, count: sourceLineItems.length, ok: true });
        if (sourceLineItems.length > 0) break;
      } catch (error) {
        fetchAttempts.push({ kind: "line_items", path: candidatePath, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    for (const candidatePath of groupPaths) {
      try {
        sourceGroups = await fetchPaged({
          accessToken,
          companyId: sourceCompanyId,
          path: candidatePath,
          arrayKeys: ["data", "line_item_groups", "groups"],
        });
        fetchAttempts.push({ kind: "groups", path: candidatePath, count: sourceGroups.length, ok: true });
        if (sourceGroups.length > 0) break;
      } catch (error) {
        fetchAttempts.push({ kind: "groups", path: candidatePath, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }

    const sourceGroupRecords = sourceGroups.filter(isRecord);
    const sourceLineItemRecords = sourceLineItems.filter(isRecord);
    const groupPayloads = sourceGroupRecords.map((group) => ({
      oldGroupId: readStr(group.id || group.group_id || group.line_item_group_id),
      name: readStr(group.name),
      payload: buildGroupPayload(group),
    }));
    const groupPayloadByOldId = new Map<string, { oldGroupId: string; name: string; payload: UnknownRecord }>();
    for (const group of groupPayloads) {
      if (group.oldGroupId) groupPayloadByOldId.set(group.oldGroupId, group);
    }

    const groupNameById = new Map<string, string>();
    for (const group of sourceGroupRecords) {
      const id = readStr(group.id || group.group_id || group.line_item_group_id);
      if (id) groupNameById.set(id, readStr(group.name));
    }

    const seedMappedLineItems = sourceLineItemRecords.map((lineItem) => {
      const groupId = lineItemGroupId(lineItem);
      const resolved = resolveLineItemMapping(lineItem, crosswalk, groupId);
      return { lineItem, mapping: resolved.mapping || null };
    });
    const groupCostCodeHints = buildGroupCostCodeHints(seedMappedLineItems);

    const missingMappings: UnknownRecord[] = [];
    const mappedLineItems = sourceLineItemRecords.map((lineItem, index) => {
      const groupId = lineItemGroupId(lineItem);
      const resolved = resolveLineItemMapping(
        lineItem,
        crosswalk,
        groupId,
        groupId ? groupCostCodeHints.get(groupId) || "" : "",
        groupId ? groupNameById.get(groupId) || "" : ""
      );
      const oldCostItemId = resolved.oldCostItemId;
      const mapping = resolved.mapping;
      if (!mapping) {
        missingMappings.push({
          index,
          lineItemId: readStr(lineItem.id || lineItem.line_item_id),
          groupId: groupId || null,
          groupName: groupId ? groupNameById.get(groupId) || null : null,
          groupCostCodeHint: groupId ? groupCostCodeHints.get(groupId) || null : null,
          name: readStr(lineItem.name),
          oldCostItemId,
          matchStrategy: resolved.strategy,
          compositeKey: resolved.compositeKey,
          costCode: resolved.costCode,
          nonUniqueMatchCount: resolved.nonUniqueMatchCount,
          uniqueMatchCount: resolved.uniqueMatchCount,
          uniqueIdentityMatchCount: resolved.uniqueIdentityMatchCount,
          inferredOldRow: resolved.inferredOldRow,
          oldCostItem: isRecord(lineItem.cost_item) ? lineItem.cost_item : null,
          oldCostCode: isRecord(lineItem.cost_code) ? lineItem.cost_code : null,
        });
      }
      return { lineItem, oldCostItemId, mapping: mapping || null, matchStrategy: resolved.strategy };
    });

    const readyForLiveClone = missingMappings.length === 0;
    const proposalPayload = buildProposalPayload(sourceProposal, targetProposalName, targetProposalType);

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        tokenSource,
        readyForLiveClone,
        source: {
          companyId: sourceCompanyId,
          projectId: sourceProjectId,
          bidBoardProjectId: sourceBidBoardProjectId || null,
          proposalId: sourceProposalId,
          proposalName: readStr(sourceProposal.name || sourceProposal.title),
          proposalType: readStr(sourceProposal.type || sourceProposal.proposal_type || sourceProposal.estimate_type) || null,
        },
        target: {
          companyId: targetCompanyId,
          bidBoardProjectId: targetBidBoardProjectId,
          bidBoardProjectInputId: targetBidBoardProjectIdInput,
          bidBoardProjectResolvedBy: targetBidBoardResolution.resolvedBy,
          projectId: targetProjectId || null,
          proposalPayload,
        },
        counts: {
          sourceGroups: sourceGroupRecords.length,
          sourceLineItems: sourceLineItemRecords.length,
          mappedLineItems: mappedLineItems.length - missingMappings.length,
          missingMappings: missingMappings.length,
        },
        crosswalk: crosswalk.summary,
        mappingOverrides,
        crosswalkIssues: crosswalk.issues.slice(0, 25),
        missingMappings: missingMappings.slice(0, 50),
        groupPreview: groupPayloads.slice(0, 10),
        lineItemPreview: mappedLineItems.slice(0, 10).map((entry) => ({
          oldCostItemId: entry.oldCostItemId,
          strategy: entry.matchStrategy,
          oldName: readStr(entry.lineItem.name),
          newItemId: isRecord(entry.mapping) && isRecord(entry.mapping.new) ? readStr(entry.mapping.new.ItemId) : null,
          newName: isRecord(entry.mapping) && isRecord(entry.mapping.new) ? readStr(entry.mapping.new.Name) : null,
          newCostCode: isRecord(entry.mapping) && isRecord(entry.mapping.new) ? readStr(entry.mapping.new["Cost Code"]) : null,
        })),
        fetchAttempts,
        targetBidBoardResolution,
      });
    }

    if (sourceLineItemRecords.length === 0) {
      const retryContinuation = targetProposalIdFromBody && lineItemOffset > 0
        ? {
            targetProposalId: targetProposalIdFromBody,
            groupIdMap: objectFromMap(continuationGroupIdMap),
            lineItemOffset,
            lineItemLimit,
          }
        : null;
      return NextResponse.json(
        {
          error: "Source proposal line items returned empty.",
          details:
            "A live clone cannot safely treat an empty source fetch as complete. Retry the same continuation offset.",
          retryable: true,
          dryRun: false,
          tokenSource,
          batch: {
            lineItemOffset,
            lineItemLimit,
            attemptedLineItems: 0,
            nextLineItemOffset: lineItemOffset,
            hasMoreLineItems: Boolean(retryContinuation),
            continueRequest: retryContinuation,
          },
          source: {
            companyId: sourceCompanyId,
            projectId: sourceProjectId,
            bidBoardProjectId: sourceBidBoardProjectId || null,
            proposalId: sourceProposalId,
          },
          target: {
            companyId: targetCompanyId,
            bidBoardProjectId: targetBidBoardProjectId,
            bidBoardProjectInputId: targetBidBoardProjectIdInput,
            bidBoardProjectResolvedBy: targetBidBoardResolution.resolvedBy,
            projectId: targetProjectId || null,
            proposalId: targetProposalIdFromBody || null,
          },
          counts: {
            sourceGroups: sourceGroupRecords.length,
            sourceLineItems: 0,
            cloneableLineItems: 0,
            createdLineItems: 0,
            failedLineItems: 0,
            skippedMissingMappings: 0,
          },
          fetchAttempts,
          targetBidBoardResolution,
        },
        { status: 503 }
      );
    }

    if (!readyForLiveClone && !allowPartial) {
      return NextResponse.json(
        {
          error: "Live clone blocked by missing cost item mappings.",
          readyForLiveClone,
          missingMappings,
          counts: {
            sourceGroups: sourceGroupRecords.length,
            sourceLineItems: sourceLineItemRecords.length,
          mappedLineItems: mappedLineItems.length - missingMappings.length,
            missingMappings: missingMappings.length,
          },
        },
        { status: 409 }
      );
    }

    let createdProposalPayload: unknown = null;
    let createdProposal: UnknownRecord = {};
    let createdProposalId = targetProposalIdFromBody;
    if (!createdProposalId) {
      createdProposalPayload = await procoreJson({
        accessToken,
        companyId: targetCompanyId,
        method: "POST",
        path: `/rest/v2.0/companies/${encodeURIComponent(targetCompanyId)}/estimating/bid_board_projects/${encodeURIComponent(
          targetBidBoardProjectId
        )}/proposals`,
        body: proposalPayload,
      });
      createdProposal = isRecord(unwrapData(createdProposalPayload)) ? (unwrapData(createdProposalPayload) as UnknownRecord) : {};
      createdProposalId = readStr(createdProposal.id || createdProposal.proposal_id);
    } else {
      createdProposalPayload = { resumed: true, id: createdProposalId };
      createdProposal = { id: createdProposalId };
    }
    if (!createdProposalId) {
      return NextResponse.json(
        { error: "Created proposal response did not include an id.", createdProposalPayload },
        { status: 502 }
      );
    }

    const groupIdMap = new Map<string, string>(continuationGroupIdMap);
    const createdGroups: UnknownRecord[] = [];

    const ensureGroupCreated = async (oldGroupId: string): Promise<string> => {
      if (!oldGroupId) return "";
      const existing = groupIdMap.get(oldGroupId);
      if (existing) return existing;

      const group = groupPayloadByOldId.get(oldGroupId);
      if (!group) return "";

      if (createdGroups.length > 0) await sleep(200);
      const payload = await procoreJson({
        accessToken,
        companyId: targetCompanyId,
        method: "POST",
        path: `/rest/v2.0/companies/${encodeURIComponent(targetCompanyId)}/estimating/bid_board_projects/${encodeURIComponent(
          targetBidBoardProjectId
        )}/proposals/${encodeURIComponent(createdProposalId)}/line_item_groups`,
        body: group.payload,
      });
      const created = isRecord(unwrapData(payload)) ? (unwrapData(payload) as UnknownRecord) : {};
      const createdGroupId = readStr(created.id || created.group_id || created.line_item_group_id);
      if (createdGroupId) {
        groupIdMap.set(oldGroupId, createdGroupId);
      }
      createdGroups.push({ oldGroupId: group.oldGroupId, newGroupId: createdGroupId || null, payload });
      return createdGroupId;
    };

    const cloneableLineItems = mappedLineItems.filter((entry) => isRecord(entry.mapping));
    const batchLineItems = cloneableLineItems.slice(lineItemOffset, lineItemOffset + lineItemLimit);
    const createdLineItems: UnknownRecord[] = [];
    const failedLineItems: UnknownRecord[] = [];
    let attemptedLineItems = 0;
    let rateLimitPause: UnknownRecord | null = null;
    for (const entry of batchLineItems) {
      if (!isRecord(entry.mapping)) continue;
      if (createdLineItems.length > 0) await sleep(750);

      const oldGroupId = lineItemGroupId(entry.lineItem);
      if (oldGroupId && !groupIdMap.has(oldGroupId)) {
        try {
          await ensureGroupCreated(oldGroupId);
        } catch (error) {
          failedLineItems.push({
            oldLineItemId: readStr(entry.lineItem.id || entry.lineItem.line_item_id),
            oldCostItemId: entry.oldCostItemId,
            oldGroupId,
            error: error instanceof Error ? error.message : String(error),
            stage: "ensure_group",
            rateLimited: isRateLimitError(error),
          });
          if (!allowPartial || isRateLimitError(error)) {
            if (isRateLimitError(error)) {
              const resumeOffset = lineItemOffset + Math.max(0, attemptedLineItems);
              rateLimitPause = {
                targetProposalId: createdProposalId,
                groupIdMap: objectFromMap(groupIdMap),
                lineItemOffset: resumeOffset,
                lineItemLimit,
              };
            }
            break;
          }
          continue;
        }
      }

      const payload = buildLineItemPayload({ lineItem: entry.lineItem, mapping: entry.mapping, groupIdMap });
      attemptedLineItems += 1;
      try {
        const created = await procoreJson({
          accessToken,
          companyId: targetCompanyId,
          method: "POST",
          path: `/rest/v2.0/companies/${encodeURIComponent(targetCompanyId)}/estimating/bid_board_projects/${encodeURIComponent(
            targetBidBoardProjectId
          )}/proposals/${encodeURIComponent(createdProposalId)}/line_items`,
          body: payload,
        });
        createdLineItems.push({
          oldLineItemId: readStr(entry.lineItem.id || entry.lineItem.line_item_id),
          oldCostItemId: entry.oldCostItemId,
          newCostItemId: isRecord(entry.mapping.new) ? readStr(entry.mapping.new.ItemId) : null,
          attemptedPayload: payload,
          created,
        });
      } catch (error) {
        const rateLimited = isRateLimitError(error);
        const resumeOffset = lineItemOffset + Math.max(0, attemptedLineItems - 1);
        failedLineItems.push({
          oldLineItemId: readStr(entry.lineItem.id || entry.lineItem.line_item_id),
          oldCostItemId: entry.oldCostItemId,
          attemptedPayload: payload,
          error: error instanceof Error ? error.message : String(error),
          rateLimited,
        });
        if (rateLimited) {
          rateLimitPause = {
            targetProposalId: createdProposalId,
            groupIdMap: objectFromMap(groupIdMap),
            lineItemOffset: resumeOffset,
            lineItemLimit,
          };
          break;
        }
        if (!allowPartial) break;
      }
    }
    const nextLineItemOffset = rateLimitPause
      ? readInt(rateLimitPause.lineItemOffset, lineItemOffset)
      : lineItemOffset + batchLineItems.length;
    const hasMoreLineItems = nextLineItemOffset < cloneableLineItems.length;
    const continueRequest = rateLimitPause || (hasMoreLineItems
      ? {
          targetProposalId: createdProposalId,
          groupIdMap: objectFromMap(groupIdMap),
          lineItemOffset: nextLineItemOffset,
          lineItemLimit,
        }
      : null);

    return NextResponse.json({
      success: failedLineItems.length === 0,
      rateLimited: Boolean(rateLimitPause),
      resumeAvailable: Boolean(continueRequest),
      statusMessage: rateLimitPause
        ? `Paused after Procore rate limit. Continue at line offset ${nextLineItemOffset}.`
        : undefined,
      dryRun: false,
      tokenSource,
      batch: {
        lineItemOffset,
        lineItemLimit,
        attemptedLineItems,
        nextLineItemOffset,
        hasMoreLineItems,
        continueRequest,
      },
      source: {
        companyId: sourceCompanyId,
        projectId: sourceProjectId,
        bidBoardProjectId: sourceBidBoardProjectId || null,
        proposalId: sourceProposalId,
      },
      target: {
        companyId: targetCompanyId,
        bidBoardProjectId: targetBidBoardProjectId,
        bidBoardProjectInputId: targetBidBoardProjectIdInput,
        bidBoardProjectResolvedBy: targetBidBoardResolution.resolvedBy,
        projectId: targetProjectId || null,
        proposalId: createdProposalId,
      },
      counts: {
        sourceGroups: sourceGroupRecords.length,
        createdGroups: createdGroups.length,
        sourceLineItems: sourceLineItemRecords.length,
        cloneableLineItems: cloneableLineItems.length,
        createdLineItems: createdLineItems.length,
        failedLineItems: failedLineItems.length,
        attemptedLineItems,
        nextLineItemOffset,
        skippedMissingMappings: missingMappings.length,
      },
      mappingOverrides,
      proposal: createdProposalPayload,
      createdGroups,
      createdLineItems,
      failedLineItems,
      missingMappings,
      fetchAttempts,
      targetBidBoardResolution,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to clone estimating proposal.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
