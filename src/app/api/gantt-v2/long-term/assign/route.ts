import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobKey, scopeOfWork, weekStart, weekEnd, foreman } = body || {};

    if (!jobKey || !scopeOfWork) {
      return NextResponse.json(
        { success: false, error: 'jobKey and scopeOfWork are required' },
        { status: 400 }
      );
    }

    const foremanValue = typeof foreman === 'string' ? foreman.trim() : '';

    // Build where clause - if weekStart/weekEnd provided, filter by date range
    const whereClause: any = {
      jobKey,
      scopeOfWork,
      source: 'gantt',
    };

    if (weekStart && weekEnd) {
      whereClause.date = {
        gte: weekStart,
        lte: weekEnd,
      };
    }

    const result = await prisma.activeSchedule.updateMany({
      where: whereClause,
      data: {
        foreman: foremanValue || null,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        updatedCount: result.count,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Failed to assign foreman: ${String(error)}` },
      { status: 500 }
    );
  }
}
