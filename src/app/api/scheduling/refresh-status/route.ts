import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    const fetchAll = body?.fetchAll === true;
    const debugProjectIds = Array.isArray(body?.debugProjectIds)
      ? body.debugProjectIds.map((v: unknown) => String(v).trim()).filter(Boolean)
      : [];
    const companyId = String(
      request.cookies.get('procore_company_id')?.value ||
      body?.companyId ||
      ''
    ).trim();

    if (!companyId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing companyId context. Reconnect Procore session or provide companyId explicitly.',
        },
        { status: 400 }
      );
    }

    // Lightweight default refresh for status updates without a full heavy sync.
    const syncPayload: Record<string, unknown> = {
      fetchAll,
      forceUserOAuth: true,
      maxPages: fetchAll ? 1000 : 1,
      includeInactiveV1: false,
      includeTestProjects: false,
      includePrimeContractProjectBackfill: false,
      usePrimeContractProjectIdsAsTruth: false,
    };

    if (debugProjectIds.length > 0) {
      syncPayload.debugProjectIds = debugProjectIds;
    }

    if (companyId) {
      syncPayload.companyId = companyId;
    }

    const upstream = await fetch(`${request.nextUrl.origin}/api/procore/sync/all-projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: request.headers.get('cookie') || '',
      },
      body: JSON.stringify(syncPayload),
    });

    const upstreamJson = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return NextResponse.json(
        {
          success: false,
          error: upstreamJson?.error || 'Status refresh failed',
          details: upstreamJson,
        },
        { status: upstream.status }
      );
    }

    return NextResponse.json({
      success: true,
      message: fetchAll ? 'Full status refresh complete' : 'Quick status refresh complete',
      data: upstreamJson,
      mode: fetchAll ? 'full' : 'quick',
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown refresh error',
      },
      { status: 500 }
    );
  }
}
