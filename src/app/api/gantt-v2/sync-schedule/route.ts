import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { syncActiveScheduleToScope } from '@/lib/ganttV2Db';

export const dynamic = 'force-dynamic';

const normalize = (value: string | null | undefined) =>
  (value || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * POST /api/gantt-v2/sync-schedule
 * 
 * Syncs activeSchedule hours to gantt_v2_schedule_entries
 * 
 * Body can contain:
 * - scopeId + jobKey: Sync a specific scope with a jobKey
 * - projectId + projectNumber: Find matching schedules and sync scopes
 * - projectId: Find activeSchedule entries matching this project and sync all scopes
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { scopeId, jobKey, projectId } = body;

    if (!projectId && !scopeId) {
      return NextResponse.json(
        { success: false, error: 'Either projectId or scopeId is required' },
        { status: 400 }
      );
    }

    if (scopeId && !jobKey) {
      return NextResponse.json(
        { success: false, error: 'jobKey is required when syncing a specific scope' },
        { status: 400 }
      );
    }

    let syncedScopes = 0;
    let totalHours = 0;

    if (scopeId && jobKey) {
      // Sync a specific scope
      const scope = await prisma.$queryRawUnsafe<Array<{ title: string }>>(
        `SELECT title FROM gantt_v2_scopes WHERE id = $1 LIMIT 1`,
        scopeId
      );

      if (!scope || scope.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Scope not found' },
          { status: 404 }
        );
      }

      const hours = await syncActiveScheduleToScope(scopeId, jobKey, scope[0].title);
      totalHours = hours;
      syncedScopes = 1;
    } else if (projectId) {
      // Get project details for jobKey matching
      const ganttProject = await prisma.$queryRawUnsafe<Array<{
        id: string;
        project_name: string;
        project_number: string | null;
      }>>(`
        SELECT id, project_name, project_number
        FROM gantt_v2_projects
        WHERE id = $1
      `, projectId);

      if (!ganttProject || ganttProject.length === 0) {
        return NextResponse.json({
          success: false,
          error: 'Project not found',
        }, { status: 404 });
      }

      const project = ganttProject[0];

      // Get all scopes for this project
      const scopes = await prisma.$queryRawUnsafe<Array<{
        id: string;
        title: string;
        start_date: Date | null;
        end_date: Date | null;
        total_hours: number;
      }>>(`
        SELECT id, title, start_date, end_date, total_hours
        FROM gantt_v2_scopes
        WHERE project_id = $1
      `, projectId);

      if (!scopes || scopes.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'No scopes to sync',
          data: { syncedScopes: 0, totalHours: 0 },
        });
      }

      const projectNumber = project.project_number || '';
      const projectNamePrefix = project.project_name.substring(0, 15);

      const activeEntries = await prisma.activeSchedule.findMany({
        where: {
          source: 'gantt',
          OR: [
            ...(projectNumber ? [{ jobKey: { contains: projectNumber } }] : []),
            { jobKey: { contains: projectNamePrefix } },
          ],
        },
        select: {
          scopeOfWork: true,
          date: true,
          hours: true,
        },
      });

      if (activeEntries.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'No active schedule entries found for this project',
          data: { syncedScopes: 0, totalHours: 0 },
        });
      }

      const scopeByNormalizedTitle = new Map(scopes.map((s) => [normalize(s.title), s]));
      const entriesByScopeIdAndDate = new Map<string, Map<string, number>>();

      for (const entry of activeEntries) {
        const match = scopeByNormalizedTitle.get(normalize(entry.scopeOfWork));
        if (!match) continue;

        if (!entriesByScopeIdAndDate.has(match.id)) {
          entriesByScopeIdAndDate.set(match.id, new Map<string, number>());
        }

        const byDate = entriesByScopeIdAndDate.get(match.id)!;
        const current = byDate.get(entry.date) || 0;
        byDate.set(entry.date, current + Number(entry.hours || 0));
      }

      for (const scope of scopes) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM gantt_v2_schedule_entries WHERE scope_id = $1`,
          scope.id
        );

        // If a scope is unscheduled in Gantt (missing dates or non-positive hours),
        // keep schedule entries cleared even if activeSchedule contains historical rows.
        if (!scope.start_date || !scope.end_date || Number(scope.total_hours || 0) <= 0) {
          continue;
        }

        const byDate = entriesByScopeIdAndDate.get(scope.id);
        if (!byDate || byDate.size === 0) continue;

        syncedScopes += 1;

        for (const [workDate, hours] of byDate.entries()) {
          totalHours += hours;
          await prisma.$executeRawUnsafe(
            `INSERT INTO gantt_v2_schedule_entries (id, scope_id, work_date, scheduled_hours)
             VALUES ($1, $2, $3::date, $4)`,
            crypto.randomUUID(),
            scope.id,
            workDate,
            hours
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Synced ${syncedScopes} scope(s)`,
      data: {
        syncedScopes,
        totalHours: Math.round(totalHours * 100) / 100,
      },
    });
  } catch (error) {
    console.error('[SYNC] Error:', error);
    return NextResponse.json(
      { success: false, error: `Failed to sync schedule: ${String(error)}` },
      { status: 500 }
    );
  }
}
