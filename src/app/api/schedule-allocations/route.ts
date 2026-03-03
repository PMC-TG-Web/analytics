import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action');
    const jobKey = searchParams.get('jobKey');
    const startMonth = searchParams.get('startMonth'); // YYYY-MM format
    const endMonth = searchParams.get('endMonth'); // YYYY-MM format

    // Get all allocations with optional filters
    if (!action || action === 'all') {
      const where: any = {};

      if (jobKey) {
        where.schedule = { jobKey };
      }

      if (startMonth || endMonth) {
        where.period = {};
        if (startMonth) where.period.gte = startMonth;
        if (endMonth) where.period.lte = endMonth;
      }

      const allocations = await prisma.scheduleAllocation.findMany({
        where,
        include: {
          schedule: {
            select: {
              id: true,
              jobKey: true,
              customer: true,
              projectNumber: true,
              projectName: true,
              status: true,
              totalHours: true,
            },
          },
        },
        orderBy: [
          { schedule: { jobKey: 'asc' } },
          { period: 'asc' },
        ],
      });

      return NextResponse.json({
        success: true,
        data: allocations,
      });
    }

    // Aggregate by month for WIP report view
    if (action === 'monthly-summary') {
      const allocations = await prisma.scheduleAllocation.findMany({
        where: {
          periodType: 'month',
          ...(startMonth && { period: { gte: startMonth } }),
          ...(endMonth && { period: { lte: endMonth } }),
        },
        include: {
          schedule: {
            select: {
              jobKey: true,
              customer: true,
              projectNumber: true,
              projectName: true,
              status: true,
              totalHours: true,
            },
          },
        },
      });

      // Group by period (month)
      const monthlySummary: Record<string, Array<any>> = {};
      allocations.forEach((alloc) => {
        if (!monthlySummary[alloc.period]) {
          monthlySummary[alloc.period] = [];
        }
        monthlySummary[alloc.period].push({
          schedule: alloc.schedule,
          hours: alloc.hours,
          percent: alloc.percent,
        });
      });

      return NextResponse.json({
        success: true,
        data: monthlySummary,
      });
    }

    // Get single schedule's allocations
    if (action === 'by-schedule' && jobKey) {
      const schedule = await prisma.schedule.findUnique({
        where: { jobKey },
        include: {
          allocations: {
            orderBy: { period: 'asc' },
          },
        },
      });

      if (!schedule) {
        return NextResponse.json(
          { success: false, error: 'Schedule not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        data: schedule,
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Failed to fetch schedule allocations:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch allocations' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { scheduleId, period, periodType = 'month', hours, percent } = body;

    if (!scheduleId || !period || typeof hours !== 'number') {
      return NextResponse.json(
        { success: false, error: 'scheduleId, period, and hours are required' },
        { status: 400 }
      );
    }

    const allocation = await prisma.scheduleAllocation.upsert({
      where: {
        scheduleId_period: {
          scheduleId,
          period,
        },
      },
      create: {
        scheduleId,
        period,
        periodType,
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
      message: 'Allocation saved successfully',
      data: allocation,
    });
  } catch (error) {
    console.error('Failed to save allocation:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save allocation' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const scheduleId = searchParams.get('scheduleId');
    const period = searchParams.get('period');

    if (!scheduleId || !period) {
      return NextResponse.json(
        { success: false, error: 'scheduleId and period are required' },
        { status: 400 }
      );
    }

    await prisma.scheduleAllocation.delete({
      where: {
        scheduleId_period: {
          scheduleId,
          period,
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Allocation deleted successfully',
    });
  } catch (error) {
    console.error('Failed to delete allocation:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete allocation' },
      { status: 500 }
    );
  }
}
