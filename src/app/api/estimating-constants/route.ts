import { prisma } from '@/lib/prisma';
import { requireAccessAdministrator } from '@/lib/accessManagement';
import { isPermissionTemplateRecord } from '@/lib/permissionTemplatePolicy';
import { buildSearchParamsCacheKey, getCachedValue, invalidateCacheByPrefix, setCachedValue } from '@/lib/serverReadCache';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ESTIMATING_CONSTANTS_CACHE_PREFIX = 'estimating-constants:';
const ESTIMATING_CONSTANTS_CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const cacheKey = buildSearchParamsCacheKey(`${ESTIMATING_CONSTANTS_CACHE_PREFIX}get`, searchParams);
    const cached = getCachedValue<{ success: boolean; data: unknown[]; rebarData: unknown[] }>(cacheKey);
    if (cached) {
      const response = NextResponse.json(cached);
      response.headers.set('Cache-Control', 'private, max-age=60, must-revalidate');
      response.headers.set('X-Cache', 'HIT');
      return response;
    }

    const category = searchParams.get('category');

    const where = category
      ? { category }
      : {
          NOT: [
            { category: 'KPI_CARDS' },
            { name: { startsWith: 'kpi-card:' } },
          ],
        };

    const constants = await prisma.estimatingConstant.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    // Try to fetch rebar constants, but don't fail if they don't exist
    let rebarConstants: any[] = [];
    try {
      rebarConstants = await prisma.rebarConstant.findMany({
        orderBy: { size: 'asc' },
      });
    } catch (err) {
      console.warn('Could not fetch rebar constants:', err);
    }

    const payload = {
      success: true,
      data: constants,
      rebarData: rebarConstants,
    };
    setCachedValue(cacheKey, payload, ESTIMATING_CONSTANTS_CACHE_TTL_MS);

    const response = NextResponse.json(payload);
    response.headers.set('Cache-Control', 'private, max-age=60, must-revalidate');
    response.headers.set('X-Cache', 'MISS');
    return response;
  } catch (error) {
    console.error('Failed to fetch constants:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch constants' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Resolve identity before consuming the request body (Auth0 may rewrap it).
    // Ordinary constants retain their existing middleware permission boundary.
    const access = await requireAccessAdministrator(request);
    const body = await request.json();
    const { name, value, category } = body;

    if (isPermissionTemplateRecord(body) && !access.authorized) return access.response;

    if (!name || !value) {
      return NextResponse.json(
        { success: false, error: 'name and value are required' },
        { status: 400 }
      );
    }

    const constant = await prisma.estimatingConstant.create({
      data: {
        name,
        value,
        category: category || 'General',
      },
    });

    invalidateCacheByPrefix(ESTIMATING_CONSTANTS_CACHE_PREFIX);
    invalidateCacheByPrefix('kpi-cards:');

    return NextResponse.json({
      success: true,
      data: constant,
    });
  } catch (error) {
    console.error('Failed to create constant:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create constant' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const access = await requireAccessAdministrator(request);
    const body = await request.json();
    const { id, name, value, category } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async tx => {
      const existing = await tx.estimatingConstant.findUnique({ where: { id }, select: { name: true, category: true } });
      if ((isPermissionTemplateRecord(existing) || isPermissionTemplateRecord(body)) && !access.authorized) return { denied: access.response };
      const constant = await tx.estimatingConstant.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(value !== undefined && { value }),
          ...(category !== undefined && { category }),
        },
      });
      return { constant };
    }, { isolationLevel: 'Serializable' });
    if ('denied' in result) return result.denied;

    invalidateCacheByPrefix(ESTIMATING_CONSTANTS_CACHE_PREFIX);
    invalidateCacheByPrefix('kpi-cards:');

    return NextResponse.json({
      success: true,
      data: result.constant,
    });
  } catch (error) {
    console.error('Failed to update constant:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update constant' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const access = await requireAccessAdministrator(request);
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async tx => {
      const existing = await tx.estimatingConstant.findUnique({ where: { id }, select: { name: true, category: true } });
      if (isPermissionTemplateRecord(existing) && !access.authorized) return { denied: access.response };
      await tx.estimatingConstant.delete({ where: { id } });
      return {};
    }, { isolationLevel: 'Serializable' });
    if ('denied' in result) return result.denied;

    invalidateCacheByPrefix(ESTIMATING_CONSTANTS_CACHE_PREFIX);
    invalidateCacheByPrefix('kpi-cards:');

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error('Failed to delete constant:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete constant' },
      { status: 500 }
    );
  }
}
