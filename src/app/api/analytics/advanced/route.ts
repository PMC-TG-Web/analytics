import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRolledUpCostCode, normalizeCostCodeForRollup } from "@/lib/costCodeRollup";

export const dynamic = "force-dynamic";

type ActualsMode = "rollup" | "cost-code";

type BudgetAnalyticsRow = {
  id: number | bigint;
  company_id: string;
  project_id: string;
  budget_line_item_id: string;
  project_name: string | null;
  customer_name: string | null;
  project_identity_source: string | null;
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

type CountRow = {
  count: string | number | bigint;
};

type CompanyCountRow = {
  company_id: string;
  count: string | number | bigint;
};

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

function parseCount(value: string | number | bigint | null | undefined): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const queryCompanyId = String(searchParams.get("companyId") || "").trim();
    const cookieCompanyId = String(request.cookies.get("procore_company_id")?.value || "").trim();
    const companyId = queryCompanyId || cookieCompanyId;
    const requestedActualsMode = String(searchParams.get("actualsMode") || "").trim().toLowerCase();
    const actualsMode: ActualsMode = requestedActualsMode === "cost-code" ? "cost-code" : "rollup";

    if (!companyId) {
      return NextResponse.json(
        { success: false, error: "Missing companyId context for analytics." },
        { status: 400 }
      );
    }

    const [
      budgetRows,
      timecardRows,
      productivityRows,
      budgetCountRows,
      timecardCountRows,
      productivityCountRows,
      purchaseOrderLineCountRows,
      budgetCompaniesRows,
      pmcProjectCountRows,
      pmcBidBoardProjectCountRows,
    ] = await Promise.all([
      prisma.$queryRawUnsafe<BudgetAnalyticsRow[]>(
        `
          WITH pmc_project_identity AS (
            SELECT
              p.company_id,
              p.procore_project_id AS canonical_project_id,
              p.project_name,
              p.customer,
              'pmc_projects'::text AS project_identity_source
            FROM pmc_projects p
            WHERE p.company_id = $1
          )
          SELECT
            b.id,
            b.company_id,
            b.project_id,
            b.budget_line_item_id,
            cp.project_name,
            cp.customer AS customer_name,
            cp.project_identity_source,
            b.name,
            b.cost_code,
            b.cost_code_description,
            b.line_item_type,
            b.uom,
            b.quantity,
            b.unit_cost,
            b.original_budget_amount,
            b.amount,
            b.synced_at::text
          FROM budgetlineitems b
          LEFT JOIN pmc_project_identity cp
            ON cp.company_id = b.company_id
           AND cp.canonical_project_id = b.project_id
          WHERE b.company_id = $1
          ORDER BY
            COALESCE(cp.project_name, b.project_id) ASC,
            COALESCE(b.cost_code, '') ASC,
            COALESCE(b.name, '') ASC,
            b.id DESC
        `,
        companyId
      ),
      prisma.$queryRawUnsafe<TimecardActualRow[]>(
        `
          SELECT
            t."procoreProjectId" AS procore_project_id,
            t."costCodeFullCode" AS cost_code,
            COALESCE(SUM(t.hours), 0) AS hours
          FROM "TimecardEntry" t
          WHERE t."procoreCompanyId" = $1
            AND t."procoreProjectId" IS NOT NULL
            AND t."costCodeFullCode" IS NOT NULL
            AND t."costCodeFullCode" <> ''
          GROUP BY t."procoreProjectId", t."costCodeFullCode"
        `,
        companyId
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
          WHERE pl."procoreCompanyId" = $1
            AND pl."procoreProjectId" IS NOT NULL
            AND pl."quantityUsed" IS NOT NULL
          GROUP BY pl."procoreProjectId", li."costCode"
        `,
        companyId
      ),
      prisma.$queryRawUnsafe<CountRow[]>(
        `
          SELECT COUNT(*)::text AS count
          FROM budgetlineitems
          WHERE company_id = $1
        `,
        companyId
      ),
      prisma.$queryRawUnsafe<CountRow[]>(
        `
          SELECT COUNT(*)::text AS count
          FROM "TimecardEntry"
          WHERE "procoreCompanyId" = $1
        `,
        companyId
      ),
      prisma.$queryRawUnsafe<CountRow[]>(
        `
          SELECT COUNT(*)::text AS count
          FROM "ProductivityLog"
          WHERE "procoreCompanyId" = $1
        `,
        companyId
      ),
      prisma.$queryRawUnsafe<CountRow[]>(
        `
          SELECT COUNT(*)::text AS count
          FROM "PurchaseOrderLineItemContractDetail"
          WHERE "procoreCompanyId" = $1
        `,
        companyId
      ),
      prisma.$queryRawUnsafe<CompanyCountRow[]>(
        `
          SELECT company_id, COUNT(*)::text AS count
          FROM budgetlineitems
          GROUP BY company_id
          ORDER BY COUNT(*) DESC
          LIMIT 10
        `
      ),
      prisma.$queryRawUnsafe<CountRow[]>(
        `
          SELECT COUNT(*)::text AS count
          FROM pmc_projects
          WHERE company_id = $1
        `,
        companyId
      ),
      prisma.$queryRawUnsafe<CountRow[]>(
        `
          SELECT COUNT(*)::text AS count
          FROM pmc_bid_board_projects
          WHERE company_id = $1
        `,
        companyId
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
      productivityActualsByKey.set(key, (productivityActualsByKey.get(key) || 0) + normalizeMetric(row.quantity_used));
    }

    return NextResponse.json({
      success: true,
      source: "local_analytics_advanced",
      companyId,
      actualsMode,
      count: budgetRows.length,
      diagnostics: {
        companyIdUsed: companyId,
        tableCountsByCompany: {
          pmcProjects: parseCount(pmcProjectCountRows[0]?.count),
          pmcBidBoardProjects: parseCount(pmcBidBoardProjectCountRows[0]?.count),
          budgetlineitems: parseCount(budgetCountRows[0]?.count),
          timecardEntries: parseCount(timecardCountRows[0]?.count),
          productivityLogs: parseCount(productivityCountRows[0]?.count),
          purchaseOrderLineItemContractDetails: parseCount(purchaseOrderLineCountRows[0]?.count),
        },
        budgetlineitemsCompaniesWithData: budgetCompaniesRows.map((row) => ({
          companyId: row.company_id,
          count: parseCount(row.count),
        })),
      },
      data: budgetRows.map((row) => {
        const actualsCode =
          actualsMode === "rollup"
            ? getRolledUpCostCode(row.cost_code) || row.cost_code
            : row.cost_code;
        const actualsKey = buildActualsKey(row.project_id, actualsCode, actualsMode) || "";

        return {
          id: `${row.project_id}:${normalizeId(row.id)}`,
          projectName: row.project_name || null,
          customerName: row.customer_name || null,
          projectId: row.project_id,
          companyId: row.company_id,
          budgetLineItemId: row.budget_line_item_id,
          projectIdentitySource: row.project_identity_source,
          name: row.name,
          costCode: row.cost_code,
          costCodeName: row.cost_code_description || null,
          lineItemType: row.line_item_type,
          uom: row.uom,
          quantity: normalizeNumber(row.quantity),
          unitCost: normalizeNumber(row.unit_cost),
          originalBudgetAmount: normalizeNumber(row.original_budget_amount),
          amount: normalizeNumber(row.amount),
          totalCost: normalizeNumber(row.original_budget_amount) || 0,
          totalSales: normalizeNumber(row.amount) || 0,
          actualTimecardHours: Number(timecardActualsByKey.get(actualsKey) || 0),
          actualProductivityQty: Number(productivityActualsByKey.get(actualsKey) || 0),
          syncedAt: row.synced_at,
        };
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: "Failed to load advanced analytics data", details: message },
      { status: 500 }
    );
  }
}
