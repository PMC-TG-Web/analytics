import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { prisma } from "@/lib/prisma";
import { validateCsrfRequest } from "@/lib/csrfProtection";
import {
  getClientCredentialsToken,
  procoreConfig,
} from "@/lib/procore";
import {
  COMMITMENT_MAKER_COST_TYPE,
  COMMITMENT_MAKER_VENDOR_NAME,
  parseCommitmentMakerRows,
  planNextPurchaseOrderNumbers,
  selectCommitmentMakerWbsCandidate,
  type CommitmentMakerGroup,
  type CommitmentMakerLineItem,
} from "@/lib/procore/commitmentMaker";
import { getCurrentUserEmail } from "@/lib/requestUser";

export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;
type ProcoreResponse = { ok: boolean; status: number; payload: unknown; path: string };

const MAX_WORKBOOK_BYTES = 15 * 1024 * 1024;
const MAX_GROUPS = 100;
const MAX_LINE_ITEMS = 5_000;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readId(record: unknown): string {
  if (!isRecord(record)) return "";
  return readText(record.id ?? (isRecord(record.data) ? record.data.id : ""));
}

function unwrapData(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return value.data ?? value;
}

function asArray(value: unknown, keys: string[]): UnknownRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
    if (isRecord(candidate)) {
      const nested = asArray(candidate, keys);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

function parseUpstreamPayload(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return raw || {};
  }
}

async function procoreJson(params: {
  path: string;
  accessToken: string;
  companyId: string;
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
}): Promise<ProcoreResponse> {
  const path = params.path.startsWith("/") ? params.path : `/${params.path}`;
  const response = await fetch(`${procoreConfig.apiUrl}${path}`, {
    method: params.method || "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Procore-Company-Id": params.companyId,
    },
    body: params.body === undefined ? undefined : JSON.stringify(params.body),
  });
  const payload = parseUpstreamPayload(await response.text());
  return { ok: response.ok, status: response.status, payload, path };
}

async function fetchPaged(params: {
  accessToken: string;
  companyId: string;
  keys: string[];
  pathForPage: (page: number) => string;
  maxPages?: number;
}): Promise<UnknownRecord[]> {
  const records: UnknownRecord[] = [];
  const maxPages = params.maxPages || 50;
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await procoreJson({
      path: params.pathForPage(page),
      accessToken: params.accessToken,
      companyId: params.companyId,
    });
    if (!response.ok) {
      throw new Error(`Procore API ${response.status} while reading ${response.path}.`);
    }
    const pageRecords = asArray(response.payload, params.keys);
    records.push(...pageRecords);
    if (pageRecords.length < 100) break;
  }
  return records;
}

async function fetchCompanyVendors(accessToken: string, companyId: string): Promise<UnknownRecord[]> {
  const paths = [
    (page: number) => `/rest/v1.0/vendors?company_id=${encodeURIComponent(companyId)}&page=${page}&per_page=100`,
    (page: number) => `/rest/v1.0/companies/${encodeURIComponent(companyId)}/vendors?page=${page}&per_page=100`,
  ];
  let lastError: unknown = null;
  for (const pathForPage of paths) {
    try {
      const records = await fetchPaged({
        accessToken,
        companyId,
        keys: ["vendors", "data"],
        pathForPage,
      });
      if (records.length > 0) return records;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return [];
}

async function fetchProjectVendors(
  accessToken: string,
  companyId: string,
  projectId: string
): Promise<UnknownRecord[]> {
  const versions = ["v1.1", "v1.0"];
  let lastError: unknown = null;
  for (const version of versions) {
    try {
      return await fetchPaged({
        accessToken,
        companyId,
        keys: ["vendors", "data"],
        pathForPage: (page) =>
          `/rest/${version}/projects/${encodeURIComponent(projectId)}/vendors?page=${page}&per_page=100`,
      });
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return [];
}

async function fetchCommitments(
  accessToken: string,
  companyId: string,
  projectId: string
): Promise<UnknownRecord[]> {
  return fetchPaged({
    accessToken,
    companyId,
    keys: ["data", "commitment_contracts"],
    pathForPage: (page) =>
      `/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(
        projectId
      )}/commitment_contracts?page=${page}&per_page=100`,
  });
}

async function fetchProjectWbsRecords(
  accessToken: string,
  companyId: string,
  projectId: string
): Promise<UnknownRecord[]> {
  const [wbsCodes, budgetLineItems] = await Promise.all([
    fetchPaged({
      accessToken,
      companyId,
      keys: ["data", "wbs_codes", "codes"],
      pathForPage: (page) =>
        `/rest/v1.0/projects/${encodeURIComponent(
          projectId
        )}/work_breakdown_structure/wbs_codes?page=${page}&per_page=100`,
    }).catch(() => []),
    fetchPaged({
      accessToken,
      companyId,
      keys: ["data", "budget_line_items"],
      pathForPage: (page) =>
        `/rest/v1.1/budget_line_items?project_id=${encodeURIComponent(projectId)}&page=${page}&per_page=100`,
    }).catch(() => []),
  ]);
  if (wbsCodes.length === 0 && budgetLineItems.length === 0) {
    throw new Error("No project WBS or budget codes could be read from Procore.");
  }
  return [...wbsCodes, ...budgetLineItems];
}

function nestedRecord(record: UnknownRecord, key: string): UnknownRecord {
  return isRecord(record[key]) ? record[key] : {};
}

function wbsId(record: UnknownRecord): string {
  const wbs = nestedRecord(record, "wbs_code");
  return readText(wbs.id ?? record.wbs_code_id ?? (readText(record.flat_code) ? record.id : ""));
}

function wbsFlatCode(record: UnknownRecord): string {
  const wbs = nestedRecord(record, "wbs_code");
  return readText(wbs.flat_code ?? record.flat_code ?? record.cost_code_string);
}

function wbsCostCode(record: UnknownRecord): string {
  const wbs = nestedRecord(record, "wbs_code");
  const costCode = nestedRecord(record, "cost_code");
  return readText(
    record.cost_code_string ?? wbs.flat_code ?? wbs.code ?? costCode.code ?? costCode.name ?? record.cost_code
  );
}

function wbsCostType(record: UnknownRecord): string {
  const lineType = nestedRecord(record, "line_item_type");
  const costType = nestedRecord(record, "cost_type");
  const flatCode = wbsFlatCode(record);
  const flatCodeParts = flatCode.split(".");
  const flatCodeSuffix = flatCodeParts.length > 1 ? flatCodeParts.at(-1) : "";
  return readText(
    lineType.code ??
      lineType.abbreviation ??
      lineType.name ??
      costType.code ??
      costType.abbreviation ??
      costType.name ??
      record.line_item_type ??
      record.cost_type ??
      flatCodeSuffix
  );
}

function normalizeCode(value: unknown): string {
  return readText(value).toUpperCase().replace(/\s+/g, "");
}

function baseCostCode(value: unknown): string {
  return normalizeCode(value).split(".")[0];
}

type WbsMatch = { id: string; flatCode: string; costCode: string; costType: string };

function buildWbsIndex(records: UnknownRecord[]): Map<string, WbsMatch[]> {
  const index = new Map<string, WbsMatch[]>();
  const seen = new Set<string>();
  for (const record of records) {
    const id = wbsId(record);
    const flatCode = wbsFlatCode(record);
    const costCode = baseCostCode(wbsCostCode(record) || flatCode);
    const normalizedFlatCode = normalizeCode(flatCode);
    const flatCodeParts = normalizedFlatCode.split(".");
    const flatCodeSuffix = flatCodeParts.length > 1 ? flatCodeParts.at(-1) : "";
    const costType = normalizeCode(wbsCostType(record) || flatCodeSuffix);
    if (!id || !costCode || seen.has(id)) continue;
    seen.add(id);
    index.set(costCode, [...(index.get(costCode) || []), { id, flatCode, costCode, costType }]);
  }
  return index;
}

function resolveWbs(line: CommitmentMakerLineItem, index: Map<string, WbsMatch[]>): WbsMatch | null {
  const candidates = index.get(normalizeCode(line.costCode)) || [];
  return selectCommitmentMakerWbsCandidate(candidates, line.costType);
}

function vendorName(record: UnknownRecord): string {
  return readText(record.name ?? record.company_name ?? record.company ?? record.vendor_name);
}

function findParadiseVendor(records: UnknownRecord[]): UnknownRecord | null {
  const normalizeExactName = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const expected = normalizeExactName(COMMITMENT_MAKER_VENDOR_NAME);
  return records.find((record) => normalizeExactName(vendorName(record)) === expected) || null;
}

function groupFingerprint(projectId: string, importFingerprint: string, group: CommitmentMakerGroup): string {
  return createHash("sha256")
    .update(JSON.stringify({ projectId, importFingerprint, name: group.name, lineItems: group.lineItems }))
    .digest("hex");
}

function originDataFor(fingerprint: string): string {
  return JSON.stringify({ source: "pmc_commitment_maker", fingerprint });
}

function commitmentOriginData(record: UnknownRecord): string {
  return readText(record.origin_data ?? record.originData);
}

function commitmentVendorId(record: UnknownRecord): string {
  return readText(record.vendor_id ?? nestedRecord(record, "vendor").id);
}

function findExistingByFingerprint(records: UnknownRecord[], fingerprint: string): UnknownRecord | null {
  return records.find((record) => commitmentOriginData(record).includes(fingerprint)) || null;
}

function purchaseOrderCommitments(records: UnknownRecord[]): UnknownRecord[] {
  const typed = records.filter((record) => readText(record.type ?? record.contract_type ?? record.kind));
  if (typed.length === 0) return records;
  return records.filter((record) =>
    readText(record.type ?? record.contract_type ?? record.kind).toLowerCase().includes("purchase")
  );
}

function workbookFromBase64(base64: string, sheetName: string, fileName: string) {
  if (!base64) throw new Error("Missing workbook data.");
  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength === 0) throw new Error("The uploaded workbook is empty.");
  if (buffer.byteLength > MAX_WORKBOOK_BYTES) throw new Error("The workbook exceeds the 15 MB upload limit.");

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const selectedSheetName = sheetName || workbook.SheetNames[0] || "";
  const sheet = workbook.Sheets[selectedSheetName];
  if (!sheet) throw new Error(`Sheet "${selectedSheetName}" was not found in the workbook.`);
  const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  const fallbackGroupName = fileName.replace(/\.[^.]+$/, "") || selectedSheetName || "All Items";
  const parsed = parseCommitmentMakerRows(rows, { fallbackGroupName });
  const totalLineItems = parsed.groups.reduce((sum, group) => sum + group.lineItems.length, 0);
  if (parsed.groups.length > MAX_GROUPS) throw new Error(`The workbook contains more than ${MAX_GROUPS} groups.`);
  if (totalLineItems > MAX_LINE_ITEMS) throw new Error(`The workbook contains more than ${MAX_LINE_ITEMS} line items.`);
  return { parsed, selectedSheetName, buffer };
}

function groupsFromPayload(value: unknown): CommitmentMakerGroup[] {
  if (!Array.isArray(value)) throw new Error("Missing parsed commitment groups.");
  if (value.length === 0) throw new Error("No commitment groups were found in the selected sheet.");
  if (value.length > MAX_GROUPS) throw new Error(`The workbook contains more than ${MAX_GROUPS} groups.`);

  let totalLineItems = 0;
  const groups = value.map((rawGroup, groupIndex) => {
    if (!isRecord(rawGroup)) throw new Error(`Group ${groupIndex + 1} is invalid.`);
    const name = readText(rawGroup.name);
    if (!name) throw new Error(`Group ${groupIndex + 1} is missing its name.`);
    if (!Array.isArray(rawGroup.lineItems)) throw new Error(`Group "${name}" is missing its line items.`);
    const lineItems = rawGroup.lineItems.map((rawLine, lineIndex): CommitmentMakerLineItem => {
      if (!isRecord(rawLine)) throw new Error(`Group "${name}" line ${lineIndex + 1} is invalid.`);
      const costCode = readText(rawLine.costCode).substring(0, 12);
      const description = readText(rawLine.description);
      const uom = readText(rawLine.uom);
      const quantity = Number(rawLine.quantity);
      const unitCost = Number(rawLine.unitCost);
      if (!costCode || !description || !uom || !Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`Group "${name}" line ${lineIndex + 1} is missing a valid cost code, description, quantity, or UOM.`);
      }
      if (!Number.isFinite(unitCost) || unitCost < 0) {
        throw new Error(`Group "${name}" line ${lineIndex + 1} has an invalid unit cost.`);
      }
      return {
        costCode,
        costType: COMMITMENT_MAKER_COST_TYPE,
        description,
        quantity,
        uom,
        unitCost: Math.round(unitCost * 100) / 100,
        subtotalOverride: null,
      };
    });
    totalLineItems += lineItems.length;
    return { name, lineItems };
  });
  if (totalLineItems > MAX_LINE_ITEMS) throw new Error(`The workbook contains more than ${MAX_LINE_ITEMS} line items.`);
  return groups;
}

async function addVendorToProject(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  vendorId: string;
}) {
  for (const version of ["v1.1", "v1.0"]) {
    const response = await procoreJson({
      path: `/rest/${version}/projects/${encodeURIComponent(params.projectId)}/vendors/${encodeURIComponent(
        params.vendorId
      )}/actions/add?view=normal`,
      method: "POST",
      accessToken: params.accessToken,
      companyId: params.companyId,
    });
    const responseText = JSON.stringify(response.payload).toLowerCase();
    if (response.ok || response.status === 409 || (response.status === 422 && /already|exists|added/.test(responseText))) {
      return;
    }
  }
  throw new Error(`Paradise Masonry could not be added to Procore project ${params.projectId}.`);
}

type PlannedLine = CommitmentMakerLineItem & { wbsCodeId: string; wbsFlatCode: string };
type PlannedGroup = {
  name: string;
  number: string;
  action: "create" | "resume";
  existingContractId: string;
  fingerprint: string;
  lineItems: PlannedLine[];
  total: number;
};

async function buildPlan(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  groups: CommitmentMakerGroup[];
  importFingerprint: string;
}) {
  const [companyVendors, projectVendors, commitments, wbsRecords] = await Promise.all([
    fetchCompanyVendors(params.accessToken, params.companyId),
    fetchProjectVendors(params.accessToken, params.companyId, params.projectId),
    fetchCommitments(params.accessToken, params.companyId, params.projectId),
    fetchProjectWbsRecords(params.accessToken, params.companyId, params.projectId),
  ]);
  const companyVendor = findParadiseVendor(companyVendors);
  const projectVendor = findParadiseVendor(projectVendors);
  const validationErrors: string[] = [];
  if (!companyVendor) validationErrors.push(`${COMMITMENT_MAKER_VENDOR_NAME} was not found in the Procore company directory.`);
  const vendorId = readId(companyVendor);
  if (companyVendor && !vendorId) validationErrors.push(`${COMMITMENT_MAKER_VENDOR_NAME} does not have a usable Procore vendor ID.`);
  if (projectVendor && vendorId && readId(projectVendor) !== vendorId) {
    validationErrors.push(`${COMMITMENT_MAKER_VENDOR_NAME} resolved to inconsistent company and project vendor IDs.`);
  }

  const wbsIndex = buildWbsIndex(wbsRecords);
  const existingNumbers = purchaseOrderCommitments(commitments).map((record) => record.number);
  const newGroupCount = params.groups.filter((group) => {
    const fingerprint = groupFingerprint(params.projectId, params.importFingerprint, group);
    return !findExistingByFingerprint(commitments, fingerprint);
  }).length;
  const availableNumbers = planNextPurchaseOrderNumbers(existingNumbers, newGroupCount);
  let nextNumberIndex = 0;
  const groups: PlannedGroup[] = [];

  for (const group of params.groups) {
    if (group.lineItems.length === 0) {
      validationErrors.push(`Group "${group.name}" has no importable line items.`);
      continue;
    }
    const fingerprint = groupFingerprint(params.projectId, params.importFingerprint, group);
    const existing = findExistingByFingerprint(commitments, fingerprint);
    if (existing && vendorId && commitmentVendorId(existing) !== vendorId) {
      validationErrors.push(
        `Group "${group.name}" matches an earlier import, but that Procore PO is no longer assigned to ${COMMITMENT_MAKER_VENDOR_NAME}.`
      );
    }
    const plannedLines: PlannedLine[] = [];
    for (const line of group.lineItems) {
      const match = resolveWbs(line, wbsIndex);
      if (!match) {
        const candidates = wbsIndex.get(normalizeCode(line.costCode)) || [];
        const candidateCodes = [...new Set(candidates.map((candidate) => candidate.flatCode).filter(Boolean))];
        validationErrors.push(candidateCodes.length > 0
          ? `Group "${group.name}": cost code ${line.costCode}.${COMMITMENT_MAKER_COST_TYPE} matches multiple project WBS codes (${candidateCodes.join(", ")}); select one in Procore before creating.`
          : `Group "${group.name}": cost code ${line.costCode}.${COMMITMENT_MAKER_COST_TYPE} was not found in this project's WBS.`
        );
        continue;
      }
      plannedLines.push({ ...line, wbsCodeId: match.id, wbsFlatCode: match.flatCode });
    }
    const number = existing ? readText(existing.number) : availableNumbers[nextNumberIndex++];
    groups.push({
      name: group.name,
      number,
      action: existing ? "resume" : "create",
      existingContractId: readId(existing),
      fingerprint,
      lineItems: plannedLines,
      total: plannedLines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0),
    });
  }

  return {
    vendor: {
      id: vendorId,
      name: companyVendor ? vendorName(companyVendor) : COMMITMENT_MAKER_VENDOR_NAME,
      assignedToProject: Boolean(projectVendor),
      willAddToProject: Boolean(companyVendor && !projectVendor),
    },
    commitments,
    groups,
    validationErrors: [...new Set(validationErrors)],
  };
}

async function fetchContractLineItems(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  contractId: string;
}): Promise<UnknownRecord[]> {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    keys: ["data", "line_items"],
    pathForPage: (page) =>
      `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(
        params.projectId
      )}/commitment_contracts/${encodeURIComponent(params.contractId)}/line_items?page=${page}&per_page=100`,
  });
}

function lineAlreadyExists(line: PlannedLine, records: UnknownRecord[]): boolean {
  return records.some((record) => {
    const recordWbsId = readText(record.wbs_code_id ?? nestedRecord(record, "wbs_code").id);
    const quantity = Number(record.quantity);
    const unitCost = Number(record.unit_cost);
    return (
      recordWbsId === line.wbsCodeId &&
      readText(record.description) === line.description &&
      Number.isFinite(quantity) &&
      Math.abs(quantity - line.quantity) < 0.0001 &&
      Number.isFinite(unitCost) &&
      Math.abs(unitCost - line.unitCost) < 0.005 &&
      readText(record.uom).toLowerCase() === line.uom.toLowerCase()
    );
  });
}

async function writeAudit(params: {
  action: string;
  entityId: string;
  userEmail: string;
  changes: unknown;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        action: params.action,
        entity: "ProcoreCommitmentMaker",
        entityId: params.entityId,
        userEmail: params.userEmail,
        changes: JSON.parse(JSON.stringify(params.changes)),
      },
    });
  } catch (error) {
    console.error("Commitment Maker audit log write failed:", error);
  }
}

async function handleRequest(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as UnknownRecord;
  const mode = readText(body.mode).toLowerCase();
  const projectId = readText(body.projectId ?? body.project_id);
  const companyId = readText(body.companyId ?? procoreConfig.companyId);
  const workbookBase64 = readText(body.workbookBase64);
  const sheetName = readText(body.sheetName);
  const fileName = readText(body.fileName) || "estimate.xlsx";
  const previewFingerprint = readText(body.previewFingerprint);

  if (!projectId) return NextResponse.json({ error: "Select a Procore project." }, { status: 400 });
  if (!companyId) return NextResponse.json({ error: "Missing Procore company ID." }, { status: 400 });
  if (!workbookBase64 && !Array.isArray(body.groups)) {
    return NextResponse.json({ error: "Upload an estimate workbook." }, { status: 400 });
  }
  if (mode !== "preview" && mode !== "create") {
    return NextResponse.json({ error: "Mode must be preview or create." }, { status: 400 });
  }

  const cookieToken = readText(request.cookies.get("procore_access_token")?.value);
  let accessToken = "";
  let tokenSource = "client_credentials";
  try {
    accessToken = await getClientCredentialsToken();
  } catch (serviceTokenError) {
    if (!cookieToken) throw serviceTokenError;
    accessToken = cookieToken;
    tokenSource = "user_oauth_fallback";
  }
  const workbookImport = workbookBase64 ? workbookFromBase64(workbookBase64, sheetName, fileName) : null;
  const selectedSheetName = workbookImport?.selectedSheetName || sheetName || "Imported Estimate";
  const groups = workbookImport?.parsed.groups || groupsFromPayload(body.groups);
  const sourceRowCount = workbookImport?.parsed.sourceRowCount || Number(body.sourceRowCount) || 0;
  const skippedRows = workbookImport?.parsed.skippedRows || Number(body.skippedRows) || 0;
  const warnings = workbookImport?.parsed.warnings || (Array.isArray(body.warnings) ? body.warnings.map(readText).filter(Boolean) : []);
  const importFingerprint = createHash("sha256")
    .update(JSON.stringify({ projectId, selectedSheetName, groups }))
    .digest("hex");
  const plan = await buildPlan({
    accessToken,
    companyId,
    projectId,
    groups,
    importFingerprint,
  });

  const preview = {
    success: plan.validationErrors.length === 0,
    mode: "preview",
    projectId,
    companyId,
    fileName,
    sheetName: selectedSheetName,
    vendor: plan.vendor,
    contractType: "Purchase Order",
    finalStatus: "Approved",
    costType: COMMITMENT_MAKER_COST_TYPE,
    previewFingerprint: importFingerprint,
    sourceRowCount,
    skippedRows,
    warnings,
    validationErrors: plan.validationErrors,
    groups: plan.groups,
    totals: {
      groups: plan.groups.length,
      lineItems: plan.groups.reduce((sum, group) => sum + group.lineItems.length, 0),
      amount: plan.groups.reduce((sum, group) => sum + group.total, 0),
    },
  };

  if (mode === "preview") return NextResponse.json(preview);
  if (!previewFingerprint || previewFingerprint !== importFingerprint) {
    return NextResponse.json(
      { error: "The workbook or project changed after preview. Preview it again before creating commitments." },
      { status: 409 }
    );
  }
  if (plan.validationErrors.length > 0) {
    return NextResponse.json({ ...preview, error: "Commitment creation is blocked by validation errors." }, { status: 409 });
  }

  // Use Auth0's App Router request context here. The workbook request body was
  // consumed above, so passing `request` back into Auth0 can cause a serverless
  // runtime to rebuild an already-disturbed body stream.
  const userEmail = (await getCurrentUserEmail()) || "unknown@pmcdecor.com";
  if (plan.vendor.willAddToProject) {
    await addVendorToProject({ accessToken, companyId, projectId, vendorId: plan.vendor.id });
  }

  const results: UnknownRecord[] = [];
  let failure: UnknownRecord | null = null;
  for (const group of plan.groups) {
    let contractId = group.existingContractId;
    let createdContract = false;
    let actualNumber = group.number;
    try {
      if (!contractId) {
        const refreshedCommitments = await fetchCommitments(accessToken, companyId, projectId);
        const duplicate = findExistingByFingerprint(refreshedCommitments, group.fingerprint);
        if (duplicate) {
          if (commitmentVendorId(duplicate) !== plan.vendor.id) {
            throw new Error(
              `The existing PO for group "${group.name}" is not assigned to ${COMMITMENT_MAKER_VENDOR_NAME}.`
            );
          }
          contractId = readId(duplicate);
        } else {
          const refreshedNumber = planNextPurchaseOrderNumbers(
            purchaseOrderCommitments(refreshedCommitments).map((record) => record.number),
            1
          )[0];
          actualNumber = refreshedNumber;
          const response = await procoreJson({
            path: `/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(
              projectId
            )}/commitment_contracts`,
            method: "POST",
            accessToken,
            companyId,
            body: {
              type: "PurchaseOrderContract",
              number: refreshedNumber,
              title: group.name,
              status: "Draft",
              vendor_id: Number(plan.vendor.id) || plan.vendor.id,
              accounting_method: "unit",
              private: false,
              show_line_items_to_non_admins: true,
              origin_data: originDataFor(group.fingerprint),
            },
          });
          if (!response.ok) {
            throw new Error(`Procore rejected PO ${refreshedNumber} (${response.status}): ${JSON.stringify(response.payload)}`);
          }
          const created = unwrapData(response.payload);
          contractId = readId(created);
          createdContract = true;
          if (!contractId) throw new Error(`Procore created PO ${refreshedNumber} without returning its ID.`);
        }
      }

      const existingLines = await fetchContractLineItems({ accessToken, companyId, projectId, contractId });
      let createdLineItems = 0;
      let reusedLineItems = 0;
      for (const line of group.lineItems) {
        if (lineAlreadyExists(line, existingLines)) {
          reusedLineItems += 1;
          continue;
        }
        const response = await procoreJson({
          path: `/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(
            projectId
          )}/commitment_contracts/${encodeURIComponent(contractId)}/line_items`,
          method: "POST",
          accessToken,
          companyId,
          body: {
            description: line.description,
            quantity: line.quantity,
            unit_cost: line.unitCost,
            amount: Math.round(line.quantity * line.unitCost * 100) / 100,
            uom: line.uom,
            wbs_code_id: line.wbsCodeId,
          },
        });
        if (!response.ok) {
          throw new Error(
            `Procore rejected line "${line.description}" (${response.status}): ${JSON.stringify(response.payload)}`
          );
        }
        createdLineItems += 1;
      }

      const approveResponse = await procoreJson({
        path: `/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(
          projectId
        )}/commitment_contracts/${encodeURIComponent(contractId)}`,
        method: "PATCH",
        accessToken,
        companyId,
        body: { status: "Approved" },
      });
      if (!approveResponse.ok) {
        throw new Error(`PO ${actualNumber} was populated but could not be approved (${approveResponse.status}).`);
      }

      const result = {
        success: true,
        group: group.name,
        number: actualNumber,
        contractId,
        createdContract,
        createdLineItems,
        reusedLineItems,
        status: "Approved",
      };
      results.push(result);
      await writeAudit({
        action: createdContract ? "create" : "resume",
        entityId: contractId,
        userEmail,
        changes: { projectId, fileName, sheetName: selectedSheetName, fingerprint: group.fingerprint, ...result },
      });
    } catch (error) {
      failure = {
        success: false,
        group: group.name,
        number: actualNumber,
        contractId: contractId || null,
        status: contractId ? "Draft - attention required" : "Not created",
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(failure);
      await writeAudit({
        action: "error",
        entityId: contractId || group.fingerprint,
        userEmail,
        changes: { projectId, fileName, sheetName: selectedSheetName, ...failure },
      });
      break;
    }
  }

  return NextResponse.json(
    {
      success: !failure,
      mode: "create",
      projectId,
      companyId,
      tokenSource,
      vendor: plan.vendor,
      results,
      created: results.filter((result) => result.success === true && result.createdContract === true).length,
      resumed: results.filter((result) => result.success === true && result.createdContract === false).length,
      failed: failure ? 1 : 0,
      error: failure ? "Commitment creation stopped after an error. Any affected PO was left in Draft for review." : undefined,
    },
    { status: failure ? 502 : 200 }
  );
}

export async function POST(request: NextRequest) {
  const csrf = validateCsrfRequest({
    method: request.method,
    requestUrl: request.url,
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
  });
  if (!csrf.allowed) {
    return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  }
  try {
    return await handleRequest(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Procore Commitment Maker error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
