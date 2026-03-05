import { NextRequest, NextResponse } from 'next/server';
import { ensureGanttV2Schema, getGanttV2LongTermSummary } from '@/lib/ganttV2Db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await ensureGanttV2Schema();

    const startMonth = request.nextUrl.searchParams.get('startMonth') || undefined;
    const monthsRaw = Number(request.nextUrl.searchParams.get('months') || 15);
    const months = Number.isFinite(monthsRaw) ? Math.max(1, Math.min(36, monthsRaw)) : 15;

    const summary = await getGanttV2LongTermSummary(startMonth, months);
    return NextResponse.json({ success: true, data: summary });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Failed to load Gantt V2 long-term data: ${String(error)}` },
      { status: 500 }
    );
  }
}
