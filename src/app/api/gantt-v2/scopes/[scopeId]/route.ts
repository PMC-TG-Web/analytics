import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureGanttV2Schema } from '@/lib/ganttV2Db';
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
  params: Promise<{ scopeId: string }>;
};

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    console.log('[PUT] Starting scope update request');
    await ensureGanttV2Schema();
    const { scopeId } = await params;
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

    // Get projectId before updating
    const existingScope = await prisma.$queryRawUnsafe<Array<{ project_id: string }>>(
      `SELECT project_id FROM gantt_v2_scopes WHERE id = $1 LIMIT 1`,
      scopeId
    );

    if (!existingScope || existingScope.length === 0) {
      return NextResponse.json({ success: false, error: 'Scope not found' }, { status: 404 });
    }

    const projectId = existingScope[0].project_id;

    await prisma.$executeRawUnsafe(
      `
        UPDATE gantt_v2_scopes
        SET title = $2,
            start_date = CAST($3 AS date),
            end_date = CAST($4 AS date),
            total_hours = $5,
            crew_size = $6,
            notes = $7,
            updated_at = NOW()
        WHERE id = $1;
      `,
      scopeId,
      title,
      startDate,
      endDate,
      Number.isFinite(totalHours) ? totalHours : 0,
      crewSize,
      notes
    );

    // Sync to ActiveSchedule
    await syncScopeToActiveSchedule(
      scopeId,
      projectId,
      title,
      startDate,
      endDate,
      Number.isFinite(totalHours) ? totalHours : 0,
      crewSize
    );
    console.log('[PUT] Scope sync complete');

    return NextResponse.json({ success: true });
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
      { success: false, error: `Failed to update Gantt V2 scope: ${String(error)}` },
      { status: 500 }
    );
  }
}

export async function DELETE(_: NextRequest, { params }: RouteParams) {
  try {
    await ensureGanttV2Schema();
    const { scopeId } = await params;

    // Get scope and project info before deleting
    const scope = await prisma.$queryRawUnsafe<Array<{
      project_id: string;
      title: string;
    }>>(
      `SELECT project_id, title FROM gantt_v2_scopes WHERE id = $1 LIMIT 1`,
      scopeId
    );

    if (scope && scope.length > 0) {
      const { project_id, title } = scope[0];

      // Get project info to construct jobKey
      const project = await prisma.$queryRawUnsafe<Array<{
        customer: string | null;
        project_number: string | null;
        project_name: string;
      }>>(
        `SELECT customer, project_number, project_name FROM gantt_v2_projects WHERE id = $1 LIMIT 1`,
        project_id
      );

      if (project && project.length > 0) {
        const { customer, project_number, project_name } = project[0];
        const jobKey = `${customer || ''}~${project_number || ''}~${project_name || ''}`;

        // Delete ActiveSchedule entries for this scope
        await prisma.activeSchedule.deleteMany({
          where: {
            jobKey,
            scopeOfWork: title,
            source: 'gantt',
          },
        });
      }
    }

    // Delete the scope
    await prisma.$executeRawUnsafe(
      `DELETE FROM gantt_v2_scopes WHERE id = $1;`,
      scopeId
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Failed to delete Gantt V2 scope: ${String(error)}` },
      { status: 500 }
    );
  }
}
