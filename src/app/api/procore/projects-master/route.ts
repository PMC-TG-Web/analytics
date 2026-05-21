import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildSearchParamsCacheKey, getCachedValue, setCachedValue } from "@/lib/serverReadCache";

export const dynamic = "force-dynamic";

type RelationRow = {
  bidboardrelation: string | null;
  bidboardlatestmvrelation: string | null;
  bidsrelation: string | null;
  bidformsrelation: string | null;
  budgetrelation: string | null;
  budgetaggmvrelation: string | null;
  commitmentcontractrelation: string | null;
  purchaseordercontractrelation: string | null;
  packagesrelation: string | null;
  commitmentrelation: string | null;
  proposalrelation: string | null;
  commitmentsaggmvrelation: string | null;
};

type MasterProjectRow = {
  canonical_project_id: string;
  procore_project_id: string | null;
  external_project_id: string | null;
  bid_board_project_id: string | null;
  company_id: string;
  project_name: string | null;
  customer: string | null;
  project_status: string | null;
  bid_board_status: string | null;
  v1_synced_at: string | null;
  bid_board_synced_at: string | null;
  commitment_contract_count: number | null;
  purchase_order_contract_count: number | null;
  commitment_total_count: number | null;
  commitment_total_value: number | null;
  commitment_vendors: string | null;
  commitment_statuses: string | null;
  budget_total_amount: number | null;
  budget_line_item_count: number | null;
  budget_uoms: string | null;
  change_order_count: number | null;
  total_change_order_value: number | null;
  approved_change_order_value: number | null;
  change_order_statuses: string | null;
  bid_count: number | null;
  bid_statuses: string | null;
  bid_form_count: number | null;
  bid_package_count: number | null;
  bid_form_statuses: string | null;
  estimate_proposal_count: number | null;
  estimate_line_item_count: number | null;
  estimate_proposal_ids: string | null;
  estimate_proposal_names: string | null;
  estimate_bid_board_project_ids: string | null;
  latest_estimate_at: string | null;
};

function toBooleanParam(value: string | null): boolean {
  return String(value || "")
    .trim()
    .toLowerCase() === "true";
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const disableCache = toBooleanParam(searchParams.get("noCache"));
    const cacheKey = buildSearchParamsCacheKey("procore-projects-master", searchParams, ["noCache"]);

    if (!disableCache) {
      const cachedPayload = getCachedValue<Record<string, unknown>>(cacheKey);
      if (cachedPayload) {
        const cachedResponse = NextResponse.json(cachedPayload);
        cachedResponse.headers.set("Cache-Control", "private, max-age=15, must-revalidate");
        cachedResponse.headers.set("X-Data-Cache", "HIT");
        return cachedResponse;
      }
    }

    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
    const requestedPageSize = Number.parseInt(searchParams.get("pageSize") || "100", 10) || 100;
    const pageSize = Math.min(10000, Math.max(1, requestedPageSize));
    const skip = (page - 1) * pageSize;

    const companyId = String(searchParams.get("companyId") || process.env.PROCORE_COMPANY_ID || "").trim();
    const search = String(searchParams.get("search") || "").trim().toLowerCase();
    const projectStatus = String(searchParams.get("projectStatus") || "").trim().toLowerCase();
    const bidBoardStatus = String(searchParams.get("bidBoardStatus") || "").trim().toLowerCase();
    const withMetricsOnly = toBooleanParam(searchParams.get("withMetricsOnly"));

    const relationRows = await prisma.$queryRawUnsafe<RelationRow[]>(`
      SELECT
        to_regclass('public.procore_bid_board_live')::text AS bidBoardRelation,
        to_regclass('public.bid_board_latest_mv')::text AS bidBoardLatestMvRelation,
        to_regclass('public.bids')::text AS bidsRelation,
        to_regclass('public.bidforms')::text AS bidformsRelation,
        to_regclass('public.budgetlineitems')::text AS budgetRelation,
        to_regclass('public.budget_agg_mv')::text AS budgetAggMvRelation,
        to_regclass('public."CommitmentContract"')::text AS commitmentContractRelation,
        to_regclass('public."PurchaseOrderContract"')::text AS purchaseOrderContractRelation,
        to_regclass('public.procore_change_order_packages')::text AS packagesRelation,
        to_regclass('public."CommitmentChangeOrder"')::text AS commitmentRelation,
        to_regclass('public.procore_proposal_line_items_live')::text AS proposalRelation,
        to_regclass('public.commitments_agg_mv')::text AS commitmentsAggMvRelation
    `);

    const relations = relationRows[0] || {
      bidboardrelation: null,
      bidboardlatestmvrelation: null,
      bidsrelation: null,
      bidformsrelation: null,
      budgetrelation: null,
      budgetaggmvrelation: null,
      commitmentcontractrelation: null,
      purchaseordercontractrelation: null,
      packagesrelation: null,
      commitmentrelation: null,
      proposalrelation: null,
      commitmentsaggmvrelation: null,
    };

    const hasBidBoardLive = Boolean(relations.bidboardrelation);
    const hasBidBoardLatestMv = Boolean(relations.bidboardlatestmvrelation);
    const hasBids = Boolean(relations.bidsrelation);
    const hasBidForms = Boolean(relations.bidformsrelation);
    const hasBudget = Boolean(relations.budgetrelation);
    const hasBudgetAggMv = Boolean(relations.budgetaggmvrelation);
    const hasCommitmentContracts = Boolean(relations.commitmentcontractrelation);
    const hasPurchaseOrderContracts = Boolean(relations.purchaseordercontractrelation);
    const hasChangeOrderPackages = Boolean(relations.packagesrelation);
    const hasCommitmentChangeOrders = Boolean(relations.commitmentrelation);
    const hasProposalLineItems = Boolean(relations.proposalrelation);
    const hasCommitmentsAggMv = Boolean(relations.commitmentsaggmvrelation);

    const bidBoardCte = hasBidBoardLive
      ? hasBidBoardLatestMv
        ? `
            bid_board_latest AS (
              SELECT
                procore_project_id,
                bid_board_id,
                status,
                customer,
                synced_at
              FROM bid_board_latest_mv
              WHERE company_id = $1
            ),
          `
        : `
            bid_board_latest AS (
              SELECT DISTINCT ON (b.procore_project_id)
                b.procore_project_id,
                b.bid_board_id,
                b.status,
                b.customer,
                b.synced_at
              FROM procore_bid_board_live b
              WHERE b.company_id = $1
                AND b.procore_project_id IS NOT NULL
              ORDER BY b.procore_project_id, b.synced_at DESC
            ),
          `
      : `
          bid_board_latest AS (
            SELECT
              NULL::text AS procore_project_id,
              NULL::text AS bid_board_id,
              NULL::text AS status,
              NULL::text AS customer,
              NULL::timestamptz AS synced_at
            WHERE FALSE
          ),
        `;

    const budgetCte = hasBudget
      ? hasBudgetAggMv
        ? `
            budget_agg AS (
              SELECT
                canonical_project_id,
                budget_total_amount,
                budget_line_item_count,
                budget_uoms
              FROM budget_agg_mv
              WHERE company_id = $1
            ),
          `
        : `
            budget_agg AS (
              SELECT
                project_id AS canonical_project_id,
                SUM(COALESCE(amount, 0))::float AS budget_total_amount,
                COUNT(DISTINCT id)::int AS budget_line_item_count,
                STRING_AGG(
                  DISTINCT NULLIF(LOWER(TRIM(COALESCE(uom, ''))), ''),
                  ', '
                  ORDER BY NULLIF(LOWER(TRIM(COALESCE(uom, ''))), '')
                ) AS budget_uoms
              FROM budgetlineitems
              WHERE company_id = $1
              GROUP BY project_id
            ),
          `
      : `
          budget_agg AS (
            SELECT
              NULL::text AS canonical_project_id,
              NULL::float AS budget_total_amount,
              NULL::int AS budget_line_item_count,
              NULL::text AS budget_uoms
            WHERE FALSE
          ),
        `;

    const commitmentsCte =
      hasCommitmentsAggMv
        ? `
            commitments_agg AS (
              SELECT
                canonical_project_id,
                commitment_contract_count,
                purchase_order_contract_count,
                commitment_total_count,
                commitment_total_value,
                commitment_vendors,
                commitment_statuses
              FROM commitments_agg_mv
              WHERE company_id = $1
            ),
          `
        : hasCommitmentContracts || hasPurchaseOrderContracts
          ? `
              commitment_contract_agg AS (
                ${
                  hasCommitmentContracts
                    ? `
                SELECT
                  "procoreProjectId" AS canonical_project_id,
                  COUNT(DISTINCT id)::int AS commitment_contract_count,
                  0::int AS purchase_order_contract_count,
                  COUNT(DISTINCT id)::int AS commitment_total_count,
                  SUM(COALESCE(value, 0))::float AS commitment_total_value,
                  STRING_AGG(
                    DISTINCT NULLIF(TRIM(COALESCE("vendorName", '')), ''),
                    ', '
                    ORDER BY NULLIF(TRIM(COALESCE("vendorName", '')), '')
                  ) AS commitment_vendors,
                  STRING_AGG(
                    DISTINCT NULLIF(TRIM(COALESCE(status, '')), ''),
                    ', '
                    ORDER BY NULLIF(TRIM(COALESCE(status, '')), '')
                  ) AS commitment_statuses
                FROM "CommitmentContract"
                WHERE "procoreCompanyId" = $1
                  AND "procoreProjectId" IS NOT NULL
                GROUP BY "procoreProjectId"
                    `
                    : `
                SELECT
                  NULL::text AS canonical_project_id,
                  NULL::int AS commitment_contract_count,
                  NULL::int AS purchase_order_contract_count,
                  NULL::int AS commitment_total_count,
                  NULL::float AS commitment_total_value,
                  NULL::text AS commitment_vendors,
                  NULL::text AS commitment_statuses
                WHERE FALSE
                    `
                }
              ),
              purchase_order_contract_agg AS (
                ${
                  hasPurchaseOrderContracts
                    ? `
                SELECT
                  "procoreProjectId" AS canonical_project_id,
                  0::int AS commitment_contract_count,
                  COUNT(DISTINCT id)::int AS purchase_order_contract_count,
                  COUNT(DISTINCT id)::int AS commitment_total_count,
                  SUM(COALESCE(value, 0))::float AS commitment_total_value,
                  STRING_AGG(
                    DISTINCT NULLIF(TRIM(COALESCE("vendorName", '')), ''),
                    ', '
                    ORDER BY NULLIF(TRIM(COALESCE("vendorName", '')), '')
                  ) AS commitment_vendors,
                  STRING_AGG(
                    DISTINCT NULLIF(TRIM(COALESCE(status, '')), ''),
                    ', '
                    ORDER BY NULLIF(TRIM(COALESCE(status, '')), '')
                  ) AS commitment_statuses
                FROM "PurchaseOrderContract"
                WHERE "procoreCompanyId" = $1
                  AND "procoreProjectId" IS NOT NULL
                GROUP BY "procoreProjectId"
                    `
                    : `
                SELECT
                  NULL::text AS canonical_project_id,
                  NULL::int AS commitment_contract_count,
                  NULL::int AS purchase_order_contract_count,
                  NULL::int AS commitment_total_count,
                  NULL::float AS commitment_total_value,
                  NULL::text AS commitment_vendors,
                  NULL::text AS commitment_statuses
                WHERE FALSE
                    `
                }
              ),
              commitments_agg AS (
                SELECT
                  canonical_project_id,
                  SUM(commitment_contract_count)::int AS commitment_contract_count,
                  SUM(purchase_order_contract_count)::int AS purchase_order_contract_count,
                  SUM(commitment_total_count)::int AS commitment_total_count,
                  SUM(COALESCE(commitment_total_value, 0))::float AS commitment_total_value,
                  STRING_AGG(
                    DISTINCT NULLIF(TRIM(COALESCE(commitment_vendors, '')), ''),
                    ', '
                    ORDER BY NULLIF(TRIM(COALESCE(commitment_vendors, '')), '')
                  ) AS commitment_vendors,
                  STRING_AGG(
                    DISTINCT NULLIF(TRIM(COALESCE(commitment_statuses, '')), ''),
                    ', '
                    ORDER BY NULLIF(TRIM(COALESCE(commitment_statuses, '')), '')
                  ) AS commitment_statuses
                FROM (
                  SELECT * FROM commitment_contract_agg
                  UNION ALL
                  SELECT * FROM purchase_order_contract_agg
                ) combined_commitments
                GROUP BY canonical_project_id
              ),
            `
          : `
              commitments_agg AS (
                SELECT
                  NULL::text AS canonical_project_id,
                  NULL::int AS commitment_contract_count,
                  NULL::int AS purchase_order_contract_count,
                  NULL::int AS commitment_total_count,
                  NULL::float AS commitment_total_value,
                  NULL::text AS commitment_vendors,
                  NULL::text AS commitment_statuses
                WHERE FALSE
              ),
            `;

    const changeOrderCte = hasChangeOrderPackages
      ? `
          change_order_agg AS (
            SELECT
              project_id AS canonical_project_id,
              COUNT(DISTINCT package_id)::int AS change_order_count,
              SUM(COALESCE(amount, 0))::float AS total_change_order_value,
              SUM(
                CASE
                  WHEN LOWER(TRIM(COALESCE(status, ''))) LIKE '%approved%'
                    OR LOWER(TRIM(COALESCE(status, ''))) LIKE '%executed%'
                  THEN COALESCE(amount, 0)
                  ELSE 0
                END
              )::float AS approved_change_order_value,
              STRING_AGG(
                DISTINCT NULLIF(TRIM(COALESCE(status, '')), ''),
                ', '
                ORDER BY NULLIF(TRIM(COALESCE(status, '')), '')
              ) AS change_order_statuses
            FROM procore_change_order_packages
            WHERE company_id = $1
            GROUP BY project_id
          ),
        `
      : hasCommitmentChangeOrders
        ? `
            change_order_agg AS (
              SELECT
                "procoreProjectId" AS canonical_project_id,
                COUNT(DISTINCT id)::int AS change_order_count,
                SUM(COALESCE(value, 0))::float AS total_change_order_value,
                SUM(
                  CASE
                    WHEN LOWER(TRIM(COALESCE(status, ''))) LIKE '%approved%'
                      OR LOWER(TRIM(COALESCE(status, ''))) LIKE '%executed%'
                    THEN COALESCE(value, 0)
                    ELSE 0
                  END
                )::float AS approved_change_order_value,
                STRING_AGG(
                  DISTINCT NULLIF(TRIM(COALESCE(status, '')), ''),
                  ', '
                  ORDER BY NULLIF(TRIM(COALESCE(status, '')), '')
                ) AS change_order_statuses
              FROM "CommitmentChangeOrder"
              WHERE "procoreProjectId" IS NOT NULL
              GROUP BY "procoreProjectId"
            ),
          `
        : `
            change_order_agg AS (
              SELECT
                NULL::text AS canonical_project_id,
                NULL::int AS change_order_count,
                NULL::float AS total_change_order_value,
                NULL::float AS approved_change_order_value,
                NULL::text AS change_order_statuses
              WHERE FALSE
            ),
          `;

    const bidsCte = hasBids
      ? `
          bids_agg AS (
            SELECT
              project_id AS canonical_project_id,
              COUNT(DISTINCT bid_id)::int AS bid_count,
              STRING_AGG(
                DISTINCT NULLIF(TRIM(COALESCE(status, '')), ''),
                ', '
                ORDER BY NULLIF(TRIM(COALESCE(status, '')), '')
              ) AS bid_statuses
            FROM bids
            WHERE company_id = $1
            GROUP BY project_id
          ),
        `
      : `
          bids_agg AS (
            SELECT
              NULL::text AS canonical_project_id,
              NULL::int AS bid_count,
              NULL::text AS bid_statuses
            WHERE FALSE
          ),
        `;

    const bidFormsCte = hasBidForms
      ? `
          bid_forms_agg AS (
            SELECT
              project_id AS canonical_project_id,
              COUNT(DISTINCT bid_form_id)::int AS bid_form_count,
              COUNT(DISTINCT bid_package_id)::int AS bid_package_count,
              STRING_AGG(
                DISTINCT NULLIF(TRIM(COALESCE(status, '')), ''),
                ', '
                ORDER BY NULLIF(TRIM(COALESCE(status, '')), '')
              ) AS bid_form_statuses
            FROM bidforms
            WHERE company_id = $1
            GROUP BY project_id
          ),
        `
      : `
          bid_forms_agg AS (
            SELECT
              NULL::text AS canonical_project_id,
              NULL::int AS bid_form_count,
              NULL::int AS bid_package_count,
              NULL::text AS bid_form_statuses
            WHERE FALSE
          ),
        `;

    const estimatesCte = hasProposalLineItems
      ? `
          estimate_bid_board_match AS (
            SELECT
              b.procore_project_id AS canonical_project_id,
              p.bid_board_project_id,
              p.proposal_id,
              p.proposal_name,
              p.synced_at
            FROM procore_proposal_line_items_live p
            JOIN procore_bid_board_live b
              ON b.company_id = p.company_id
              AND b.bid_board_id = p.bid_board_project_id
            WHERE p.company_id = $1
              AND b.procore_project_id IS NOT NULL
          ),
          estimate_name_customer_match AS (
            SELECT
              s.external_id AS canonical_project_id,
              p.bid_board_project_id,
              p.proposal_id,
              p.proposal_name,
              p.synced_at
            FROM procore_project_staging s
            JOIN procore_proposal_line_items_live p
              ON p.company_id = s.company_id
              AND LOWER(TRIM(COALESCE(p.project_name, ''))) = LOWER(TRIM(COALESCE(s.name, '')))
              AND LOWER(TRIM(COALESCE(p.customer_name, ''))) = LOWER(TRIM(COALESCE(s.customer, '')))
            WHERE s.company_id = $1
              AND s.source = 'procore_v1_projects'
              AND s.external_id IS NOT NULL
              AND s.name IS NOT NULL
          ),
          estimate_combined AS (
            SELECT * FROM estimate_bid_board_match
            UNION ALL
            SELECT *
            FROM estimate_name_customer_match n
            WHERE NOT EXISTS (
              SELECT 1
              FROM estimate_bid_board_match b
              WHERE b.canonical_project_id = n.canonical_project_id
                AND b.proposal_id = n.proposal_id
            )
          ),
          estimate_agg AS (
            SELECT
              canonical_project_id,
              COUNT(DISTINCT proposal_id)::int AS estimate_proposal_count,
              COUNT(*)::int AS estimate_line_item_count,
              STRING_AGG(DISTINCT proposal_id, ', ' ORDER BY proposal_id) AS estimate_proposal_ids,
              STRING_AGG(
                DISTINCT NULLIF(TRIM(COALESCE(proposal_name, '')), ''),
                ', '
                ORDER BY NULLIF(TRIM(COALESCE(proposal_name, '')), '')
              ) AS estimate_proposal_names,
              STRING_AGG(DISTINCT bid_board_project_id, ', ' ORDER BY bid_board_project_id) AS estimate_bid_board_project_ids,
              MAX(synced_at)::text AS latest_estimate_at
            FROM estimate_combined
            GROUP BY canonical_project_id
          ),
          estimate_by_bid_board_agg AS (
            SELECT
              bid_board_project_id,
              COUNT(DISTINCT proposal_id)::int AS estimate_proposal_count,
              COUNT(*)::int AS estimate_line_item_count,
              STRING_AGG(DISTINCT proposal_id, ', ' ORDER BY proposal_id) AS estimate_proposal_ids,
              STRING_AGG(
                DISTINCT NULLIF(TRIM(COALESCE(proposal_name, '')), ''),
                ', '
                ORDER BY NULLIF(TRIM(COALESCE(proposal_name, '')), '')
              ) AS estimate_proposal_names,
              MAX(synced_at)::text AS latest_estimate_at
            FROM procore_proposal_line_items_live
            WHERE company_id = $1
            GROUP BY bid_board_project_id
          ),
        `
      : `
          estimate_agg AS (
            SELECT
              NULL::text AS canonical_project_id,
              NULL::int AS estimate_proposal_count,
              NULL::int AS estimate_line_item_count,
              NULL::text AS estimate_proposal_ids,
              NULL::text AS estimate_proposal_names,
              NULL::text AS estimate_bid_board_project_ids,
              NULL::text AS latest_estimate_at
            WHERE FALSE
          ),
          estimate_by_bid_board_agg AS (
            SELECT
              NULL::text AS bid_board_project_id,
              NULL::int AS estimate_proposal_count,
              NULL::int AS estimate_line_item_count,
              NULL::text AS estimate_proposal_ids,
              NULL::text AS estimate_proposal_names,
              NULL::text AS latest_estimate_at
            WHERE FALSE
          ),
        `;

    const values: unknown[] = [companyId];
    const whereParts: string[] = [];

    if (search) {
      values.push(`%${search}%`);
      whereParts.push(`(
        LOWER(COALESCE(external_project_id, '')) LIKE $${values.length}
        OR LOWER(COALESCE(procore_project_id, '')) LIKE $${values.length}
        OR LOWER(COALESCE(bid_board_project_id, '')) LIKE $${values.length}
        OR LOWER(COALESCE(project_name, '')) LIKE $${values.length}
        OR LOWER(COALESCE(customer, '')) LIKE $${values.length}
        OR LOWER(COALESCE(project_status, '')) LIKE $${values.length}
        OR LOWER(COALESCE(bid_board_status, '')) LIKE $${values.length}
      )`);
    }

    if (projectStatus) {
      values.push(projectStatus);
      whereParts.push(`LOWER(COALESCE(project_status, '')) = $${values.length}`);
    }

    if (bidBoardStatus) {
      values.push(bidBoardStatus);
      whereParts.push(`LOWER(COALESCE(bid_board_status, '')) = $${values.length}`);
    }

    if (withMetricsOnly) {
      whereParts.push(`(
        COALESCE(budget_line_item_count, 0) > 0
        OR COALESCE(change_order_count, 0) > 0
        OR COALESCE(bid_count, 0) > 0
        OR COALESCE(bid_form_count, 0) > 0
        OR COALESCE(estimate_proposal_count, 0) > 0
      )`);
    }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

    const baseCte = `
      WITH
      ${bidBoardCte}
      ${commitmentsCte}
      ${budgetCte}
      ${changeOrderCte}
      ${bidsCte}
      ${bidFormsCte}
      ${estimatesCte}
      v1_base AS (
        SELECT
          COALESCE(s.procore_project_id, s.external_id) AS canonical_project_id,
          s.procore_project_id,
          s.external_id AS external_project_id,
          bb.bid_board_id AS bid_board_project_id,
          s.company_id,
          s.name AS project_name,
          COALESCE(NULLIF(TRIM(s.customer), ''), NULLIF(TRIM(bb.customer), '')) AS customer,
          s.status AS project_status,
          COALESCE(s.bid_board_status, bb.status) AS bid_board_status,
          s.synced_at::text AS v1_synced_at,
          bb.synced_at::text AS bid_board_synced_at,
          commitments.commitment_contract_count,
          commitments.purchase_order_contract_count,
          commitments.commitment_total_count,
          commitments.commitment_total_value,
          commitments.commitment_vendors,
          commitments.commitment_statuses,
          budget.budget_total_amount,
          budget.budget_line_item_count,
          budget.budget_uoms,
          change_orders.change_order_count,
          change_orders.total_change_order_value,
          change_orders.approved_change_order_value,
          change_orders.change_order_statuses,
          bids.bid_count,
          bids.bid_statuses,
          bid_forms.bid_form_count,
          bid_forms.bid_package_count,
          bid_forms.bid_form_statuses,
          estimates.estimate_proposal_count,
          estimates.estimate_line_item_count,
          estimates.estimate_proposal_ids,
          estimates.estimate_proposal_names,
          estimates.estimate_bid_board_project_ids,
          estimates.latest_estimate_at
        FROM procore_project_staging s
        LEFT JOIN bid_board_latest bb
          ON bb.procore_project_id = COALESCE(s.procore_project_id, s.external_id)
        LEFT JOIN commitments_agg commitments
          ON commitments.canonical_project_id = COALESCE(s.procore_project_id, s.external_id)
        LEFT JOIN budget_agg budget
          ON budget.canonical_project_id = COALESCE(s.procore_project_id, s.external_id)
        LEFT JOIN change_order_agg change_orders
          ON change_orders.canonical_project_id = COALESCE(s.procore_project_id, s.external_id)
        LEFT JOIN bids_agg bids
          ON bids.canonical_project_id = COALESCE(s.procore_project_id, s.external_id)
        LEFT JOIN bid_forms_agg bid_forms
          ON bid_forms.canonical_project_id = COALESCE(s.procore_project_id, s.external_id)
        LEFT JOIN estimate_agg estimates
          ON estimates.canonical_project_id = COALESCE(s.procore_project_id, s.external_id)
        WHERE s.source = 'procore_v1_projects'
          AND s.company_id = $1
          AND s.external_id IS NOT NULL
          AND s.name IS NOT NULL
      ),
      bid_board_only AS (
        SELECT
          COALESCE(b.procore_project_id, CONCAT('bidboard:', b.bid_board_id)) AS canonical_project_id,
          b.procore_project_id,
          NULL::text AS external_project_id,
          b.bid_board_id AS bid_board_project_id,
          b.company_id,
          b.name AS project_name,
          NULLIF(TRIM(b.customer), '') AS customer,
          NULL::text AS project_status,
          b.status AS bid_board_status,
          NULL::text AS v1_synced_at,
          b.synced_at::text AS bid_board_synced_at,
          commitments.commitment_contract_count,
          commitments.purchase_order_contract_count,
          commitments.commitment_total_count,
          commitments.commitment_total_value,
          commitments.commitment_vendors,
          commitments.commitment_statuses,
          NULL::float AS budget_total_amount,
          NULL::int AS budget_line_item_count,
          NULL::text AS budget_uoms,
          NULL::int AS change_order_count,
          NULL::float AS total_change_order_value,
          NULL::float AS approved_change_order_value,
          NULL::text AS change_order_statuses,
          NULL::int AS bid_count,
          NULL::text AS bid_statuses,
          NULL::int AS bid_form_count,
          NULL::int AS bid_package_count,
          NULL::text AS bid_form_statuses,
          estimates_bb.estimate_proposal_count,
          estimates_bb.estimate_line_item_count,
          estimates_bb.estimate_proposal_ids,
          estimates_bb.estimate_proposal_names,
          b.bid_board_id AS estimate_bid_board_project_ids,
          estimates_bb.latest_estimate_at
        FROM procore_bid_board_live b
        LEFT JOIN LATERAL (
          SELECT 1 AS matched
          FROM procore_project_staging s
          WHERE s.source = 'procore_v1_projects'
            AND s.company_id = b.company_id
            AND (
              (b.procore_project_id IS NOT NULL AND COALESCE(s.procore_project_id, s.external_id) = b.procore_project_id)
              OR (
                LOWER(TRIM(COALESCE(s.name, ''))) = LOWER(TRIM(COALESCE(b.name, '')))
                AND LOWER(TRIM(COALESCE(s.customer, ''))) = LOWER(TRIM(COALESCE(b.customer, '')))
              )
            )
          LIMIT 1
        ) matched ON TRUE
        LEFT JOIN commitments_agg commitments
          ON commitments.canonical_project_id = b.procore_project_id
        LEFT JOIN estimate_by_bid_board_agg estimates_bb
          ON estimates_bb.bid_board_project_id = b.bid_board_id
        WHERE b.company_id = $1
          AND matched.matched IS NULL
      ),
      base AS (
        SELECT * FROM v1_base
        UNION ALL
        SELECT * FROM bid_board_only
      )
    `;

    const rows = await prisma.$queryRawUnsafe<MasterProjectRow[]>(
      `
        ${baseCte}
        SELECT *
        FROM base
        ${whereClause}
        ORDER BY
          COALESCE(project_status, '') ASC,
          COALESCE(project_name, '') ASC,
          canonical_project_id ASC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      ...values,
      pageSize,
      skip
    );

    const countRows = await prisma.$queryRawUnsafe<Array<{ total: number | string | bigint }>>(
      `
        ${baseCte}
        SELECT COUNT(*)::int AS total
        FROM base
        ${whereClause}
      `,
      ...values
    );

    const total = Number(countRows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const payload = {
      success: true,
      companyId,
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: skip + rows.length < total,
      hasPreviousPage: page > 1,
      sources: {
        procoreProjectStaging: true,
        bidBoardLive: hasBidBoardLive,
        commitmentContracts: hasCommitmentContracts,
        purchaseOrderContracts: hasPurchaseOrderContracts,
        bids: hasBids,
        bidForms: hasBidForms,
        budgetLineItems: hasBudget,
        changeOrderPackages: hasChangeOrderPackages,
        commitmentChangeOrders: hasCommitmentChangeOrders,
        proposalLineItems: hasProposalLineItems,
      },
      idGuide: {
        canonicalProjectId:
          "Primary project key for this endpoint. Uses the Procore project ID (59...) when linked, otherwise falls back to bidboard:{bidBoardProjectId} for estimating-only rows.",
        bidBoardProjectId: "Estimating bid board project ID (often 56...).",
        estimateProposalIds: "Proposal IDs under the estimating bid board project.",
      },
      data: rows.map((row) => ({
        canonicalProjectId: row.canonical_project_id,
        procoreProjectId: row.procore_project_id || null,
        externalProjectId: row.external_project_id,
        bidBoardProjectId: row.bid_board_project_id,
        companyId: row.company_id,
        projectName: row.project_name,
        customer: row.customer || "",
        projectStatus: row.project_status,
        bidBoardStatus: row.bid_board_status,
        v1SyncedAt: row.v1_synced_at,
        bidBoardSyncedAt: row.bid_board_synced_at,
        commitmentContractCount: row.commitment_contract_count || 0,
        purchaseOrderContractCount: row.purchase_order_contract_count || 0,
        commitmentTotalCount: row.commitment_total_count || 0,
        commitmentTotalValue: row.commitment_total_value || 0,
        commitmentVendors: row.commitment_vendors || "",
        commitmentStatuses: row.commitment_statuses || "",
        budgetTotalAmount: row.budget_total_amount || 0,
        budgetLineItemCount: row.budget_line_item_count || 0,
        budgetUoms: row.budget_uoms || "",
        changeOrderCount: row.change_order_count || 0,
        totalChangeOrderValue: row.total_change_order_value || 0,
        approvedChangeOrderValue: row.approved_change_order_value || 0,
        changeOrderStatuses: row.change_order_statuses || "",
        bidCount: row.bid_count || 0,
        bidStatuses: row.bid_statuses || "",
        bidFormCount: row.bid_form_count || 0,
        bidPackageCount: row.bid_package_count || 0,
        bidFormStatuses: row.bid_form_statuses || "",
        estimateProposalCount: row.estimate_proposal_count || 0,
        estimateLineItemCount: row.estimate_line_item_count || 0,
        estimateProposalIds: row.estimate_proposal_ids || "",
        estimateProposalNames: row.estimate_proposal_names || "",
        estimateBidBoardProjectIds: row.estimate_bid_board_project_ids || "",
        latestEstimateAt: row.latest_estimate_at,
      })),
    };

    if (!disableCache) {
      setCachedValue(cacheKey, payload, 15_000);
    }

    const response = NextResponse.json(payload);
    response.headers.set("Cache-Control", "private, max-age=15, must-revalidate");
    response.headers.set("X-Data-Cache", "MISS");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to fetch Procore projects master:", message);
    return NextResponse.json(
      { success: false, error: "Failed to fetch Procore projects master", details: message },
      { status: 500 }
    );
  }
}
