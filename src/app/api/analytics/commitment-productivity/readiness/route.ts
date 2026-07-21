import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type ReadinessRow = Record<string, bigint | number | string | null>;

function toNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: NextRequest) {
  try {
    const companyId = String(
      request.nextUrl.searchParams.get('companyId') || process.env.PROCORE_COMPANY_ID || ''
    ).trim();
    const projectId = String(request.nextUrl.searchParams.get('projectId') || '').trim() || null;

    if (!companyId) {
      return NextResponse.json({ success: false, error: 'Missing companyId.' }, { status: 400 });
    }

    const rows = await prisma.$queryRawUnsafe<ReadinessRow[]>(
      `
        WITH po_lines AS (
          SELECT li.*
          FROM "PurchaseOrderLineItemContractDetail" li
          WHERE li."procoreCompanyId" = $1
            AND ($2::text IS NULL OR li."procoreProjectId" = $2)
            AND NOT EXISTS (
              SELECT 1
              FROM "PurchaseOrderContract" po
              WHERE po."procoreCompanyId" = li."procoreCompanyId"
                AND po."procoreProjectId" = li."procoreProjectId"
                AND po."procoreId" = li."procorePurchaseOrderContractId"
                AND COALESCE(po.title, '') ILIKE '%Billing File%'
            )
        ),
        productivity AS (
          SELECT
            p.*,
            COALESCE(a.target_line_item_id, p."lineItemId") AS canonical_line_item_id
          FROM "ProductivityLog" p
          LEFT JOIN analytics_po_line_aliases a
            ON a.company_id = p."procoreCompanyId"
           AND a.procore_project_id = p."procoreProjectId"
           AND a.source_line_item_id = p."lineItemId"
          WHERE p."procoreCompanyId" = $1
            AND ($2::text IS NULL OR p."procoreProjectId" = $2)
            AND p."procoreDeletedAt" IS NULL
            AND COALESCE(p."lineItemHolderTitle", '') NOT ILIKE '%Billing File%'
        ),
        timecards AS (
          SELECT t.*
          FROM "TimecardEntry" t
          WHERE t."procoreCompanyId" = $1
            AND ($2::text IS NULL OR t."procoreProjectId" = $2)
        ),
        po_code_cardinality AS (
          SELECT
            "procoreProjectId" AS project_id,
            "costCode" AS cost_code,
            COUNT(DISTINCT "procoreId") AS line_count
          FROM po_lines
          WHERE NULLIF(BTRIM("costCode"), '') IS NOT NULL
          GROUP BY "procoreProjectId", "costCode"
        ),
        timecard_assignment AS (
          SELECT
            t.id,
            COALESCE(t.hours, t."totalHoursWorked", 0)::numeric AS hours,
            COALESCE(pc.line_count, 0) AS line_count
          FROM timecards t
          LEFT JOIN po_code_cardinality pc
            ON pc.project_id = t."procoreProjectId"
           AND pc.cost_code = t."costCodeFullCode"
          WHERE NULLIF(BTRIM(t."costCodeFullCode"), '') IS NOT NULL
        ),
        duplicate_commitments AS (
          SELECT COUNT(*)::bigint AS duplicate_count
          FROM "CommitmentContract" c
          JOIN "PurchaseOrderContract" po
            ON po."procoreCompanyId" = c."procoreCompanyId"
           AND po."procoreProjectId" = c."procoreProjectId"
           AND po."procoreId" = c."procoreId"
          WHERE c."procoreCompanyId" = $1
            AND ($2::text IS NULL OR c."procoreProjectId" = $2)
        )
        SELECT
          (SELECT COUNT(*) FROM po_lines) AS po_line_count,
          (SELECT COUNT(*) FROM productivity) AS productivity_count,
          (
            SELECT COUNT(*) FROM productivity p
            WHERE EXISTS (
              SELECT 1 FROM po_lines li
              WHERE li."procoreCompanyId" = p."procoreCompanyId"
                AND li."procoreProjectId" = p."procoreProjectId"
                AND li."procoreId" = p.canonical_line_item_id
            )
          ) AS productivity_matched_count,
          (
            SELECT COUNT(*) FROM productivity p
            WHERE NOT EXISTS (
              SELECT 1 FROM po_lines li
              WHERE li."procoreCompanyId" = p."procoreCompanyId"
                AND li."procoreProjectId" = p."procoreProjectId"
                AND li."procoreId" = p.canonical_line_item_id
            )
          ) AS productivity_unmatched_count,
          (
            SELECT COUNT(*) FROM analytics_po_line_aliases a
            WHERE a.company_id = $1
              AND ($2::text IS NULL OR a.procore_project_id = $2)
          ) AS po_line_alias_count,
          (
            SELECT COUNT(*) FROM analytics_po_line_aliases a
            WHERE a.company_id = $1
              AND a.confidence < 1
              AND ($2::text IS NULL OR a.procore_project_id = $2)
          ) AS reviewed_po_line_alias_count,
          (SELECT COUNT(*) FROM timecards) AS timecard_count,
          (SELECT COALESCE(SUM(hours), 0) FROM timecard_assignment) AS coded_timecard_hours,
          (SELECT COALESCE(SUM(hours), 0) FROM timecard_assignment WHERE line_count = 1) AS uniquely_assignable_hours,
          (SELECT COALESCE(SUM(hours), 0) FROM timecard_assignment WHERE line_count > 1) AS ambiguous_hours,
          (SELECT COALESCE(SUM(hours), 0) FROM timecard_assignment WHERE line_count = 0) AS unmatched_hours,
          (
            SELECT COUNT(*) FROM procore_estimate_proposals ep
            WHERE ep.company_id = $1
              AND ($2::text IS NULL OR ep.procore_project_id = $2)
          ) AS estimate_proposal_count,
          (
            SELECT COUNT(*) FROM procore_estimate_proposals ep
            WHERE ep.company_id = $1
              AND ep.procore_project_id IS NOT NULL
              AND ($2::text IS NULL OR ep.procore_project_id = $2)
          ) AS linked_estimate_proposal_count,
          (
            SELECT COUNT(*) FROM procore_estimate_proposals ep
            WHERE ep.company_id = $1
              AND ep.is_baseline_candidate
              AND ($2::text IS NULL OR ep.procore_project_id = $2)
          ) AS baseline_proposal_count,
          (
            SELECT COALESCE(SUM(li.labor_hours), 0)
            FROM procore_estimate_line_items li
            JOIN procore_estimate_proposals ep
              ON ep.company_id = li.company_id
             AND ep.bid_board_project_id = li.bid_board_project_id
             AND ep.proposal_id = li.proposal_id
             AND ep.is_baseline_candidate
            WHERE li.company_id = $1
              AND ($2::text IS NULL OR li.procore_project_id = $2)
          ) AS baseline_labor_hours,
          (
            SELECT COUNT(*) FROM procore_change_order_packages cop
            WHERE cop.company_id = $1
              AND LOWER(COALESCE(cop.status, '')) IN ('approved', 'executed', 'complete', 'completed')
              AND ($2::text IS NULL OR cop.project_id = $2)
          ) AS approved_change_order_count,
          (
            SELECT COUNT(*) FROM procore_change_order_package_lines col
            WHERE col.company_id = $1
              AND LOWER(COALESCE(col.package_status, '')) IN ('approved', 'executed', 'complete', 'completed')
              AND ($2::text IS NULL OR col.project_id = $2)
          ) AS approved_change_order_line_count,
          (
            SELECT COALESCE(SUM(col.labor_hours), 0)
            FROM procore_change_order_package_lines col
            WHERE col.company_id = $1
              AND LOWER(COALESCE(col.package_status, '')) IN ('approved', 'executed', 'complete', 'completed')
              AND ($2::text IS NULL OR col.project_id = $2)
          ) AS approved_change_order_labor_hours,
          (SELECT duplicate_count FROM duplicate_commitments) AS duplicate_commitment_header_count
      `,
      companyId,
      projectId
    );

    const row = rows[0] ?? {};
    const productivityCount = toNumber(row.productivity_count);
    const productivityMatchedCount = toNumber(row.productivity_matched_count);
    const codedTimecardHours = toNumber(row.coded_timecard_hours);
    const uniquelyAssignableHours = toNumber(row.uniquely_assignable_hours);
    const baselineProposalCount = toNumber(row.baseline_proposal_count);
    const approvedChangeOrderCount = toNumber(row.approved_change_order_count);
    const approvedChangeOrderLineCount = toNumber(row.approved_change_order_line_count);

    const metrics = {
      poLineCount: toNumber(row.po_line_count),
      productivityCount,
      productivityMatchedCount,
      productivityUnmatchedCount: toNumber(row.productivity_unmatched_count),
      productivityMatchRate: productivityCount > 0 ? productivityMatchedCount / productivityCount : 1,
      poLineAliasCount: toNumber(row.po_line_alias_count),
      reviewedPoLineAliasCount: toNumber(row.reviewed_po_line_alias_count),
      timecardCount: toNumber(row.timecard_count),
      codedTimecardHours,
      uniquelyAssignableHours,
      ambiguousHours: toNumber(row.ambiguous_hours),
      unmatchedHours: toNumber(row.unmatched_hours),
      uniqueTimecardAllocationRate: codedTimecardHours > 0 ? uniquelyAssignableHours / codedTimecardHours : 1,
      estimateProposalCount: toNumber(row.estimate_proposal_count),
      linkedEstimateProposalCount: toNumber(row.linked_estimate_proposal_count),
      baselineProposalCount,
      baselineLaborHours: toNumber(row.baseline_labor_hours),
      approvedChangeOrderCount,
      approvedChangeOrderLineCount,
      approvedChangeOrderLaborHours: toNumber(row.approved_change_order_labor_hours),
      duplicateCommitmentHeaderCount: toNumber(row.duplicate_commitment_header_count),
    };

    return NextResponse.json({
      success: true,
      companyId,
      projectId,
      ready: {
        quantities: metrics.poLineCount > 0 && metrics.productivityMatchRate >= 0.99,
        baselineLabor: baselineProposalCount > 0 && metrics.baselineLaborHours > 0,
        approvedChangeOrders:
          approvedChangeOrderCount === 0 || approvedChangeOrderLineCount > 0,
        directLineLaborAllocation: metrics.uniqueTimecardAllocationRate >= 0.99,
      },
      metrics,
      notes: [
        'directLineLaborAllocation=false is expected when several PO lines share a cost code; keep those hours at work-scope level until mapped',
        'canonical commitment views suppress overlapping generic commitment and PO headers',
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: 'Failed to calculate commitment/productivity readiness.', details: message },
      { status: 500 }
    );
  }
}
