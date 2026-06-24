import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";
import { buildAllowedProcoreHostCandidates } from "@/lib/procoreHosts";

const DEFAULT_ESTIMATING_BASE_URL = "https://api.procore.com";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string {
  return String(value || "").trim();
}

function formatExcelSerialDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;

  const date = new Date(Date.UTC(1899, 11, 30));
  date.setUTCDate(date.getUTCDate() + Math.floor(serial));
  return date.toISOString();
}

function normalizeUtcDateTime(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00:00Z`;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return value;
}

function readDateString(value: unknown): string {
  if (typeof value === "number") {
    return formatExcelSerialDate(value) || "";
  }

  const text = readString(value);
  if (!text) return "";

  const numericValue = Number(text);
  if (/^\d+(\.\d+)?$/.test(text) && Number.isFinite(numericValue)) {
    return formatExcelSerialDate(numericValue) || text;
  }

  return normalizeUtcDateTime(text);
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
}

function readTemplateFlag(body: UnknownRecord): boolean | undefined {
  return (
    readBoolean(body.is_template) ??
    readBoolean(body.isTemplate) ??
    readBoolean(body.as_template) ??
    readBoolean(body.asTemplate) ??
    readBoolean(body.template)
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const cookieStore = await cookies();

    const bodyToken = readString(body.accessToken);
    const cookieToken = readString(cookieStore.get("procore_access_token")?.value);
    let accessToken = bodyToken || cookieToken;
    let tokenSource = bodyToken ? "body" : cookieToken ? "cookie" : "client_credentials";

    if (!accessToken) {
      try {
        accessToken = await getClientCredentialsToken();
      } catch (error) {
        return NextResponse.json(
          {
            error: "Missing access token. Authenticate with Procore first or configure client credentials.",
            details: error instanceof Error ? error.message : String(error),
          },
          { status: 401 }
        );
      }
    }

    const companyId = readString(body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId);
    if (!companyId) {
      return NextResponse.json(
        { error: "Missing required field: companyId" },
        { status: 400 }
      );
    }

    const requestedBaseUrl = readString(
      body.baseUrl || process.env.PROCORE_ESTIMATING_API_URL || DEFAULT_ESTIMATING_BASE_URL
    );

    const hostCandidates = buildAllowedProcoreHostCandidates({
      requestedOrigin: requestedBaseUrl,
      extraOrigins: [process.env.PROCORE_ESTIMATING_API_URL, DEFAULT_ESTIMATING_BASE_URL, "https://api.procore.com"],
    });

    if (hostCandidates.error) {
      return NextResponse.json({ error: hostCandidates.error }, { status: 400 });
    }

    const name = readString(body.name);
    const status = readString(body.status || "ESTIMATING");
    const dueDate = readDateString(body.due_date || body.dueDate);

    if (!name) {
      return NextResponse.json(
        { error: "Missing required field: name" },
        { status: 400 }
      );
    }

    const payload: UnknownRecord = {
      name,
      status,
      ...(readString(body.description) ? { description: readString(body.description) } : {}),
      ...(dueDate ? { due_date: dueDate } : {}),
      ...(readString(body.project_number || body.projectNumber)
        ? { project_number: readString(body.project_number || body.projectNumber) }
        : {}),
      ...(typeof body.square_footage === "number" ? { square_footage: body.square_footage } : {}),
      ...(readBoolean(body.use_metric_units ?? body.useMetricUnits) !== undefined
        ? { use_metric_units: readBoolean(body.use_metric_units ?? body.useMetricUnits) }
        : {}),
      ...(readBoolean(body.use_tax_from_cost ?? body.useTaxFromCost) !== undefined
        ? { use_tax_from_cost: readBoolean(body.use_tax_from_cost ?? body.useTaxFromCost) }
        : {}),
      ...(readBoolean(body.individual_labor_rates ?? body.individualLaborRates) !== undefined
        ? { individual_labor_rates: readBoolean(body.individual_labor_rates ?? body.individualLaborRates) }
        : {}),
      ...(readTemplateFlag(body) !== undefined ? { is_template: readTemplateFlag(body) } : {}),
      ...(readBoolean(body.use_unit_labor_cost ?? body.useUnitLaborCost) !== undefined
        ? { use_unit_labor_cost: readBoolean(body.use_unit_labor_cost ?? body.useUnitLaborCost) }
        : {}),
      ...(readBoolean(body.wbs_validation_enabled ?? body.wbsValidationEnabled) !== undefined
        ? { wbs_validation_enabled: readBoolean(body.wbs_validation_enabled ?? body.wbsValidationEnabled) }
        : {}),
      ...(readBoolean(body.disable_ea_parts_rounding ?? body.disableEaPartsRounding) !== undefined
        ? { disable_ea_parts_rounding: readBoolean(body.disable_ea_parts_rounding ?? body.disableEaPartsRounding) }
        : {}),
    };

    if (isRecord(body.address)) {
      const address = body.address;
      payload.address = {
        ...(readString(address.street) ? { street: readString(address.street) } : {}),
        ...(readString(address.city) ? { city: readString(address.city) } : {}),
        ...(readString(address.state) ? { state: readString(address.state) } : {}),
        ...(readString(address.zip) ? { zip: readString(address.zip) } : {}),
        ...(readString(address.country) ? { country: readString(address.country) } : {}),
      };
    }

    const attempts: Array<{ host: string; status: number; message: string }> = [];

    for (const host of hostCandidates.candidates) {
      const url = `${host.replace(/\/$/, "")}/rest/v2.0/companies/${encodeURIComponent(
        companyId
      )}/estimating/bid_board_projects`;

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

      if (!response.ok) {
        const errorText = await response.text();
        attempts.push({
          host,
          status: response.status,
          message: errorText || "No response body",
        });

        if (response.status === 404) continue;

        return NextResponse.json(
          {
            error: `Create bid board project API error ${response.status}`,
            details: errorText,
            host,
            attemptedPayload: payload,
          },
          { status: response.status }
        );
      }

      const responsePayload = (await response.json().catch(() => ({}))) as unknown;
      const responseRecord = isRecord(responsePayload) ? responsePayload : {};
      const dataRecord = isRecord(responseRecord.data) ? responseRecord.data : responseRecord;

      return NextResponse.json({
        success: true,
        source: "estimating.create_bid_board_project",
        tokenSource,
        companyId,
        baseUrl: host,
        attemptedPayload: payload,
        bidBoardProjectId: readString(dataRecord.id || dataRecord.bid_board_project_id) || null,
        projectId: readString(dataRecord.project_id) || null,
        data: responsePayload,
      });
    }

    return NextResponse.json(
      {
        error: "Failed to create bid board project",
        details: "All configured hosts failed",
        attempts,
      },
      { status: 404 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to create bid board project",
        details: message,
      },
      { status: 500 }
    );
  }
}
