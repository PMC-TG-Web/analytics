import { NextResponse } from 'next/server';
import { ensureGanttV2Schema } from '@/lib/ganttV2Db';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await ensureGanttV2Schema();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Failed to initialize Gantt V2 schema: ${String(error)}` },
      { status: 500 }
    );
  }
}
