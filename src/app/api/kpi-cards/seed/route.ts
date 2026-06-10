import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { defaultCardData } from '@/lib/kpiCardDefaults';
import { auth0 } from '@/lib/auth0';
import { logAuditEvent } from '@/lib/auditLog';

type KPICardRow = {
  kpi: string;
  values: string[];
};

type KPICardPayload = {
  cardName?: string;
  rows?: KPICardRow[];
};

const KPI_CARD_CATEGORY = 'KPI_CARDS';
const KPI_CARD_KEY_PREFIX = 'kpi-card:';

function normalizeName(name: string): string {
  return (name || '').trim().toLowerCase();
}

function toCardKey(cardName: string): string {
  return `${KPI_CARD_KEY_PREFIX}${normalizeName(cardName).replace(/\s+/g, '-')}`;
}

function normalizeCardRows(rows: unknown): KPICardRow[] {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const candidate = row as { kpi?: unknown; values?: unknown };
      const kpi = String(candidate.kpi || '').trim();
      if (!kpi) return null;

      const values = Array.isArray(candidate.values)
        ? candidate.values.map((value) => String(value ?? ''))
        : [];

      return { kpi, values };
    })
    .filter((row): row is KPICardRow => row !== null);
}

function mergeCardRowsPreserveExisting(existingRows: KPICardRow[], incomingRows: KPICardRow[]): KPICardRow[] {
  const mergedRows = existingRows.map((row) => ({ kpi: row.kpi, values: [...row.values] }));
  const indexByKpi = new Map<string, number>();

  mergedRows.forEach((row, index) => {
    indexByKpi.set(normalizeName(row.kpi), index);
  });

  for (const row of incomingRows) {
    const key = normalizeName(row.kpi);
    const existingIndex = indexByKpi.get(key);

    if (existingIndex === undefined) {
      indexByKpi.set(key, mergedRows.length);
      mergedRows.push({ kpi: row.kpi, values: [...row.values] });
      continue;
    }

    const existingRow = mergedRows[existingIndex];
    mergedRows[existingIndex] = {
      kpi: row.kpi,
      values: existingRow.values.length > 0 ? existingRow.values : [...row.values],
    };
  }

  return mergedRows;
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
    const body = await request.json().catch(() => ({}));
    const confirmSeed = body?.confirmSeed === true;
    const confirmPhrase = (body?.confirmPhrase || '').toString().trim();

    if (!confirmSeed || confirmPhrase !== 'SEED KPI CARDS') {
      return NextResponse.json(
        {
          success: false,
          error: 'Seed confirmation is required',
          hint: 'Send { confirmSeed: true, confirmPhrase: "SEED KPI CARDS" } to execute this action.',
        },
        { status: 400 }
      );
    }

    const cards = defaultCardData.map((card) => ({
      cardName: card.cardName,
      rows: card.rows as KPICardRow[],
    }));

    // IMPORTANT: Preserve existing manually-entered data instead of deleting it
    // Get all existing cards first
    const existingRows = await prisma.estimatingConstant.findMany({
      where: {
        category: KPI_CARD_CATEGORY,
        name: { startsWith: KPI_CARD_KEY_PREFIX },
      },
    });

    // Build a map of existing card data to preserve
    const existingCardMap = new Map<string, KPICardPayload>();
    for (const row of existingRows) {
      try {
        const payload = JSON.parse(row.value) as KPICardPayload;
        const cardNameNormalized = (payload.cardName || '').trim().toLowerCase().replace(/\s+/g, '-');
        existingCardMap.set(cardNameNormalized, payload);
      } catch {
        // Skip malformed entries
      }
    }

    // Create new cards, but preserve existing data where it exists
    let preservedCount = 0;
    const seededCardKeys: string[] = [];

    for (const card of cards) {
      const cardNameNormalized = card.cardName.toLowerCase().replace(/\s+/g, '-');
      const existing = existingCardMap.get(cardNameNormalized);
      const key = toCardKey(card.cardName);
      
      // Preserve existing values, but keep the current default row layout in sync.
      const rowsToUse = mergeCardRowsPreserveExisting(
        normalizeCardRows(existing?.rows),
        card.rows,
      );

      if (existing?.rows && Array.isArray(existing.rows) && existing.rows.length > 0) {
        preservedCount += 1;
      }

      await prisma.estimatingConstant.upsert({
        where: {
          name: key,
        },
        update: {
          value: JSON.stringify({
            cardName: card.cardName,
            rows: rowsToUse,
            updatedBy: actorEmail,
            seedTriggeredBy: actorEmail,
            preservedExisting: existing ? 'yes' : 'no',
          }),
        },
        create: {
          name: key,
          category: KPI_CARD_CATEGORY,
          value: JSON.stringify({
            cardName: card.cardName,
            rows: rowsToUse,
            updatedBy: actorEmail,
            seedTriggeredBy: actorEmail,
          }),
        },
      });

      seededCardKeys.push(key);
    }

    await prisma.auditLog.create({
      data: {
        action: 'SEED',
        entity: 'EstimatingConstant',
        entityId: 'kpi-cards-seed',
        userEmail: actorEmail,
        changes: {
          category: KPI_CARD_CATEGORY,
          actorEmail,
          cardCount: cards.length,
          preservedCount,
          seededCardKeys,
        },
      },
    });

    await logAuditEvent(request, {
      action: 'seed',
      resource: 'kpi-cards',
      target: 'seed',
      details: {
        actorEmail,
        cardCount: cards.length,
        preservedCount,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Seeded ${cards.length} KPI cards to database (preserving existing data)`,
      count: cards.length,
      actorEmail,
      preservedCount,
      source: 'database',
    });
  } catch (error) {
    console.error('Failed to seed KPI cards:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to seed KPI cards' },
      { status: 500 }
    );
  }
}
