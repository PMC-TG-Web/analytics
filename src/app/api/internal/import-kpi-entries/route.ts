import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/internal/import-kpi-entries
 *
 * Imports KPIEntry rows exported from the old database via /api/internal/export-kpi-entries.
 * Uses upsert on entryKey so it is safe to run multiple times.
 *
 * Body: { entries: KPIEntry[] }  (the JSON from the export endpoint)
 *
 * Protected by Bearer CRON_SECRET.
 */

type KPIEntryInput = {
  entryKey: string;
  year: string;
  month: number;
  monthName: string;
  bidSubmittedSales?: number | null;
  scheduledSales?: number | null;
  subs?: number | null;
  estimates?: number | null;
  grossProfit?: number | null;
  cost?: number | null;
  bidSubmittedHours?: number | null;
  scheduledHours?: number | null;
  leadtimes?: number | null;
  createdByEmail?: string | null;
  updatedByEmail?: string | null;
  estimatesActualHours?: number | null;
  gpActualPercent?: number | null;
  profitActualPercent?: number | null;
  revenueActual?: number | null;
  revenueActualHours?: number | null;
  salesActualHours?: number | null;
  subActualHours?: number | null;
  subsAllowance?: number | null;
};

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { entries?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    return NextResponse.json({ error: 'body.entries must be a non-empty array' }, { status: 400 });
  }

  const entries = body.entries as KPIEntryInput[];
  let upserted = 0;
  const errors: string[] = [];

  for (const entry of entries) {
    if (!entry.entryKey || !entry.year || typeof entry.month !== 'number') {
      errors.push(`Skipped invalid entry: ${JSON.stringify(entry).slice(0, 80)}`);
      continue;
    }

    try {
      const data = {
        year: entry.year,
        month: entry.month,
        monthName: entry.monthName,
        bidSubmittedSales: entry.bidSubmittedSales ?? null,
        scheduledSales: entry.scheduledSales ?? null,
        subs: entry.subs ?? null,
        estimates: entry.estimates ?? null,
        grossProfit: entry.grossProfit ?? null,
        cost: entry.cost ?? null,
        bidSubmittedHours: entry.bidSubmittedHours ?? null,
        scheduledHours: entry.scheduledHours ?? null,
        leadtimes: entry.leadtimes ?? null,
        createdByEmail: entry.createdByEmail ?? null,
        updatedByEmail: entry.updatedByEmail ?? null,
        estimatesActualHours: entry.estimatesActualHours ?? null,
        gpActualPercent: entry.gpActualPercent ?? null,
        profitActualPercent: entry.profitActualPercent ?? null,
        revenueActual: entry.revenueActual ?? null,
        revenueActualHours: entry.revenueActualHours ?? null,
        salesActualHours: entry.salesActualHours ?? null,
        subActualHours: entry.subActualHours ?? null,
        subsAllowance: entry.subsAllowance ?? null,
      };

      await prisma.kPIEntry.upsert({
        where: { entryKey: entry.entryKey },
        create: { entryKey: entry.entryKey, ...data },
        update: data,
      });
      upserted++;
    } catch (err) {
      errors.push(`Failed to upsert ${entry.entryKey}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    upserted,
    skipped: entries.length - upserted,
    errors,
  });
}
