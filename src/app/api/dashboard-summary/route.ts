import { prisma } from '@/lib/prisma';
import { getCanonicalProjectIdentity } from '@/lib/projectCanonical';
import { buildSearchParamsCacheKey, getCachedValue, setCachedValue } from '@/lib/serverReadCache';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const DASHBOARD_SUMMARY_CACHE_PREFIX = 'dashboard-summary:';
const DASHBOARD_SUMMARY_CACHE_TTL_MS = 60 * 1000;

function buildSummaryETag(payload: unknown): string {
  const hash = createHash('sha1').update(JSON.stringify(payload)).digest('hex');
  return `W/"${hash}"`;
}

function ifNoneMatchContainsETag(ifNoneMatchHeader: string | null, etag: string): boolean {
  if (!ifNoneMatchHeader) return false;
  if (ifNoneMatchHeader.trim() === '*') return true;
  return ifNoneMatchHeader
    .split(',')
    .map((value) => value.trim())
    .includes(etag);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cacheKey = buildSearchParamsCacheKey(`${DASHBOARD_SUMMARY_CACHE_PREFIX}get`, searchParams);
    const cached = getCachedValue<Record<string, unknown>>(cacheKey);
    if (cached) {
      const etag = buildSummaryETag(cached);
      if (ifNoneMatchContainsETag(request.headers.get('if-none-match'), etag)) {
        const notModified = new NextResponse(null, { status: 304 });
        notModified.headers.set('ETag', etag);
        notModified.headers.set('Cache-Control', 'private, max-age=30, must-revalidate');
        notModified.headers.set('X-Cache', 'HIT');
        return notModified;
      }

      const response = NextResponse.json(cached);
      response.headers.set('ETag', etag);
      response.headers.set('Cache-Control', 'private, max-age=30, must-revalidate');
      response.headers.set('X-Cache', 'HIT');
      return response;
    }

    const includeProjectIdentity = (searchParams.get('includeProjectIdentity') || '').trim().toLowerCase() === 'true';

    const summary = await prisma.dashboardSummary.findUnique({
      where: { id: 'summary' },
    });

    let projectIdentityCoverage: {
      totalProjects: number;
      withProcoreId: number;
      withBidBoardId: number;
      withCustomerSource: number;
      withStatusSource: number;
    } | null = null;

    if (includeProjectIdentity) {
      const projects = await prisma.project.findMany({
        select: {
          id: true,
          procoreId: true,
          bidBoardId: true,
          customerSource: true,
          statusSource: true,
          customFields: true,
        },
      });

      let withProcoreId = 0;
      let withBidBoardId = 0;
      let withCustomerSource = 0;
      let withStatusSource = 0;

      for (const project of projects) {
        const identity = getCanonicalProjectIdentity(project);
        if (identity.procoreId) withProcoreId += 1;
        if (identity.bidBoardId) withBidBoardId += 1;
        if (identity.customerSource) withCustomerSource += 1;
        if (identity.statusSource) withStatusSource += 1;
      }

      projectIdentityCoverage = {
        totalProjects: projects.length,
        withProcoreId,
        withBidBoardId,
        withCustomerSource,
        withStatusSource,
      };
    }

    if (!summary) {
      const payload = {
        success: true,
        data: null,
      };
      setCachedValue(cacheKey, payload, DASHBOARD_SUMMARY_CACHE_TTL_MS);

      const etag = buildSummaryETag(payload);
      if (ifNoneMatchContainsETag(request.headers.get('if-none-match'), etag)) {
        const notModified = new NextResponse(null, { status: 304 });
        notModified.headers.set('ETag', etag);
        notModified.headers.set('Cache-Control', 'private, max-age=30, must-revalidate');
        notModified.headers.set('X-Cache', 'MISS');
        return notModified;
      }

      const response = NextResponse.json(payload);
      response.headers.set('ETag', etag);
      response.headers.set('Cache-Control', 'private, max-age=30, must-revalidate');
      response.headers.set('X-Cache', 'MISS');
      return response;
    }

    const payload = {
      success: true,
      data: {
        totalSales: summary.totalSales,
        totalCost: summary.totalCost,
        totalHours: summary.totalHours,
        statusGroups: summary.statusGroups,
        contractors: summary.contractors,
        pmcGroupHours: summary.pmcGroupHours,
        laborBreakdown: summary.laborBreakdown,
        lastUpdated: summary.lastUpdated,
        ...(projectIdentityCoverage ? { projectIdentityCoverage } : {}),
      },
    };
    setCachedValue(cacheKey, payload, DASHBOARD_SUMMARY_CACHE_TTL_MS);

    const etag = buildSummaryETag(payload);
    if (ifNoneMatchContainsETag(request.headers.get('if-none-match'), etag)) {
      const notModified = new NextResponse(null, { status: 304 });
      notModified.headers.set('ETag', etag);
      notModified.headers.set('Cache-Control', 'private, max-age=30, must-revalidate');
      notModified.headers.set('X-Cache', 'MISS');
      return notModified;
    }

    const response = NextResponse.json(payload);
    response.headers.set('ETag', etag);
    response.headers.set('Cache-Control', 'private, max-age=30, must-revalidate');
    response.headers.set('X-Cache', 'MISS');
    return response;
  } catch (error) {
    console.error('Failed to fetch dashboard summary:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch dashboard summary' },
      { status: 500 }
    );
  }
}
