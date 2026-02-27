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
        shortTermData: true,
        longTermData: true,
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
            shortTermData: {},
            longTermData: {},
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
          shortTermData: schedule.shortTermData || {},
          longTermData: schedule.longTermData || {},
        },
      });
    }

    // Month-specific query (for drawer editor)
    if (!schedule) {
      // Return empty structure if no schedule exists yet
      const [customer, projectNumber, projectName] = jobKey.split('~');
      return NextResponse.json({
        success: true,
        data: {
          jobKey,
          customer: customer || '',
          projectNumber: projectNumber || '',
          projectName: projectName || '',
          month,
          weeks: Array.from({ length: 6 }, (_, i) => ({
            weekNumber: i + 1,
            days: Array.from({ length: 7 }, (_, j) => ({
              dayNumber: j + 1,
              hours: 0,
            })),
          })),
        },
      });
    }

    // Extract month data from shortTermData JSON
    const shortTermData = (schedule.shortTermData as any) || {};
    const monthData = shortTermData[month];

    if (!monthData) {
      // Return empty structure for this month
      const [customer, projectNumber, projectName] = jobKey.split('~');
      return NextResponse.json({
        success: true,
        data: {
          jobKey,
          customer: customer || '',
          projectNumber: projectNumber || '',
          projectName: projectName || '',
          month,
          weeks: Array.from({ length: 6 }, (_, i) => ({
            weekNumber: i + 1,
            days: Array.from({ length: 7 }, (_, j) => ({
              dayNumber: j + 1,
              hours: 0,
            })),
          })),
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
        weeks: monthData.weeks || [],
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
    const { jobKey, customer, projectNumber, projectName, month, weeks } = body;

    if (!jobKey || !month) {
      return NextResponse.json(
        { success: false, error: 'jobKey and month are required' },
        { status: 400 }
      );
    }

    // Fetch existing schedule data to merge
    const existingSchedule = await prisma.schedule.findUnique({
      where: { jobKey },
      select: { shortTermData: true },
    });

    const existingData = (existingSchedule?.shortTermData as any) || {};

    // Upsert the schedule document
    const schedule = await prisma.schedule.upsert({
      where: { jobKey },
      update: {
        shortTermData: {
          ...existingData,
          [month]: { weeks },
        },
      },
      create: {
        jobKey,
        customer,
        projectNumber,
        projectName,
        shortTermData: {
          [month]: { weeks },
        },
      },
      select: {
        id: true,
        jobKey: true,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Schedule saved',
      data: { id: schedule.id, jobKey: schedule.jobKey },
    });
  } catch (error) {
    console.error('Failed to save project schedule:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save schedule' },
      { status: 500 }
    );
  }
}
