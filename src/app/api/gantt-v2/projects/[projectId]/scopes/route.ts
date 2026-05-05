import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureGanttV2Schema, getGanttV2ProjectsWithScopes } from '@/lib/ganttV2Db';
import { syncGanttScopeToActiveSchedule } from '@/lib/scheduling/ganttScopeSync';
import { SchedulingConflictError } from '@/lib/scheduling/dailyAssignment';
import { getCachedValue, setCachedValue, invalidateCacheByPrefix } from '@/lib/serverReadCache';

export const dynamic = 'force-dynamic';

const GANTT_SCOPES_TTL_MS = 60_000;

async function syncScopeToActiveSchedule(
  scopeId: string,
  projectId: string,
  title: string,
  startDate: string | null,
  endDate: string | null,
  totalHours: number,
  crewSize: number | null
): Promise<void> {
  await syncGanttScopeToActiveSchedule({ scopeId, projectId, title, startDate, endDate, totalHours, crewSize });
}

type RouteParams = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_: NextRequest, { params }: RouteParams) {
  try {
    await ensureGanttV2Schema();
    const { projectId } = await params;
    const cacheKey = `gantt-v2:scopes:${projectId}`;
    const cached = getCachedValue<unknown[]>(cacheKey);
    if (cached) {
      return NextResponse.json({ success: true, data: cached, cached: true });
    }
    const [project] = await getGanttV2ProjectsWithScopes({ includeEstimateHours: false, projectId });
    const scopes = project?.scopes || [];
    setCachedValue(cacheKey, scopes, GANTT_SCOPES_TTL_MS);
    return NextResponse.json({ success: true, data: scopes, cached: false });
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
    let predecessorScopeId = body?.predecessorScopeId ? String(body.predecessorScopeId).trim() : null;

    if (!title) {
      return NextResponse.json({ success: false, error: 'title is required' }, { status: 400 });
    }

    if (predecessorScopeId) {
      const predecessor = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM gantt_v2_scopes WHERE id = $1 AND project_id = $2 LIMIT 1`,
        predecessorScopeId, projectId
      );
      if (!predecessor || predecessor.length === 0) {
        console.warn('[POST] Dropping invalid predecessor scope for project', { projectId, predecessorScopeId, title });
        predecessorScopeId = null;
      }
    }

    const existingByTitle = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM gantt_v2_scopes WHERE project_id = $1 AND title = $2 LIMIT 1`,
      projectId, title
    );

    const safeHours = Number.isFinite(totalHours) ? totalHours : 0;

    if (existingByTitle && existingByTitle.length > 0) {
      const existingId = existingByTitle[0].id;
      console.log('[POST] Scope with same title already exists - updating instead of creating duplicate', { existingId, title });

      await prisma.$executeRawUnsafe(
        `UPDATE gantt_v2_scopes
         SET start_date = CAST($2 AS date), end_date = CAST($3 AS date),
             total_hours = $4, crew_size = $5, notes = $6,
             predecessor_scope_id = $7, updated_at = NOW()
         WHERE id = $1;`,
        existingId, startDate, endDate, safeHours, crewSize, notes, predecessorScopeId
      );

      await syncScopeToActiveSchedule(existingId, projectId, title, startDate, endDate, safeHours, crewSize);
      invalidateCacheByPrefix('gantt-v2:');

      return NextResponse.json({ success: true, data: { id: existingId, projectId, predecessorScopeId, title, startDate, endDate, totalHours: safeHours, crewSize, notes } });
    }

    const id = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO gantt_v2_scopes (id, project_id, title, start_date, end_date, total_hours, crew_size, notes, predecessor_scope_id)
       VALUES ($1, $2, $3, CAST($4 AS date), CAST($5 AS date), $6, $7, $8, $9);`,
      id, projectId, title, startDate, endDate, safeHours, crewSize, notes, predecessorScopeId
    );

    console.log('[POST] About to sync scope for ActiveSchedule');
    await syncScopeToActiveSchedule(id, projectId, title, startDate, endDate, safeHours, crewSize);
    console.log('[POST] Scope sync complete');

    invalidateCacheByPrefix('gantt-v2:');

    return NextResponse.json({ success: true, data: { id, projectId, predecessorScopeId, title, startDate, endDate, totalHours: safeHours, crewSize, notes } });
  } catch (error) {
    if (error instanceof SchedulingConflictError) {
      return NextResponse.json(
        { success: false, error: error.message, conflict: { code: error.code, details: error.details ?? null } },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { success: false, error: `Failed to create Gantt V2 scope: ${String(error)}` },
      { status: 500 }
    );
  }
}
