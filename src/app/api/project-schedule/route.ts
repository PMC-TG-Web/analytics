import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const jobKey = searchParams.get('jobKey');
    const month = searchParams.get('month');

    if (!jobKey) {
      return NextResponse.json(
        { success: false, error: 'jobKey is required' },
        { status: 400 }
      );
    }

    // Fetch the schedule document for this project
    const schedule = await prisma.schedule.findFirst({
      where: {
        jobKey: jobKey,
      },
      select: {
        id: true,
        jobKey: true,
        customer: true,
        projectNumber: true,
        projectName: true,
        totalHours: true,
        allocationsList: {
          select: {
            period: true,
            periodType: true,
            hours: true,
            percent: true,
          },
          orderBy: { period: 'asc' },
        },
      },
    });

    // If no month specified, return all schedule data (for Gantt view)
    if (!month) {
      if (!schedule) {
        const [customer, projectNumber, projectName] = jobKey.split('~');
        return NextResponse.json({
          success: true,
          data: {
            jobKey,
            customer: customer || '',
            projectNumber: projectNumber || '',
            projectName: projectName || '',
            allocations: [],
          },
        });
      }

      return NextResponse.json({
        success: true,
        data: {
          jobKey,
          customer: schedule.customer || '',
          projectNumber: schedule.projectNumber || '',
          projectName: schedule.projectName || '',
          totalHours: schedule.totalHours || 0,
          allocations: schedule.allocationsList || [],
        },
      });
    }

    // Month-specific query (for drawer editor)
    const allocation = schedule?.allocationsList?.find((a) => a.period === month);

    if (!allocation) {
      // Return empty structure if no allocation exists for this month
      const [customer, projectNumber, projectName] = jobKey.split('~');
      return NextResponse.json({
        success: true,
        data: {
          jobKey,
          customer: customer || '',
          projectNumber: projectNumber || '',
          projectName: projectName || '',
          month,
          allocation: {
            hours: 0,
            percent: 0,
          },
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        jobKey,
        customer: schedule.customer || '',
        projectNumber: schedule.projectNumber || '',
        projectName: schedule.projectName || '',
        month,
        allocation: {
          hours: allocation.hours,
          percent: allocation.percent,
        },
      },
    });
  } catch (error) {
    console.error('Failed to fetch project schedule:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch schedule' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobKey, customer, projectNumber, projectName, month, hours, percent } = body;

    if (!jobKey || !month || typeof hours !== 'number') {
      return NextResponse.json(
        { success: false, error: 'jobKey, month, and hours are required' },
        { status: 400 }
      );
    }

    // Ensure schedule exists
    const schedule = await prisma.schedule.upsert({
      where: { jobKey },
      update: {},
      create: {
        jobKey,
        customer,
        projectNumber,
        projectName,
      },
      select: { id: true },
    });

    // Create or update allocation
    const allocation = await prisma.scheduleAllocation.upsert({
      where: {
        scheduleId_period: {
          scheduleId: schedule.id,
          period: month,
        },
      },
      create: {
        scheduleId: schedule.id,
        period: month,
        periodType: 'month',
        hours,
        percent,
      },
      update: {
        hours,
        percent,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Schedule saved',
      data: { 
        scheduleId: schedule.id,
        allocationId: allocation.id,
        period: month,
        hours,
        percent,
      },
    });
  } catch (error) {
    console.error('Failed to save project schedule:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save schedule' },
      { status: 500 }
    );
  }
}
