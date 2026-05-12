import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobKey, scopeOfWork, weekStart, weekEnd, foreman, applyAcrossProject } = body || {};

    const normalizedJobKey = String(jobKey || '').trim();
    const normalizedScopeOfWork = String(scopeOfWork || '').trim();
    const shouldApplyAcrossProject = Boolean(applyAcrossProject);

    if (!normalizedJobKey || (!shouldApplyAcrossProject && !normalizedScopeOfWork)) {
      return NextResponse.json(
        { success: false, error: 'jobKey is required, and scopeOfWork is required unless applyAcrossProject is true' },
        { status: 400 }
      );
    }

    const foremanValue = typeof foreman === 'string' ? foreman.trim() : '';

    // Build where clause - if weekStart/weekEnd provided, filter by date range
    const whereClause: any = {
      jobKey: normalizedJobKey,
    };

    if (!shouldApplyAcrossProject) {
      whereClause.scopeOfWork = normalizedScopeOfWork;
    }

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

    // If updating a specific scope, ensure it exists in projectScope
    if (!shouldApplyAcrossProject && normalizedScopeOfWork) {
      const existingScope = await prisma.projectScope.findFirst({
        where: {
          jobKey: normalizedJobKey,
          title: normalizedScopeOfWork,
        },
        select: { id: true },
      });

      if (!existingScope) {
        await prisma.projectScope.create({
          data: {
            jobKey: normalizedJobKey,
            title: normalizedScopeOfWork,
            hours: 0,
            manpower: 0,
            startDate: '',
            endDate: '',
            description: `Auto-created from long-term foreman assignment`,
            tasks: [],
            schedulingMode: 'contiguous',
            selectedDays: [],
          },
        }).catch(() => {
          // Ignore duplicate key errors (another request may have created it concurrently)
        });
      }
    }

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
