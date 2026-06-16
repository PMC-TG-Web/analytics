import { existsSync } from "node:fs";
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
  return [row.Name, row["Cost Code"], row["Cost Name"], row.Description].map(norm).join("|");
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
}) {
  const response = await fetch(`${BASE_URL}${params.path}`, {
    method: params.method || "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
      ...(params.body ? { "Content-Type": "application/json" } : {}),
      "Procore-Company-Id": params.companyId,
    },
    ...(params.body ? { body: JSON.stringify(params.body) } : {}),
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
    throw new Error(`Procore ${params.method || "GET"} ${params.path} failed (${response.status}): ${message}`);
  }
  return payload;
}

function readSheet(workbook: XLSX.WorkBook, sheetName: string): UnknownRecord[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" }) as UnknownRecord[];
}

function buildCrosswalk(crosswalkPath: string) {
  const workbook = XLSX.readFile(crosswalkPath);
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
  const issues: UnknownRecord[] = [];

  for (const oldRow of uniqueOld) {
    const oldItemId = readStr(oldRow.ItemId);
    const costCode = norm(oldRow["Cost Code"]);
    const matches = newUniqueByCostCode.get(costCode) || [];
    if (!oldItemId) continue;
    if (matches.length === 1) {
      byOldItemId.set(oldItemId, { old: oldRow, new: matches[0], strategy: "unique_cost_code" });
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
      byOldItemId.set(oldItemId, { old: oldRow, new: matches[0], strategy: "non_unique_composite" });
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

function lineItemOldCostItemId(lineItem: UnknownRecord): string {
  const costItem = isRecord(lineItem.cost_item) ? lineItem.cost_item : {};
  return readStr(costItem.id || costItem.item_id || lineItem.cost_item_id || lineItem.item_id);
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

function buildGroupPayload(group: UnknownRecord): UnknownRecord {
  const payload: UnknownRecord = { name: readStr(group.name) || "Imported Group" };
  const notes = readStr(group.notes);
  const multiplier = readNum(group.multiplier);
  if (notes) payload.notes = notes;
  if (multiplier !== undefined) payload.multiplier = multiplier;
  if (isRecord(group.pricing_override)) {
    payload.pricing_override = group.pricing_override;
  }
  return payload;
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

  const payload: UnknownRecord = {
    name: readStr(lineItem.name || sourceCostItem.name || newRow.Name) || "Imported Line Item",
    cost_item: {
      id: readStr(newRow.ItemId),
      name: readStr(newRow.Name),
      description: readStr(newRow.Description),
      type: readStr(sourceCostItem.type || sourceCostItem.item_type || "Custom"),
      ...(readStr(sourceCostItem.unit) ? { unit: readStr(sourceCostItem.unit) } : {}),
    },
    cost_code: {
      code: readStr(newRow["Cost Code"]),
      ...(readStr(newRow["Cost Name"]) ? { name: readStr(newRow["Cost Name"]) } : {}),
    },
  };

  const mappedGroupId = oldGroupId ? groupIdMap.get(oldGroupId) : "";
  if (mappedGroupId) payload.group_id = mappedGroupId;

  const tag = readStr(lineItem.tag);
  const laborFactor = readNum(lineItem.labor_factor ?? lineItem.laborFactor);
  const count = readNum(lineItem.count ?? lineItem.quantity ?? lineItem.qty);
  const itemCost = readNum(lineItem.item_cost ?? lineItem.itemCost);
  const laborCost = readNum(lineItem.labor_cost ?? lineItem.laborCost);

  if (tag) payload.tag = tag;
  if (laborFactor !== undefined) payload.labor_factor = laborFactor;
  if (count !== undefined) payload.count = count;
  if (itemCost !== undefined) payload.item_cost = itemCost;
  if (laborCost !== undefined) payload.labor_cost = laborCost;

  const costCodeType = readStr(newRow["Cost code type"]);
  if (costCodeType) payload.cost_code_type = costCodeType;

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
    if (!existsSync(crosswalkPath)) {
      return NextResponse.json({ error: "Crosswalk workbook not found.", crosswalkPath }, { status: 400 });
    }

    const crosswalk = buildCrosswalk(crosswalkPath);
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
      const oldCostItemId = lineItemOldCostItemId(lineItem);
      const mapping = oldCostItemId ? crosswalk.byOldItemId.get(oldCostItemId) : undefined;
      if (!mapping) {
        missingMappings.push({
          index,
          lineItemId: readStr(lineItem.id || lineItem.line_item_id),
          name: readStr(lineItem.name),
          oldCostItemId,
          oldCostItem: isRecord(lineItem.cost_item) ? lineItem.cost_item : null,
          oldCostCode: isRecord(lineItem.cost_code) ? lineItem.cost_code : null,
        });
      }
      return { lineItem, oldCostItemId, mapping: mapping || null };
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
        crosswalkIssues: crosswalk.issues.slice(0, 25),
        missingMappings: missingMappings.slice(0, 50),
        groupPreview: groupPayloads.slice(0, 10),
        lineItemPreview: mappedLineItems.slice(0, 10).map((entry) => ({
          oldCostItemId: entry.oldCostItemId,
          strategy: isRecord(entry.mapping) ? entry.mapping.strategy : null,
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
