import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

export async function GET() {
  try {
    const rows = await prisma.estimatingConstant.findMany({
      where: {
        category: KPI_CARD_CATEGORY,
        name: { startsWith: KPI_CARD_KEY_PREFIX },
      },
      orderBy: { name: 'asc' },
    });

    const data: KPICard[] = rows.map((row) => {
      const payload = parseStoredPayload(row.value);
      const cardName = (payload.cardName || '').toString().trim() || row.name.replace(KPI_CARD_KEY_PREFIX, '');
      const cardRows = Array.isArray(payload.rows) ? payload.rows : [];
      return toCardRecord(cardName, cardRows, row.updatedAt, payload.updatedBy);
    });

    return NextResponse.json({
      success: true,
      data,
      source: 'database',
      fallback: false,
    });
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
    const body = await request.json();
    const cardName = (body?.cardName || '').toString().trim();
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const updatedBy = (body?.updatedBy || 'unknown').toString();

    if (!cardName) {
      return NextResponse.json(
        { success: false, error: 'cardName is required' },
        { status: 400 }
      );
    }

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

    const updatedCard = toCardRecord(cardName, rows, record.updatedAt, updatedBy);

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
