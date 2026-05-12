import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { auth0 } from '@/lib/auth0';
import { logAuditEvent } from '@/lib/auditLog';
import { getCachedValue, invalidateCacheByPrefix, setCachedValue } from '@/lib/serverReadCache';

type KPICardRow = {
  kpi: string;
  values: string[];
};

type KPICard = {
  id: string;
  cardName: string;
  rows: KPICardRow[];
  updatedAt: string;
  updatedBy?: string;
};

type StoredCardPayload = {
  cardName?: string;
  rows?: KPICardRow[];
  updatedBy?: string;
};

const KPI_CARD_CATEGORY = 'KPI_CARDS';
const KPI_CARD_KEY_PREFIX = 'kpi-card:';
const KPI_CARDS_CACHE_PREFIX = 'kpi-cards:';
const KPI_CARDS_CACHE_KEY = `${KPI_CARDS_CACHE_PREFIX}list`;
const KPI_CARDS_CACHE_TTL_MS = 60 * 1000;

function normalizeName(name: string): string {
  return (name || '').trim().toLowerCase();
}

function toCardKey(cardName: string): string {
  return `${KPI_CARD_KEY_PREFIX}${normalizeName(cardName).replace(/\s+/g, '-')}`;
}

function toCardRecord(cardName: string, rows: KPICardRow[], updatedAt: Date, updatedBy?: string): KPICard {
  return {
    id: toCardKey(cardName),
    cardName,
    rows: Array.isArray(rows) ? rows : [],
    updatedAt: updatedAt.toISOString(),
    updatedBy,
  };
}

function parseStoredPayload(value: string): StoredCardPayload {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as StoredCardPayload;
  } catch {
    return {};
  }
}

function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return process.env.NODE_ENV !== 'production';

  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function findRowValues(rows: KPICardRow[] | undefined, kpiName: string): string[] {
  if (!Array.isArray(rows)) return [];
  const match = rows.find((row) => (row?.kpi || '').trim().toLowerCase() === kpiName.trim().toLowerCase());
  return Array.isArray(match?.values) ? match!.values : [];
}

function buildCardsETag(cards: KPICard[]): string {
  const basis = JSON.stringify(cards);
  const hash = createHash('sha1').update(basis).digest('hex');
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

export async function GET(request: NextRequest) {
  try {
    let data = getCachedValue<KPICard[]>(KPI_CARDS_CACHE_KEY);
    const cacheState = data ? 'HIT' : 'MISS';

    if (!data) {
      const rows = await prisma.estimatingConstant.findMany({
        where: {
          category: KPI_CARD_CATEGORY,
          name: { startsWith: KPI_CARD_KEY_PREFIX },
        },
        orderBy: { name: 'asc' },
      });

      data = rows.map((row) => {
        const payload = parseStoredPayload(row.value);
        const cardName = (payload.cardName || '').toString().trim() || row.name.replace(KPI_CARD_KEY_PREFIX, '');
        const cardRows = Array.isArray(payload.rows) ? payload.rows : [];
        return toCardRecord(cardName, cardRows, row.updatedAt, payload.updatedBy);
      });
      setCachedValue(KPI_CARDS_CACHE_KEY, data, KPI_CARDS_CACHE_TTL_MS);
    }

    const etag = buildCardsETag(data);
    if (ifNoneMatchContainsETag(request.headers.get('if-none-match'), etag)) {
      const notModified = new NextResponse(null, { status: 304 });
      notModified.headers.set('ETag', etag);
      notModified.headers.set('Cache-Control', 'private, max-age=60, must-revalidate');
      notModified.headers.set('X-Cache', cacheState);
      return notModified;
    }

    const response = NextResponse.json({
      success: true,
      data,
      source: 'database',
      fallback: false,
    });
    response.headers.set('ETag', etag);
    response.headers.set('Cache-Control', 'private, max-age=60, must-revalidate');
    response.headers.set('X-Cache', cacheState);
    return response;
  } catch (error) {
    console.error('Failed to fetch KPI cards:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch KPI cards' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request)) {
      return NextResponse.json(
        { success: false, error: 'Cross-origin write blocked' },
        { status: 403 }
      );
    }

    const session = await auth0.getSession(request);
    const actorEmail = session?.user?.email?.toString().trim() || 'unknown';
    const body = await request.json();
    const cardName = (body?.cardName || '').toString().trim();
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const clientUpdatedBy = (body?.updatedBy || '').toString().trim();
    const updatedBy = actorEmail !== 'unknown' ? actorEmail : (clientUpdatedBy || 'unknown');

    if (!cardName) {
      return NextResponse.json(
        { success: false, error: 'cardName is required' },
        { status: 400 }
      );
    }

    const key = toCardKey(cardName);
    const existing = await prisma.estimatingConstant.findUnique({
      where: { name: key },
      select: { id: true, value: true },
    });

    const previousPayload = existing?.value ? parseStoredPayload(existing.value) : {};

    const record = await prisma.estimatingConstant.upsert({
      where: { name: toCardKey(cardName) },
      update: {
        category: KPI_CARD_CATEGORY,
        value: JSON.stringify({ cardName, rows, updatedBy }),
      },
      create: {
        name: toCardKey(cardName),
        category: KPI_CARD_CATEGORY,
        value: JSON.stringify({ cardName, rows, updatedBy }),
      },
    });

    await prisma.auditLog.create({
      data: {
        action: existing ? 'UPDATE' : 'CREATE',
        entity: 'EstimatingConstant',
        entityId: record.id,
        userEmail: actorEmail,
        changes: {
          category: KPI_CARD_CATEGORY,
          name: key,
          cardName,
          actorEmail,
          clientUpdatedBy: clientUpdatedBy || null,
          previousUpdatedBy: previousPayload.updatedBy || null,
          rowCountBefore: Array.isArray(previousPayload.rows) ? previousPayload.rows.length : 0,
          rowCountAfter: rows.length,
          revenueActualHoursBefore: findRowValues(previousPayload.rows, 'Revenue Actual Hours Worked'),
          revenueActualHoursAfter: findRowValues(rows, 'Revenue Actual Hours Worked'),
        },
      },
    });

    await logAuditEvent(request, {
      action: 'update',
      resource: 'kpi-card',
      target: key,
      details: {
        cardName,
        actorEmail,
        rowCount: rows.length,
        operation: existing ? 'update' : 'create',
      },
    });

    const updatedCard = toCardRecord(cardName, rows, record.updatedAt, updatedBy);
    invalidateCacheByPrefix(KPI_CARDS_CACHE_PREFIX);

    return NextResponse.json({
      success: true,
      data: updatedCard,
      message: 'KPI card saved',
    });
  } catch (error) {
    console.error('Failed to save KPI card:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save KPI card' },
      { status: 500 }
    );
  }
}
