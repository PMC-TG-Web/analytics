import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureGanttV2Schema } from '@/lib/ganttV2Db';
import { syncGanttScopeToActiveSchedule } from '@/lib/scheduling/ganttScopeSync';
import { cascadeDependentScopesFromLead } from '@/lib/scheduling/ganttDependencyCascade';
import { SchedulingConflictError } from '@/lib/scheduling/dailyAssignment';
import { invalidateCacheByPrefix } from '@/lib/serverReadCache';

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

    // Get projectId before updating
    const existingScope = await prisma.$queryRawUnsafe<Array<{
      project_id: string;
      title: string;
      start_date: Date | null;
      end_date: Date | null;
      total_hours: number;
      crew_size: number | null;
      notes: string | null;
      predecessor_scope_id: string | null;
    }>>(
      `
        SELECT
          project_id,
          title,
          start_date,
          end_date,
          total_hours,
          crew_size,
          notes,
          predecessor_scope_id
        FROM gantt_v2_scopes
        WHERE id = $1
        LIMIT 1
      `,
      scopeId
    );

    if (!existingScope || existingScope.length === 0) {
      return NextResponse.json({ success: false, error: 'Scope not found' }, { status: 404 });
    }

    const projectId = existingScope[0].project_id;
    const previousTitle = String(existingScope[0].title || "").trim();
    const title = (body?.title ?? existingScope[0].title ?? '').toString().trim();
    const startDate = body?.startDate === undefined
      ? (existingScope[0].start_date ? existingScope[0].start_date.toISOString().slice(0, 10) : null)
      : ((body?.startDate || '').toString().trim() || null);
    const endDate = body?.endDate === undefined
      ? (existingScope[0].end_date ? existingScope[0].end_date.toISOString().slice(0, 10) : null)
      : ((body?.endDate || '').toString().trim() || null);
    const totalHours = body?.totalHours === undefined
      ? Number(existingScope[0].total_hours || 0)
      : Number(body?.totalHours || 0);
    const crewSize = body?.crewSize === undefined
      ? existingScope[0].crew_size
      : (body?.crewSize === '' || body?.crewSize === null
          ? null
          : Number(body.crewSize));
    const notes = body?.notes === undefined
      ? (existingScope[0].notes ?? null)
      : ((body?.notes || '').toString().trim() || null);
    let predecessorScopeId = body?.predecessorScopeId === undefined
      ? (existingScope[0].predecessor_scope_id ?? null)
      : (body?.predecessorScopeId
          ? String(body.predecessorScopeId).trim()
          : null);

    if (!title) {
      return NextResponse.json({ success: false, error: 'title is required' }, { status: 400 });
    }

    if (predecessorScopeId === scopeId) {
      return NextResponse.json({ success: false, error: 'Scope cannot depend on itself' }, { status: 400 });
    }

    if (predecessorScopeId) {
      const predecessor = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM gantt_v2_scopes WHERE id = $1 AND project_id = $2 LIMIT 1`,
        predecessorScopeId,
        projectId
      );
      if (!predecessor || predecessor.length === 0) {
        console.warn('[PUT] Dropping invalid predecessor scope for project', {
          projectId,
          scopeId,
          predecessorScopeId,
          title,
        });
        predecessorScopeId = null;
      }
    }

    await prisma.$executeRawUnsafe(
      `
        UPDATE gantt_v2_scopes
        SET title = $2,
            start_date = CAST($3 AS date),
            end_date = CAST($4 AS date),
            total_hours = $5,
            crew_size = $6,
            notes = $7,
            predecessor_scope_id = $8,
            updated_at = NOW()
        WHERE id = $1;
      `,
      scopeId,
      title,
      startDate,
      endDate,
      Number.isFinite(totalHours) ? totalHours : 0,
      crewSize,
      notes,
      predecessorScopeId
    );

    const previousStartDate = existingScope[0].start_date
      ? existingScope[0].start_date.toISOString().slice(0, 10)
      : null;
    const previousEndDate = existingScope[0].end_date
      ? existingScope[0].end_date.toISOString().slice(0, 10)
      : null;
    const didDatesChange = previousStartDate !== startDate || previousEndDate !== endDate;
    const didScheduleAffectingFieldsChange =
      previousTitle !== title ||
      previousStartDate !== startDate ||
      previousEndDate !== endDate ||
      Number(existingScope[0].total_hours || 0) !== (Number.isFinite(totalHours) ? totalHours : 0) ||
      (existingScope[0].crew_size === null ? null : Number(existingScope[0].crew_size)) !== crewSize;

    if (didScheduleAffectingFieldsChange && previousTitle && previousTitle !== title) {
      const project = await prisma.$queryRawUnsafe<Array<{
        customer: string | null;
        project_number: string | null;
        project_name: string;
      }>>(
        `SELECT customer, project_number, project_name FROM gantt_v2_projects WHERE id = $1 LIMIT 1`,
        projectId
      );

      if (project && project.length > 0) {
        const { customer, project_number, project_name } = project[0];
        const jobKey = `${customer || ''}~${project_number || ''}~${project_name || ''}`;

        await prisma.activeSchedule.deleteMany({
          where: {
            jobKey,
            scopeOfWork: previousTitle,
            source: 'gantt',
          },
        });
      }
    }

    // Sync to ActiveSchedule
    if (didScheduleAffectingFieldsChange) {
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
    }

    let cascadeUpdates: Array<{
      scopeId: string;
      oldStartDate: string | null;
      oldEndDate: string | null;
      newStartDate: string;
      newEndDate: string;
    }> = [];

    if (didDatesChange && endDate) {
      cascadeUpdates = await cascadeDependentScopesFromLead({
        projectId,
        leadScopeId: scopeId,
      });
    }

    invalidateCacheByPrefix('gantt-v2:');
    return NextResponse.json({ success: true, cascadeUpdates });
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
            scopeOfWork: {
              equals: title,
              mode: 'insensitive',
            },
          },
        });
      }
    }

    // Delete the scope
    await prisma.$executeRawUnsafe(
      `DELETE FROM gantt_v2_scopes WHERE id = $1;`,
      scopeId
    );

    invalidateCacheByPrefix('gantt-v2:');

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Failed to delete Gantt V2 scope: ${String(error)}` },
      { status: 500 }
    );
  }
}
