import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureBidsTable } from '@/lib/procoreBids';

function normalizeId(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return '';
}

export async function GET(request: NextRequest) {
  try {
    await ensureBidsTable();

    const searchParams = request.nextUrl.searchParams;
    const companyId = String(searchParams.get('companyId') || '').trim();
    const projectId = String(searchParams.get('projectId') || '').trim();
    const bidId = String(searchParams.get('bidId') || '').trim();
    const search = String(searchParams.get('search') || '').trim();

    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const requestedPageSize = Number.parseInt(searchParams.get('pageSize') || '200', 10) || 200;
    const pageSize = Math.min(1000, Math.max(1, requestedPageSize));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (companyId) {
      conditions.push(`company_id = $${p++}`);
      params.push(companyId);
    }
    if (projectId) {
      conditions.push(`project_id = $${p++}`);
      params.push(projectId);
    }
    if (bidId) {
      conditions.push(`bid_id = $${p++}`);
      params.push(bidId);
    }
    if (search) {
      conditions.push(`(COALESCE(name, '') ILIKE $${p} OR COALESCE(created_by, '') ILIKE $${p})`);
      params.push(`%${search}%`);
      p += 1;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = await prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
      `SELECT COUNT(*)::bigint AS total FROM bids ${whereClause}`,
      ...params
    );

    const totalRaw = countRows[0]?.total ?? 0;
    const total = typeof totalRaw === 'bigint' ? Number(totalRaw) : Number(totalRaw || 0);

    const rows = await prisma.$queryRawUnsafe<Array<{
      id: unknown;
      company_id: string;
      project_id: string;
      bid_id: string;
      name: string | null;
      status: string | null;
      created_by: string | null;
      source_created_at: Date | null;
      payload: unknown;
      synced_at: Date;
      created_at: Date;
      updated_at: Date;
    }>>(
      `
        SELECT
          id,
          company_id,
          project_id,
          bid_id,
          name,
          status,
          created_by,
          source_created_at,
          payload,
          synced_at,
          created_at,
          updated_at
        FROM bids
        ${whereClause}
        ORDER BY synced_at DESC
        LIMIT $${p++}
        OFFSET $${p++}
      `,
      ...params,
      pageSize,
      offset
    );

    return NextResponse.json({
      success: true,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      data: rows.map((row) => ({
        id: normalizeId(row.id),
        companyId: row.company_id,
        projectId: row.project_id,
        bidId: row.bid_id,
        name: row.name,
        status: row.status,
        createdBy: row.created_by,
        sourceCreatedAt: row.source_created_at,
        payload: row.payload,
        syncedAt: row.synced_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `Failed to read bids: ${message}` },
      { status: 500 }
    );
  }
}
