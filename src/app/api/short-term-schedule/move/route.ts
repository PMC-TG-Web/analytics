import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { reconcileDailyAssignment, SchedulingConflictError } from '@/lib/scheduling/dailyAssignment';
import { syncActiveScheduleToScope } from '@/lib/ganttV2Db';

export const dynamic = 'force-dynamic';

function getWeekRangeFromDateKey(dateKey: string): { weekStart: string; weekEnd: string } | null {
  const parts = String(dateKey || '').trim().split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;

  const dayOfWeek = date.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStartDate = new Date(date);
  weekStartDate.setDate(date.getDate() + mondayOffset);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekStartDate.getDate() + 6);

  const formatDateKey = (value: Date) => {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  return {
    weekStart: formatDateKey(weekStartDate),
    weekEnd: formatDateKey(weekEndDate),
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      jobKey,
      scopeOfWork,
      sourceDateKey,      // YYYY-MM-DD format or null for new entries
      targetDateKey,      // YYYY-MM-DD format
      targetForemanId,
      hours,
      allowScopeOverrun,
      applyForemanAcrossProjectWeek,
    } = body;

    console.log('[SHORT-TERM-MOVE] Request:', { jobKey, scopeOfWork, sourceDateKey, targetDateKey, targetForemanId, hours });

    if (!jobKey || !scopeOfWork || !targetDateKey) {
      return NextResponse.json(
        { success: false, error: 'jobKey, scopeOfWork, and targetDateKey are required' },
        { status: 400 }
      );
    }

    let warning: string | null = null;
    if (allowScopeOverrun === true) {
      const normalizedScope = String(scopeOfWork || '').trim();
      const numericHours = typeof hours === 'number' && Number.isFinite(hours) ? hours : 8;

      const scope = await prisma.projectScope.findFirst({
        where: {
          jobKey,
          title: normalizedScope,
        },
        select: {
          hours: true,
        },
      });

      const scopeHourCap = scope?.hours ?? null;
      if (scopeHourCap !== null && scopeHourCap >= 0) {
        const existingTargetEntry = await prisma.activeSchedule.findUnique({
          where: {
            jobKey_scopeOfWork_date: {
              jobKey,
              scopeOfWork: normalizedScope,
              date: targetDateKey,
            },
          },
          select: {
            hours: true,
          },
        });

        const currentScopeAggregate = await prisma.activeSchedule.aggregate({
          where: {
            jobKey,
            scopeOfWork: normalizedScope,
          },
          _sum: {
            hours: true,
          },
        });

        const existingTotal = currentScopeAggregate._sum.hours ?? 0;
        const existingTargetHours = existingTargetEntry?.hours ?? 0;
        const projectedTotal = existingTotal - existingTargetHours + numericHours;

        if (projectedTotal > scopeHourCap + 1e-9) {
          warning = `Scope hours exceeded for '${normalizedScope}'. Scheduled anyway because override is enabled.`;
        }
      }
    }

    const reconcileResult = await reconcileDailyAssignment({
      jobKey,
      scopeOfWork,
      sourceDateKey,
      targetDateKey,
      targetForemanId,
      hours,
      fallbackSource: 'wip-page',
      enforceScopeHourCap: allowScopeOverrun === true ? false : true,
    });

    if (applyForemanAcrossProjectWeek === true) {
      const weekRange = getWeekRangeFromDateKey(targetDateKey);
      if (weekRange) {
        const normalizedForeman =
          typeof targetForemanId === 'string' && targetForemanId.trim() && targetForemanId !== '__unassigned__'
            ? targetForemanId.trim()
            : null;

        await prisma.activeSchedule.updateMany({
          where: {
            jobKey,
            date: {
              gte: weekRange.weekStart,
              lte: weekRange.weekEnd,
            },
          },
          data: {
            foreman: normalizedForeman,
          },
        });
      }
    }

    console.log('[SHORT-TERM-MOVE] Reconcile result:', reconcileResult);

    // Keep gantt scope totals in sync when editing a gantt-backed daily assignment.
    if (reconcileResult.sourceType === 'gantt') {
      const matchingScope = await prisma.$queryRawUnsafe<Array<{ scope_id: string; title: string }>>(
        `
          SELECT s.id AS scope_id, s.title
          FROM gantt_v2_projects p
          JOIN gantt_v2_scopes s ON s.project_id = p.id
          WHERE CONCAT(COALESCE(p.customer, ''), '~', COALESCE(p.project_number, ''), '~', COALESCE(p.project_name, '')) = $1
            AND LOWER(TRIM(s.title)) = LOWER(TRIM($2))
          LIMIT 1
        `,
        jobKey,
        scopeOfWork
      );

      if (matchingScope.length > 0) {
        await syncActiveScheduleToScope(matchingScope[0].scope_id, jobKey, matchingScope[0].title);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Project moved successfully',
      data: reconcileResult,
      warning,
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

    console.error('[SHORT-TERM-MOVE] Failed to move project:', error);
    return NextResponse.json(
      { success: false, error: `Failed to move project: ${String(error)}` },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobKey, scopeOfWork, date } = body || {};

    if (!jobKey || !scopeOfWork || !date) {
      return NextResponse.json(
        { success: false, error: 'jobKey, scopeOfWork, and date are required' },
        { status: 400 }
      );
    }

    const normalizedScopeOfWork = String(scopeOfWork).trim();

    const existingEntry = await prisma.activeSchedule.findUnique({
      where: {
        jobKey_scopeOfWork_date: {
          jobKey,
          scopeOfWork: normalizedScopeOfWork,
          date,
        },
      },
      select: {
        source: true,
      },
    });

    const result = await prisma.activeSchedule.deleteMany({
      where: {
        jobKey,
        scopeOfWork: normalizedScopeOfWork,
        date,
      },
    });

    // Keep gantt scope totals in sync when deleting a gantt-backed daily assignment.
    if ((existingEntry?.source || '').toLowerCase() === 'gantt' && result.count > 0) {
      const matchingScope = await prisma.$queryRawUnsafe<Array<{ scope_id: string; title: string }>>(
        `
          SELECT s.id AS scope_id, s.title
          FROM gantt_v2_projects p
          JOIN gantt_v2_scopes s ON s.project_id = p.id
          WHERE CONCAT(COALESCE(p.customer, ''), '~', COALESCE(p.project_number, ''), '~', COALESCE(p.project_name, '')) = $1
            AND LOWER(TRIM(s.title)) = LOWER(TRIM($2))
          LIMIT 1
        `,
        jobKey,
        normalizedScopeOfWork
      );

      if (matchingScope.length > 0) {
        await syncActiveScheduleToScope(matchingScope[0].scope_id, jobKey, matchingScope[0].title);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        deletedCount: result.count,
      },
    });
  } catch (error) {
    console.error('[SHORT-TERM-MOVE] Failed to delete day assignment:', error);
    return NextResponse.json(
      { success: false, error: `Failed to delete day assignment: ${String(error)}` },
      { status: 500 }
    );
  }
}
