import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";

type UnknownRecord = Record<string, unknown>;

type ContractType = "commitment_contract" | "work_order_contract" | "purchase_order_contract";

type ProductivityLineItemOption = {
  line_item_id: number;
  description: string;
  uom: string;
  unit_cost: number | null;
  amount: number | null;
  quantity: number | null;
  contract_id: string;
  contract_type: ContractType;
  contract_title: string;
  contract_number: string;
  contract_status: string;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStr(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readNum(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeStatusToken(value: unknown): string {
  return readStr(value).toLowerCase();
}

function isApprovedStatusToken(value: unknown): boolean {
  const token = normalizeStatusToken(value);
  if (!token) return false;
  if (token === "approved") return true;
  if (token.includes("approved") && !token.includes("unapproved")) return true;
  // Procore PO contracts often sit in "Processing" or "Submitted" while still
  // being valid for productivity log line items. Accept these too.
  if (["processing", "submitted", "executed", "complete", "active", "open"].includes(token)) return true;
  return false;
}

function getContractStatusCandidates(contract: UnknownRecord): string[] {
  const rawCandidates = [
    contract.status,
    contract.contract_status,
    contract.status_name,
    contract.workflow_status,
    contract.approval_status,
    contract.state,
  ];

  return rawCandidates
    .map((value) => readStr(value))
    .filter((value) => value.length > 0);
}

function hasContractStatus(contract: UnknownRecord): boolean {
  return getContractStatusCandidates(contract).length > 0;
}

function isApprovedContract(contract: UnknownRecord): boolean {
  const approvedFlag = contract.approved;
  if (typeof approvedFlag === "boolean") return approvedFlag;

  const isApprovedFlag = contract.is_approved;
  if (typeof isApprovedFlag === "boolean") return isApprovedFlag;

  const candidates = getContractStatusCandidates(contract);
  return candidates.some((status) => isApprovedStatusToken(status));
}

function getContractStatusLabel(contract: UnknownRecord): string {
  const candidates = getContractStatusCandidates(contract);
  return candidates[0] || "";
}

function unwrapArray(value: unknown): UnknownRecord[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is UnknownRecord => isRecord(item));
  }
  if (isRecord(value)) {
    const data = value.data;
    const results = value.results;
    if (Array.isArray(data)) return data.filter((item): item is UnknownRecord => isRecord(item));
    if (Array.isArray(results)) return results.filter((item): item is UnknownRecord => isRecord(item));
  }
  return [];
}

async function fetchProcoreJson(url: string, accessToken: string, companyId: string): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Procore-Company-Id": companyId,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    const errorDetail = errorText ? ` - ${errorText}` : "";
    throw new Error(`GET ${url} failed (${response.status})${errorDetail}`);
  }

  const text = await response.text();
  if (!text) return [];
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

async function fetchFirstSuccessfulArray(
  urls: string[],
  accessToken: string,
  companyId: string
): Promise<UnknownRecord[]> {
  let lastError = "";
  for (const url of urls) {
    try {
      const payload = await fetchProcoreJson(url, accessToken, companyId);
      return unwrapArray(payload);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      continue;
    }
  }
  if (lastError) throw new Error(lastError);
  return [];
}

function approvedContracts(contracts: UnknownRecord[]): UnknownRecord[] {
  return contracts.filter((contract) => isApprovedContract(contract));
}

async function fetchApprovedContracts(
  contractType: ContractType,
  projectId: string,
  companyId: string,
  accessToken: string
): Promise<UnknownRecord[]> {
  if (contractType === "commitment_contract") {
    const commitmentUrl = `https://api.procore.com/rest/v2.0/companies/${encodeURIComponent(
      companyId
    )}/projects/${encodeURIComponent(projectId)}/commitment_contracts?page=1&per_page=100`;

    try {
      const records = await fetchFirstSuccessfulArray([commitmentUrl], accessToken, companyId);
      return approvedContracts(records);
    } catch {
      return [];
    }
  }

  const base = "https://api.procore.com/rest/v1.0/projects";
  const project = encodeURIComponent(projectId);
  const company = encodeURIComponent(companyId);

  const path =
    contractType === "work_order_contract"
      ? "work_order_contracts"
      : "purchase_order_contracts";

  const urls = [
    `${base}/${project}/${path}?company_id=${company}&filters[status]=Approved&page=1&per_page=100`,
    `${base}/${project}/${path}?company_id=${company}&page=1&per_page=100`,
  ];

  try {
    const filteredRecords = await fetchFirstSuccessfulArray([urls[0]], accessToken, companyId);
    if (filteredRecords.length > 0) {
      const approved = approvedContracts(filteredRecords);
      // If the Approved-filter URL returned results but none matched our status check,
      // use all of them (Procore already filtered by status server-side).
      return approved.length > 0 ? approved : filteredRecords;
    }

    const unfilteredRecords = await fetchFirstSuccessfulArray([urls[1]], accessToken, companyId);
    const approved = approvedContracts(unfilteredRecords);
    // Fall back to all contracts if none carry a recognisable approved status label.
    return approved.length > 0 ? approved : unfilteredRecords;
  } catch {
    // Some projects do not have both contract tools enabled.
    return [];
  }
}

async function fetchContractLineItems(
  contractType: ContractType,
  contractId: string,
  projectId: string,
  companyId: string,
  accessToken: string
): Promise<{ items: UnknownRecord[]; attempts: Array<{ url: string; itemsFound?: number; error?: string }> }> {
  const project = encodeURIComponent(projectId);
  const company = encodeURIComponent(companyId);
  const contract = encodeURIComponent(contractId);

  const urls =
    contractType === "commitment_contract"
      ? [
          // Correct Procore v2.0 endpoint with default view (max per_page=100 for v2.0)
          `https://api.procore.com/rest/v2.0/companies/${company}/projects/${project}/commitment_contracts/${contract}/line_items?page=1&per_page=100`,
          // With extended view for additional data
          `https://api.procore.com/rest/v2.0/companies/${company}/projects/${project}/commitment_contracts/${contract}/line_items?view=extended&page=1&per_page=100`,
          // Fallback: v2.0 with company scope only
          `https://api.procore.com/rest/v2.0/companies/${company}/commitment_contracts/${contract}/line_items?page=1&per_page=100`,
        ]
      : contractType === "work_order_contract"
        ? [
            `https://api.procore.com/rest/v1.0/projects/${project}/work_order_contracts/${contract}/line_items?company_id=${company}&page=1&per_page=200`,
            `https://api.procore.com/rest/v1.0/work_order_contracts/${contract}/line_items?project_id=${project}&company_id=${company}&page=1&per_page=200`,
            `https://api.procore.com/rest/v1.0/work_order_contracts/${contract}/line_items?company_id=${company}&page=1&per_page=200`,
          ]
        : [
            `https://api.procore.com/rest/v1.0/projects/${project}/purchase_order_contracts/${contract}/line_items?company_id=${company}&page=1&per_page=200`,
            `https://api.procore.com/rest/v1.0/purchase_order_contracts/${contract}/line_items?project_id=${project}&company_id=${company}&page=1&per_page=200`,
            `https://api.procore.com/rest/v1.0/purchase_order_contracts/${contract}/line_items?company_id=${company}&page=1&per_page=200`,
          ];

  const attempts: Array<{ url: string; itemsFound?: number; error?: string }> = [];
  let bestResult: UnknownRecord[] = [];

  for (const url of urls) {
    try {
      console.log(`[valid-line-items] Fetching from: ${url}`);
      const payload = await fetchProcoreJson(url, accessToken, companyId);
      const result = unwrapArray(payload);
      console.log(`[valid-line-items] Got ${result.length} items from: ${url}`);
      attempts.push({ url, itemsFound: result.length });
      if (result.length > 0 && bestResult.length === 0) {
        bestResult = result;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[valid-line-items] Attempt failed: ${errorMsg}`);
      attempts.push({ url, error: errorMsg });
    }
  }

  return { items: bestResult, attempts };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = readStr(url.searchParams.get("projectId"));

    if (!projectId) {
      return NextResponse.json({ error: "Missing required query parameter: projectId" }, { status: 400 });
    }

    const cookieStore = await cookies();
    const accessToken =
      readStr(cookieStore.get("procore_access_token")?.value) ||
      readStr(url.searchParams.get("accessToken"));

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token. Authenticate with Procore first or provide accessToken." },
        { status: 401 }
      );
    }

    const companyId =
      readStr(url.searchParams.get("companyId")) ||
      readStr(cookieStore.get("procore_company_id")?.value) ||
      readStr(procoreConfig.companyId);

    if (!companyId) {
      return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    }

    const commitmentContracts = await fetchApprovedContracts(
      "commitment_contract",
      projectId,
      companyId,
      accessToken
    );
    const workOrderContracts = await fetchApprovedContracts(
      "work_order_contract",
      projectId,
      companyId,
      accessToken
    );
    const purchaseOrderContracts = await fetchApprovedContracts(
      "purchase_order_contract",
      projectId,
      companyId,
      accessToken
    );

    const allOptions: ProductivityLineItemOption[] = [];
    const allAttempts: Array<{ contractType: string; contractId: string; url: string; itemsFound?: number; error?: string }> = [];

    for (const contract of commitmentContracts) {
      const contractId = readStr(contract.id);
      if (!contractId) continue;
      const { items: lineItems, attempts } = await fetchContractLineItems(
        "commitment_contract",
        contractId,
        projectId,
        companyId,
        accessToken
      );
      for (const attempt of attempts) {
        allAttempts.push({ contractType: "commitment_contract", contractId, ...attempt });
      }

      for (const item of lineItems) {
        const lineItemId = readNum(item.id);
        if (lineItemId === undefined) continue;
        allOptions.push({
          line_item_id: lineItemId,
          description: readStr(item.description) || readStr(item.name),
          uom: readStr(item.uom),
          unit_cost: readNum(item.unit_cost) ?? readNum(item.unit_price) ?? null,
          amount: readNum(item.amount) ?? null,
          quantity: readNum(item.quantity) ?? null,
          contract_id: contractId,
          contract_type: "commitment_contract",
          contract_title: readStr(contract.title),
          contract_number: readStr(contract.number),
          contract_status: getContractStatusLabel(contract),
        });
      }
    }

    for (const contract of workOrderContracts) {
      const contractId = readStr(contract.id);
      if (!contractId) continue;
      const { items: lineItems, attempts } = await fetchContractLineItems(
        "work_order_contract",
        contractId,
        projectId,
        companyId,
        accessToken
      );
      for (const attempt of attempts) {
        allAttempts.push({ contractType: "work_order_contract", contractId, ...attempt });
      }

      for (const item of lineItems) {
        const lineItemId = readNum(item.id);
        if (lineItemId === undefined) continue;
        allOptions.push({
          line_item_id: lineItemId,
          description: readStr(item.description) || readStr(item.name),
          uom: readStr(item.uom),
          unit_cost: readNum(item.unit_cost) ?? readNum(item.unit_price) ?? null,
          amount: readNum(item.amount) ?? null,
          quantity: readNum(item.quantity) ?? null,
          contract_id: contractId,
          contract_type: "work_order_contract",
          contract_title: readStr(contract.title),
          contract_number: readStr(contract.number),
          contract_status: getContractStatusLabel(contract),
        });
      }
    }

    for (const contract of purchaseOrderContracts) {
      const contractId = readStr(contract.id);
      if (!contractId) continue;
      const { items: lineItems, attempts } = await fetchContractLineItems(
        "purchase_order_contract",
        contractId,
        projectId,
        companyId,
        accessToken
      );
      for (const attempt of attempts) {
        allAttempts.push({ contractType: "purchase_order_contract", contractId, ...attempt });
      }

      for (const item of lineItems) {
        const lineItemId = readNum(item.id);
        if (lineItemId === undefined) continue;
        allOptions.push({
          line_item_id: lineItemId,
          description: readStr(item.description) || readStr(item.name),
          uom: readStr(item.uom),
          unit_cost: readNum(item.unit_cost) ?? readNum(item.unit_price) ?? null,
          amount: readNum(item.amount) ?? null,
          quantity: readNum(item.quantity) ?? null,
          contract_id: contractId,
          contract_type: "purchase_order_contract",
          contract_title: readStr(contract.title),
          contract_number: readStr(contract.number),
          contract_status: getContractStatusLabel(contract),
        });
      }
    }

    const dedupe = new Map<string, ProductivityLineItemOption>();
    for (const option of allOptions) {
      const key = `${option.contract_type}:${option.contract_id}:${option.line_item_id}`;
      if (!dedupe.has(key)) dedupe.set(key, option);
    }

    const options = Array.from(dedupe.values()).sort((a, b) => {
      if (a.contract_type !== b.contract_type) {
        return a.contract_type.localeCompare(b.contract_type);
      }
      if (a.contract_number !== b.contract_number) {
        return a.contract_number.localeCompare(b.contract_number);
      }
      return a.line_item_id - b.line_item_id;
    });

    const debug = {
      commitmentContractDetails: commitmentContracts.map((c) => ({
        id: readStr(c.id),
        title: readStr(c.title),
        number: readStr(c.number),
        status: getContractStatusLabel(c),
      })),
      workOrderContractDetails: workOrderContracts.map((c) => ({
        id: readStr(c.id),
        title: readStr(c.title),
        number: readStr(c.number),
        status: getContractStatusLabel(c),
      })),
      purchaseOrderContractDetails: purchaseOrderContracts.map((c) => ({
        id: readStr(c.id),
        title: readStr(c.title),
        number: readStr(c.number),
        status: getContractStatusLabel(c),
      })),
      lineItemFetchAttempts: allAttempts,
    };

    return NextResponse.json({
      success: true,
      projectId,
      companyId,
      counts: {
        approvedCommitmentContracts: commitmentContracts.length,
        approvedWorkOrderContracts: workOrderContracts.length,
        approvedPurchaseOrderContracts: purchaseOrderContracts.length,
        lineItems: options.length,
      },
      items: options,
      debug,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[valid-line-items] Error:", message);
    return NextResponse.json(
      { error: "Failed to load valid productivity line items", details: message },
      { status: 500 }
    );
  }
}
