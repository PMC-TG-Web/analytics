import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";

type UnknownRecord = Record<string, unknown>;

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

function readNullableNum(value: unknown): number | null | undefined {
  if (value === null) return null;
  return readNum(value);
}

function normalizeStringLike(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function normalizeNumericArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((item) => readNum(item))
    .filter((item): item is number => item !== undefined);
  return out.length > 0 ? out : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((item) => normalizeStringLike(item))
    .filter((item): item is string => Boolean(item));
  return out.length > 0 ? out : undefined;
}

function normalizeProductivityLog(input: unknown): UnknownRecord | null {
  if (!isRecord(input)) return null;

  const payload: UnknownRecord = {};

  const date = readStr(input.date);
  const datetime = readStr(input.datetime);
  const lineItemId = readNum(input.line_item_id ?? input.lineItemId);
  const locationId = readNullableNum(input.location_id ?? input.locationId);
  const dailyLogSegmentId = readNum(input.daily_log_segment_id ?? input.dailyLogSegmentId);
  const notes = normalizeStringLike(input.notes);
  const quantityDelivered = readNum(input.quantity_delivered ?? input.quantityDelivered);
  const quantityUsed = readNum(input.quantity_used ?? input.quantityUsed);

  if (date) payload.date = date;
  if (datetime) payload.datetime = datetime;
  if (lineItemId !== undefined) payload.line_item_id = lineItemId;
  if (locationId !== undefined) payload.location_id = locationId;
  if (dailyLogSegmentId !== undefined) payload.daily_log_segment_id = dailyLogSegmentId;
  if (notes) payload.notes = notes;
  if (quantityDelivered !== undefined) payload.quantity_delivered = quantityDelivered;
  if (quantityUsed !== undefined) payload.quantity_used = quantityUsed;

  const drawingRevisionIds = normalizeNumericArray(input.drawing_revision_ids ?? input.drawingRevisionIds);
  const fileVersionIds = normalizeNumericArray(input.file_version_ids ?? input.fileVersionIds);
  const formIds = normalizeNumericArray(input.form_ids ?? input.formIds);
  const imageIds = normalizeNumericArray(input.image_ids ?? input.imageIds);
  const uploadIds = normalizeStringArray(input.upload_ids ?? input.uploadIds);
  const documentRevisionIds = normalizeStringArray(
    input.document_management_document_revision_ids ?? input.documentManagementDocumentRevisionIds
  );

  if (drawingRevisionIds) payload.drawing_revision_ids = drawingRevisionIds;
  if (fileVersionIds) payload.file_version_ids = fileVersionIds;
  if (formIds) payload.form_ids = formIds;
  if (imageIds) payload.image_ids = imageIds;
  if (uploadIds) payload.upload_ids = uploadIds;
  if (documentRevisionIds) {
    payload.document_management_document_revision_ids = documentRevisionIds;
  }

  return payload;
}

type LineageMatch = {
  contractType: "commitment_contract" | "purchase_order_contract";
  contractId: string;
  contractStatus: string;
  lineItemId: number;
};

type LineageValidationResult = {
  canValidate: boolean;
  matched: boolean;
  approved: boolean;
  match?: LineageMatch;
  checkedContracts: number;
  notes?: string[];
};

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
    throw new Error(`GET ${url} failed (${response.status})`);
  }
  return response.json().catch(() => []);
}

function toRecordArray(value: unknown): UnknownRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is UnknownRecord => isRecord(item));
}

function isApprovedStatus(value: unknown): boolean {
  const status = readStr(value).toLowerCase();
  if (!status) return false;
  if (status === "approved") return true;
  return status.includes("approved") && !status.includes("unapproved");
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

function getContractStatusLabel(contract: UnknownRecord): string {
  const candidates = getContractStatusCandidates(contract);
  return candidates[0] || "";
}

function isApprovedContract(contract: UnknownRecord): boolean {
  const approvedFlag = contract.approved;
  if (typeof approvedFlag === "boolean") return approvedFlag;

  const isApprovedFlag = contract.is_approved;
  if (typeof isApprovedFlag === "boolean") return isApprovedFlag;

  return getContractStatusCandidates(contract).some((status) => isApprovedStatus(status));
}

async function validateLineItemAncestry(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  lineItemId: number;
}): Promise<LineageValidationResult> {
  const { accessToken, companyId, projectId, lineItemId } = params;

  const notes: string[] = [];
  let checkedContracts = 0;

  try {
    const commitmentContractsUrl = `https://api.procore.com/rest/v2.0/companies/${encodeURIComponent(
      companyId
    )}/projects/${encodeURIComponent(projectId)}/commitment_contracts?page=1&per_page=100`;
    const commitmentContractsRaw = await fetchProcoreJson(commitmentContractsUrl, accessToken, companyId);
    const commitmentContracts = toRecordArray(commitmentContractsRaw);

    for (const contract of commitmentContracts) {
      const contractId = readStr(contract.id);
      if (!contractId) continue;

      const contractStatus = getContractStatusLabel(contract);
      const lineItemsUrl = `https://api.procore.com/rest/v2.0/companies/${encodeURIComponent(
        companyId
      )}/projects/${encodeURIComponent(projectId)}/commitment_contracts/${encodeURIComponent(
        contractId
      )}/line_items?page=1&per_page=100`;

      let lineItems: UnknownRecord[] = [];
      try {
        const lineItemsRaw = await fetchProcoreJson(lineItemsUrl, accessToken, companyId);
        lineItems = toRecordArray(
          isRecord(lineItemsRaw) && Array.isArray(lineItemsRaw.data)
            ? lineItemsRaw.data
            : lineItemsRaw
        );
      } catch {
        continue;
      }

      checkedContracts += 1;

      const found = lineItems.some((item) => readNum(item.id) === lineItemId);
      if (found) {
        return {
          canValidate: true,
          matched: true,
          approved: isApprovedContract(contract),
          match: {
            contractType: "commitment_contract",
            contractId,
            contractStatus,
            lineItemId,
          },
          checkedContracts,
        };
      }
    }
  } catch (error) {
    notes.push(error instanceof Error ? error.message : String(error));
  }

  try {
    const poContractsUrl = `https://api.procore.com/rest/v1.0/projects/${encodeURIComponent(
      projectId
    )}/purchase_order_contracts?company_id=${encodeURIComponent(companyId)}&page=1&per_page=100`;
    const poContractsRaw = await fetchProcoreJson(poContractsUrl, accessToken, companyId);
    const poContracts = toRecordArray(poContractsRaw);

    for (const contract of poContracts) {
      const contractId = readStr(contract.id);
      if (!contractId) continue;

      const contractStatus = getContractStatusLabel(contract);
      const lineItemsUrl = `https://api.procore.com/rest/v1.0/projects/${encodeURIComponent(
        projectId
      )}/purchase_order_contracts/${encodeURIComponent(contractId)}/line_items?company_id=${encodeURIComponent(
        companyId
      )}&page=1&per_page=200`;

      let lineItems: UnknownRecord[] = [];
      try {
        const lineItemsRaw = await fetchProcoreJson(lineItemsUrl, accessToken, companyId);
        lineItems = toRecordArray(lineItemsRaw);
      } catch {
        continue;
      }

      checkedContracts += 1;

      const found = lineItems.some((item) => readNum(item.id) === lineItemId);
      if (found) {
        return {
          canValidate: true,
          matched: true,
          approved: isApprovedContract(contract),
          match: {
            contractType: "purchase_order_contract",
            contractId,
            contractStatus,
            lineItemId,
          },
          checkedContracts,
        };
      }
    }
  } catch (error) {
    notes.push(error instanceof Error ? error.message : String(error));
  }

  return {
    canValidate: checkedContracts > 0,
    matched: false,
    approved: false,
    checkedContracts,
    notes: notes.length > 0 ? notes : undefined,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const cookieStore = await cookies();

    const bodyToken = readStr(body.accessToken);
    const cookieToken = readStr(cookieStore.get("procore_access_token")?.value);
    const accessToken = cookieToken || bodyToken;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token. Authenticate with Procore first or provide accessToken." },
        { status: 401 }
      );
    }

    const companyId = readStr(
      body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId
    );
    const projectId = readStr(body.projectId || body.project_id);

    if (!companyId || !projectId) {
      return NextResponse.json(
        { error: "Missing required fields: companyId and projectId" },
        { status: 400 }
      );
    }

    const source = isRecord(body.productivity_log)
      ? body.productivity_log
      : isRecord(body.productivityLog)
        ? body.productivityLog
        : body;

    const productivityLog = normalizeProductivityLog(source);
    if (!productivityLog) {
      return NextResponse.json(
        { error: "Missing required payload object: productivity_log" },
        { status: 400 }
      );
    }

    if (readNum(productivityLog.line_item_id) === undefined) {
      return NextResponse.json(
        {
          error: "Missing required field: productivity_log.line_item_id",
          details: "line_item_id must reference a line item from an approved contract.",
        },
        { status: 400 }
      );
    }

    if (!readStr(productivityLog.date) && !readStr(productivityLog.datetime)) {
      return NextResponse.json(
        { error: "Provide productivity_log.date or productivity_log.datetime" },
        { status: 400 }
      );
    }

    const lineItemId = readNum(productivityLog.line_item_id);
    if (lineItemId !== undefined) {
      const lineage = await validateLineItemAncestry({
        accessToken,
        companyId,
        projectId,
        lineItemId,
      });

      if (lineage.canValidate && !lineage.matched) {
        return NextResponse.json(
          {
            error: "Invalid line_item_id ancestry for productivity_log",
            details:
              "The provided line_item_id was not found under project commitment or purchase order contract line items. Use an approved contract, then use its Show endpoint to pick a line item ID.",
            lineItemValidation: lineage,
            attemptedPayload: { productivity_log: productivityLog },
          },
          { status: 422 }
        );
      }

      if (lineage.matched && !lineage.approved) {
        return NextResponse.json(
          {
            error: "line_item_id belongs to a non-approved contract",
            details:
              "Productivity logs require a line_item_id from an approved contract. Use filters[status]=Approved on Work Order or Purchase Order contracts, then select a line item from that contract.",
            lineItemValidation: lineage,
            attemptedPayload: { productivity_log: productivityLog },
          },
          { status: 422 }
        );
      }
    }

    const baseUrl = `https://api.procore.com/rest/v1.0/projects/${encodeURIComponent(projectId)}/productivity_logs`;
    const urlAttempts = [baseUrl, `${baseUrl}?company_id=${encodeURIComponent(companyId)}`];

    const payloadAttempts: UnknownRecord[] = [productivityLog];
    const payloadDate = readStr(productivityLog.date);
    if (payloadDate && !readStr(productivityLog.datetime)) {
      payloadAttempts.push({
        ...productivityLog,
        datetime: `${payloadDate}T00:00:00Z`,
      });
    }

    const attemptResults: Array<{ status: number; url: string; attemptedPayload: UnknownRecord; upstream?: unknown }> = [];

    for (const url of urlAttempts) {
      for (const attemptedPayload of payloadAttempts) {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            "Procore-Company-Id": companyId,
          },
          body: JSON.stringify({ productivity_log: attemptedPayload }),
        });

        const rawText = await response.text();
        let parsed: unknown = rawText;
        try {
          parsed = rawText ? JSON.parse(rawText) : {};
        } catch {
          parsed = rawText || {};
        }

        if (response.ok) {
          return NextResponse.json({
            success: true,
            source: "productivity_logs.create",
            companyId,
            projectId,
            url,
            attemptedPayload: { productivity_log: attemptedPayload },
            result: parsed,
          });
        }

        attemptResults.push({
          status: response.status,
          url,
          attemptedPayload,
          upstream: parsed,
        });

        // Retry only server-side failures where payload/URL variation can help.
        if (response.status < 500) {
          return NextResponse.json(
            {
              error: `Create productivity log API error ${response.status}`,
              details: typeof parsed === "string" ? parsed : undefined,
              upstream: typeof parsed === "object" && parsed !== null ? parsed : undefined,
              attemptedPayload: { productivity_log: attemptedPayload },
              url,
            },
            { status: response.status }
          );
        }
      }
    }

    const lastAttempt = attemptResults[attemptResults.length - 1];
    return NextResponse.json(
      {
        error: `Create productivity log API error ${lastAttempt?.status ?? 500}`,
        details: "All productivity log create attempts failed. Validate line_item_id and project permissions in Procore.",
        upstream:
          lastAttempt && typeof lastAttempt.upstream === "object" && lastAttempt.upstream !== null
            ? lastAttempt.upstream
            : undefined,
        attemptedPayload: lastAttempt ? { productivity_log: lastAttempt.attemptedPayload } : undefined,
        url: lastAttempt?.url,
        attempts: attemptResults.map((item) => ({
          status: item.status,
          url: item.url,
          attemptedPayload: { productivity_log: item.attemptedPayload },
          upstream: typeof item.upstream === "object" && item.upstream !== null ? item.upstream : undefined,
        })),
      },
      { status: lastAttempt?.status ?? 500 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to create productivity log", details: message },
      { status: 500 }
    );
  }
}
