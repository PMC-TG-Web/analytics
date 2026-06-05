import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";
import { normalizeProcoreCostItemUnit, normalizeProcoreLaborTimeUnit } from "@/lib/procoreUnits";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isLaborCostItemType(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "labor";
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
    const groupsInput = Array.isArray(body.groups) ? body.groups : [];

    if (!companyId || !bidBoardProjectId) {
      return NextResponse.json(
        { error: "Missing required fields: companyId, bidBoardProjectId" },
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

    if (groupsInput.length === 0) {
      return NextResponse.json(
        { error: "Missing required field: groups (non-empty array)." },
        { status: 400 }
      );
    }

    const readStr = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
    const readNum = (v: unknown): number | undefined => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string") {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
      return undefined;
    };
    const readBool = (v: unknown): boolean | undefined => {
      if (typeof v === "boolean") return v;
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (s === "true") return true;
        if (s === "false") return false;
      }
      return undefined;
    };
    const readCostCode = (v: unknown): string => {
      if (isRecord(v)) {
        return readStr(v.code ?? v.name ?? v.value);
      }
      return readStr(v);
    };

    const normalizeCostItem = (src: unknown): UnknownRecord => {
      if (!isRecord(src)) return {};
      const out: UnknownRecord = {};

      const strFields = [
        "type",
        "based_on_item_id",
        "name",
        "description",
        "labor_time_unit",
        "manufacturer",
        "catalog_number",
        "url",
        "supplier",
        "unit",
        "notes",
        "id",
        "color",
        "symbol_id",
        "catalog_id",
      ];
      const numFields = [
        "unit_cost",
        "unit_labor",
        "unit_labor_cost",
        "waste",
        "material_waste",
        "item_margin",
        "labor_margin",
        "unit_labor_rate",
        "delivery_unit",
      ];

      for (const key of strFields) {
        const value = readStr(src[key]);
        if (value) out[key] = value;
      }
      for (const key of numFields) {
        const value = readNum(src[key]);
        if (value !== undefined) out[key] = value;
      }
      const isUntaxed = readBool(src.is_untaxed);
      if (isUntaxed !== undefined) out.is_untaxed = isUntaxed;

      if (typeof out.labor_time_unit === "string") {
        const normalizedLaborTimeUnit = normalizeProcoreLaborTimeUnit(out.labor_time_unit);
        if (normalizedLaborTimeUnit) {
          out.labor_time_unit = normalizedLaborTimeUnit;
        } else {
          delete out.labor_time_unit;
        }
      }
      if (typeof out.unit === "string") {
        out.unit = normalizeProcoreCostItemUnit(out.unit);
      }
      if (isLaborCostItemType(out.type)) {
        delete out.unit_cost;
      }

      return out;
    };

    const normalizeLayer = (src: unknown): UnknownRecord | null => {
      if (!isRecord(src)) return null;
      const out: UnknownRecord = {};

      const name = readStr(src.name);
      const groupId = readStr(src.group_id);
      const tag = readStr(src.tag);
      const id = readStr(src.id);
      const type = readStr(src.type);
      const updatedAt = readStr(src.updated_at);

      const laborFactor = readNum(src.labor_factor);
      const count = readNum(src.count);
      const itemCost = readNum(src.item_cost);
      const itemSales = readNum(src.item_sales);
      const laborCost = readNum(src.labor_cost);
      const laborSales = readNum(src.labor_sales);
      const profit = readNum(src.profit);
      const costCode = readCostCode(src.cost_code ?? src.costCode ?? src.budget_code ?? src.budgetCode);

      if (name) out.name = name;
      if (groupId) out.group_id = groupId;
      if (tag) out.tag = tag;
      if (id) out.id = id;
      if (type) out.type = type;
      if (updatedAt) out.updated_at = updatedAt;
      if (laborFactor !== undefined) out.labor_factor = laborFactor;
      if (count !== undefined) out.count = count;
      if (itemCost !== undefined) out.item_cost = itemCost;
      if (itemSales !== undefined) out.item_sales = itemSales;
      if (laborCost !== undefined) out.labor_cost = laborCost;
      if (laborSales !== undefined) out.labor_sales = laborSales;
      if (profit !== undefined) out.profit = profit;
      if (costCode) out.cost_code = { code: costCode };

      const costItem = normalizeCostItem(src.cost_item);
      const costItemId = readStr(costItem.id);
      if (!name || !costItemId) {
        return null;
      }

      if (isLaborCostItemType(costItem.type)) {
        delete out.item_cost;
      }

      out.cost_item = costItem;

      return out;
    };

    const normalizePricingOverride = (src: unknown): UnknownRecord => {
      if (!isRecord(src)) return {};
      const out: UnknownRecord = {};
      const numFields = [
        "unit_material_cost",
        "material_margin",
        "unit_labor",
        "labor_factor",
        "unit_labor_rate",
        "unit_labor_cost",
        "labor_margin",
      ];
      for (const key of numFields) {
        const value = readNum(src[key]);
        if (value !== undefined) out[key] = value;
      }
      const isUntaxed = readBool(src.is_untaxed);
      if (isUntaxed !== undefined) out.is_untaxed = isUntaxed;
      return out;
    };

    const groups = groupsInput
      .map((entry) => {
        if (!isRecord(entry)) return null;

        const group: UnknownRecord = {};
        const name = readStr(entry.name);
        if (!name) return null;
        group.name = name;

        const notes = readStr(entry.notes);
        const multiplier = readNum(entry.multiplier);
        const order = readNum(entry.order);
        if (notes) group.notes = notes;
        if (multiplier !== undefined) group.multiplier = multiplier;
        if (order !== undefined) group.order = order;

        const pricingOverride = normalizePricingOverride(entry.pricing_override);
        if (Object.keys(pricingOverride).length > 0) {
          group.pricing_override = pricingOverride;
        }

        const layersInput = Array.isArray(entry.layers) ? entry.layers : [];
        const layers = layersInput
          .map((layer) => normalizeLayer(layer))
          .filter((layer): layer is UnknownRecord => Boolean(layer));
        if (layers.length === 0) {
          return null;
        }

        group.layers = layers;
        return group;
      })
      .filter((entry): entry is UnknownRecord => Boolean(entry));

    if (groups.length === 0) {
      return NextResponse.json(
        { error: "No valid groups were provided. Each group must include name and at least one valid layer." },
        { status: 400 }
      );
    }

    const payload: UnknownRecord = { groups };

    const baseUrl = "https://api.procore.com";
    const url = `${baseUrl}/rest/v2.0/companies/${encodeURIComponent(
      companyId
    )}/estimating/bid_board_projects/${encodeURIComponent(bidBoardProjectId)}/import/line_item_groups`;

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
      return NextResponse.json(
        {
          error: `Import line item groups API error ${response.status}`,
          details: errorText || "No response body",
          host: baseUrl,
          url,
          attemptedPayload: payload,
        },
        { status: response.status }
      );
    }

    const responsePayload = (await response.json().catch(() => ({}))) as unknown;

    return NextResponse.json({
      success: true,
      source: "estimating.import_line_item_groups",
      companyId,
      bidBoardProjectId,
      baseUrl,
      url,
      importedGroupCount: groups.length,
      attemptedPayload: payload,
      result: responsePayload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to import line item groups",
        details: message,
      },
      { status: 500 }
    );
  }
}
