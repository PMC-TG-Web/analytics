import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action');

    if (action === 'employees') {
      // GET employees
      const employees = await prisma.employee.findMany({
        where: { isActive: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      });

      return NextResponse.json({
        success: true,
        data: employees,
      });
    }

    if (action === 'time-off') {
      // GET time off requests
      const timeOffRequests = await prisma.timeOffRequest.findMany({
        select: {
          id: true,
          employeeId: true,
          employeeName: true,
          dates: true,
          reason: true,
          status: true,
        },
      });

      return NextResponse.json({
        success: true,
        data: timeOffRequests,
      });
    }

    if (action === 'scopes') {
      // GET project scopes
      const scopes = await prisma.projectScope.findMany({
        select: {
          id: true,
          jobKey: true,
          title: true,
          startDate: true,
          endDate: true,
          hours: true,
        },
      });

      return NextResponse.json({
        success: true,
        data: scopes,
      });
    }

    if (action === 'projects') {
      // GET projects
      const projects = await prisma.project.findMany({
        where: {
          status: {
            notIn: ['Bid Submitted', 'Lost'],
          },
          projectArchived: false,
        },
        select: {
          id: true,
          projectNumber: true,
          projectName: true,
          customer: true,
          status: true,
          hours: true,
          projectManager: true,
        },
      });

      return NextResponse.json({
        success: true,
        data: projects,
      });
    }

    if (action === 'active-schedule') {
      // GET active schedule for date range
      const startDate = searchParams.get('startDate');
      const endDate = searchParams.get('endDate');

      if (!startDate || !endDate) {
        return NextResponse.json(
          { success: false, error: 'startDate and endDate are required' },
          { status: 400 }
        );
      }

      const activeSchedules = await prisma.activeSchedule.findMany({
        where: {
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
        select: {
          id: true,
          jobKey: true,
          scopeOfWork: true,
          date: true,
          hours: true,
          foreman: true,
          manpower: true,
          source: true,
        },
      });

      return NextResponse.json({
        success: true,
        data: activeSchedules,
      });
    }

    // Default: return all critical data for schedule view
    const [employees, timeOffs, scopes, projects] = await Promise.all([
      prisma.employee.findMany({
        where: { isActive: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      prisma.timeOffRequest.findMany(),
      prisma.projectScope.findMany(),
      prisma.project.findMany({
        where: {
          status: { notIn: ['Bid Submitted', 'Lost'] },
          projectArchived: false,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        employees,
        timeOffs,
        scopes,
        projects,
      },
    });
  } catch (error) {
    console.error('Failed to fetch short-term schedule data:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch data' },
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
      projectNumber,
      projectName,
      month,
      weeks,
      docId,
    } = body;

    if (!jobKey || !month) {
      return NextResponse.json(
        { success: false, error: 'jobKey and month are required' },
        { status: 400 }
      );
    }

    // Store schedule data in Schedule table's shortTermData JSON field
    const schedule = await prisma.schedule.upsert({
      where: { jobKey },
      create: {
        jobKey,
        customer,
        projectNumber,
        projectName,
        status: 'In Progress',
        shortTermData: {
          [month]: {
            weeks,
            updatedAt: new Date().toISOString(),
          },
        },
      },
      update: {
        shortTermData: {
          ...{}, // Preserve existing months
          [month]: {
            weeks,
            updatedAt: new Date().toISOString(),
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Schedule saved successfully',
      data: schedule,
    });
  } catch (error) {
    console.error('Failed to save short-term schedule:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save schedule' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const jobKey = searchParams.get('jobKey');
    const month = searchParams.get('month');

    if (!jobKey || !month) {
      return NextResponse.json(
        { success: false, error: 'jobKey and month are required' },
        { status: 400 }
      );
    }

    // Get existing schedule and remove the month's data
    const schedule = await prisma.schedule.findUnique({
      where: { jobKey },
    });

    if (!schedule) {
      return NextResponse.json(
        { success: false, error: 'Schedule not found' },
        { status: 404 }
      );
    }

    // Remove the specific month from shortTermData
    const shortTermData = (schedule.shortTermData as Record<string, any>) || {};
    delete shortTermData[month];

    await prisma.schedule.update({
      where: { jobKey },
      data: {
        shortTermData: Object.keys(shortTermData).length > 0 ? shortTermData : {},
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Schedule deleted successfully',
    });
  } catch (error) {
    console.error('Failed to delete short-term schedule:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete schedule' },
      { status: 500 }
    );
  }
}
