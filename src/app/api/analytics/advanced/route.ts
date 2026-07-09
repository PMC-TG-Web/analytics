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
  first_date: string | null;
  last_date: string | null;
};

type ProductivityActualRow = {
  procore_project_id: string | null;
  cost_code: string | null;
  quantity_used: number | string | null;
  first_date: string | null;
  last_date: string | null;
};

type ActualAggregate = {
  units: number;
  firstDate: string | null;
  lastDate: string | null;
};

type CountRow = {
  count: string | number | bigint;
};

type CompanyCountRow = {
  company_id: string;
  count: string | number | bigint;
};

type ProjectAnalyticsRow = {
  company_id: string;
  procore_project_id: string | null;
  bid_board_id: string | null;
  project_number: string | null;
  project_name: string;
  customer: string | null;
  status: string | null;
  bid_board_status: string | null;
  source_table: string;
  budget_line_items: string | number | bigint | null;
  budget_amount: string | number | null;
  original_budget_amount: string | number | null;
  estimate_line_items: string | number | bigint | null;
  estimate_proposals: string | number | bigint | null;
  timecard_entries: string | number | bigint | null;
  timecard_hours: string | number | null;
  productivity_logs: string | number | bigint | null;
  productivity_quantity_used: string | number | null;
  productivity_quantity_delivered: string | number | null;
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

function pickEarlierDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;

  const aTime = new Date(a).getTime();
  const bTime = new Date(b).getTime();
  if (Number.isNaN(aTime)) return b;
  if (Number.isNaN(bTime)) return a;
  return bTime < aTime ? b : a;
}

function pickLaterDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;

  const aTime = new Date(a).getTime();
  const bTime = new Date(b).getTime();
  if (Number.isNaN(aTime)) return b;
  if (Number.isNaN(bTime)) return a;
  return bTime > aTime ? b : a;
}

function mergeActualAggregate(
  map: Map<string, ActualAggregate>,
  key: string,
  units: number,
  firstDate: string | null,
  lastDate: string | null
) {
  const existing = map.get(key) || { units: 0, firstDate: null, lastDate: null };
  map.set(key, {
    units: existing.units + units,
    firstDate: pickEarlierDate(existing.firstDate, firstDate),
    lastDate: pickLaterDate(existing.lastDate, lastDate),
  });
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const queryCompanyId = String(searchParams.get("companyId") || "").trim();
    const cookieCompanyId = String(request.cookies.get("procore_company_id")?.value || "").trim();
    const envCompanyId = String(process.env.PROCORE_COMPANY_ID || "").trim();
    const companyId = queryCompanyId || cookieCompanyId || envCompanyId;
    const requestedActualsMode = String(searchParams.get("actualsMode") || "").trim().toLowerCase();
    const actualsMode: ActualsMode = requestedActualsMode === "cost-code" ? "cost-code" : "rollup";

    if (!companyId) {
      return NextResponse.json(
        { success: false, error: "Missing companyId context for analytics." },
        { status: 400 }
      );
    }

    const [
      projectRows,
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
      prisma.$queryRawUnsafe<ProjectAnalyticsRow[]>(
        `
          WITH pmc_projects_ranked AS (
            SELECT
              p.company_id,
              p.procore_project_id,
              p.bid_board_id,
              p.project_number,
              p.project_name,
              p.customer,
              p.status,
              p.bid_board_status,
              'pmc_projects'::text AS source_table,
              ROW_NUMBER() OVER (
                PARTITION BY p.company_id, p.procore_project_id
                ORDER BY p.synced_at DESC, p.project_name ASC
              ) AS rn
            FROM pmc_projects p
            WHERE p.company_id = $1
              AND p.procore_project_id IS NOT NULL
          ),
          pmc_projects_clean AS (
            SELECT
              company_id,
              procore_project_id,
              bid_board_id,
              project_number,
              project_name,
              customer,
              status,
              bid_board_status,
              source_table
            FROM pmc_projects_ranked
            WHERE rn = 1
          ),
          bid_board_ranked AS (
            SELECT
              b.company_id,
              b.procore_project_id,
              CASE
                WHEN b.bid_board_id IS NULL THEN NULL
                WHEN strpos(b.bid_board_id, ':') > 0 THEN regexp_replace(b.bid_board_id, '^.*:', '')
                ELSE b.bid_board_id
              END AS bid_board_id,
              b.project_number,
              b.project_name,
              b.customer,
              b.status,
              b.status_raw AS bid_board_status,
              'pmc_bid_board_projects'::text AS source_table,
              ROW_NUMBER() OVER (
                PARTITION BY b.company_id,
                  CASE
                    WHEN b.bid_board_id IS NULL THEN NULL
                    WHEN strpos(b.bid_board_id, ':') > 0 THEN regexp_replace(b.bid_board_id, '^.*:', '')
                    ELSE b.bid_board_id
                  END
                ORDER BY b.synced_at DESC, b.project_name ASC
              ) AS rn
            FROM pmc_bid_board_projects b
            WHERE b.company_id = $1
              AND b.procore_project_id IS NULL
              AND b.bid_board_id IS NOT NULL
          ),
          bid_board_clean AS (
            SELECT
              company_id,
              procore_project_id,
              bid_board_id,
              project_number,
              project_name,
              customer,
              status,
              bid_board_status,
              source_table
            FROM bid_board_ranked
            WHERE rn = 1
          ),
          bid_board_unmatched AS (
            SELECT b.*
            FROM bid_board_clean b
            LEFT JOIN pmc_projects_clean p
              ON p.company_id = b.company_id
             AND (
               (
                 NULLIF(BTRIM(COALESCE(b.project_number, '')), '') IS NOT NULL
                 AND NULLIF(BTRIM(COALESCE(p.project_number, '')), '') IS NOT NULL
                 AND LOWER(BTRIM(b.project_number)) = LOWER(BTRIM(p.project_number))
               )
               OR (
                 (
                   NULLIF(BTRIM(COALESCE(b.project_number, '')), '') IS NULL
                   OR NULLIF(BTRIM(COALESCE(p.project_number, '')), '') IS NULL
                 )
                 AND LOWER(BTRIM(COALESCE(b.project_name, ''))) = LOWER(BTRIM(COALESCE(p.project_name, '')))
               )
             )
            WHERE p.procore_project_id IS NULL
          ),
          clean_projects AS (
            SELECT * FROM pmc_projects_clean

            UNION ALL

            SELECT * FROM bid_board_unmatched
          ),
          budget_totals AS (
            SELECT
              company_id,
              project_id AS procore_project_id,
              COUNT(*)::text AS budget_line_items,
              COALESCE(SUM(amount), 0) AS budget_amount,
              COALESCE(SUM(original_budget_amount), 0) AS original_budget_amount
            FROM budgetlineitems
            WHERE company_id = $1
            GROUP BY company_id, project_id
          ),
          estimate_totals AS (
            SELECT
              company_id,
              CASE
                WHEN bid_board_project_id IS NULL THEN NULL
                WHEN strpos(bid_board_project_id, ':') > 0 THEN regexp_replace(bid_board_project_id, '^.*:', '')
                ELSE bid_board_project_id
              END AS bid_board_id,
              COUNT(*)::text AS estimate_line_items,
              COUNT(DISTINCT proposal_id)::text AS estimate_proposals
            FROM procore_proposal_line_items_live
            WHERE company_id = $1
            GROUP BY
              company_id,
              CASE
                WHEN bid_board_project_id IS NULL THEN NULL
                WHEN strpos(bid_board_project_id, ':') > 0 THEN regexp_replace(bid_board_project_id, '^.*:', '')
                ELSE bid_board_project_id
              END
          ),
          timecard_totals AS (
            SELECT
              t."procoreCompanyId" AS company_id,
              t."procoreProjectId" AS procore_project_id,
              COUNT(*)::text AS timecard_entries,
              COALESCE(SUM(t.hours), 0) AS timecard_hours
            FROM "TimecardEntry" t
            WHERE t."procoreCompanyId" = $1
              AND t."procoreProjectId" IS NOT NULL
            GROUP BY t."procoreCompanyId", t."procoreProjectId"
          ),
          productivity_totals AS (
            SELECT
              pl."procoreCompanyId" AS company_id,
              pl."procoreProjectId" AS procore_project_id,
              COUNT(*)::text AS productivity_logs,
              COALESCE(SUM(pl."quantityUsed"), 0) AS productivity_quantity_used,
              COALESCE(SUM(pl."quantityDelivered"), 0) AS productivity_quantity_delivered
            FROM "ProductivityLog" pl
            WHERE pl."procoreCompanyId" = $1
              AND pl."procoreProjectId" IS NOT NULL
            GROUP BY pl."procoreCompanyId", pl."procoreProjectId"
          )
          SELECT
            cp.company_id,
            cp.procore_project_id,
            cp.bid_board_id,
            cp.project_number,
            cp.project_name,
            cp.customer,
            cp.status,
            cp.bid_board_status,
            cp.source_table,
            bt.budget_line_items,
            bt.budget_amount,
            bt.original_budget_amount,
            et.estimate_line_items,
            et.estimate_proposals,
            tt.timecard_entries,
            tt.timecard_hours,
            pt.productivity_logs,
            pt.productivity_quantity_used,
            pt.productivity_quantity_delivered
          FROM clean_projects cp
          LEFT JOIN budget_totals bt
            ON bt.company_id = cp.company_id
           AND bt.procore_project_id = cp.procore_project_id
          LEFT JOIN estimate_totals et
            ON et.company_id = cp.company_id
           AND et.bid_board_id = cp.bid_board_id
          LEFT JOIN timecard_totals tt
            ON tt.company_id = cp.company_id
           AND tt.procore_project_id = cp.procore_project_id
          LEFT JOIN productivity_totals pt
            ON pt.company_id = cp.company_id
           AND pt.procore_project_id = cp.procore_project_id
          ORDER BY cp.project_name ASC
        `,
        companyId
      ),
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
            COALESCE(SUM(t.hours), 0) AS hours,
            MIN(t.date)::text AS first_date,
            MAX(t.date)::text AS last_date
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
            COALESCE(SUM(pl."quantityUsed"), 0) AS quantity_used,
            MIN(pl.date)::text AS first_date,
            MAX(pl.date)::text AS last_date
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

    const timecardActualsByKey = new Map<string, ActualAggregate>();
    const productivityActualsByKey = new Map<string, ActualAggregate>();

    for (const row of timecardRows) {
      const key = buildActualsKey(row.procore_project_id, row.cost_code, actualsMode);
      if (!key) continue;
      mergeActualAggregate(
        timecardActualsByKey,
        key,
        normalizeMetric(row.hours),
        row.first_date,
        row.last_date
      );
    }

    for (const row of productivityRows) {
      const key = buildActualsKey(row.procore_project_id, row.cost_code, actualsMode);
      if (!key) continue;
      mergeActualAggregate(
        productivityActualsByKey,
        key,
        normalizeMetric(row.quantity_used),
        row.first_date,
        row.last_date
      );
    }

    return NextResponse.json({
      success: true,
      source: "local_analytics_advanced",
      companyId,
      actualsMode,
      projectCount: projectRows.length,
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
      projects: projectRows.map((row) => ({
        id: row.procore_project_id || row.bid_board_id || row.project_name,
        companyId: row.company_id,
        procoreProjectId: row.procore_project_id,
        bidBoardId: row.bid_board_id,
        projectNumber: row.project_number,
        projectName: row.project_name,
        customerName: row.customer,
        status: row.status,
        bidBoardStatus: row.bid_board_status,
        sourceTable: row.source_table,
        budgetLineItems: parseCount(row.budget_line_items),
        budgetAmount: normalizeNumber(row.budget_amount) || 0,
        originalBudgetAmount: normalizeNumber(row.original_budget_amount) || 0,
        estimateLineItems: parseCount(row.estimate_line_items),
        estimateProposals: parseCount(row.estimate_proposals),
        timecardEntries: parseCount(row.timecard_entries),
        timecardHours: normalizeNumber(row.timecard_hours) || 0,
        productivityLogs: parseCount(row.productivity_logs),
        productivityQuantityUsed: normalizeNumber(row.productivity_quantity_used) || 0,
        productivityQuantityDelivered: normalizeNumber(row.productivity_quantity_delivered) || 0,
      })),
      data: budgetRows.map((row) => {
        const actualsCode =
          actualsMode === "rollup"
            ? getRolledUpCostCode(row.cost_code) || row.cost_code
            : row.cost_code;
        const actualsKey = buildActualsKey(row.project_id, actualsCode, actualsMode) || "";
        const timecardActual = timecardActualsByKey.get(actualsKey);
        const productivityActual = productivityActualsByKey.get(actualsKey);

        return {
          id: `${row.project_id}:${normalizeId(row.id)}`,
          actualsKey: actualsKey || null,
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
          actualTimecardHours: Number(timecardActual?.units || 0),
          actualTimecardFirstDate: timecardActual?.firstDate || null,
          actualTimecardLastDate: timecardActual?.lastDate || null,
          actualProductivityQty: Number(productivityActual?.units || 0),
          actualProductivityFirstDate: productivityActual?.firstDate || null,
          actualProductivityLastDate: productivityActual?.lastDate || null,
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
