import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";
import { buildAllowedProcoreHostCandidates } from "@/lib/procoreHosts";

const DEFAULT_ESTIMATING_BASE_URL = "https://api.procore.com";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function normalizeLaborTimeUnit(raw: string): string {
  const key = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    min: "MINUTES",
    mins: "MINUTES",
    minute: "MINUTES",
    minutes: "MINUTES",
    hr: "HOURS",
    hrs: "HOURS",
    hour: "HOURS",
    hours: "HOURS",
    day: "DAYS",
    days: "DAYS",
  };
  return map[key] || raw.trim().toUpperCase();
}

function normalizeCostItemUnit(raw: string): string {
  const key = raw.trim().toLowerCase();
  const compact = key.replace(/\s+/g, " ");
  const map: Record<string, string> = {
    ea: "EA",
    each: "EA",
    lf: "LF",
    ft: "LF",
    feet: "LF",
    sf: "SF",
    "sq ft": "SF",
    sqft: "SF",
    sy: "SY",
    "sq yd": "SY",
    sqyd: "SY",
    cf: "CF",
    "cu ft": "CF",
    cuft: "CF",
    cy: "CY",
    "cu yd": "CY",
    "c u yd": "CY",
    "cubic yard": "CY",
    "cubic yards": "CY",
    yd3: "CY",
    ls: "LS",
    lot: "LS",
    lots: "LS",
    hr: "HR",
    hrs: "HR",
    hour: "HR",
    hours: "HR",
  };
  return map[compact] || raw.trim().toUpperCase();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const cookieStore = await cookies();

    const bodyToken = String(body.accessToken || "").trim();
    const cookieToken = String(cookieStore.get("procore_access_token")?.value || "").trim();
    const accessToken = cookieToken || bodyToken;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token. Authenticate with Procore first or provide accessToken." },
        { status: 401 }
      );
    }

    const companyId = String(
      body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId || ""
    ).trim();
    const bidBoardProjectId = String(body.bidBoardProjectId || body.bid_board_project_id || "").trim();
    const proposalId = String(body.proposalId || body.proposal_id || "").trim();

    if (!companyId || !bidBoardProjectId || !proposalId) {
      return NextResponse.json(
        { error: "Missing required fields: companyId, bidBoardProjectId, proposalId" },
        { status: 400 }
      );
    }

    const readStr = (v: unknown) =>
      typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
    const readNum = (v: unknown): number | undefined => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim() !== "") { const n = Number(v); if (Number.isFinite(n)) return n; }
      return undefined;
    };
    const readBool = (v: unknown): boolean | undefined => {
      if (typeof v === "boolean") return v;
      if (typeof v === "string") { const s = v.trim().toLowerCase(); if (s === "true") return true; if (s === "false") return false; }
      return undefined;
    };

    // Support both a pre-built lineItem object or flat body fields
    const src = isRecord(body.lineItem) ? body.lineItem : body;

    const name = readStr(src.name);
    if (!name) {
      return NextResponse.json({ error: "Missing required field: name" }, { status: 400 });
    }

    const lineItemPayload: UnknownRecord = { name };

    const groupId = readStr(src.group_id ?? src.groupId);
    const tag = readStr(src.tag);
    const laborFactor = readNum(src.labor_factor ?? src.laborFactor);
    if (groupId) lineItemPayload.group_id = groupId;
    if (tag) lineItemPayload.tag = tag;
    if (laborFactor !== undefined) lineItemPayload.labor_factor = laborFactor;

    // Build cost_item sub-object — check ci_* prefixed flat keys for xlsx upload ergonomics
    const ciSrc = isRecord(src.cost_item) ? src.cost_item : src;
    const ciStrFields: Array<[string, string]> = [
      ["type", "type"],
      ["based_on_item_id", "basedOnItemId"],
      ["name", "costItemName"],
      ["description", "description"],
      ["labor_time_unit", "laborTimeUnit"],
      ["manufacturer", "manufacturer"],
      ["catalog_number", "catalogNumber"],
      ["url", "url"],
      ["supplier", "supplier"],
      ["unit", "unit"],
      ["notes", "costItemNotes"],
      ["id", "costItemId"],
      ["color", "color"],
      ["symbol_id", "symbolId"],
      ["catalog_id", "catalogId"],
    ];
    const ciNumFields: Array<[string, string]> = [
      ["unit_cost", "unitCost"],
      ["unit_labor", "unitLabor"],
      ["unit_labor_cost", "unitLaborCost"],
      ["waste", "waste"],
      ["material_waste", "materialWaste"],
      ["item_margin", "itemMargin"],
      ["labor_margin", "laborMargin"],
      ["unit_labor_rate", "unitLaborRate"],
      ["delivery_unit", "deliveryUnit"],
    ];

    const costItem: UnknownRecord = {};
    for (const [snake, camel] of ciStrFields) {
      const v = readStr(ciSrc[snake] ?? ciSrc[camel] ?? src[`ci_${snake}`] ?? src[`ci_${camel}`]);
      if (v) costItem[snake] = v;
    }
    if (typeof costItem.labor_time_unit === "string") {
      costItem.labor_time_unit = normalizeLaborTimeUnit(costItem.labor_time_unit);
    }
    if (typeof costItem.unit === "string") {
      costItem.unit = normalizeCostItemUnit(costItem.unit);
    }
    for (const [snake, camel] of ciNumFields) {
      const v = readNum(ciSrc[snake] ?? ciSrc[camel] ?? src[`ci_${snake}`] ?? src[`ci_${camel}`]);
      if (v !== undefined) costItem[snake] = v;
    }
    const isUntaxed = readBool(ciSrc.is_untaxed ?? ciSrc.isUntaxed ?? src.is_untaxed ?? src.isUntaxed);
    if (isUntaxed !== undefined) costItem.is_untaxed = isUntaxed;
    if (Object.keys(costItem).length > 0) lineItemPayload.cost_item = costItem;

    const requestedBaseUrl = String(
      body.baseUrl || process.env.PROCORE_ESTIMATING_API_URL || DEFAULT_ESTIMATING_BASE_URL
    ).trim();

    const hostCandidates = buildAllowedProcoreHostCandidates({
      requestedOrigin: requestedBaseUrl,
      extraOrigins: [process.env.PROCORE_ESTIMATING_API_URL, DEFAULT_ESTIMATING_BASE_URL, "https://api.procore.com"],
    });

    if (hostCandidates.error) {
      return NextResponse.json({ error: hostCandidates.error }, { status: 400 });
    }

    const attempts: Array<{ host: string; status: number; message: string }> = [];

    for (const host of hostCandidates.candidates) {
      const url = `${host.replace(/\/$/, "")}/rest/v2.0/companies/${encodeURIComponent(
        companyId
      )}/estimating/bid_board_projects/${encodeURIComponent(
        bidBoardProjectId
      )}/proposals/${encodeURIComponent(proposalId)}/line_items`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "Procore-Company-Id": companyId,
        },
        body: JSON.stringify(lineItemPayload),
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
            error: `Create line item API error ${response.status}`,
            details: errorText,
            host,
            attemptedPayload: lineItemPayload,
          },
          { status: response.status }
        );
      }

      const payload = (await response.json().catch(() => ({}))) as unknown;
      const payloadRecord = isRecord(payload) ? payload : {};
      const dataRecord = isRecord(payloadRecord.data) ? payloadRecord.data : payloadRecord;
      const createdLineItemId = String(dataRecord.id || dataRecord.line_item_id || "").trim() || null;

      return NextResponse.json({
        success: true,
        source: "estimating.create_line_item",
        companyId,
        bidBoardProjectId,
        proposalId,
        baseUrl: host,
        lineItemId: createdLineItemId,
        lineItem: payload,
        attemptedPayload: lineItemPayload,
      });
    }

    return NextResponse.json(
      {
        error: "Failed to create line item",
        details: "All configured hosts failed",
        attempts,
      },
      { status: 404 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to create line item",
        details: message,
      },
      { status: 500 }
    );
  }
}
