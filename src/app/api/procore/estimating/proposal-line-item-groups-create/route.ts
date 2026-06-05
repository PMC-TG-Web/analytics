import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
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

    if (bidBoardProjectId === companyId) {
      return NextResponse.json(
        {
          error: "Invalid bidBoardProjectId",
          details: "bidBoardProjectId matches companyId. Provide the Bid Board Project ID (not the company ID).",
        },
        { status: 400 }
      );
    }

    const readStr = (v: unknown) => typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
    const readNum = (v: unknown): number | undefined => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string") { const n = Number(v); if (Number.isFinite(n)) return n; }
      return undefined;
    };
    const readBool = (v: unknown): boolean | undefined => {
      if (typeof v === "boolean") return v;
      if (typeof v === "string") { const s = v.trim().toLowerCase(); if (s === "true") return true; if (s === "false") return false; }
      return undefined;
    };

    // Support both a pre-built lineItemGroup object or flat body fields
    const src = isRecord(body.lineItemGroup) ? body.lineItemGroup : body;

    const name = readStr(src.name);
    if (!name) {
      return NextResponse.json(
        { error: "Missing required field: name" },
        { status: 400 }
      );
    }

    const groupPayload: UnknownRecord = { name };

    const notes = readStr(src.notes);
    const multiplier = readNum(src.multiplier);
    if (notes) groupPayload.notes = notes;
    if (multiplier !== undefined) groupPayload.multiplier = multiplier;

    // Build pricing_override only if any sub-field is present
    const poSrc = isRecord(src.pricing_override) ? src.pricing_override : src;
    const pricingFields: Array<[string, string]> = [
      ["unit_material_cost", "unitMaterialCost"],
      ["material_margin", "materialMargin"],
      ["unit_labor", "unitLabor"],
      ["labor_factor", "laborFactor"],
      ["unit_labor_rate", "unitLaborRate"],
      ["unit_labor_cost", "unitLaborCost"],
      ["labor_margin", "laborMargin"],
    ];
    const pricingOverride: UnknownRecord = {};
    for (const [snake, camel] of pricingFields) {
      const v = readNum(poSrc[snake] ?? poSrc[camel] ?? src[snake] ?? src[camel]);
      if (v !== undefined) pricingOverride[snake] = v;
    }
    const isUntaxed = readBool(poSrc.is_untaxed ?? poSrc.isUntaxed ?? src.is_untaxed ?? src.isUntaxed);
    if (isUntaxed !== undefined) pricingOverride.is_untaxed = isUntaxed;
    if (Object.keys(pricingOverride).length > 0) groupPayload.pricing_override = pricingOverride;

    const baseUrl = "https://api.procore.com";
    const url = `${baseUrl}/rest/v2.0/companies/${encodeURIComponent(
      companyId
    )}/estimating/bid_board_projects/${encodeURIComponent(
      bidBoardProjectId
    )}/proposals/${encodeURIComponent(proposalId)}/line_item_groups`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Procore-Company-Id": companyId,
      },
      body: JSON.stringify(groupPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        {
          error: `Create line item group API error ${response.status}`,
          details: errorText || "No response body",
          host: baseUrl,
          url,
          attemptedPayload: groupPayload,
        },
        { status: response.status }
      );
    }

    const payload = (await response.json().catch(() => ({}))) as unknown;
    const payloadRecord = isRecord(payload) ? payload : {};
    const dataRecord = isRecord(payloadRecord.data) ? payloadRecord.data : payloadRecord;
    const createdGroupId = String(dataRecord.id || dataRecord.line_item_group_id || "").trim() || null;

    return NextResponse.json({
      success: true,
      source: "estimating.create_line_item_group",
      companyId,
      bidBoardProjectId,
      proposalId,
      baseUrl,
      url,
      lineItemGroupId: createdGroupId,
      lineItemGroup: payload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to create line item group",
        details: message,
      },
      { status: 500 }
    );
  }
}
