import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getErrorMessage, shouldFallbackToEmptyRead, withDatabaseRetry } from "@/lib/dbResilience";
import { getRolledUpCostCode, normalizeCostCodeForRollup } from "@/lib/costCodeRollup";

export const dynamic = "force-dynamic";

type ProposalLineItemLiveRow = {
  id: number | bigint;
  company_id: string;
  bid_board_project_id: string;
  procore_project_id: string | null;
  proposal_id: string;
  line_item_id: string;
  project_name: string | null;
  customer_name: string | null;
  project_status: string | null;
  bid_board_status: string | null;
  proposal_name: string | null;
  name: string | null;
  status: string | null;
  cost_code: string | null;
  uom: string | null;
  line_item_type: string | null;
  total_cost: number | string | null;
  total_sales: number | string | null;
  payload: unknown;
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

function normalizeId(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return "";
}

function normalizeCount(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isMissingTableError(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || "").toUpperCase();
  const message = error instanceof Error ? error.message : String(error);
  return code === "42P01" || /relation .* does not exist/i.test(message);
}

function normalizeMetric(value: number | string | null | undefined): number {
  const num = typeof value === "number" ? value : Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function buildActualsKey(projectId: string | null | undefined, costCode: string | null | undefined): string | null {
  const normalizedProjectId = String(projectId || "").trim();
  if (!normalizedProjectId) return null;

  const normalizedCostCode = getRolledUpCostCode(costCode) || normalizeCostCodeForRollup(costCode);
  if (!normalizedCostCode) return null;

  return `${normalizedProjectId}::${normalizedCostCode}`;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
    const requestedPageSize = Number.parseInt(searchParams.get("pageSize") || "200", 10) || 200;
    const pageSize = Math.min(10000, Math.max(1, requestedPageSize));
    const skip = (page - 1) * pageSize;

    const companyId = String(searchParams.get("companyId") || "").trim();
    const bidBoardProjectId = String(searchParams.get("bidBoardProjectId") || "").trim();
    const proposalId = String(searchParams.get("proposalId") || "").trim();
    const projectStatus = String(searchParams.get("projectStatus") || "").trim();
    const bidBoardStatus = String(searchParams.get("bidBoardStatus") || "").trim();
    const proposalName = String(searchParams.get("proposalName") || "").trim();
    const uom = String(searchParams.get("uom") || "").trim();
    const search = String(searchParams.get("search") || "").trim();

    const whereParts: string[] = [];
    const values: unknown[] = [];

    if (companyId) {
      values.push(companyId);
      whereParts.push(`base.company_id = $${values.length}`);
    }

    if (bidBoardProjectId) {
      values.push(bidBoardProjectId);
      whereParts.push(`base.bid_board_project_id = $${values.length}`);
    }

    if (proposalId) {
      values.push(proposalId);
      whereParts.push(`base.proposal_id = $${values.length}`);
    }

    if (projectStatus) {
      values.push(projectStatus.toLowerCase());
      whereParts.push(`LOWER(COALESCE(base.project_status, '')) = $${values.length}`);
    }

    if (bidBoardStatus) {
      values.push(bidBoardStatus.toLowerCase());
      whereParts.push(`LOWER(COALESCE(base.bid_board_status, '')) = $${values.length}`);
    }

    if (proposalName) {
      values.push(`%${proposalName.toLowerCase()}%`);
      whereParts.push(`LOWER(COALESCE(base.proposal_name, '')) LIKE $${values.length}`);
    }

    if (uom) {
      values.push(uom.toLowerCase());
      whereParts.push(`LOWER(COALESCE(base.uom, '')) = $${values.length}`);
    }

    if (search) {
      values.push(`%${search.toLowerCase()}%`);
      whereParts.push(
        `(
          LOWER(COALESCE(base.name, '')) LIKE $${values.length}
          OR LOWER(COALESCE(base.status, '')) LIKE $${values.length}
          OR LOWER(COALESCE(base.cost_code, '')) LIKE $${values.length}
          OR LOWER(COALESCE(base.project_name, '')) LIKE $${values.length}
          OR LOWER(COALESCE(base.customer_name, '')) LIKE $${values.length}
          OR LOWER(COALESCE(base.project_status, '')) LIKE $${values.length}
          OR LOWER(COALESCE(base.bid_board_status, '')) LIKE $${values.length}
          OR LOWER(COALESCE(base.proposal_name, '')) LIKE $${values.length}
          OR LOWER(COALESCE(base.uom, '')) LIKE $${values.length}
          OR LOWER(COALESCE(base.line_item_type, '')) LIKE $${values.length}
          OR LOWER(COALESCE(base.line_item_id, '')) LIKE $${values.length}
          OR LOWER(COALESCE(base.bid_board_project_id, '')) LIKE $${values.length}
          OR LOWER(COALESCE(base.procore_project_id, '')) LIKE $${values.length}
          OR LOWER(COALESCE(base.proposal_id, '')) LIKE $${values.length}
        )`
      );
    }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

    const baseQuery = `
      WITH base AS (
        SELECT
          p.id,
          p.company_id,
          p.bid_board_project_id,
          COALESCE(proj.procore_project_id, bb.procore_project_id) AS procore_project_id,
          p.proposal_id,
          p.line_item_id,
          p.project_name,
          p.customer_name,
          proj.project_status,
          COALESCE(proj.bid_board_status, bb.bid_board_status) AS bid_board_status,
          p.proposal_name,
          p.name,
          p.status,
          p.cost_code,
          COALESCE(
            NULLIF(BTRIM(p.payload->'cost_item'->>'unit'), ''),
            NULLIF(BTRIM(p.payload->>'type'), '')
          ) AS uom,
          NULLIF(BTRIM(p.payload->>'type'), '') AS line_item_type,
          (
            COALESCE(NULLIF(p.payload->>'item_cost', '')::numeric, 0)
            + COALESCE(NULLIF(p.payload->>'labor_cost', '')::numeric, 0)
          ) AS total_cost,
          (
            COALESCE(NULLIF(p.payload->>'item_sales', '')::numeric, 0)
            + COALESCE(NULLIF(p.payload->>'labor_sales', '')::numeric, 0)
          ) AS total_sales,
          p.payload,
          p.synced_at
        FROM procore_proposal_line_items_live p
        LEFT JOIN LATERAL (
          SELECT
            b.procore_project_id,
            b.status AS bid_board_status
          FROM procore_bid_board_live b
          WHERE b.company_id = p.company_id
            AND b.bid_board_id = p.bid_board_project_id
          ORDER BY b.synced_at DESC
          LIMIT 1
        ) bb ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            s.external_id AS procore_project_id,
            s.status AS project_status,
            s.bid_board_status AS bid_board_status
          FROM procore_project_staging s
          WHERE s.company_id = p.company_id
            AND s.source = 'procore_v1_projects'
            AND s.external_id IS NOT NULL
            AND (
              EXISTS (
                SELECT 1
                FROM procore_bid_board_live b
                WHERE b.company_id = p.company_id
                  AND b.bid_board_id = p.bid_board_project_id
                  AND (
                    b.procore_project_id = s.external_id
                    OR b.procore_project_id = s.procore_project_id
                  )
              )
              OR (
                LOWER(TRIM(COALESCE(s.name, ''))) = LOWER(TRIM(COALESCE(p.project_name, '')))
                AND LOWER(TRIM(COALESCE(s.customer, ''))) = LOWER(TRIM(COALESCE(p.customer_name, '')))
              )
            )
          ORDER BY
            CASE
              WHEN EXISTS (
                SELECT 1
                FROM procore_bid_board_live b
                WHERE b.company_id = p.company_id
                  AND b.bid_board_id = p.bid_board_project_id
                  AND (
                    b.procore_project_id = s.external_id
                    OR b.procore_project_id = s.procore_project_id
                  )
              ) THEN 0
              ELSE 1
            END,
            s.synced_at DESC
          LIMIT 1
        ) proj ON TRUE
      )
    `;

    const [rows, countRows] = await Promise.all([
      withDatabaseRetry(() =>
        prisma.$queryRawUnsafe<ProposalLineItemLiveRow[]>(
          `
            ${baseQuery}
            SELECT
              base.id,
              base.company_id,
              base.bid_board_project_id,
              base.procore_project_id,
              base.proposal_id,
              base.line_item_id,
              base.project_name,
              base.customer_name,
              base.project_status,
              base.bid_board_status,
              base.proposal_name,
              base.name,
              base.status,
              base.cost_code,
              base.uom,
              base.line_item_type,
              base.total_cost,
              base.total_sales,
              base.payload,
              base.synced_at
            FROM base
            ${whereClause}
            ORDER BY
              COALESCE(base.project_status, '') ASC,
              COALESCE(base.project_name, '') ASC,
              COALESCE(base.proposal_name, '') ASC,
              COALESCE(base.uom, '') ASC,
              COALESCE(base.name, '') ASC,
              base.id DESC
            LIMIT $${values.length + 1}
            OFFSET $${values.length + 2}
          `,
          ...values,
          pageSize,
          skip
        )
      ),
      withDatabaseRetry(() =>
        prisma.$queryRawUnsafe<Array<{ total: number | bigint | string }>>(
          `
            ${baseQuery}
            SELECT COUNT(*)::int AS total
            FROM base
            ${whereClause}
          `,
          ...values
        )
      ),
    ]);

    const total = normalizeCount(countRows[0]?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const materializedRows = rows.map((row) => {
      const rollupCostCode = getRolledUpCostCode(row.cost_code) || row.cost_code || null;
      return {
        id: normalizeId(row.id),
        companyId: row.company_id,
        bidBoardProjectId: row.bid_board_project_id,
        procoreProjectId: row.procore_project_id,
        proposalId: row.proposal_id,
        lineItemId: row.line_item_id,
        projectName: row.project_name,
        customerName: row.customer_name,
        projectStatus: row.project_status,
        bidBoardStatus: row.bid_board_status,
        proposalName: row.proposal_name,
        name: row.name,
        status: row.status,
        costCode: row.cost_code,
        rollupCostCode,
        uom: row.uom,
        lineItemType: row.line_item_type,
        totalCost: row.total_cost === null ? null : Number(row.total_cost),
        totalSales: row.total_sales === null ? null : Number(row.total_sales),
        payload: row.payload,
        syncedAt: row.synced_at,
      };
    });

    const projectIds = Array.from(
      new Set(
        materializedRows
          .map((row) => String(row.procoreProjectId || "").trim())
          .filter(Boolean)
      )
    );

    const timecardActualsByKey = new Map<string, number>();
    const productivityActualsByKey = new Map<string, number>();

    if (projectIds.length > 0) {
      const [timecardRows, productivityRows] = await Promise.all([
        withDatabaseRetry(() =>
          prisma.$queryRawUnsafe<TimecardActualRow[]>(
            `
              SELECT
                t."procoreProjectId" AS procore_project_id,
                t."costCodeFullCode" AS cost_code,
                COALESCE(SUM(t.hours), 0) AS hours
              FROM "TimecardEntry" t
              WHERE t."procoreProjectId" = ANY($1)
                AND t."costCodeFullCode" IS NOT NULL
                AND t."costCodeFullCode" <> ''
              GROUP BY t."procoreProjectId", t."costCodeFullCode"
            `,
            projectIds
          )
        ),
        withDatabaseRetry(() =>
          prisma.$queryRawUnsafe<ProductivityActualRow[]>(
            `
              SELECT
                pl."procoreProjectId" AS procore_project_id,
                li."costCode" AS cost_code,
                COALESCE(SUM(pl."quantityUsed"), 0) AS quantity_used
              FROM "ProductivityLog" pl
              LEFT JOIN "PurchaseOrderLineItemContractDetail" li
                ON li."procoreId" = pl."lineItemId"
              WHERE pl."procoreProjectId" = ANY($1)
                AND pl."quantityUsed" IS NOT NULL
              GROUP BY pl."procoreProjectId", li."costCode"
            `,
            projectIds
          )
        ),
      ]);

      for (const row of timecardRows) {
        const key = buildActualsKey(row.procore_project_id, row.cost_code);
        if (!key) continue;
        timecardActualsByKey.set(key, (timecardActualsByKey.get(key) || 0) + normalizeMetric(row.hours));
      }

      for (const row of productivityRows) {
        const key = buildActualsKey(row.procore_project_id, row.cost_code);
        if (!key) continue;
        productivityActualsByKey.set(key, (productivityActualsByKey.get(key) || 0) + normalizeMetric(row.quantity_used));
      }
    }

    const enrichedRows = materializedRows.map((row) => {
      const key = buildActualsKey(row.procoreProjectId, row.rollupCostCode || row.costCode);
      const actualTimecardHours = key ? Number(timecardActualsByKey.get(key) || 0) : 0;
      const actualProductivityQty = key ? Number(productivityActualsByKey.get(key) || 0) : 0;

      return {
        ...row,
        actualTimecardHours,
        actualProductivityQty,
      };
    });

    return NextResponse.json({
      success: true,
      count: rows.length,
      total,
      page,
      pageSize,
      totalPages,
      hasNextPage: skip + rows.length < total,
      hasPreviousPage: page > 1,
      data: enrichedRows,
    });
  } catch (error) {
    if (isMissingTableError(error) || shouldFallbackToEmptyRead(error)) {
      const fallbackPage = Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("page") || "1", 10) || 1);
      const requestedPageSize = Number.parseInt(request.nextUrl.searchParams.get("pageSize") || "200", 10) || 200;
      const fallbackPageSize = Math.min(10000, Math.max(1, requestedPageSize));
      return NextResponse.json({
        success: true,
        count: 0,
        total: 0,
        page: fallbackPage,
        pageSize: fallbackPageSize,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: fallbackPage > 1,
        data: [],
        note:
          "Persisted proposal line items are currently unavailable in this environment (missing schema objects or restricted read permissions).",
      });
    }

    const message = getErrorMessage(error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch persisted proposal line items", details: message },
      { status: 500 }
    );
  }
}
