import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Get all schedules
    const schedules = await prisma.schedule.findMany({
      select: {
        id: true,
        jobKey: true,
        customer: true,
        projectName: true,
        projectNumber: true,
        status: true,
        totalHours: true,
        allocations: true,
      },
    });

    // Transform allocations from JSON to the expected format
    const data = schedules.map((s) => ({
      ...s,
      allocations: Array.isArray(s.allocations)
        ? s.allocations
        : Object.entries(s.allocations || {}).map(([month, percent]) => ({
            month,
            percent,
          })),
    }));

    return NextResponse.json({
      success: true,
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

    // Convert allocations array format to object if needed
    let allocationsObj: Record<string, number> = {};
    if (Array.isArray(allocations)) {
      allocations.forEach((alloc: any) => {
        allocationsObj[alloc.month] = alloc.percent;
      });
    } else {
      allocationsObj = allocations || {};
    }

    // Upsert schedule (update if exists, create if not)
    const schedule = await prisma.schedule.upsert({
      where: { jobKey },
      create: {
        jobKey,
        customer,
        projectName,
        projectNumber,
        status,
        totalHours,
        allocations: allocationsObj,
      },
      update: {
        customer,
        projectName,
        projectNumber,
        status,
        totalHours,
        allocations: allocationsObj,
      },
    });

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
