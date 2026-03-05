import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

    const scopeOfWorkTrimmed = scopeOfWork.trim();
    const targetForeman = targetForemanId === '__unassigned__' || !targetForemanId ? null : targetForemanId;
    const hoursValue = typeof hours === 'number' ? hours : 8;

    // Get the source from the existing entry (to preserve it)
    let sourceType = 'wip-page';
    if (sourceDateKey) {
      const existingEntry = await prisma.activeSchedule.findFirst({
        where: {
          jobKey,
          scopeOfWork: scopeOfWorkTrimmed,
          date: sourceDateKey,
        },
        select: { source: true },
      });
      if (existingEntry?.source) {
        sourceType = existingEntry.source;
      }
    }

    console.log('[SHORT-TERM-MOVE] Determined source type:', sourceType);

    // Delete the old ActiveSchedule entry if moving from a different date
    if (sourceDateKey && sourceDateKey !== targetDateKey) {
      console.log('[SHORT-TERM-MOVE] Deleting old entry from date:', sourceDateKey);
      const deleteResult = await prisma.activeSchedule.deleteMany({
        where: {
          jobKey,
          scopeOfWork: scopeOfWorkTrimmed,
          date: sourceDateKey,
        },
      });
      console.log('[SHORT-TERM-MOVE] Delete result:', deleteResult);
    }

    // Create or update the target date entry with preserved source
    console.log('[SHORT-TERM-MOVE] Upserting with key:', { jobKey, scopeOfWork: scopeOfWorkTrimmed, date: targetDateKey });
    const upsertResult = await prisma.activeSchedule.upsert({
      where: {
        jobKey_scopeOfWork_date: {
          jobKey,
          scopeOfWork: scopeOfWorkTrimmed,
          date: targetDateKey,
        },
      },
      create: {
        jobKey,
        scopeOfWork: scopeOfWorkTrimmed,
        date: targetDateKey,
        hours: hoursValue,
        foreman: targetForeman,
        source: sourceType,
      },
      update: {
        hours: hoursValue,
        foreman: targetForeman,
        source: sourceType,
      },
    });
    
    console.log('[SHORT-TERM-MOVE] Upsert result:', upsertResult);

    return NextResponse.json({
      success: true,
      message: 'Project moved successfully',
    });
  } catch (error) {
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
