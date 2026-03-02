import { prisma } from '@/lib/prisma';
import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const requestedPageSize = Number.parseInt(searchParams.get('pageSize') || '100', 10) || 100;
    const pageSize = Math.min(500, Math.max(1, requestedPageSize));
    const skip = (page - 1) * pageSize;

    const [total, rows] = await Promise.all([
      prisma.status.count(),
      prisma.status.findMany({
        orderBy: [{ customer: 'asc' }, { projectName: 'asc' }],
        skip,
        take: pageSize,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return NextResponse.json({
      success: true,
      count: rows.length,
      total,
      page,
      pageSize,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      data: rows,
    });
  } catch (error) {
    console.error('Failed to fetch status rows:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch status rows' },
      { status: 500 }
    );
  }
}
