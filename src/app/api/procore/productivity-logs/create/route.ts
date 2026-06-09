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
  const quantityDelivered = normalizeStringLike(input.quantity_delivered ?? input.quantityDelivered);
  const quantityUsed = normalizeStringLike(input.quantity_used ?? input.quantityUsed);

  if (date) payload.date = date;
  if (datetime) payload.datetime = datetime;
  if (lineItemId !== undefined) payload.line_item_id = lineItemId;
  if (locationId !== undefined) payload.location_id = locationId;
  if (dailyLogSegmentId !== undefined) payload.daily_log_segment_id = dailyLogSegmentId;
  if (notes) payload.notes = notes;
  if (quantityDelivered) payload.quantity_delivered = quantityDelivered;
  if (quantityUsed) payload.quantity_used = quantityUsed;

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

    const url = `https://api.procore.com/rest/v1.0/projects/${encodeURIComponent(projectId)}/productivity_logs`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Procore-Company-Id": companyId,
      },
      body: JSON.stringify({ productivity_log: productivityLog }),
    });

    const rawText = await response.text();
    let parsed: unknown = rawText;
    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch {
      parsed = rawText || {};
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `Create productivity log API error ${response.status}`,
          details: typeof parsed === "string" ? parsed : undefined,
          upstream: typeof parsed === "object" && parsed !== null ? parsed : undefined,
          attemptedPayload: { productivity_log: productivityLog },
          url,
        },
        { status: response.status }
      );
    }

    return NextResponse.json({
      success: true,
      source: "productivity_logs.create",
      companyId,
      projectId,
      url,
      attemptedPayload: { productivity_log: productivityLog },
      result: parsed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to create productivity log", details: message },
      { status: 500 }
    );
  }
}
