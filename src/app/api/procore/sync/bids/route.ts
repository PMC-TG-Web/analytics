import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { makeRequest, procoreConfig } from '@/lib/procore';
import { ensureBidsTable, upsertBid } from '@/lib/procoreBids';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' ? (value as JsonObject) : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = readText(value);
    if (text) return text;
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const projectId = String(body?.projectId || '').trim();
    const companyIdFromBody = String(body?.companyId || '').trim();
    const fetchAll = body?.fetchAll !== false;
    const page = Math.max(1, Number.parseInt(String(body?.page || '1'), 10) || 1);
    const perPage = Math.min(100, Math.max(1, Number.parseInt(String(body?.perPage || '100'), 10) || 100));

    if (!projectId) {
      return NextResponse.json({ success: false, error: 'Missing projectId.' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const accessToken = cookieStore.get('procore_access_token')?.value;
    const companyId = String(companyIdFromBody || cookieStore.get('procore_company_id')?.value || procoreConfig.companyId).trim();

    if (!accessToken) {
      return NextResponse.json({ success: false, error: 'Missing access token. Please login via OAuth.' }, { status: 401 });
    }

    await ensureBidsTable();

    const allBids: JsonObject[] = [];
    let currentPage = page;

    while (true) {
      const endpoint = `/rest/v1.0/projects/${encodeURIComponent(projectId)}/bids?company_id=${encodeURIComponent(companyId)}&page=${currentPage}&per_page=${perPage}`;
      const data = await makeRequest(endpoint, accessToken);
      const items = Array.isArray(data)
        ? data.map(asObject).filter((v): v is JsonObject => Boolean(v))
        : [];

      if (items.length === 0) break;
      allBids.push(...items);
      if (!fetchAll || items.length < perPage) break;
      currentPage += 1;
      if (currentPage - page > 50) break;
    }

    let upserted = 0;
    const errors: string[] = [];

    for (const bid of allBids) {
      try {
        const bidId = firstText(bid.id, bid.bid_id);
        if (!bidId) continue;

        const createdByObject = asObject(bid.created_by);
        const createdBy = firstText(createdByObject?.name, createdByObject?.email, createdByObject?.id, bid.created_by);

        await upsertBid({
          companyId,
          projectId,
          bidId,
          name: firstText(bid.name, bid.title, bid.bid_name),
          status: firstText(bid.status),
          createdBy,
          sourceCreatedAt: readString(bid.created_at),
          payload: bid,
        });

        upserted += 1;
      } catch (error: unknown) {
        const id = firstText(bid.id, bid.bid_id) || 'unknown';
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`bid:${id} => ${message}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Bids sync complete',
      data: {
        companyId,
        projectId,
        fetched: allBids.length,
        upserted,
        errors,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: `Failed to sync bids: ${message}` }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const body = JSON.stringify({
    projectId: url.searchParams.get('projectId') || undefined,
    companyId: url.searchParams.get('companyId') || undefined,
    fetchAll: String(url.searchParams.get('fetchAll') || '').toLowerCase() !== 'false',
    page: url.searchParams.get('page') || undefined,
    perPage: url.searchParams.get('perPage') || undefined,
  });

  return POST(
    new Request(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  );
}
