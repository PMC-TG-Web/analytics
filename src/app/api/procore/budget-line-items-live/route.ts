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

type CostCodeLookupRow = {
  code: string | null;
  full_code: string | null;
  name: string | null;
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
      ? getRolledUpCostCode(costCode) || normalizeCostCodeForRollup(costCode)
      : normalizeCostCodeForRollup(costCode);
  if (!normalizedCostCode) return null;

  return `${normalizedProjectId}::${normalizedCostCode}`;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const companyId = String(searchParams.get("companyId") || "").trim();
    const projectId = String(searchParams.get("projectId") || "").trim();
    const requestedPageSize = Number.parseInt(searchParams.get("pageSize") || "10000", 10) || 10000;
    const pageSize = Math.min(10000, Math.max(1, requestedPageSize));
    const requestedActualsMode = String(searchParams.get("actualsMode") || "").trim().toLowerCase();
    const actualsMode: ActualsMode = requestedActualsMode === "cost-code" ? "cost-code" : "rollup";

    if (!companyId || !projectId) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: companyId, projectId" },
        { status: 400 }
      );
    }

    const rows = await prisma.$queryRawUnsafe<BudgetLineRow[]>(
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
          AND project_id = $2
        ORDER BY
          COALESCE(cost_code, '') ASC,
          COALESCE(name, '') ASC,
          id DESC
        LIMIT $3
      `,
      companyId,
      projectId,
      pageSize
    );

    const missingDescriptionCodes = Array.from(
      new Set(
        rows
          .filter((row) => !String(row.cost_code_description || "").trim())
          .map((row) => normalizeCostCodeKey(row.cost_code))
          .filter(Boolean)
      )
    );

    const fallbackCostCodeNameByCode = new Map<string, string>();

    if (missingDescriptionCodes.length > 0) {
      const lookupRows = await prisma.$queryRawUnsafe<CostCodeLookupRow[]>(
        `
          SELECT DISTINCT ON (COALESCE(cc.full_code, cc.code))
            cc.code,
            cc.full_code,
            cc.name
          FROM procore_cost_code_staging cc
          WHERE cc.company_id = $1
            AND cc.project_id = $2
            AND (
              cc.full_code = ANY($3)
              OR cc.code = ANY($3)
            )
          ORDER BY COALESCE(cc.full_code, cc.code), cc.synced_at DESC
        `,
        companyId,
        projectId,
        missingDescriptionCodes
      );

      for (const lookupRow of lookupRows) {
        const name = String(lookupRow.name || "").trim();
        if (!name) continue;

        const fullCodeKey = normalizeCostCodeKey(lookupRow.full_code);
        const codeKey = normalizeCostCodeKey(lookupRow.code);
        if (fullCodeKey && !fallbackCostCodeNameByCode.has(fullCodeKey)) {
          fallbackCostCodeNameByCode.set(fullCodeKey, name);
        }
        if (codeKey && !fallbackCostCodeNameByCode.has(codeKey)) {
          fallbackCostCodeNameByCode.set(codeKey, name);
        }
      }
    }

    const timecardActualsByKey = new Map<string, number>();
    const productivityActualsByKey = new Map<string, number>();

    const [timecardRows, productivityRows] = await Promise.all([
      prisma.$queryRawUnsafe<TimecardActualRow[]>(
        `
          SELECT
            t."procoreProjectId" AS procore_project_id,
            t."costCodeFullCode" AS cost_code,
            COALESCE(SUM(t.hours), 0) AS hours
          FROM "TimecardEntry" t
          WHERE t."procoreProjectId" = $1
            AND t."costCodeFullCode" IS NOT NULL
            AND t."costCodeFullCode" <> ''
          GROUP BY t."procoreProjectId", t."costCodeFullCode"
        `,
        projectId
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
          WHERE pl."procoreProjectId" = $1
            AND pl."quantityUsed" IS NOT NULL
          GROUP BY pl."procoreProjectId", li."costCode"
        `,
        projectId
      ),
    ]);

    for (const row of timecardRows) {
      const key = buildActualsKey(row.procore_project_id, row.cost_code, actualsMode);
      if (!key) continue;
      timecardActualsByKey.set(key, (timecardActualsByKey.get(key) || 0) + normalizeMetric(row.hours));
    }

    for (const row of productivityRows) {
      const key = buildActualsKey(row.procore_project_id, row.cost_code, actualsMode);
      if (!key) continue;
      productivityActualsByKey.set(key, (productivityActualsByKey.get(key) || 0) + normalizeMetric(row.quantity_used));
    }

    return NextResponse.json({
      success: true,
      companyId,
      projectId,
      count: rows.length,
      data: rows.map((row) => ({
        costCodeDescription:
          row.cost_code_description ||
          fallbackCostCodeNameByCode.get(normalizeCostCodeKey(row.cost_code)) ||
          null,
        rollupCostCode: getRolledUpCostCode(row.cost_code) || row.cost_code || null,
        actualTimecardHours:
          Number(
            timecardActualsByKey.get(
              buildActualsKey(
                projectId,
                actualsMode === "rollup" ? getRolledUpCostCode(row.cost_code) || row.cost_code : row.cost_code,
                actualsMode
              ) || ""
            ) || 0
          ),
        actualProductivityQty:
          Number(
            productivityActualsByKey.get(
              buildActualsKey(
                projectId,
                actualsMode === "rollup" ? getRolledUpCostCode(row.cost_code) || row.cost_code : row.cost_code,
                actualsMode
              ) || ""
            ) || 0
          ),
        id: normalizeId(row.id),
        companyId: row.company_id,
        projectId: row.project_id,
        budgetLineItemId: row.budget_line_item_id,
        name: row.name,
        costCode: row.cost_code,
        lineItemType: row.line_item_type,
        uom: row.uom,
        quantity: normalizeNumber(row.quantity),
        unitCost: normalizeNumber(row.unit_cost),
        originalBudgetAmount: normalizeNumber(row.original_budget_amount),
        amount: normalizeNumber(row.amount),
        syncedAt: row.synced_at,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch budget line items", details: message },
      { status: 500 }
    );
  }
}
