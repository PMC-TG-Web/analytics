import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

export const dynamic = "force-dynamic";

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

function norm(value: unknown): string {
  return readStr(value).replace(/\s+/g, " ").toLowerCase();
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
