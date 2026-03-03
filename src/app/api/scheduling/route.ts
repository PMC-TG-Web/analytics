import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { syncAllocationToActiveSchedule } from '@/utils/syncActiveSchedule';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const requestedPageSize = Number.parseInt(searchParams.get('pageSize') || '100', 10) || 100;
    const pageSize = Math.min(500, Math.max(1, requestedPageSize));
    const skip = (page - 1) * pageSize;

    // Get all schedules
    const [total, schedules] = await Promise.all([
      prisma.schedule.count(),
      prisma.schedule.findMany({
        skip,
        take: pageSize,
        select: {
          id: true,
          jobKey: true,
          customer: true,
          projectName: true,
          projectNumber: true,
          status: true,
          totalHours: true,
          allocationsList: {
            select: {
              period: true,
              hours: true,
              percent: true,
            },
            orderBy: { period: 'asc' },
          },
        },
      }),
    ]);

    // Transform allocations to the expected format
    const data = schedules.map((s) => {
      const { allocationsList, ...rest } = s;
      return {
        ...rest,
        allocations: allocationsList.map((alloc) => ({
          month: alloc.period,
          percent: alloc.percent || 0,
          hours: alloc.hours,
        })),
      };
    });

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return NextResponse.json({
      success: true,
      count: data.length,
      total,
      page,
      pageSize,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      data,
    });
  } catch (error) {
    console.error('Failed to fetch schedules:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch schedules' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      jobKey,
      customer,
      projectName,
      projectNumber,
      status,
      totalHours,
      allocations,
    } = body;

    if (!jobKey || !customer || !projectName) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Create or update schedule (without allocations - those are managed separately)
    const schedule = await prisma.schedule.upsert({
      where: { jobKey },
      create: {
        jobKey,
        customer,
        projectName,
        projectNumber,
        status,
        totalHours,
      },
      update: {
        customer,
        projectName,
        projectNumber,
        status,
        totalHours,
      },
    });

    // If allocations are provided, create/update ScheduleAllocation records
    if (allocations && Array.isArray(allocations)) {
      for (const alloc of allocations) {
        const { month, percent, hours } = alloc;
        if (!month) continue;

        await prisma.scheduleAllocation.upsert({
          where: {
            scheduleId_period: {
              scheduleId: schedule.id,
              period: month,
            },
          },
          create: {
            scheduleId: schedule.id,
            period: month,
            hours: hours || 0,
            percent: percent || 0,
          },
          update: {
            hours: hours || 0,
            percent: percent || 0,
          },
        });

        // Sync to activeSchedule for monthly allocations
        await syncAllocationToActiveSchedule(
          schedule.id,
          month,
          hours || 0,
          'schedules'
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Schedule saved successfully',
      data: schedule,
    });
  } catch (error) {
    console.error('Failed to save schedule:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save schedule' },
      { status: 500 }
    );
  }
}
