import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type MappingProfileBody = {
  costCodeMap?: Record<string, string>;
  costTypeMap?: Record<string, string>;
  costTypeByCodeMap?: Record<string, string>;
};

const PROFILE_SOURCE = "po_line_item_mapping_profile_v1";
const MAP_KIND_COST_CODE = "cost_code_map";
const MAP_KIND_COST_TYPE = "cost_type_map";
const MAP_KIND_COST_TYPE_BY_CODE = "cost_type_by_code_map";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, mapValue] of Object.entries(value)) {
    const cleanKey = String(key || "").trim();
    const cleanValue = String(mapValue ?? "").trim();
    if (cleanKey && cleanValue) {
      result[cleanKey] = cleanValue;
    }
  }
  return result;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function toRows(map: Record<string, string>, mapKind: string) {
  return Object.entries(map).map(([key, value]) => ({
    costItem: key,
    costType: mapKind,
    pmcGroup: value,
    costItemNorm: normalize(key),
    costTypeNorm: normalize(mapKind),
    source: PROFILE_SOURCE,
  }));
}

export async function GET() {
  try {
    const rows = await prisma.pmcGroupMapping.findMany({
      where: { source: PROFILE_SOURCE },
      orderBy: [{ updatedAt: "desc" }, { costItem: "asc" }],
    });

    if (!rows.length) {
      return NextResponse.json({
        success: true,
        exists: false,
        costCodeMap: {},
        costTypeMap: {},
        costTypeByCodeMap: {},
      });
    }

    const costCodeMap: Record<string, string> = {};
    const costTypeMap: Record<string, string> = {};
    const costTypeByCodeMap: Record<string, string> = {};

    for (const row of rows) {
      const key = String(row.costItem || "").trim();
      const value = String(row.pmcGroup || "").trim();
      const kind = normalize(row.costType || "");
      if (!key || !value) continue;

      if (kind === MAP_KIND_COST_CODE) costCodeMap[key] = value;
      if (kind === MAP_KIND_COST_TYPE) costTypeMap[key] = value;
      if (kind === MAP_KIND_COST_TYPE_BY_CODE) costTypeByCodeMap[key] = value;
    }

    return NextResponse.json({
      success: true,
      exists: true,
      costCodeMap,
      costTypeMap,
      costTypeByCodeMap,
      updatedAt: rows[0]?.updatedAt,
    });
  } catch (error) {
    console.error("Failed to load PO line-item mapping profile:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load mapping profile." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as MappingProfileBody;
    const costCodeMap = sanitizeStringMap(body.costCodeMap);
    const costTypeMap = sanitizeStringMap(body.costTypeMap);
    const costTypeByCodeMap = sanitizeStringMap(body.costTypeByCodeMap);

    const allRows = [
      ...toRows(costCodeMap, MAP_KIND_COST_CODE),
      ...toRows(costTypeMap, MAP_KIND_COST_TYPE),
      ...toRows(costTypeByCodeMap, MAP_KIND_COST_TYPE_BY_CODE),
    ];

    await prisma.$transaction(async (tx) => {
      await tx.pmcGroupMapping.deleteMany({ where: { source: PROFILE_SOURCE } });
      if (allRows.length > 0) {
        await tx.pmcGroupMapping.createMany({ data: allRows, skipDuplicates: true });
      }
    });

    return NextResponse.json({
      success: true,
      saved: true,
      counts: {
        costCodeMap: Object.keys(costCodeMap).length,
        costTypeMap: Object.keys(costTypeMap).length,
        costTypeByCodeMap: Object.keys(costTypeByCodeMap).length,
      },
    });
  } catch (error) {
    console.error("Failed to save PO line-item mapping profile:", error);
    return NextResponse.json(
      { success: false, error: "Failed to save mapping profile." },
      { status: 500 }
    );
  }
}
