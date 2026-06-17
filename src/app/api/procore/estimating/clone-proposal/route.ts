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

function nonUniqueKey(row: UnknownRecord): string {
  return [row.Name, row.Description, row["Cost Name"]].map(norm).join("|");
}

function itemIdentityKey(row: UnknownRecord): string {
  return [row.Name, row.Description].map(norm).join("|");
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
    if (response.status !== 429 || attempt >= maxRetries) break;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 2500 + attempt * 2500;
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
    throw new Error(`Procore ${method} ${params.path} failed (${finalResponse.status}): ${message}`);
  }
  return payload;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return buildCrosswalkFromWorkbook(XLSX.read(readFileSync(crosswalkPath), { type: "buffer" }));
}

function buildCrosswalkFromBase64(base64: string) {
  return buildCrosswalkFromWorkbook(XLSX.read(Buffer.from(base64, "base64"), { type: "buffer" }));
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
    if (!oldItemId || !newItemId) {
      skipped.push({ row, issue: "missing_old_or_new_item_id" });
      continue;
    }
    crosswalk.byOldItemId.set(oldItemId, {
      old: { ItemId: oldItemId },
      new: {
        ItemId: newItemId,
        Name: readStr(row.newName || row.name),
        "Cost Code": readStr(row.newCostCode || row.costCode || row.cost_code),
        "Cost Name": readStr(row.newCostName || row.costName || row.cost_name),
        "Cost code type": readStr(row.costCodeType || row.cost_code_type),
        Description: readStr(row.newDescription || row.description),
      },
      strategy: "manual_override",
    });
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

function resolveLineItemMapping(
  lineItem: UnknownRecord,
  crosswalk: ReturnType<typeof buildCrosswalk>
) {
  const oldCostItemId = lineItemOldCostItemId(lineItem);
  if (oldCostItemId) {
    const byId = crosswalk.byOldItemId.get(oldCostItemId);
    if (byId) return { mapping: byId, strategy: "old_item_id", oldCostItemId };
  }

  const oldRow = lineItemOldCrosswalkRow(lineItem);
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

function buildProposalPayload(sourceProposal: UnknownRecord, targetProposalName: string): UnknownRecord {
  const description = readStr(sourceProposal.description);
  return {
    name: targetProposalName || `${readStr(sourceProposal.name || sourceProposal.title) || "Cloned Proposal"} (Cloned)`,
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
      path: `${params.path}${separator}page=${page}&per_page=200`,
    });
    const items = asArray(payload, params.arrayKeys);
    rows.push(...items);
    if (items.length < 200) break;
  }
  return rows;
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
    const targetBidBoardProjectId = readStr(body.targetBidBoardProjectId || body.targetBidBoardId);
    const targetProjectId = readStr(body.targetProjectId || body.procoreProjectId);
    const targetProposalName = readStr(body.targetProposalName || body.newProposalName);
    const dryRun = body.dryRun !== false;
    const allowPartial = body.allowPartial === true;
    const crosswalkWorkbookBase64 = readStr(body.crosswalkWorkbookBase64);
    const requestedCrosswalkPath = readStr(body.crosswalkPath || DEFAULT_CROSSWALK_PATH);
    const crosswalkPath = path.isAbsolute(requestedCrosswalkPath)
      ? requestedCrosswalkPath
      : path.join(process.cwd(), requestedCrosswalkPath);

    if (!sourceCompanyId || !sourceProjectId || !sourceProposalId || !targetCompanyId || !targetBidBoardProjectId) {
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

    const missingMappings: UnknownRecord[] = [];
    const mappedLineItems = sourceLineItemRecords.map((lineItem, index) => {
      const resolved = resolveLineItemMapping(lineItem, crosswalk);
      const oldCostItemId = resolved.oldCostItemId;
      const mapping = resolved.mapping;
      if (!mapping) {
        missingMappings.push({
          index,
          lineItemId: readStr(lineItem.id || lineItem.line_item_id),
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
    const proposalPayload = buildProposalPayload(sourceProposal, targetProposalName);

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
        },
        target: {
          companyId: targetCompanyId,
          bidBoardProjectId: targetBidBoardProjectId,
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
      });
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

    const createdProposalPayload = await procoreJson({
      accessToken,
      companyId: targetCompanyId,
      method: "POST",
      path: `/rest/v2.0/companies/${encodeURIComponent(targetCompanyId)}/estimating/bid_board_projects/${encodeURIComponent(
        targetBidBoardProjectId
      )}/proposals`,
      body: proposalPayload,
    });
    const createdProposal = isRecord(unwrapData(createdProposalPayload)) ? (unwrapData(createdProposalPayload) as UnknownRecord) : {};
    const createdProposalId = readStr(createdProposal.id || createdProposal.proposal_id);
    if (!createdProposalId) {
      return NextResponse.json(
        { error: "Created proposal response did not include an id.", createdProposalPayload },
        { status: 502 }
      );
    }

    const groupIdMap = new Map<string, string>();
    const createdGroups: UnknownRecord[] = [];
    for (const group of groupPayloads) {
      if (createdGroups.length > 0) await sleep(350);
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
      if (group.oldGroupId && createdGroupId) groupIdMap.set(group.oldGroupId, createdGroupId);
      createdGroups.push({ oldGroupId: group.oldGroupId, newGroupId: createdGroupId, payload });
    }

    const createdLineItems: UnknownRecord[] = [];
    const failedLineItems: UnknownRecord[] = [];
    for (const entry of mappedLineItems) {
      if (!isRecord(entry.mapping)) continue;
      if (createdLineItems.length > 0) await sleep(750);
      const payload = buildLineItemPayload({ lineItem: entry.lineItem, mapping: entry.mapping, groupIdMap });
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
          created,
        });
      } catch (error) {
        failedLineItems.push({
          oldLineItemId: readStr(entry.lineItem.id || entry.lineItem.line_item_id),
          oldCostItemId: entry.oldCostItemId,
          attemptedPayload: payload,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!allowPartial) break;
      }
    }

    return NextResponse.json({
      success: failedLineItems.length === 0,
      dryRun: false,
      tokenSource,
      source: {
        companyId: sourceCompanyId,
        projectId: sourceProjectId,
        bidBoardProjectId: sourceBidBoardProjectId || null,
        proposalId: sourceProposalId,
      },
      target: {
        companyId: targetCompanyId,
        bidBoardProjectId: targetBidBoardProjectId,
        projectId: targetProjectId || null,
        proposalId: createdProposalId,
      },
      counts: {
        sourceGroups: sourceGroupRecords.length,
        createdGroups: createdGroups.length,
        sourceLineItems: sourceLineItemRecords.length,
        createdLineItems: createdLineItems.length,
        failedLineItems: failedLineItems.length,
        skippedMissingMappings: missingMappings.length,
      },
      mappingOverrides,
      proposal: createdProposalPayload,
      createdGroups,
      createdLineItems,
      failedLineItems,
      missingMappings,
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
