import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStr(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
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

function readNumericOrString(value: unknown): number | string | undefined {
  const asString = readStr(value);
  if (!asString) return undefined;
  const asNum = readNum(value);
  if (asNum !== undefined && !String(value).includes(".")) return asNum;
  return asString;
}

function normalizeLineItem(value: unknown): UnknownRecord | null {
  if (!isRecord(value)) return null;

  const payload: UnknownRecord = { ...value };

  if (payload.cost_code_id === undefined && payload.costCodeId !== undefined) {
    payload.cost_code_id = payload.costCodeId;
  }
  if (payload.extended_type === undefined && payload.extendedType !== undefined) {
    payload.extended_type = payload.extendedType;
  }
  if (payload.line_item_type_id === undefined && payload.lineItemTypeId !== undefined) {
    payload.line_item_type_id = payload.lineItemTypeId;
  }
  if (payload.origin_data === undefined && payload.originData !== undefined) {
    payload.origin_data = payload.originData;
  }
  if (payload.origin_id === undefined && payload.originId !== undefined) {
    payload.origin_id = payload.originId;
  }
  if (payload.tax_code_id === undefined && payload.taxCodeId !== undefined) {
    payload.tax_code_id = payload.taxCodeId;
  }
  if (payload.unit_cost === undefined && payload.unitCost !== undefined) {
    payload.unit_cost = payload.unitCost;
  }
  if (payload.wbs_code_id === undefined && payload.wbsCodeId !== undefined) {
    payload.wbs_code_id = payload.wbsCodeId;
  }
  if (payload.wbs_code_id === undefined && payload.budget_code_id !== undefined) {
    payload.wbs_code_id = payload.budget_code_id;
  }
  if (payload.wbs_code_id === undefined && payload.budgetCodeId !== undefined) {
    payload.wbs_code_id = payload.budgetCodeId;
  }
  if (payload.budget_line_item_id === undefined && payload.budgetLineItemId !== undefined) {
    payload.budget_line_item_id = payload.budgetLineItemId;
  }
  if (payload.budget_line_item_id === undefined && payload.budget_code_id !== undefined) {
    payload.budget_line_item_id = payload.budget_code_id;
  }
  if (payload.budget_line_item_id === undefined && payload.budgetCodeId !== undefined) {
    payload.budget_line_item_id = payload.budgetCodeId;
  }

  const normalized: UnknownRecord = {};

  const amount = readNumericOrString(payload.amount);
  const description = readStr(payload.description);
  const extendedType = readStr(payload.extended_type);
  const quantity = readNumericOrString(payload.quantity);
  const originData = readStr(payload.origin_data);
  const uom = readStr(payload.uom);
  const unitCost = readNumericOrString(payload.unit_cost);

  const costCodeId = readNum(payload.cost_code_id);
  const lineItemTypeId = readNum(payload.line_item_type_id);
  const originId = readNum(payload.origin_id);
  const taxCodeId = readNum(payload.tax_code_id);
  const wbsCodeId = readNum(payload.wbs_code_id);
  const budgetLineItemId = readNum(payload.budget_line_item_id);

  if (amount !== undefined) normalized.amount = amount;
  if (costCodeId !== undefined) normalized.cost_code_id = costCodeId;
  if (description) normalized.description = description;
  if (extendedType) normalized.extended_type = extendedType;
  if (quantity !== undefined) normalized.quantity = quantity;
  if (lineItemTypeId !== undefined) normalized.line_item_type_id = lineItemTypeId;
  if (originData) normalized.origin_data = originData;
  if (originId !== undefined) normalized.origin_id = originId;
  if (taxCodeId !== undefined) normalized.tax_code_id = taxCodeId;
  if (unitCost !== undefined) normalized.unit_cost = unitCost;
  if (uom) normalized.uom = uom;
  if (wbsCodeId !== undefined) normalized.wbs_code_id = wbsCodeId;
  if (budgetLineItemId !== undefined) normalized.budget_line_item_id = budgetLineItemId;

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function buildValidationHints(upstream: unknown, lineItem: UnknownRecord): string[] {
  const hints: string[] = [];
  const upstreamRecord = asRecord(upstream);
  const rawErrors = upstreamRecord?.errors;

  const errorMessages = [
    ...(typeof rawErrors === "string" ? [rawErrors] : []),
    ...(Array.isArray(rawErrors) ? rawErrors.map(readStr).filter(Boolean) : []),
  ];

  if (errorMessages.some((msg) => /invalid tax code/i.test(msg))) {
    const taxCodeId = readStr(lineItem.tax_code_id);
    hints.push(
      taxCodeId
        ? `tax_code_id ${taxCodeId} is not valid for this project/company context. Remove it or replace it with a tax code available on this contract/project.`
        : "tax_code_id is invalid for this project/company context."
    );
  }

  if (errorMessages.some((msg) => /invalid cost code/i.test(msg))) {
    const costCodeId = readStr(lineItem.cost_code_id);
    const budgetLineItemId = readStr(lineItem.budget_line_item_id);
    const wbsCodeId = readStr(lineItem.wbs_code_id);
    hints.push(
      costCodeId
        ? `cost_code_id ${costCodeId} was sent, but Procore rejected it for this contract/project context. A real company cost code can still be invalid unless it is available on this project's budget/WBS setup. Try the matching budget_line_item_id or wbs_code_id for the same project.`
        : "Procore rejected the cost code for this contract/project context. Try the matching budget_line_item_id or wbs_code_id for the same project."
    );

    if (budgetLineItemId || wbsCodeId) {
      hints.push(
        `Budget references sent with this request: budget_line_item_id=${budgetLineItemId || "-"}, wbs_code_id=${wbsCodeId || "-"}.`
      );
    }
  }

  if (errorMessages.some((msg) => /budget|wbs/i.test(msg))) {
    const budgetLineItemId = readStr(lineItem.budget_line_item_id);
    const wbsCodeId = readStr(lineItem.wbs_code_id);
    hints.push(
      budgetLineItemId || wbsCodeId
        ? `Budget code was sent as budget_line_item_id=${budgetLineItemId || "-"} and wbs_code_id=${wbsCodeId || "-"}. If Procore still shows a blank Budget Code, verify the ID belongs to this exact project/commitment budget context.`
        : "No recognized budget reference was sent. Provide budget_line_item_id or wbs_code_id for the target project/commitment."
    );
  }

  return hints;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const cookieStore = await cookies();

    const accessToken = readStr(body.accessToken) || readStr(cookieStore.get("procore_access_token")?.value);
    const companyId = readStr(body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId);
    const projectId = readStr(body.project_id || body.projectId);
    const purchaseOrderContractId = readStr(
      body.purchase_order_contract_id ?? body.purchaseOrderContractId
    );

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token. Authenticate with Procore first or provide accessToken." },
        { status: 401 }
      );
    }

    if (!companyId) {
      return NextResponse.json({ error: "Missing companyId." }, { status: 400 });
    }

    if (!projectId) {
      return NextResponse.json({ error: "Missing required field: project_id" }, { status: 400 });
    }

    if (!purchaseOrderContractId) {
      return NextResponse.json(
        { error: "Missing required field: purchase_order_contract_id" },
        { status: 400 }
      );
    }

    const lineItem = normalizeLineItem(body.line_item ?? body.lineItem);
    if (!lineItem) {
      return NextResponse.json(
        { error: "Missing required field: line_item" },
        { status: 400 }
      );
    }

    const payload: UnknownRecord = {
      project_id: projectId,
      line_item: lineItem,
    };

    const url = `https://api.procore.com/rest/v1.0/purchase_order_contracts/${encodeURIComponent(
      purchaseOrderContractId
    )}/line_items`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Procore-Company-Id": companyId,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    let parsed: unknown = rawText;
    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch {
      parsed = rawText || {};
    }

    if (!response.ok) {
      const validationHints = buildValidationHints(parsed, lineItem);
      return NextResponse.json(
        {
          error: `Create purchase order contract line item API error ${response.status}`,
          details: typeof parsed === "string" ? parsed : undefined,
          upstream: typeof parsed === "object" && parsed !== null ? parsed : undefined,
          validationHints,
          attemptedPayload: payload,
          url,
        },
        { status: response.status }
      );
    }

    return NextResponse.json({
      success: true,
      source: "purchase_order_contracts.line_items.create",
      companyId,
      projectId,
      purchaseOrderContractId,
      url,
      attemptedPayload: payload,
      result: parsed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to create purchase order contract line item", details: message },
      { status: 500 }
    );
  }
}
