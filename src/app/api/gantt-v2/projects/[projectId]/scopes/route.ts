import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureGanttV2Schema, getGanttV2Scopes } from '@/lib/ganttV2Db';
import { syncGanttScopeToActiveSchedule } from '@/lib/scheduling/ganttScopeSync';
import { SchedulingConflictError } from '@/lib/scheduling/dailyAssignment';

export const dynamic = 'force-dynamic';

// Helper function to sync scope to ActiveSchedule
async function syncScopeToActiveSchedule(
  scopeId: string,
  projectId: string,
  title: string,
  startDate: string | null,
  endDate: string | null,
  totalHours: number,
  crewSize: number | null
): Promise<void> {
  await syncGanttScopeToActiveSchedule({
    scopeId,
    projectId,
    title,
    startDate,
    endDate,
    totalHours,
    crewSize,
  });
}

type RouteParams = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_: NextRequest, { params }: RouteParams) {
  try {
    await ensureGanttV2Schema();
    const { projectId } = await params;
    const scopes = await getGanttV2Scopes(projectId);
    return NextResponse.json({ success: true, data: scopes });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Failed to load Gantt V2 scopes: ${String(error)}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    await ensureGanttV2Schema();
    const { projectId } = await params;
    const body = await request.json();

    const title = (body?.title || '').toString().trim();
    const startDate = (body?.startDate || '').toString().trim() || null;
    const endDate = (body?.endDate || '').toString().trim() || null;
    const totalHours = Number(body?.totalHours || 0);
    const crewSize = body?.crewSize === '' || body?.crewSize === undefined || body?.crewSize === null
      ? null
      : Number(body.crewSize);
    const notes = (body?.notes || '').toString().trim() || null;

    if (!title) {
      return NextResponse.json({ success: false, error: 'title is required' }, { status: 400 });
    }

    const id = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO gantt_v2_scopes (id, project_id, title, start_date, end_date, total_hours, crew_size, notes)
        VALUES ($1, $2, $3, CAST($4 AS date), CAST($5 AS date), $6, $7, $8);
      `,
      id,
      projectId,
      title,
      startDate,
      endDate,
      Number.isFinite(totalHours) ? totalHours : 0,
      crewSize,
      notes
    );

    // Sync to ActiveSchedule if dates and hours are provided
    console.log('[POST] About to sync scope for ActiveSchedule');
    await syncScopeToActiveSchedule(
      id,
      projectId,
      title,
      startDate,
      endDate,
      Number.isFinite(totalHours) ? totalHours : 0,
      crewSize
    );
    console.log('[POST] Scope sync complete');

    return NextResponse.json({
      success: true,
      data: {
        id,
        projectId,
        title,
        startDate,
        endDate,
        totalHours: Number.isFinite(totalHours) ? totalHours : 0,
        crewSize,
        notes,
      },
    });
  } catch (error) {
    if (error instanceof SchedulingConflictError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          conflict: {
            code: error.code,
            details: error.details ?? null,
          },
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { success: false, error: `Failed to create Gantt V2 scope: ${String(error)}` },
      { status: 500 }
    );
  }
}
