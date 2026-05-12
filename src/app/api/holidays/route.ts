import { prisma } from '@/lib/prisma';
import { getErrorMessage, shouldFallbackToEmptyRead } from '@/lib/dbResilience';
import { buildSearchParamsCacheKey, getCachedValue, invalidateCacheByPrefix, setCachedValue } from '@/lib/serverReadCache';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const HOLIDAYS_CACHE_PREFIX = 'holidays:';
const HOLIDAYS_CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const cacheKey = buildSearchParamsCacheKey(`${HOLIDAYS_CACHE_PREFIX}get`, searchParams);
    const cached = getCachedValue<Record<string, unknown>>(cacheKey);
    if (cached) {
      const response = NextResponse.json(cached);
      response.headers.set('Cache-Control', 'private, max-age=60, must-revalidate');
      response.headers.set('X-Cache', 'HIT');
      return response;
    }

    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const requestedPageSize = Number.parseInt(searchParams.get('pageSize') || '100', 10) || 100;
    const pageSize = Math.min(500, Math.max(1, requestedPageSize));
    const skip = (page - 1) * pageSize;

    const [total, holidays] = await Promise.all([
      prisma.holiday.count(),
      prisma.holiday.findMany({
        orderBy: {
          date: 'asc',
        },
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          date: true,
          isPaid: true,
          description: true,
        },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const payload = {
      success: true,
      count: holidays.length,
      total,
      page,
      pageSize,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      data: holidays,
    };

    setCachedValue(cacheKey, payload, HOLIDAYS_CACHE_TTL_MS);

    const response = NextResponse.json(payload);
    response.headers.set('Cache-Control', 'private, max-age=60, must-revalidate');
    response.headers.set('X-Cache', 'MISS');
    return response;
  } catch (error) {
    console.error('Failed to fetch holidays:', error);
    if (shouldFallbackToEmptyRead(error)) {
      const fallbackPage = Math.max(1, Number.parseInt(request.nextUrl.searchParams.get('page') || '1', 10) || 1);
      const requestedPageSize = Number.parseInt(request.nextUrl.searchParams.get('pageSize') || '100', 10) || 100;
      const fallbackPageSize = Math.min(500, Math.max(1, requestedPageSize));

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
      });
    }

    return NextResponse.json(
      { success: false, error: `Failed to fetch holidays: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Handle batch creation (for seed/import)
    if (Array.isArray(body)) {
      const normalized = body
        .map((h) => ({
          name: String(h?.name || '').trim(),
          date: String(h?.date || '').trim(),
          isPaid: h?.isPaid ?? true,
          description: h?.description ? String(h.description).trim() : null,
        }))
        .filter((h) => h.name && h.date);

      const existing = await prisma.holiday.findMany({
        select: { name: true, date: true },
      });
      const existingPairs = new Set(existing.map((h) => `${h.name}__${h.date}`));

      const uniqueNewRows = normalized.filter((h) => !existingPairs.has(`${h.name}__${h.date}`));

      const holidays = uniqueNewRows.length
        ? await prisma.holiday.createMany({
            data: uniqueNewRows,
          })
        : { count: 0 };

      invalidateCacheByPrefix(HOLIDAYS_CACHE_PREFIX);

      return NextResponse.json({
        success: true,
        data: holidays,
      });
    }

    // Handle single creation
    const { name, date, isPaid, description } = body;

    if (!name || !date) {
      return NextResponse.json(
        { success: false, error: 'name and date are required' },
        { status: 400 }
      );
    }

    const holiday = await prisma.holiday.create({
      data: {
        name,
        date,
        isPaid: isPaid ?? true,
        description: description || null,
      },
    });

    invalidateCacheByPrefix(HOLIDAYS_CACHE_PREFIX);

    return NextResponse.json({
      success: true,
      data: holiday,
    });
  } catch (error) {
    console.error('Failed to create holiday:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create holiday' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, date, isPaid, description } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const holiday = await prisma.holiday.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(date !== undefined && { date }),
        ...(isPaid !== undefined && { isPaid }),
        ...(description !== undefined && { description: description || null }),
      },
    });

    invalidateCacheByPrefix(HOLIDAYS_CACHE_PREFIX);

    return NextResponse.json({
      success: true,
      data: holiday,
    });
  } catch (error) {
    console.error('Failed to update holiday:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update holiday' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    await prisma.holiday.delete({
      where: { id },
    });

    invalidateCacheByPrefix(HOLIDAYS_CACHE_PREFIX);

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error('Failed to delete holiday:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete holiday' },
      { status: 500 }
    );
  }
}
