import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type BidBoardLiveRow = {
  bid_board_id: string;
  procore_project_id: string | null;
  name: string | null;
  status: string | null;
  status_raw: string | null;
  customer: string | null;
  synced_at: string;
};

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

    const rows = await prisma.$queryRawUnsafe<BidBoardLiveRow[]>(
      `
        WITH ranked AS (
          SELECT
            bid_board_id,
            procore_project_id,
            name,
            status,
            status_raw,
            customer,
            synced_at,
            ROW_NUMBER() OVER (
              PARTITION BY bid_board_id
              ORDER BY synced_at DESC, bid_board_id DESC
            ) AS rn
          FROM procore_bid_board_live
          WHERE bid_board_id IS NOT NULL
        )
        SELECT
          bid_board_id,
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
      skip
    );

    const countRows = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
      `
        WITH ranked AS (
          SELECT
            ROW_NUMBER() OVER (
              PARTITION BY bid_board_id
              ORDER BY synced_at DESC, bid_board_id DESC
            ) AS rn
          FROM procore_bid_board_live
          WHERE bid_board_id IS NOT NULL
        )
        SELECT COUNT(*)::int AS total
        FROM ranked
        WHERE rn = 1
      `
    );

    const total = countRows[0]?.total ?? 0;
    const hasNextPage = skip + rows.length < total;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const data = rows.map((row) => ({
      id: row.bid_board_id,
      bidBoardId: row.bid_board_id,
      procoreId: row.procore_project_id,
      projectName: row.name,
      status: row.status,
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
