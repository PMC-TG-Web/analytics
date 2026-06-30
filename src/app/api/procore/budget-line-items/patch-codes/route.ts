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

function readBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return fallback;
}

function readInt(value: unknown, fallback: number): number {
  const parsed = Number(readStr(value));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function norm(value: unknown): string {
  return readStr(value).replace(/\s+/g, " ").toLowerCase();
}

function normCode(value: unknown): string {
  return readStr(value).replace(/\s+/g, "").toLowerCase();
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
    if ((response.status !== 429 && response.status !== 502 && response.status !== 504) || attempt >= maxRetries) break;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * Math.pow(2, attempt);
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

function readSheet(workbook: XLSX.WorkBook, sheetName: string): UnknownRecord[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" }) as UnknownRecord[];
}

function loadWorkbook(params: { crosswalkWorkbookBase64: string; crosswalkPath: string }) {
  if (params.crosswalkWorkbookBase64) {
    const base64 = params.crosswalkWorkbookBase64.includes(",")
      ? params.crosswalkWorkbookBase64.split(",").pop() || ""
      : params.crosswalkWorkbookBase64;
    return {
      workbook: XLSX.read(Buffer.from(base64, "base64"), { type: "buffer" }),
      source: "uploaded_workbook",
    };
  }
  if (!existsSync(params.crosswalkPath)) return { workbook: null, source: params.crosswalkPath };
  return {
    workbook: XLSX.read(readFileSync(params.crosswalkPath), { type: "buffer" }),
    source: params.crosswalkPath,
  };
}

function buildWorkbookNewRows(workbook: XLSX.WorkBook) {
  return [...readSheet(workbook, "Unique_New_codes"), ...readSheet(workbook, "non_unique_new_codes")].filter((row) =>
    readStr(row["Cost Code"]) || readStr(row.Name) || readStr(row.Description)
  );
}

async function fetchBudgetLineItems(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}) {
  const records: UnknownRecord[] = [];
  const errors: UnknownRecord[] = [];
  const encodedProjectId = encodeURIComponent(params.projectId);

  for (let page = 1; page <= params.maxPages; page += 1) {
    const query = new URLSearchParams({ project_id: params.projectId, page: String(page), per_page: "100" });
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

async function fetchProjectWbsCodes(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}) {
  const records: UnknownRecord[] = [];
  const errors: UnknownRecord[] = [];

  for (let page = 1; page <= params.maxPages; page += 1) {
    const endpoints = [
      `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/work_breakdown_structure/wbs_codes?page=${page}&per_page=100`,
      `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/work_breakdown_structure/wbs_codes?company_id=${encodeURIComponent(params.companyId)}&page=${page}&per_page=100`,
      `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(params.projectId)}/wbs/codes?page=${page}&per_page=100`,
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
      pageRecords = asArray(response.payload, ["data", "wbs_codes", "codes"]).filter(isRecord);
      pageOk = true;
      break;
    }

    if (!pageOk || pageRecords.length === 0) break;
    records.push(...pageRecords);
    if (pageRecords.length < 100) break;
  }

  return { records, errors };
}

function budgetLineId(item: UnknownRecord) {
  return readStr(item.id ?? item.budget_line_item_id);
}

function budgetLineWbsId(item: UnknownRecord) {
  const wbsCode = isRecord(item.wbs_code) ? item.wbs_code : {};
  return readStr(wbsCode.id ?? item.wbs_code_id);
}

function budgetLineFlatCode(item: UnknownRecord) {
  const wbsCode = isRecord(item.wbs_code) ? item.wbs_code : {};
  return readStr(wbsCode.flat_code ?? wbsCode.full_code ?? item.flat_code ?? item.full_code ?? item.cost_code_string);
}

function targetWbsId(item: UnknownRecord) {
  const wbsCode = isRecord(item.wbs_code) ? item.wbs_code : {};
  return readStr(wbsCode.id ?? item.wbs_code_id ?? (budgetLineFlatCode(item) ? item.id : ""));
}

function budgetLineCostCode(item: UnknownRecord) {
  const wbsCode = isRecord(item.wbs_code) ? item.wbs_code : {};
  const costCode = isRecord(item.cost_code) ? item.cost_code : {};
  const flatCode = budgetLineFlatCode(item);
  return readStr(item.cost_code_string || (flatCode ? flatCode.split(".")[0] : "") || wbsCode.code || costCode.code || costCode.name || item.cost_code);
}

function budgetLineCostType(item: UnknownRecord) {
  const lineItemType = isRecord(item.line_item_type) ? item.line_item_type : {};
  const costType = isRecord(item.cost_type) ? item.cost_type : {};
  const flatCodeType = flatCodeSuffix(budgetLineFlatCode(item));
  const segmentItems = [
    ...asArray(item.segment_items).filter(isRecord),
    ...asArray(item.segments).filter(isRecord),
    ...asArray(item.wbs_segments).filter(isRecord),
  ];
  const segmentType = segmentItems
    .map((segment) => readStr(segment.code ?? segment.abbreviation ?? segment.name ?? segment.value))
    .map(canonicalCostType)
    .find((value) => ["l", "m", "c", "con", "o"].includes(value));
  return readStr(
    lineItemType.code ??
      lineItemType.abbreviation ??
      lineItemType.name ??
      costType.code ??
      costType.abbreviation ??
      costType.name ??
      segmentType ??
      flatCodeType ??
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

function costCodeBaseKey(value: unknown) {
  return normCode(value).split(".")[0];
}

function flatCodeSuffix(value: unknown) {
  const parts = normCode(value).split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function canonicalCostType(value: unknown) {
  const normalized = normCode(value);
  if (["l", "lab", "labor"].includes(normalized)) return "l";
  if (["m", "mat", "material", "materials"].includes(normalized)) return "m";
  if (["s", "sub", "subcontract", "commitment", "commitments", "c"].includes(normalized)) return "c";
  if (["con", "conc", "concrete"].includes(normalized)) return "con";
  if (["o", "other"].includes(normalized)) return "o";
  return normalized;
}

function procoreFlatCostType(value: unknown) {
  const canonical = canonicalCostType(value);
  if (canonical === "c") return "C";
  if (canonical === "con") return "CON";
  if (canonical === "l") return "L";
  if (canonical === "m") return "M";
  if (canonical === "o") return "O";
  return readStr(value).toUpperCase();
}

function targetFlatCodeFromPlan(entry: UnknownRecord) {
  const costCode = readStr(entry.targetCostCode);
  const costType = procoreFlatCostType(entry.targetCostType);
  return costCode && costType ? `${costCode}.${costType}` : "";
}

function buildTargetWbsIndex(items: UnknownRecord[]) {
  const byCodeAndType = new Map<string, UnknownRecord[]>();
  const byCode = new Map<string, UnknownRecord[]>();
  const byFlatCode = new Map<string, UnknownRecord>();

  for (const item of items) {
    const wbsCodeId = targetWbsId(item);
    const flatCode = normCode(budgetLineFlatCode(item));
    const costCode = costCodeBaseKey(budgetLineCostCode(item) || flatCode);
    if (!wbsCodeId || !costCode) continue;
    const costType = canonicalCostType(budgetLineCostType(item) || flatCodeSuffix(flatCode));
    const normalized = {
      item,
      wbsCodeId,
      costCode: budgetLineCostCode(item),
      flatCode: budgetLineFlatCode(item),
      costType: canonicalCostType(budgetLineCostType(item) || flatCodeSuffix(flatCode)),
      description: budgetLineDescription(item),
    };
    byCode.set(costCode, [...(byCode.get(costCode) || []), normalized]);
    if (flatCode && !byFlatCode.has(flatCode)) byFlatCode.set(flatCode, normalized);
    if (costType) {
      byCodeAndType.set(`${costCode}|${costType}`, [...(byCodeAndType.get(`${costCode}|${costType}`) || []), normalized]);
    }
  }

  return { byCodeAndType, byCode, byFlatCode };
}

function resolveTargetWbsId(
  newRow: UnknownRecord,
  targetIndex: ReturnType<typeof buildTargetWbsIndex>,
  options: { requireCostTypeMatch?: boolean } = {}
) {
  const costCode = normCode(newRow["Cost Code"]);
  const costType = canonicalCostType(newRow["Cost code type"]);
  if (!costCode) return { wbsCodeId: "", issue: "missing_new_cost_code", matchCount: 0 };

  const codeMatches = targetIndex.byCode.get(costCode) || [];
  if (codeMatches.length === 1 && (!options.requireCostTypeMatch || !costType)) {
    return {
      wbsCodeId: readStr(codeMatches[0].wbsCodeId),
      issue: "",
      matchCount: 1,
      strategy: "cost_code_only",
      matchedFlatCode: readStr(codeMatches[0].flatCode),
    };
  }
  if (codeMatches.length === 1 && options.requireCostTypeMatch && costType) {
    const onlyMatch = codeMatches[0];
    const matchedType = canonicalCostType(onlyMatch.costType || flatCodeSuffix(onlyMatch.flatCode));
    if (matchedType === costType || canonicalCostType(flatCodeSuffix(onlyMatch.flatCode)) === costType) {
      return {
        wbsCodeId: readStr(onlyMatch.wbsCodeId),
        issue: "",
        matchCount: 1,
        strategy: "cost_code_only_type_verified",
        matchedFlatCode: readStr(onlyMatch.flatCode),
      };
    }
    return {
      wbsCodeId: "",
      issue: "missing_target_wbs_code_type",
      matchCount: 1,
      requestedCostType: costType,
      matchedCostType: readStr(onlyMatch.costType),
      matchedFlatCode: readStr(onlyMatch.flatCode),
    };
  }

  if (costType) {
    const exactFlatMatch = targetIndex.byFlatCode.get(`${costCode}.${costType}`);
    if (exactFlatMatch) return { wbsCodeId: readStr(exactFlatMatch.wbsCodeId), issue: "", matchCount: 1, strategy: "flat_code_exact" };
    const typedMatches = targetIndex.byCodeAndType.get(`${costCode}|${costType}`) || [];
    if (typedMatches.length === 1) return { wbsCodeId: readStr(typedMatches[0].wbsCodeId), issue: "", matchCount: 1, strategy: "cost_code_and_type" };
    if (typedMatches.length > 1) {
      return {
        wbsCodeId: "",
        issue: "ambiguous_target_wbs_code_type",
        matchCount: typedMatches.length,
        matches: typedMatches.slice(0, 8).map((match) => ({
          wbsCodeId: match.wbsCodeId,
          flatCode: match.flatCode,
          costType: match.costType,
          description: match.description,
        })),
      };
    }
  }

  return {
    wbsCodeId: "",
    issue: codeMatches.length === 0 ? "missing_target_wbs_code" : "ambiguous_target_wbs_code",
    matchCount: codeMatches.length,
    matches: codeMatches.slice(0, 8).map((match) => ({
      wbsCodeId: match.wbsCodeId,
      flatCode: match.flatCode,
      costType: match.costType,
      description: match.description,
    })),
  };
}

function workbookScore(row: UnknownRecord, item: UnknownRecord) {
  const description = norm(budgetLineDescription(item));
  const candidates = [row.Name, row.Description, row["Cost Name"]].map(norm).filter(Boolean);
  let score = 0;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate === description) score = Math.max(score, 100);
    else if (candidate && description.includes(candidate)) score = Math.max(score, 80);
    else if (description && candidate.includes(description)) score = Math.max(score, 70);
  }
  return score;
}

function budgetLineTypeHint(item: UnknownRecord) {
  const description = norm(budgetLineDescription(item));
  const explicitType = normCode(budgetLineCostType(item));
  if (description.endsWith(".labor") || /\.labor\b/.test(description)) return "l";
  // A current ".Materials" suffix can be the wrong code we are trying to fix
  // (for example concrete rows that should become .CON), so do not force M.
  if (description.endsWith(".materials") || /\.materials\b/.test(description)) return "";
  if (description.endsWith(".commitments") || /\.commitments\b/.test(description)) return "c";
  if (description.endsWith(".other") || /\.other\b/.test(description)) return "o";
  return canonicalCostType(explicitType);
}

function workbookCostTypeMatchesHint(row: UnknownRecord, hint: string) {
  if (!hint) return true;
  const rowType = canonicalCostType(row["Cost code type"]);
  if (!rowType) return true;
  if (rowType === hint) return true;
  return false;
}

function findWorkbookRowForBudgetLine(item: UnknownRecord, newRows: UnknownRecord[]) {
  const typeHint = budgetLineTypeHint(item);
  const typeFilteredRows = typeHint ? newRows.filter((row) => workbookCostTypeMatchesHint(row, typeHint)) : newRows;
  const rowsToScore = typeFilteredRows.length > 0 ? typeFilteredRows : newRows;
  const scored = rowsToScore
    .map((row) => ({ row, score: workbookScore(row, item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { row: null, issue: "missing_workbook_match", matchCount: 0, typeHint };
  const bestScore = scored[0].score;
  const best = scored.filter((entry) => entry.score === bestScore);
  const equivalent = new Set(best.map((entry) => `${normCode(entry.row["Cost Code"])}|${norm(entry.row["Cost code type"])}`));
  if (equivalent.size === 1) return { row: best[0].row, issue: "", matchCount: best.length, score: bestScore, typeHint };
  return {
    row: null,
    issue: "ambiguous_workbook_match",
    matchCount: best.length,
    typeHint,
    candidates: best.slice(0, 8).map((entry) => ({
      score: entry.score,
      name: entry.row.Name,
      costCode: entry.row["Cost Code"],
      costType: entry.row["Cost code type"],
    })),
  };
}

async function patchBudgetLineItem(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  budgetLineItemId: string;
  wbsCodeId: string;
}) {
  const body = {
    project_id: Number(params.projectId),
    budget_line_item: {
      wbs_code_id: Number(params.wbsCodeId),
    },
  };
  return procoreJson({
    path: `/rest/v1.1/budget_line_items/${encodeURIComponent(params.budgetLineItemId)}`,
    method: "PATCH",
    accessToken: params.accessToken,
    companyId: params.companyId,
    body,
  });
}

async function createProjectWbsCode(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  flatCode: string;
}) {
  const bodies = [
    { wbs_code: { flat_code: params.flatCode } },
    { wbs_code: { code: params.flatCode } },
    { wbs_code: { full_code: params.flatCode } },
    { flat_code: params.flatCode },
    { code: params.flatCode },
  ];
  const paths = [
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/work_breakdown_structure/wbs_codes`,
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/work_breakdown_structure/wbs_codes?company_id=${encodeURIComponent(params.companyId)}`,
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
        allowStatuses: [400, 403, 404, 405, 409, 422],
      });
      attempts.push({ path, body, status: response.status, ok: response.ok, response: response.payload });
      if (response.ok) return { ok: true, path, body, status: response.status, response: response.payload, attempts };
      const text = safeJson(response.payload).toLowerCase();
      if (response.status === 409 || /already|taken|exists/.test(text)) {
        return { ok: true, alreadyExists: true, path, body, status: response.status, response: response.payload, attempts };
      }
    }
  }

  const bulkBody = { wbs_codes: [{ flat_code: params.flatCode }] };
  for (const method of ["PATCH", "POST"]) {
    const path = `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/work_breakdown_structure/wbs_codes/bulk_create`;
    const response = await procoreJson({
      path,
      method,
      accessToken: params.accessToken,
      companyId: params.companyId,
      body: bulkBody,
      allowStatuses: [400, 403, 404, 405, 409, 422],
    });
    attempts.push({ path, method, body: bulkBody, status: response.status, ok: response.ok, response: response.payload });
    if (response.ok) return { ok: true, path, method, body: bulkBody, status: response.status, response: response.payload, attempts };
    const text = safeJson(response.payload).toLowerCase();
    if (response.status === 409 || /already|taken|exists/.test(text)) {
      return { ok: true, alreadyExists: true, path, method, body: bulkBody, status: response.status, response: response.payload, attempts };
    }
  }

  return { ok: false, flatCode: params.flatCode, attempts };
}

function buildPatchPlan(params: {
  candidates: UnknownRecord[];
  workbookRows: UnknownRecord[];
  targetIndex: ReturnType<typeof buildTargetWbsIndex>;
  patchExisting: boolean;
}) {
  return params.candidates.map((item) => {
    const workbookMatch = findWorkbookRowForBudgetLine(item, params.workbookRows);
    if (!workbookMatch.row) {
      return {
        budgetLineItemId: budgetLineId(item),
        description: budgetLineDescription(item),
        currentWbsCodeId: budgetLineWbsId(item),
        patchable: false,
        issue: workbookMatch.issue,
        matchCount: workbookMatch.matchCount,
        typeHint: workbookMatch.typeHint,
        candidates: workbookMatch.candidates,
      };
    }
    const wbsMatch = resolveTargetWbsId(workbookMatch.row, params.targetIndex, { requireCostTypeMatch: params.patchExisting });
    const currentWbsCodeId = budgetLineWbsId(item);
    const alreadyCorrect = Boolean(wbsMatch.wbsCodeId) && readStr(wbsMatch.wbsCodeId) === currentWbsCodeId;
    return {
      budgetLineItemId: budgetLineId(item),
      description: budgetLineDescription(item),
      currentWbsCodeId,
      targetWbsCodeId: wbsMatch.wbsCodeId,
      targetCostCode: workbookMatch.row["Cost Code"],
      targetCostType: workbookMatch.row["Cost code type"],
      targetFlatCode: `${readStr(workbookMatch.row["Cost Code"])}.${procoreFlatCostType(workbookMatch.row["Cost code type"])}`,
      typeHint: workbookMatch.typeHint,
      patchable: Boolean(wbsMatch.wbsCodeId) && !alreadyCorrect,
      alreadyCorrect,
        issue: alreadyCorrect ? "already_correct" : wbsMatch.issue,
        matchCount: wbsMatch.matchCount,
        strategy: wbsMatch.strategy,
        matchedFlatCode: wbsMatch.matchedFlatCode,
        matches: wbsMatch.matches,
      };
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const targetCompanyId = readStr(body.targetCompanyId || body.companyId || procoreConfig.companyId);
    const targetProjectId = readStr(body.targetProjectId || body.projectId);
    const dryRun = readBool(body.dryRun, true);
    const patchExisting = readBool(body.patchExisting, false);
    const ensureMissingCodes = readBool(body.ensureMissingCodes, false);
    const patchOffset = readInt(body.patchOffset, 0);
    const patchLimit = Math.max(1, Math.min(100, readInt(body.patchLimit, 25)));
    const maxPages = Math.max(1, Math.min(50, readInt(body.maxPages, 10)));
    const rawCrosswalkPath = readStr(body.crosswalkPath) || DEFAULT_CROSSWALK_PATH;
    const crosswalkPath = path.isAbsolute(rawCrosswalkPath) ? rawCrosswalkPath : path.resolve(process.cwd(), rawCrosswalkPath);
    const crosswalkWorkbookBase64 = readStr(body.crosswalkWorkbookBase64);

    if (!targetCompanyId || !targetProjectId) {
      return NextResponse.json({ success: false, error: "targetCompanyId and targetProjectId are required." }, { status: 400 });
    }

    const { accessToken, tokenSource } = await getToken(body.accessToken);
    const workbookLoad = loadWorkbook({ crosswalkWorkbookBase64, crosswalkPath });
    if (!workbookLoad.workbook) {
      return NextResponse.json({ success: false, error: `Workbook not found: ${workbookLoad.source}` }, { status: 400 });
    }

    const budgetFetch = await fetchBudgetLineItems({
      accessToken,
      companyId: targetCompanyId,
      projectId: targetProjectId,
      maxPages,
    });
    let wbsFetch = await fetchProjectWbsCodes({
      accessToken,
      companyId: targetCompanyId,
      projectId: targetProjectId,
      maxPages,
    });
    let targetIndex = buildTargetWbsIndex([...budgetFetch.records, ...wbsFetch.records]);
    const workbookRows = buildWorkbookNewRows(workbookLoad.workbook);

    const candidates = budgetFetch.records.filter((item) => {
      if (!budgetLineId(item)) return false;
      if (patchExisting) return true;
      return !budgetLineWbsId(item);
    });

    let plan = buildPatchPlan({ candidates, workbookRows, targetIndex, patchExisting });
    const missingCodeFlatCodes = Array.from(
      new Set(
        plan
          .filter((entry) => readStr(entry.issue) === "missing_target_wbs_code_type" || readStr(entry.issue) === "missing_target_wbs_code")
          .map(targetFlatCodeFromPlan)
          .filter(Boolean)
      )
    );

    const ensureResults = [];
    if (ensureMissingCodes && !dryRun && missingCodeFlatCodes.length > 0) {
      for (const flatCode of missingCodeFlatCodes) {
        const result = await createProjectWbsCode({
          accessToken,
          companyId: targetCompanyId,
          projectId: targetProjectId,
          flatCode,
        });
        ensureResults.push({ flatCode, ...result });
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      wbsFetch = await fetchProjectWbsCodes({
        accessToken,
        companyId: targetCompanyId,
        projectId: targetProjectId,
        maxPages,
      });
      targetIndex = buildTargetWbsIndex([...budgetFetch.records, ...wbsFetch.records]);
      plan = buildPatchPlan({ candidates, workbookRows, targetIndex, patchExisting });
    }

    const patchable = plan.filter((entry) => entry.patchable && entry.targetWbsCodeId);
    const alreadyCorrect = plan.filter((entry) => entry.alreadyCorrect);
    const batch = dryRun ? [] : patchable.slice(patchOffset, patchOffset + patchLimit);
    const patchResults = [];
    for (const entry of batch) {
      try {
        const response = await patchBudgetLineItem({
          accessToken,
          companyId: targetCompanyId,
          projectId: targetProjectId,
          budgetLineItemId: readStr(entry.budgetLineItemId),
          wbsCodeId: readStr(entry.targetWbsCodeId),
        });
        patchResults.push({ ...entry, ok: true, status: response.status, response: response.payload });
      } catch (error) {
        patchResults.push({ ...entry, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }

    const failed = patchResults.filter((result) => !result.ok);
    const nextPatchOffset = !dryRun && failed.length === 0 && patchOffset + patchLimit < patchable.length
      ? patchOffset + patchLimit
      : null;

    return NextResponse.json({
      success: dryRun || failed.length === 0,
      dryRun,
      tokenSource,
      target: { companyId: targetCompanyId, projectId: targetProjectId },
      workbook: { source: workbookLoad.source, rows: workbookRows.length },
      options: { patchExisting, ensureMissingCodes, patchOffset, patchLimit },
      counts: {
        targetBudgetLineItems: budgetFetch.records.length,
        targetWbsCodes: wbsFetch.records.length,
        candidates: candidates.length,
        missingWbsCodes: missingCodeFlatCodes.length,
        ensuredWbsCodes: ensureResults.filter((result) => result.ok).length,
        patchable: patchable.length,
        alreadyCorrect: alreadyCorrect.length,
        blocked: plan.length - patchable.length - alreadyCorrect.length,
        patched: patchResults.filter((result) => result.ok).length,
        failed: failed.length,
        nextPatchOffset,
      },
      fetchWarnings: [...budgetFetch.errors, ...wbsFetch.errors].slice(0, 12),
      missingWbsCodes: missingCodeFlatCodes,
      ensureResults,
      plan,
      patchResults,
      nextStep: dryRun
        ? ensureMissingCodes
          ? "Review missingWbsCodes. Rerun with dryRun=false to create missing WBS codes, refetch, then PATCH budget line item wbs_code_id values."
          : "Review plan. Rerun with dryRun=false to PATCH existing budget line item wbs_code_id values."
        : nextPatchOffset !== null
          ? `Continue at patchOffset ${nextPatchOffset}.`
          : "Budget code patch batch complete.",
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Budget code patch failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
