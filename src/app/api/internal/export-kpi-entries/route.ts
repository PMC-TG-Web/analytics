import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/internal/export-kpi-entries
 *
 * Exports all KPIEntry rows as JSON. Used when migrating to a new database
 * so manually-entered KPI data is not lost.
 *
 * Protected by Bearer CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const entries = await prisma.kPIEntry.findMany({
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });

  return NextResponse.json({ count: entries.length, entries });
}
