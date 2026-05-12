import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRolledUpCostCode, normalizeCostCodeForRollup } from "@/lib/costCodeRollup";

export const dynamic = "force-dynamic";

type BudgetLineRow = {
  id: number | bigint;
  company_id: string;
  project_id: string;
  budget_line_item_id: string;
  name: string | null;
  cost_code: string | null;
  cost_code_description: string | null;
  line_item_type: string | null;
  uom: string | null;
  quantity: number | string | null;
  unit_cost: number | string | null;
  original_budget_amount: number | string | null;
  amount: number | string | null;
  synced_at: string;
};

type TimecardActualRow = {
  procore_project_id: string | null;
  cost_code: string | null;
  hours: number | string | null;
};

type ProductivityActualRow = {
  procore_project_id: string | null;
  cost_code: string | null;
  quantity_used: number | string | null;
};

type ActualsMode = "rollup" | "cost-code";

function normalizeId(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return "";
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeMetric(value: number | string | null | undefined): number {
  const num = typeof value === "number" ? value : Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function normalizeCostCodeKey(value: string | null | undefined): string {
  return normalizeCostCodeForRollup(value);
}

function buildActualsKey(
  projectId: string | null | undefined,
  costCode: string | null | undefined,
  actualsMode: ActualsMode
): string | null {
  const normalizedProjectId = String(projectId || "").trim();
  if (!normalizedProjectId) return null;

  const normalizedCostCode =
    actualsMode === "rollup"
      ? getRolledUpCostCode(costCode) || normalizeCostCodeKey(costCode)
      : normalizeCostCodeKey(costCode);
  if (!normalizedCostCode) return null;

  return `${normalizedProjectId}::${normalizedCostCode}`;
}

/**
 * Bulk budget line items endpoint for the analytics page.
 * Accepts a comma-separated list of projectIds and returns all budget line items
 * for those projects in a single round trip, eliminating the serial chunk pattern.
 *
 * Query params:
 *   companyId  - required
 *   projectIds - required, comma-separated Procore project IDs
 *   actualsMode - "cost-code" (default) or "rollup"
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const companyId = String(searchParams.get("companyId") || "").trim();
    const projectIdsParam = String(searchParams.get("projectIds") || "").trim();
    const requestedActualsMode = String(searchParams.get("actualsMode") || "").trim().toLowerCase();
    const actualsMode: ActualsMode = requestedActualsMode === "cost-code" ? "cost-code" : "rollup";

    if (!companyId || !projectIdsParam) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: companyId, projectIds" },
        { status: 400 }
      );
    }

    const projectIds = projectIdsParam
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (projectIds.length === 0) {
      return NextResponse.json({ success: true, count: 0, data: [] });
    }

    const [rows, timecardRows, productivityRows] = await Promise.all([
      prisma.$queryRawUnsafe<BudgetLineRow[]>(
        `
          SELECT
            id,
            company_id,
            project_id,
            budget_line_item_id,
            name,
            cost_code,
            cost_code_description,
            line_item_type,
            uom,
            quantity,
            unit_cost,
            original_budget_amount,
            amount,
            synced_at::text
          FROM budgetlineitems
          WHERE company_id = $1
            AND project_id = ANY($2::text[])
          ORDER BY project_id, COALESCE(cost_code, '') ASC, COALESCE(name, '') ASC, id DESC
        `,
        companyId,
        projectIds
      ),
      prisma.$queryRawUnsafe<TimecardActualRow[]>(
        `
          SELECT
            t."procoreProjectId" AS procore_project_id,
            t."costCodeFullCode" AS cost_code,
            COALESCE(SUM(t.hours), 0) AS hours
          FROM "TimecardEntry" t
          WHERE t."procoreProjectId" = ANY($1::text[])
            AND t."costCodeFullCode" IS NOT NULL
            AND t."costCodeFullCode" <> ''
          GROUP BY t."procoreProjectId", t."costCodeFullCode"
        `,
        projectIds
      ),
      prisma.$queryRawUnsafe<ProductivityActualRow[]>(
        `
          SELECT
            pl."procoreProjectId" AS procore_project_id,
            li."costCode" AS cost_code,
            COALESCE(SUM(pl."quantityUsed"), 0) AS quantity_used
          FROM "ProductivityLog" pl
          LEFT JOIN "PurchaseOrderLineItemContractDetail" li
            ON li."procoreId" = pl."lineItemId"
          WHERE pl."procoreProjectId" = ANY($1::text[])
            AND pl."quantityUsed" IS NOT NULL
          GROUP BY pl."procoreProjectId", li."costCode"
        `,
        projectIds
      ),
    ]);

    const timecardActualsByKey = new Map<string, number>();
    const productivityActualsByKey = new Map<string, number>();

    for (const row of timecardRows) {
      const key = buildActualsKey(row.procore_project_id, row.cost_code, actualsMode);
      if (!key) continue;
      timecardActualsByKey.set(key, (timecardActualsByKey.get(key) || 0) + normalizeMetric(row.hours));
    }

    for (const row of productivityRows) {
      const key = buildActualsKey(row.procore_project_id, row.cost_code, actualsMode);
      if (!key) continue;
      productivityActualsByKey.set(
        key,
        (productivityActualsByKey.get(key) || 0) + normalizeMetric(row.quantity_used)
      );
    }

    return NextResponse.json({
      success: true,
      count: rows.length,
      data: rows.map((row) => {
        const rowActualsCode =
          actualsMode === "rollup"
            ? getRolledUpCostCode(row.cost_code) || row.cost_code
            : row.cost_code;

        return {
          id: normalizeId(row.id),
          projectId: row.project_id,
          companyId: row.company_id,
          budgetLineItemId: row.budget_line_item_id,
          name: row.name,
          costCode: row.cost_code,
          costCodeDescription: row.cost_code_description || null,
          rollupCostCode: getRolledUpCostCode(row.cost_code) || row.cost_code || null,
          lineItemType: row.line_item_type,
          uom: row.uom,
          quantity: normalizeNumber(row.quantity),
          unitCost: normalizeNumber(row.unit_cost),
          originalBudgetAmount: normalizeNumber(row.original_budget_amount),
          amount: normalizeNumber(row.amount),
          actualTimecardHours: Number(
            timecardActualsByKey.get(buildActualsKey(row.project_id, rowActualsCode, actualsMode) || "") || 0
          ),
          actualProductivityQty: Number(
            productivityActualsByKey.get(buildActualsKey(row.project_id, rowActualsCode, actualsMode) || "") || 0
          ),
          syncedAt: row.synced_at,
        };
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch bulk budget line items", details: message },
      { status: 500 }
    );
  }
}
