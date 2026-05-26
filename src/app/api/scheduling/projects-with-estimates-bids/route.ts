import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildCanonicalProcoreProjectsCte } from '@/lib/procoreProjectsCanonicalSql';

export const dynamic = 'force-dynamic';

type RelationRow = {
  bidsrelation: string | null;
  bidformsrelation: string | null;
  proposalrelation: string | null;
  bidboardrelation: string | null;
};

type ProjectRow = {
  projectid: string;
  procoreprojectid: string | null;
  projectname: string | null;
  customer: string | null;
  bidboardstatus: string | null;
  bidboardid: string | null;
};

type BidAggRow = {
  projectid: string;
  bidcount: number;
  bidstatuses: string | null;
  latestbidat: string | null;
};

type BidFormAggRow = {
  projectid: string;
  bidformcount: number;
  bidpackagecount: number;
  bidformstatuses: string | null;
  latestbidformat: string | null;
};

type EstimateAggRow = {
  projectid: string;
  estimateproposalcount: number;
  estimatelineitemcount: number;
  estimateproposalnames: string | null;
  latestestimateat: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const resolvedCompanyId = String(
      request.cookies.get('procore_company_id')?.value ||
      searchParams.get('companyId') ||
      ''
    ).trim();
    const rawBidBoardStatus = searchParams.get('bidBoardStatus');
    const bidBoardStatus = String(rawBidBoardStatus ?? 'IN_PROGRESS').trim();
    const bidBoardStatusFilter =
      !bidBoardStatus || bidBoardStatus.toLowerCase() === 'all' ? null : bidBoardStatus;
    const companyId = resolvedCompanyId;

    if (!companyId) {
      return NextResponse.json(
        { success: false, error: 'Missing companyId context for projects-with-estimates-bids.' },
        { status: 400 }
      );
    }

    const relationRows = await prisma.$queryRawUnsafe<RelationRow[]>(`
      SELECT
        to_regclass('public.bids')::text AS bidsRelation,
        to_regclass('public.bidforms')::text AS bidformsRelation,
        to_regclass('public.procore_proposal_line_items_live')::text AS proposalRelation,
        to_regclass('public.procore_bid_board_live')::text AS bidBoardRelation
    `);

    const relations = relationRows[0];
    const hasBids = Boolean(relations?.bidsrelation);
    const hasBidForms = Boolean(relations?.bidformsrelation);
    const hasProposalLineItems = Boolean(relations?.proposalrelation);
    const hasBidBoardLive = Boolean(relations?.bidboardrelation);
    const canonicalProjectsCte = buildCanonicalProcoreProjectsCte(1);

    const projectRows = await prisma.$queryRawUnsafe<ProjectRow[]>(
      `
        WITH
        ${canonicalProjectsCte}
        SELECT
          cp.external_project_id AS projectId,
          cp.procore_project_id AS procoreProjectId,
          cp.project_name AS projectName,
          cp.customer AS customer,
          cp.bid_board_status AS bidBoardStatus,
          cp.bid_board_id AS bidBoardId
        FROM canonical_projects cp
        WHERE ($2::text IS NULL OR cp.bid_board_status = $2::text)
        ORDER BY cp.project_name ASC NULLS LAST
      `,
      companyId,
      bidBoardStatusFilter
    );

    const bidAggMap = new Map<string, BidAggRow>();
    if (hasBids) {
      const bidRows = await prisma.$queryRawUnsafe<BidAggRow[]>(
        `
          SELECT
            project_id AS projectId,
            COUNT(DISTINCT bid_id)::int AS bidCount,
            STRING_AGG(
              DISTINCT NULLIF(TRIM(COALESCE(status, '')), ''),
              ', '
              ORDER BY NULLIF(TRIM(COALESCE(status, '')), '')
            ) AS bidStatuses,
            MAX(synced_at)::text AS latestBidAt
          FROM bids
          WHERE company_id = $1
          GROUP BY project_id
        `,
        companyId
      );

      for (const row of bidRows) {
        bidAggMap.set(row.projectid, row);
      }
    }

    const bidFormAggMap = new Map<string, BidFormAggRow>();
    if (hasBidForms) {
      const bidFormRows = await prisma.$queryRawUnsafe<BidFormAggRow[]>(
        `
          SELECT
            project_id AS projectId,
            COUNT(DISTINCT bid_form_id)::int AS bidFormCount,
            COUNT(DISTINCT bid_package_id)::int AS bidPackageCount,
            STRING_AGG(
              DISTINCT NULLIF(TRIM(COALESCE(status, '')), ''),
              ', '
              ORDER BY NULLIF(TRIM(COALESCE(status, '')), '')
            ) AS bidFormStatuses,
            MAX(synced_at)::text AS latestBidFormAt
          FROM bidforms
          WHERE company_id = $1
          GROUP BY project_id
        `,
        companyId
      );

      for (const row of bidFormRows) {
        bidFormAggMap.set(row.projectid, row);
      }
    }

    const estimateAggMap = new Map<string, EstimateAggRow>();
    if (hasProposalLineItems) {
      const estimateRows = await prisma.$queryRawUnsafe<EstimateAggRow[]>(
        `
          WITH bid_board_match AS (
            SELECT
              b.procore_project_id AS project_id,
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
          name_customer_match AS (
            SELECT
              s.external_id AS project_id,
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
          combined AS (
            SELECT * FROM bid_board_match
            UNION ALL
            SELECT *
            FROM name_customer_match n
            WHERE NOT EXISTS (
              SELECT 1
              FROM bid_board_match b
              WHERE b.project_id = n.project_id
                AND b.proposal_id = n.proposal_id
            )
          )
          SELECT
            project_id AS projectId,
            COUNT(DISTINCT proposal_id)::int AS estimateProposalCount,
            COUNT(*)::int AS estimateLineItemCount,
            STRING_AGG(
              DISTINCT NULLIF(TRIM(COALESCE(proposal_name, '')), ''),
              ', '
              ORDER BY NULLIF(TRIM(COALESCE(proposal_name, '')), '')
            ) AS estimateProposalNames,
            MAX(synced_at)::text AS latestEstimateAt
          FROM combined
          GROUP BY project_id
        `,
        companyId
      );

      for (const row of estimateRows) {
        estimateAggMap.set(row.projectid, row);
      }
    }

    return NextResponse.json({
      success: true,
      count: projectRows.length,
      bidBoardStatus: bidBoardStatusFilter,
      companyId,
      sources: {
        bids: hasBids,
        bidforms: hasBidForms,
        proposalLineItems: hasProposalLineItems,
        bidBoardLive: hasBidBoardLive,
      },
      data: projectRows.map((row) => {
        const projectKey = row.procoreprojectid || row.projectid;
        const bidAgg = bidAggMap.get(projectKey) || bidAggMap.get(row.projectid);
        const bidFormAgg = bidFormAggMap.get(projectKey) || bidFormAggMap.get(row.projectid);
        const estimateAgg = estimateAggMap.get(projectKey) || estimateAggMap.get(row.projectid);

        return {
          projectId: row.projectid,
          procoreProjectId: row.procoreprojectid,
          bidBoardId: row.bidboardid,
          projectName: row.projectname,
          customer: row.customer || '',
          bidBoardStatus: row.bidboardstatus,
          bidCount: bidAgg?.bidcount || 0,
          bidStatuses: bidAgg?.bidstatuses || '',
          latestBidAt: bidAgg?.latestbidat || null,
          bidFormCount: bidFormAgg?.bidformcount || 0,
          bidPackageCount: bidFormAgg?.bidpackagecount || 0,
          bidFormStatuses: bidFormAgg?.bidformstatuses || '',
          latestBidFormAt: bidFormAgg?.latestbidformat || null,
          estimateProposalCount: estimateAgg?.estimateproposalcount || 0,
          estimateLineItemCount: estimateAgg?.estimatelineitemcount || 0,
          estimateProposalNames: estimateAgg?.estimateproposalnames || '',
          latestEstimateAt: estimateAgg?.latestestimateat || null,
        };
      }),
    });
  } catch (error) {
    console.error('Failed to fetch projects with estimates/bids:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch projects with estimates/bids' },
      { status: 500 }
    );
  }
}
