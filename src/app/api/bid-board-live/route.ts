import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const SINGLE_ALLOWED_PROCORE_COMPANY_ID = '598134325805519';

type BidBoardLiveRow = {
  bid_board_id: string;
  canonical_bid_board_id: string;
  procore_project_id: string | null;
  name: string | null;
  status: string | null;
  status_raw: string | null;
  customer: string | null;
  synced_at: string;
};

function normalizeBidBoardStatus(status: string | null | undefined): string | null {
  const raw = String(status || '').trim();
  const normalized = raw
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ');

  if (!normalized) return null;
  if (normalized === 'bid submitted' || normalized === 'bidding') return 'Bid Submitted';
  if (normalized === 'pre construction' || normalized === 'estimating') return 'Estimating';
  if (normalized === 'post construction' || normalized === 'complete') return 'Complete';
  if (normalized === 'active' || normalized === 'in progress' || normalized === 'course of construction') return 'In Progress';
  if (normalized === 'accepted') return 'Accepted';
  if (normalized === 'invitation' || normalized === 'invitations') return 'Invitations';
  if (normalized === 'lost') return 'Lost';
  if (normalized === 'to do' || normalized === 'todo') return 'To Do';

  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function isTransientDbError(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || '').toUpperCase();
  if (code === 'P1001' || code === 'P2024') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /Can't reach database server|Timed out fetching a new connection from the connection pool/i.test(message);
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const requestedPageSize = Number.parseInt(searchParams.get('pageSize') || '500', 10) || 500;
    const pageSize = Math.min(2000, Math.max(1, requestedPageSize));
    const skip = (page - 1) * pageSize;
    const queryCompanyId = String(searchParams.get('companyId') || '').trim();
    const cookieCompanyId = String(request.cookies.get('procore_company_id')?.value || '').trim();

    if (cookieCompanyId && queryCompanyId && cookieCompanyId !== queryCompanyId) {
      return NextResponse.json(
        { success: false, error: 'Company context mismatch between session cookie and request query.' },
        { status: 403 }
      );
    }

    const companyId = (cookieCompanyId || queryCompanyId || SINGLE_ALLOWED_PROCORE_COMPANY_ID).trim();
    if (companyId !== SINGLE_ALLOWED_PROCORE_COMPANY_ID) {
      return NextResponse.json(
        { success: false, error: 'Forbidden company context for this deployment.' },
        { status: 403 }
      );
    }

    const rows = await prisma.$queryRawUnsafe<BidBoardLiveRow[]>(
      `
        WITH normalized AS (
          SELECT
            bid_board_id,
            CASE
              WHEN bid_board_id IS NULL THEN NULL
              WHEN strpos(bid_board_id, ':') > 0 THEN regexp_replace(bid_board_id, '^.*:', '')
              ELSE bid_board_id
            END AS canonical_bid_board_id,
            procore_project_id,
            name,
            status,
            status_raw,
            customer,
            synced_at
          FROM procore_bid_board_live
          WHERE bid_board_id IS NOT NULL
            AND company_id = $3
        ),
        ranked AS (
          SELECT
            bid_board_id,
            canonical_bid_board_id,
            procore_project_id,
            name,
            status,
            status_raw,
            customer,
            synced_at,
            ROW_NUMBER() OVER (
              PARTITION BY canonical_bid_board_id
              ORDER BY synced_at DESC, bid_board_id DESC
            ) AS rn
          FROM normalized
        )
        SELECT
          bid_board_id,
          canonical_bid_board_id,
          procore_project_id,
          name,
          status,
          status_raw,
          customer,
          synced_at
        FROM ranked
        WHERE rn = 1
        ORDER BY name ASC NULLS LAST
        LIMIT $1
        OFFSET $2
      `,
      pageSize,
      skip,
      companyId
    );

    const countRows = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
      `
        WITH normalized AS (
          SELECT
            CASE
              WHEN bid_board_id IS NULL THEN NULL
              WHEN strpos(bid_board_id, ':') > 0 THEN regexp_replace(bid_board_id, '^.*:', '')
              ELSE bid_board_id
            END AS canonical_bid_board_id,
            bid_board_id,
            synced_at
          FROM procore_bid_board_live
          WHERE bid_board_id IS NOT NULL
            AND company_id = $1
        ),
        ranked AS (
          SELECT
            ROW_NUMBER() OVER (
              PARTITION BY canonical_bid_board_id
              ORDER BY synced_at DESC, bid_board_id DESC
            ) AS rn
          FROM normalized
        )
        SELECT COUNT(*)::int AS total
        FROM ranked
        WHERE rn = 1
      `,
      companyId
    );

    const total = countRows[0]?.total ?? 0;
    const hasNextPage = skip + rows.length < total;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const data = rows.map((row) => ({
      id: row.canonical_bid_board_id || row.bid_board_id,
      bidBoardId: row.canonical_bid_board_id || row.bid_board_id,
      procoreId: row.procore_project_id,
      projectName: row.name,
      status: normalizeBidBoardStatus(row.status) || normalizeBidBoardStatus(row.status_raw) || row.status,
      statusRaw: row.status_raw,
      customer: row.customer,
      statusSource: 'procore_bid_board_live',
      syncedAt: row.synced_at,
    }));

    return NextResponse.json({
      success: true,
      count: data.length,
      total,
      page,
      pageSize,
      totalPages,
      hasNextPage,
      hasPreviousPage: page > 1,
      data,
    });
  } catch (error) {
    console.error('Failed to fetch bid-board-live:', error);
    if (isTransientDbError(error)) {
      return NextResponse.json(
        {
          success: false,
          degraded: true,
          error: 'Database temporarily unavailable',
          count: 0,
          total: 0,
          page: 1,
          pageSize: 500,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
          data: [],
        },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'Failed to fetch live Procore bid board data' },
      { status: 500 }
    );
  }
}
