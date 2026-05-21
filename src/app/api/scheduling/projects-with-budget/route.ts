import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildSearchParamsCacheKey, getCachedValue, setCachedValue } from '@/lib/serverReadCache';

export const dynamic = 'force-dynamic';

type ProjectBudgetRow = {
  projectid: string;
  externalid: string | null;
  projectname: string | null;
  customer: string | null;
  bidboardstatus: string | null;
  totalamount: number | null;
  totalquantity: number | null;
  lineitemcount: number;
  uoms: string | null;
  syncedat: string;
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const disableCache = String(searchParams.get('noCache') || '').trim().toLowerCase() === 'true';
    const cacheKey = buildSearchParamsCacheKey('scheduling-projects-with-budget', searchParams, ['noCache']);

    if (!disableCache) {
      const cachedPayload = getCachedValue<Record<string, unknown>>(cacheKey);
      if (cachedPayload) {
        const cachedResponse = NextResponse.json(cachedPayload);
        cachedResponse.headers.set('Cache-Control', 'private, max-age=30, must-revalidate');
        cachedResponse.headers.set('X-Data-Cache', 'HIT');
        return cachedResponse;
      }
    }

    const rawBidBoardStatus = searchParams.get('bidBoardStatus');
    const bidBoardStatus = String(rawBidBoardStatus ?? 'IN_PROGRESS').trim();
    const bidBoardStatusFilter =
      !bidBoardStatus || bidBoardStatus.toLowerCase() === 'all' ? null : bidBoardStatus;
    const companyId = String(searchParams.get('companyId') || process.env.PROCORE_COMPANY_ID || '').trim();

    const rows = await prisma.$queryRawUnsafe<ProjectBudgetRow[]>(
      `
        SELECT
          s.procore_project_id AS projectId,
          s.external_id AS externalId,
          s.name AS projectName,
          s.customer AS customer,
          s.bid_board_status AS bidBoardStatus,
          SUM(COALESCE(b.amount, 0))::float AS totalAmount,
          SUM(
            CASE
              WHEN LOWER(COALESCE(b.uom, '')) IN ('hours', 'hr', 'hrs')
                AND LOWER(COALESCE(b.cost_code, '')) NOT IN ('project management.other', '01-300-10-20.o')
              THEN COALESCE(b.quantity, 0)
              ELSE 0
            END
          )::float AS totalQuantity,
          COUNT(DISTINCT b.id)::int AS lineItemCount,
          STRING_AGG(DISTINCT NULLIF(LOWER(TRIM(COALESCE(b.uom, ''))), ''), ', ' ORDER BY NULLIF(LOWER(TRIM(COALESCE(b.uom, ''))), '')) AS uoms,
          MAX(s.synced_at)::text AS syncedAt
        FROM procore_project_staging s
        LEFT JOIN budgetlineitems b
          ON b.company_id = s.company_id
          AND b.project_id = s.procore_project_id
        WHERE s.source = 'procore_v1_projects'
          AND s.company_id = $1
          AND s.procore_project_id IS NOT NULL
          AND s.name IS NOT NULL
          AND ($2::text IS NULL OR s.bid_board_status = $2::text)
        GROUP BY s.procore_project_id, s.external_id, s.name, s.customer, s.bid_board_status, s.synced_at
        ORDER BY s.name ASC NULLS LAST
      `,
      companyId,
      bidBoardStatusFilter
    );
    const payload = {
      success: true,
      count: rows.length,
      bidBoardStatus: bidBoardStatusFilter,
      companyId,
      data: rows.map((row) => ({
        projectId: row.projectid,
        externalId: row.externalid,
        projectName: row.projectname,
        customer: row.customer || '',
        bidBoardStatus: row.bidboardstatus,
        totalAmount: row.totalamount || 0,
        totalQuantity: row.totalquantity || 0,
        lineItemCount: row.lineitemcount,
        uoms: row.uoms || '',
        syncedAt: row.syncedat,
      })),
    };

    if (!disableCache) {
      setCachedValue(cacheKey, payload, 30_000);
    }

    const response = NextResponse.json(payload);
    response.headers.set('Cache-Control', 'private, max-age=30, must-revalidate');
    response.headers.set('X-Data-Cache', 'MISS');
    return response;
  } catch (error) {
    console.error('Failed to fetch projects with budget:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch projects with budget' },
      { status: 500 }
    );
  }
}
