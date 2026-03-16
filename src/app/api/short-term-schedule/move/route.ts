import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { reconcileDailyAssignment, SchedulingConflictError } from '@/lib/scheduling/dailyAssignment';
import { syncActiveScheduleToScope } from '@/lib/ganttV2Db';

export const dynamic = 'force-dynamic';

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
    } = body;

    console.log('[SHORT-TERM-MOVE] Request:', { jobKey, scopeOfWork, sourceDateKey, targetDateKey, targetForemanId, hours });

    if (!jobKey || !scopeOfWork || !targetDateKey) {
      return NextResponse.json(
        { success: false, error: 'jobKey, scopeOfWork, and targetDateKey are required' },
        { status: 400 }
      );
    }

    const reconcileResult = await reconcileDailyAssignment({
      jobKey,
      scopeOfWork,
      sourceDateKey,
      targetDateKey,
      targetForemanId,
      hours,
      fallbackSource: 'wip-page',
      enforceScopeHourCap: true,
    });

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

    const result = await prisma.activeSchedule.deleteMany({
      where: {
        jobKey,
        scopeOfWork: String(scopeOfWork).trim(),
        date,
        source: 'wip-page',
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        deletedCount: result.count,
      },
    });
  } catch (error) {
    console.error('[SHORT-TERM-MOVE] Failed to delete custom scope:', error);
    return NextResponse.json(
      { success: false, error: `Failed to delete custom scope: ${String(error)}` },
      { status: 500 }
    );
  }
}
