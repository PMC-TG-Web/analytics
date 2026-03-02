import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { defaultCardData } from '@/lib/kpiCardDefaults';

type KPICardRow = {
  kpi: string;
  values: string[];
};

const KPI_CARD_CATEGORY = 'KPI_CARDS';
const KPI_CARD_KEY_PREFIX = 'kpi-card:';

function normalizeName(name: string): string {
  return (name || '').trim().toLowerCase();
}

function toCardKey(cardName: string): string {
  return `${KPI_CARD_KEY_PREFIX}${normalizeName(cardName).replace(/\s+/g, '-')}`;
}

export async function POST() {
  try {
    const cards = defaultCardData.map((card) => ({
      cardName: card.cardName,
      rows: card.rows as KPICardRow[],
    }));

    // Delete existing cards
    await prisma.estimatingConstant.deleteMany({
      where: {
        category: KPI_CARD_CATEGORY,
        name: { startsWith: KPI_CARD_KEY_PREFIX },
      },
    });

    // Create new cards
    for (const card of cards) {
      await prisma.estimatingConstant.create({
        data: {
          name: toCardKey(card.cardName),
          category: KPI_CARD_CATEGORY,
          value: JSON.stringify({
            cardName: card.cardName,
            rows: card.rows,
            updatedBy: 'seed',
          }),
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: `Seeded ${cards.length} KPI cards to database`,
      count: cards.length,
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
