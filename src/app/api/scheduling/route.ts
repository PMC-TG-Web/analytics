import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

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
          allocations: true,
        },
      }),
    ]);

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

    // Convert allocations array format to object if needed
    let allocationsObj: Record<string, number> = {};
    if (Array.isArray(allocations)) {
      allocations.forEach((alloc: { month: string; percent: number }) => {
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
