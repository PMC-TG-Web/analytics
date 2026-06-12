import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";

type UnknownRecord = Record<string, unknown>;
type AttachmentReference = { reference_id: string };

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

function readBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
}

function isLikelyReferenceId(value: string): boolean {
  return /^[0-9]+$/.test(value) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function normalizeAttachments(value: unknown): AttachmentReference[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments = value
    .map((entry) => {
      if (isRecord(entry)) {
        const referenceId = readStr(
          entry.reference_id ?? entry.referenceId ?? entry.upload_id ?? entry.uploadId ?? entry.id
        );
        if (!referenceId || !isLikelyReferenceId(referenceId)) return null;
        return { reference_id: referenceId };
      }

      const referenceId = readStr(entry);
      if (!referenceId || !isLikelyReferenceId(referenceId)) return null;
      return { reference_id: referenceId };
    })
    .filter((entry): entry is AttachmentReference => entry !== null);
  return attachments.length > 0 ? attachments : undefined;
}

function normalizePurchaseOrderContract(value: unknown): UnknownRecord | null {
  if (!isRecord(value)) return null;

  const payload: UnknownRecord = { ...value };

  if (payload.accounting_method === undefined && payload.accountingMethod !== undefined) {
    payload.accounting_method = payload.accountingMethod;
  }
  if (payload.approval_letter_date === undefined && payload.approvalLetterDate !== undefined) {
    payload.approval_letter_date = payload.approvalLetterDate;
  }
  if (payload.assignee_id === undefined && payload.assigneeId !== undefined) {
    payload.assignee_id = payload.assigneeId;
  }
  if (payload.bill_to_address === undefined && payload.billToAddress !== undefined) {
    payload.bill_to_address = payload.billToAddress;
  }
  if (payload.contract_date === undefined && payload.contractDate !== undefined) {
    payload.contract_date = payload.contractDate;
  }
  if (payload.delivery_date === undefined && payload.deliveryDate !== undefined) {
    payload.delivery_date = payload.deliveryDate;
  }
  if (payload.description === undefined && payload.html_description !== undefined) {
    payload.description = payload.html_description;
  }
  if (payload.execution_date === undefined && payload.executionDate !== undefined) {
    payload.execution_date = payload.executionDate;
  }
  if (payload.invoice_contact_user_ids === undefined && payload.invoiceContactUserIds !== undefined) {
    payload.invoice_contact_user_ids = payload.invoiceContactUserIds;
  }
  if (payload.issued_on_date === undefined && payload.issuedOnDate !== undefined) {
    payload.issued_on_date = payload.issuedOnDate;
  }
  if (payload.letter_of_intent_date === undefined && payload.letterOfIntentDate !== undefined) {
    payload.letter_of_intent_date = payload.letterOfIntentDate;
  }
  if (payload.origin_code === undefined && payload.originCode !== undefined) {
    payload.origin_code = payload.originCode;
  }
  if (payload.origin_data === undefined && payload.originData !== undefined) {
    payload.origin_data = payload.originData;
  }
  if (payload.origin_id === undefined && payload.originId !== undefined) {
    payload.origin_id = payload.originId;
  }
  if (payload.payment_terms === undefined && payload.paymentTerms !== undefined) {
    payload.payment_terms = payload.paymentTerms;
  }
  if (payload.retainage_percent === undefined && payload.retainagePercent !== undefined) {
    payload.retainage_percent = payload.retainagePercent;
  }
  if (payload.returned_date === undefined && payload.returnedDate !== undefined) {
    payload.returned_date = payload.returnedDate;
  }
  if (payload.ship_to_address === undefined && payload.shipToAddress !== undefined) {
    payload.ship_to_address = payload.shipToAddress;
  }
  if (payload.ship_via === undefined && payload.shipVia !== undefined) {
    payload.ship_via = payload.shipVia;
  }
  if (payload.private === undefined && payload.is_private !== undefined) {
    payload.private = payload.is_private;
  }
  if (payload.vendor_id === undefined && payload.vendorId !== undefined) {
    payload.vendor_id = payload.vendorId;
  }
  if (payload.currency_exchange_rate === undefined && payload.currencyExchangeRate !== undefined) {
    payload.currency_exchange_rate = payload.currencyExchangeRate;
  }
  if (payload.currency_iso_code === undefined && payload.currencyIsoCode !== undefined) {
    payload.currency_iso_code = payload.currencyIsoCode;
  }
  if (payload.signed_contract_received_date === undefined && payload.signedContractReceivedDate !== undefined) {
    payload.signed_contract_received_date = payload.signedContractReceivedDate;
  }
  if (payload.contract_start_date === undefined && payload.contractStartDate !== undefined) {
    payload.contract_start_date = payload.contractStartDate;
  }
  if (
    payload.contract_estimated_completion_date === undefined &&
    payload.contractEstimatedCompletionDate !== undefined
  ) {
    payload.contract_estimated_completion_date = payload.contractEstimatedCompletionDate;
  }
  if (payload.actual_completion_date === undefined && payload.actualCompletionDate !== undefined) {
    payload.actual_completion_date = payload.actualCompletionDate;
  }
  if (payload.signature_required === undefined && payload.signatureRequired !== undefined) {
    payload.signature_required = payload.signatureRequired;
  }
  if (
    payload.billing_schedule_of_values_status === undefined &&
    payload.billingScheduleOfValuesStatus !== undefined
  ) {
    payload.billing_schedule_of_values_status = payload.billingScheduleOfValuesStatus;
  }
  if (payload.allow_comments === undefined && payload.allowComments !== undefined) {
    payload.allow_comments = payload.allowComments;
  }
  if (payload.allow_markups === undefined && payload.allowMarkups !== undefined) {
    payload.allow_markups = payload.allowMarkups;
  }
  if (
    payload.change_order_level_of_detail === undefined &&
    payload.changeOrderLevelOfDetail !== undefined
  ) {
    payload.change_order_level_of_detail = payload.changeOrderLevelOfDetail;
  }
  if (payload.enable_ssov === undefined && payload.enableSsov !== undefined) {
    payload.enable_ssov = payload.enableSsov;
  }
  if (
    payload.allow_change_orders_ssov === undefined &&
    payload.allowChangeOrdersSsov !== undefined
  ) {
    payload.allow_change_orders_ssov = payload.allowChangeOrdersSsov;
  }
  if (
    payload.allow_payment_applications === undefined &&
    payload.allowPaymentApplications !== undefined
  ) {
    payload.allow_payment_applications = payload.allowPaymentApplications;
  }
  if (payload.allow_payments === undefined && payload.allowPayments !== undefined) {
    payload.allow_payments = payload.allowPayments;
  }
  if (
    payload.display_materials_retainage === undefined &&
    payload.displayMaterialsRetainage !== undefined
  ) {
    payload.display_materials_retainage = payload.displayMaterialsRetainage;
  }
  if (
    payload.display_work_retainage === undefined &&
    payload.displayWorkRetainage !== undefined
  ) {
    payload.display_work_retainage = payload.displayWorkRetainage;
  }
  if (payload.show_cost_code_on_pdf === undefined && payload.showCostCodeOnPdf !== undefined) {
    payload.show_cost_code_on_pdf = payload.showCostCodeOnPdf;
  }
  if (payload.ssr_enabled === undefined && payload.ssrEnabled !== undefined) {
    payload.ssr_enabled = payload.ssrEnabled;
  }
  if (payload.bill_recipient_ids === undefined && payload.billRecipientIds !== undefined) {
    payload.bill_recipient_ids = payload.billRecipientIds;
  }
  if (payload.accessor_ids === undefined && payload.accessorIds !== undefined) {
    payload.accessor_ids = payload.accessorIds;
  }
  if (payload.attachment_ids === undefined && payload.attachmentIds !== undefined) {
    payload.attachment_ids = payload.attachmentIds;
  }
  if (payload.drawing_revision_ids === undefined && payload.drawingRevisionIds !== undefined) {
    payload.drawing_revision_ids = payload.drawingRevisionIds;
  }
  if (payload.file_version_ids === undefined && payload.fileVersionIds !== undefined) {
    payload.file_version_ids = payload.fileVersionIds;
  }
  if (payload.form_ids === undefined && payload.formIds !== undefined) {
    payload.form_ids = payload.formIds;
  }
  if (payload.image_ids === undefined && payload.imageIds !== undefined) {
    payload.image_ids = payload.imageIds;
  }
  if (payload.upload_ids === undefined && payload.uploadIds !== undefined) {
    payload.upload_ids = payload.uploadIds;
  }
  if (
    payload.change_event_attachment_ids === undefined &&
    payload.changeEventAttachmentIds !== undefined
  ) {
    payload.change_event_attachment_ids = payload.changeEventAttachmentIds;
  }
  if (
    payload.request_for_quote_attachment_ids === undefined &&
    payload.requestForQuoteAttachmentIds !== undefined
  ) {
    payload.request_for_quote_attachment_ids = payload.requestForQuoteAttachmentIds;
  }
  if (payload.show_line_items_to_non_admins === undefined && payload.showLineItemsToNonAdmins !== undefined) {
    payload.show_line_items_to_non_admins = payload.showLineItemsToNonAdmins;
  }
  if (payload.type === undefined && payload.contract_type !== undefined) {
    payload.type = payload.contract_type;
  }
  if (payload.type === undefined && payload.contractType !== undefined) {
    payload.type = payload.contractType;
  }

  const normalizedCustomFieldKey = Object.keys(payload).find((key) => /^custom_field_/.test(key));
  if (!normalizedCustomFieldKey) {
    const customFieldEntry = Object.entries(payload).find(([key]) => /^customField_/.test(key));
    if (customFieldEntry) {
      const [key, value] = customFieldEntry;
      payload[key.replace(/^customField_/, "custom_field_")] = value;
      delete payload[key];
    }
  }

  return payload;
}

function normalizeStatusToApproved(value: unknown): string {
  const token = readStr(value).toLowerCase();
  if (!token) return "Approved";
  if (token === "approved") return "Approved";
  if (token.includes("approved") && !token.includes("unapproved")) return "Approved";
  return "Approved";
}

function enforceDailyLogSelectableDefaults(purchaseOrderContract: UnknownRecord): void {
  const typeToken = readStr(purchaseOrderContract.type);
  if (typeToken !== "PurchaseOrderContract" && typeToken !== "WorkOrderContract") return;

  // Daily Logs contract pickers are approval/visibility sensitive.
  purchaseOrderContract.status = normalizeStatusToApproved(purchaseOrderContract.status);
  purchaseOrderContract.private = false;

  // Daily Logs visibility requires unit-based contracts.
  purchaseOrderContract.accounting_method = "unit";

  if (purchaseOrderContract.show_line_items_to_non_admins === undefined) {
    purchaseOrderContract.show_line_items_to_non_admins = true;
  }
}

function appendFormValue(formData: FormData, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const entry of value) {
      appendFormValue(formData, `${key}[]`, entry);
    }
    return;
  }
  if (value instanceof Blob) {
    formData.append(key, value);
    return;
  }
  if (typeof value === "object") {
    formData.append(key, JSON.stringify(value));
    return;
  }
  formData.append(key, typeof value === "boolean" ? (value ? "true" : "false") : String(value));
}

function appendNestedFormFields(formData: FormData, prefix: string, value: unknown): void {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    for (const entry of value) {
      appendNestedFormFields(formData, `${prefix}[]`, entry);
    }
    return;
  }

  if (typeof value === "object" && !(value instanceof Blob)) {
    for (const [key, entry] of Object.entries(value as UnknownRecord)) {
      appendNestedFormFields(formData, `${prefix}[${key}]`, entry);
    }
    return;
  }

  appendFormValue(formData, prefix, value);
}

function buildValidationHints(upstream: unknown, purchaseOrderContract: UnknownRecord): string[] {
  const hints: string[] = [];
  const upstreamRecord = asRecord(upstream);
  const errors = asRecord(upstreamRecord?.errors);
  if (!errors) return hints;

  const vendorErrors = Array.isArray(errors.vendor_id) ? errors.vendor_id.map(readStr).filter(Boolean) : [];
  if (vendorErrors.some((msg) => /must be selected when the contract'?s status is not draft/i.test(msg))) {
    const status = readStr(purchaseOrderContract.status);
    hints.push(
      status
        ? `vendor_id is required when status is '${status}'. Either set a valid project vendor_id or change status to 'Draft'.`
        : "vendor_id is required when contract status is not 'Draft'."
    );
  }
  if (vendorErrors.some((msg) => /has not been added to this project/i.test(msg))) {
    const vendorId = readStr(purchaseOrderContract.vendor_id);
    hints.push(
      vendorId
        ? `vendor_id ${vendorId} is not linked to this project. Use a vendor contact assigned to project vendors.`
        : "vendor_id is required and must be a vendor linked to this project."
    );
  }

  const assigneeErrors = Array.isArray(errors.assignee_id) ? errors.assignee_id.map(readStr).filter(Boolean) : [];
  if (assigneeErrors.some((msg) => /unauthorized/i.test(msg) || /selected is unauthorized/i.test(msg))) {
    const assigneeId = readStr(purchaseOrderContract.assignee_id);
    hints.push(
      assigneeId
        ? `assignee_id ${assigneeId} is not authorized for this project/company directory context.`
        : "assignee_id must be a user authorized in this project's company directory context."
    );
  }

  const baseErrors = Array.isArray(errors.base) ? errors.base.map(readStr).filter(Boolean) : [];
  if (baseErrors.some((msg) => /referenced a user with no contact in the company directory/i.test(msg))) {
    const invoiceIds = Array.isArray(purchaseOrderContract.invoice_contact_user_ids)
      ? purchaseOrderContract.invoice_contact_user_ids.map(readStr).filter(Boolean)
      : [];
    if (invoiceIds.length > 0) {
      hints.push(
        `invoice_contact_user_ids (${invoiceIds.join(", ")}) must exist as contacts in the company directory for this project.`
      );
    } else {
      hints.push("One or more referenced users are not contacts in the company directory for this project.");
    }
  }

  if (baseErrors.some((msg) => /ancestry does not match/i.test(msg))) {
    hints.push(
      "One or more related IDs belong to a different company/project hierarchy. Re-select vendor/user IDs from this exact project context."
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
    const runConfigurableValidations = readBool(
      body.run_configurable_validations ?? body.runConfigurableValidations
    );
    const enforceDailyLogVisibility =
      readBool(body.enforce_daily_log_visibility ?? body.enforceDailyLogVisibility) !== false;
    const useLegacyV1 = readBool(body.useLegacyV1 ?? body.use_legacy_v1) === true;
    const commitmentView = readStr(body.view ?? body.commitment_view ?? body.commitmentView);

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

    const purchaseOrderContract = normalizePurchaseOrderContract(
      body.purchase_order_contract ?? body.purchaseOrderContract
    );

    if (!purchaseOrderContract) {
      return NextResponse.json(
        { error: "Missing required field: purchase_order_contract" },
        { status: 400 }
      );
    }

    const attachments = normalizeAttachments(body.attachments);
    const contractType = readStr(purchaseOrderContract.type) || "PurchaseOrderContract";
    purchaseOrderContract.type = contractType;

    if (!useLegacyV1 && enforceDailyLogVisibility) {
      enforceDailyLogSelectableDefaults(purchaseOrderContract);
    }

    // For v2 commitment endpoint, map attachment references to attachment_ids if needed.
    if (attachments && purchaseOrderContract.attachment_ids === undefined) {
      const attachmentIds = attachments.map((a) => a.reference_id);
      if (attachmentIds.length > 0) purchaseOrderContract.attachment_ids = attachmentIds;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Procore-Company-Id": companyId,
      "Content-Type": "application/json",
    };

    let url = "";
    let requestBody: string;
    const query = new URLSearchParams();

    if (useLegacyV1) {
      if (runConfigurableValidations !== undefined) {
        query.set("run_configurable_validations", String(runConfigurableValidations));
      }
      url = `https://api.procore.com/rest/v1.0/purchase_order_contracts${query.toString() ? `?${query.toString()}` : ""}`;
      const payload: UnknownRecord = {
        project_id: projectId,
        purchase_order_contract: purchaseOrderContract,
      };
      requestBody = JSON.stringify(payload);
    } else {
      if (commitmentView) query.set("view", commitmentView);
      url = `https://api.procore.com/rest/v2.0/companies/${encodeURIComponent(
        companyId
      )}/projects/${encodeURIComponent(projectId)}/commitment_contracts${
        query.toString() ? `?${query.toString()}` : ""
      }`;
      requestBody = JSON.stringify(purchaseOrderContract);
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: requestBody,
    });

    const rawText = await response.text();
    let parsed: unknown = rawText;
    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch {
      parsed = rawText || {};
    }

    if (!response.ok) {
      const validationHints = buildValidationHints(parsed, purchaseOrderContract);
      return NextResponse.json(
        {
          error: `Create purchase order contract API error ${response.status}`,
          details: typeof parsed === "string" ? parsed : undefined,
          upstream: typeof parsed === "object" && parsed !== null ? parsed : undefined,
          validationHints,
          attemptedPayload: useLegacyV1
            ? { project_id: projectId, purchase_order_contract: purchaseOrderContract }
            : purchaseOrderContract,
          apiVersion: useLegacyV1 ? "v1" : "v2",
          url,
        },
        { status: response.status }
      );
    }

    return NextResponse.json({
      success: true,
      source: "purchase_order_contracts.create",
      companyId,
      projectId,
      apiVersion: useLegacyV1 ? "v1" : "v2",
      dailyLogVisibilityProfile: {
        enforced: !useLegacyV1 && enforceDailyLogVisibility,
        status: readStr(purchaseOrderContract.status),
        private: readBool(purchaseOrderContract.private) ?? false,
        accounting_method: readStr(purchaseOrderContract.accounting_method),
      },
      url,
      query: Object.fromEntries(query.entries()),
      attemptedPayload: useLegacyV1
        ? { project_id: projectId, purchase_order_contract: purchaseOrderContract }
        : purchaseOrderContract,
      result: parsed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to create purchase order contract", details: message },
      { status: 500 }
    );
  }
}