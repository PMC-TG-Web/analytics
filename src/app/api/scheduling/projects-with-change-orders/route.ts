import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type ProjectChangeOrderRow = {
  projectid: string;
  projectname: string | null;
  customer: string | null;
  bidboardstatus: string | null;
  changeordercount: number;
  totalchangeordervalue: number | null;
  approvedchangeordervalue: number | null;
  changeorderstatuses: string | null;
  latestchangeorderat: string | null;
};

type ExistingRelationRow = {
  packagesrelation: string | null;
  commitmentrelation: string | null;
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
        { success: false, error: 'Missing companyId context for projects-with-change-orders.' },
        { status: 400 }
      );
    }

    const relationRows = await prisma.$queryRawUnsafe<ExistingRelationRow[]>(
      `
        SELECT
          to_regclass('public.procore_change_order_packages')::text AS packagesRelation,
          to_regclass('public."CommitmentChangeOrder"')::text AS commitmentRelation
      `
    );

    const relations = relationRows[0];
    const hasPackages = Boolean(relations?.packagesrelation);
    const hasCommitmentChangeOrders = Boolean(relations?.commitmentrelation);

    let rows: ProjectChangeOrderRow[] = [];
    let source: 'packages' | 'commitment_change_orders' | 'none' = 'none';

    if (hasPackages) {
      source = 'packages';
      rows = await prisma.$queryRawUnsafe<ProjectChangeOrderRow[]>(
        `
          SELECT
            s.external_id AS projectId,
            s.name AS projectName,
            s.customer AS customer,
            s.bid_board_status AS bidBoardStatus,
            COUNT(DISTINCT c.package_id)::int AS changeOrderCount,
            SUM(COALESCE(c.amount, 0))::float AS totalChangeOrderValue,
            SUM(
              CASE
                WHEN LOWER(TRIM(COALESCE(c.status, ''))) LIKE '%approved%'
                  OR LOWER(TRIM(COALESCE(c.status, ''))) LIKE '%executed%'
                THEN COALESCE(c.amount, 0)
                ELSE 0
              END
            )::float AS approvedChangeOrderValue,
            STRING_AGG(
              DISTINCT NULLIF(TRIM(COALESCE(c.status, '')), ''),
              ', '
              ORDER BY NULLIF(TRIM(COALESCE(c.status, '')), '')
            ) AS changeOrderStatuses,
            MAX(COALESCE(c.source_updated_at, c.synced_at))::text AS latestChangeOrderAt
          FROM procore_project_staging s
          LEFT JOIN procore_change_order_packages c
            ON c.company_id = s.company_id
            AND (c.project_id = s.procore_project_id OR c.project_id = s.external_id)
          WHERE s.source = 'procore_v1_projects'
            AND s.company_id = $1
            AND s.external_id IS NOT NULL
            AND s.name IS NOT NULL
            AND ($2::text IS NULL OR s.bid_board_status = $2::text)
          GROUP BY s.external_id, s.name, s.customer, s.bid_board_status, s.synced_at
          ORDER BY s.name ASC NULLS LAST
        `,
        companyId,
        bidBoardStatusFilter
      );
    } else if (hasCommitmentChangeOrders) {
      source = 'commitment_change_orders';
      rows = await prisma.$queryRawUnsafe<ProjectChangeOrderRow[]>(
        `
          SELECT
            s.external_id AS projectId,
            s.name AS projectName,
            s.customer AS customer,
            s.bid_board_status AS bidBoardStatus,
            COUNT(DISTINCT c.id)::int AS changeOrderCount,
            SUM(COALESCE(c.value, 0))::float AS totalChangeOrderValue,
            SUM(
              CASE
                WHEN LOWER(TRIM(COALESCE(c.status, ''))) LIKE '%approved%'
                  OR LOWER(TRIM(COALESCE(c.status, ''))) LIKE '%executed%'
                THEN COALESCE(c.value, 0)
                ELSE 0
              END
            )::float AS approvedChangeOrderValue,
            STRING_AGG(
              DISTINCT NULLIF(TRIM(COALESCE(c.status, '')), ''),
              ', '
              ORDER BY NULLIF(TRIM(COALESCE(c.status, '')), '')
            ) AS changeOrderStatuses,
            MAX(c."updatedAt")::text AS latestChangeOrderAt
          FROM procore_project_staging s
          LEFT JOIN "CommitmentChangeOrder" c
            ON c."procoreProjectId" = s.procore_project_id
            OR c."procoreProjectId" = s.external_id
          WHERE s.source = 'procore_v1_projects'
            AND s.company_id = $1
            AND s.external_id IS NOT NULL
            AND s.name IS NOT NULL
            AND ($2::text IS NULL OR s.bid_board_status = $2::text)
          GROUP BY s.external_id, s.name, s.customer, s.bid_board_status, s.synced_at
          ORDER BY s.name ASC NULLS LAST
        `,
        companyId,
        bidBoardStatusFilter
      );
    }

    return NextResponse.json({
      success: true,
      count: rows.length,
      bidBoardStatus: bidBoardStatusFilter,
      companyId,
      source,
      data: rows.map((row) => ({
        projectId: row.projectid,
        projectName: row.projectname,
        customer: row.customer || '',
        bidBoardStatus: row.bidboardstatus,
        changeOrderCount: row.changeordercount,
        totalChangeOrderValue: row.totalchangeordervalue || 0,
        approvedChangeOrderValue: row.approvedchangeordervalue || 0,
        changeOrderStatuses: row.changeorderstatuses || '',
        latestChangeOrderAt: row.latestchangeorderat,
      })),
    });
  } catch (error) {
    console.error('Failed to fetch projects with change orders:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch projects with change orders' },
      { status: 500 }
    );
  }
}
