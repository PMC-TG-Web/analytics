import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function readStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function readNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function normalizeLineItemUpdate(src: unknown): UnknownRecord | null {
  if (!isRecord(src)) return null;

  const out: UnknownRecord = {};

  // id is required for sync
  const id = readNum(src.id);
  if (id === undefined) return null;
  out.id = id;

  const strFields: Array<[string, string[]]> = [
    ["description",   ["description"]],
    ["extended_type", ["extended_type", "extendedType"]],
    ["origin_data",   ["origin_data", "originData"]],
    ["origin_id",     ["origin_id", "originId"]],
    ["uom",           ["uom"]],
  ];

  const numFields: Array<[string, string[]]> = [
    ["amount",             ["amount"]],
    ["wbs_code_id",        ["wbs_code_id", "wbsCodeId"]],
    ["cost_code_id",       ["cost_code_id", "costCodeId"]],
    ["direct_cost_id",     ["direct_cost_id", "directCostId"]],
    ["quantity",           ["quantity"]],
    ["line_item_type_id",  ["line_item_type_id", "lineItemTypeId"]],
    ["unit_cost",          ["unit_cost", "unitCost"]],
    ["tax_code_id",        ["tax_code_id", "taxCodeId"]],
  ];

  for (const [key, aliases] of strFields) {
    const v = readStr(aliases.reduce<unknown>((acc, k) => acc ?? src[k], undefined));
    if (v) out[key] = v;
  }
  for (const [key, aliases] of numFields) {
    const v = readNum(aliases.reduce<unknown>((acc, k) => acc ?? src[k], undefined));
    if (v !== undefined) out[key] = v;
  }

  return out;
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
        { error: "Missing required fields: companyId, projectId" },
        { status: 400 }
      );
    }

    const updatesInput = Array.isArray(body.updates) ? body.updates : [];
    if (updatesInput.length === 0) {
      return NextResponse.json(
        { error: "Missing required field: updates (non-empty array)." },
        { status: 400 }
      );
    }

    const updates = updatesInput
      .map((u) => normalizeLineItemUpdate(u))
      .filter((u): u is UnknownRecord => u !== null);

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No valid update entries found. Each entry must include an id." },
        { status: 400 }
      );
    }

    const url = `https://api.procore.com/rest/v1.0/projects/${encodeURIComponent(projectId)}/direct_costs/line_items/sync`;

    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Procore-Company-Id": companyId,
      },
      body: JSON.stringify({ updates }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        {
          error: `Direct cost line items sync API error ${response.status}`,
          details: errorText || "No response body",
          url,
          attemptedPayload: { updates },
        },
        { status: response.status }
      );
    }

    const result = await response.json().catch(() => ({}));

    return NextResponse.json({
      success: true,
      source: "direct_costs.line_items.sync",
      companyId,
      projectId,
      url,
      updatedCount: updates.length,
      attemptedPayload: { updates },
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to sync direct cost line items", details: message },
      { status: 500 }
    );
  }
}
