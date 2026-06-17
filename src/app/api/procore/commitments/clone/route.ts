import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

type UnknownRecord = Record<string, unknown>;

const BASE_URL = "https://api.procore.com";

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
  if (raw.includes("work")) return "WorkOrderContract";
  if (raw.includes("purchase")) return "PurchaseOrderContract";
  if (raw.includes("sub")) return "CommitmentContract";
  return readStr(source.type) || "PurchaseOrderContract";
}

function buildContractPayload(params: {
  source: UnknownRecord;
  targetStatus: string;
  preserveStatus: boolean;
  vendorIdMap: Record<string, string>;
  issues: UnknownRecord[];
  requireMappedIds: boolean;
  allowUnmappedIds: boolean;
}) {
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

  const mappedVendorId = mapId(sourceVendorId, params.vendorIdMap, "vendor_id", params.issues, context, {
    required: params.requireMappedIds && readStr(payload.status).toLowerCase() !== "draft",
    allowUnmappedIds: params.allowUnmappedIds,
  });
  delete payload.vendor;
  delete payload.vendor_name;
  if (mappedVendorId !== undefined) payload.vendor_id = mappedVendorId;
  else delete payload.vendor_id;

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
  maxPages: number;
}) {
  const candidates = (page: number) => [
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
}) {
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

async function createLineItem(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  contractId: string;
  payload: UnknownRecord;
}) {
  const response = await procoreJson({
    path: `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(
      params.projectId
    )}/commitment_contracts/${encodeURIComponent(params.contractId)}/line_items`,
    method: "POST",
    accessToken: params.accessToken,
    companyId: params.companyId,
    body: params.payload,
  });
  return unwrapData(response.payload);
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
    const allowUnmappedIds = readBool(body.allowUnmappedIds, false);
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

    const requireMappedIds = sourceCompanyId !== targetCompanyId || sourceProjectId !== targetProjectId;
    const maps = {
      vendorIdMap: buildIdMap(body.vendorIdMap),
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

    const plan: UnknownRecord[] = [];
    const missingMappings: UnknownRecord[] = [];
    let sourceLineItems = 0;

    for (const contract of selectedContracts) {
      const contractId = readStr(contract.id);
      const lineFetch = cloneLineItems && contractId
        ? await fetchLineItems({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, contractId, maxPages })
        : { records: [] as UnknownRecord[], errors: [] as UnknownRecord[] };
      sourceLineItems += lineFetch.records.length;
      const contractIssues: UnknownRecord[] = [];
      const contractPayload = buildContractPayload({
        source: contract,
        targetStatus,
        preserveStatus,
        vendorIdMap: maps.vendorIdMap,
        issues: contractIssues,
        requireMappedIds,
        allowUnmappedIds,
      });
      const lineItemPlans = lineFetch.records.map((lineItem) => {
        const lineIssues: UnknownRecord[] = [];
        const payload = buildLineItemPayload({
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
      missingMappings.push(...contractIssues);
      plan.push({
        sourceContractId: contractId,
        sourceEndpoint: contract._cloneSourceEndpoint,
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

    const readyForLiveClone = missingMappings.length === 0 || allowUnmappedIds;

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        tokenSource,
        readyForLiveClone,
        source: { companyId: sourceCompanyId, projectId: sourceProjectId, sourceMode },
        target: { companyId: targetCompanyId, projectId: targetProjectId, targetStatus, preserveStatus },
        counts: {
          sourceContracts: selectedContracts.length,
          sourceLineItems,
          missingMappings: missingMappings.length,
        },
        maps: Object.fromEntries(Object.entries(maps).map(([key, value]) => [key, Object.keys(value).length])),
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
          counts: { sourceContracts: selectedContracts.length, sourceLineItems, missingMappings: missingMappings.length },
          missingMappings,
          plan,
        },
        { status: 409 }
      );
    }

    const createdContracts: UnknownRecord[] = [];
    const errors: UnknownRecord[] = [];
    for (const entry of plan) {
      try {
        const created = await createContract({
          accessToken,
          companyId: targetCompanyId,
          projectId: targetProjectId,
          payload: entry.contractPayload as UnknownRecord,
        });
        const createdRecord = isRecord(created) ? created : {};
        const createdContractId = readStr(createdRecord.id);
        const createdLineItems: UnknownRecord[] = [];

        if (cloneLineItems && createdContractId && Array.isArray(entry.lineItems)) {
          for (const line of entry.lineItems as UnknownRecord[]) {
            try {
              const createdLineItem = await createLineItem({
                accessToken,
                companyId: targetCompanyId,
                projectId: targetProjectId,
                contractId: createdContractId,
                payload: line.payload as UnknownRecord,
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

        createdContracts.push({
          sourceContractId: entry.sourceContractId,
          sourceNumber: entry.number,
          sourceTitle: entry.title,
          createdContractId,
          result: created,
          createdLineItems,
        });
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

    return NextResponse.json({
      success: errors.length === 0,
      dryRun: false,
      tokenSource,
      source: { companyId: sourceCompanyId, projectId: sourceProjectId, sourceMode },
      target: { companyId: targetCompanyId, projectId: targetProjectId, targetStatus, preserveStatus },
      counts: {
        sourceContracts: selectedContracts.length,
        sourceLineItems,
        createdContracts: createdContracts.length,
        createdLineItems: createdContracts.reduce((sum, contract) => {
          const lines = Array.isArray(contract.createdLineItems) ? contract.createdLineItems.length : 0;
          return sum + lines;
        }, 0),
        errors: errors.length,
      },
      createdContracts,
      errors,
      plan,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: "Failed to clone commitments.", details: message },
      { status: 500 }
    );
  }
}
