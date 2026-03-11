import { prisma } from '@/lib/prisma';
import { logAuditEvent } from '@/lib/auditLog';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const numericFields = [
  // Database-fed fields
  'bidSubmittedSales',
  'scheduledSales',
  'bidSubmittedHours',
  'scheduledHours',
  'leadtimes',
  // Manual entry fields
  'revenueActual',
  'estimates',
  'estimatesActualHours',
  'salesActualHours',
  'revenueActualHours',
  'subsAllowance',
  'subActualHours',
  'gpActualPercent',
  'profitActualPercent',
  // Legacy fields (keeping for backwards compatibility)
  'subs',
  'grossProfit',
  'cost',
] as const;

type NumericField = (typeof numericFields)[number];

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getMonthName(month: number): string {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return monthNames[Math.max(1, Math.min(12, month)) - 1];
}

export async function GET(request: NextRequest) {
  try {
    const yearParam = (request.nextUrl.searchParams.get('year') || '').trim();

    const where = yearParam ? { year: yearParam } : undefined;
    const entries = await prisma.kPIEntry.findMany({
      where,
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });

    return NextResponse.json({
      success: true,
      count: entries.length,
      data: entries,
    });
  } catch (error) {
    console.error('Failed to fetch KPI entries:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch KPI entries' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const year = (body?.year || '').toString().trim();
    const month = Number.parseInt((body?.month || '').toString(), 10);

    if (!year || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json(
        { success: false, error: 'year and month (1-12) are required' },
        { status: 400 }
      );
    }

    const updateData: Record<string, number | null> = {};
    for (const field of numericFields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        updateData[field] = toNumberOrNull(body[field]);
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one KPI numeric field is required' },
        { status: 400 }
      );
    }

    const entryKey = `${year}-${String(month).padStart(2, '0')}`;

    const saved = await prisma.kPIEntry.upsert({
      where: { entryKey },
      update: updateData,
      create: {
        entryKey,
        year,
        month,
        monthName: getMonthName(month),
        ...updateData,
      },
    });

    await logAuditEvent(request, {
      action: 'update',
      resource: 'kpi-entry',
      target: entryKey,
      details: {
        year,
        month,
        updatedFields: Object.keys(updateData),
      },
    });

    return NextResponse.json({
      success: true,
      data: saved,
      message: 'KPI entry saved',
    });
  } catch (error) {
    console.error('Failed to save KPI entry:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save KPI entry' },
      { status: 500 }
    );
  }
}
