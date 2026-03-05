import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
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

    // Validate month format (YYYY-MM)
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json(
        { success: false, error: 'Invalid month format. Use YYYY-MM' },
        { status: 400 }
      );
    }

    const [year, monthNum] = month.split('-');
    const monthDate = new Date(Number(year), Number(monthNum) - 1, 1);
    
    // Get the first and last day of the month
    const firstDayOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const lastDayOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

    // Format as YYYY-MM-DD for database queries
    const startDate = firstDayOfMonth.toISOString().split('T')[0];
    const endDate = lastDayOfMonth.toISOString().split('T')[0];

    // Query ActiveSchedule for this job and month
    const activeSchedules = await prisma.activeSchedule.findMany({
      where: {
        jobKey: jobKey,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        date: true,
        hours: true,
        scopeOfWork: true,
      },
      orderBy: {
        date: 'asc',
      },
    });

    // Aggregate by week
    const weekMap: Record<number, { weekNumber: number; hours: number }> = {};

    activeSchedules.forEach((entry) => {
      const entryDate = new Date(`${entry.date}T00:00:00Z`);
      
      // Calculate week number within the month
      const dayOfMonth = entryDate.getDate();
      const weekNumber = Math.ceil(dayOfMonth / 7);

      if (!weekMap[weekNumber]) {
        weekMap[weekNumber] = {
          weekNumber,
          hours: 0,
        };
      }

      weekMap[weekNumber].hours += entry.hours || 0;
    });

    // Create weeks array with 0 hours for missing weeks
    const weeks = [];
    for (let i = 1; i <= 5; i++) {
      weeks.push(
        weekMap[i] || {
          weekNumber: i,
          hours: 0,
        }
      );
    }

    // Return as single document matching the expected format
    return NextResponse.json([
      {
        id: `${jobKey}-${month}`,
        jobKey,
        month,
        weeks,
      },
    ]);
  } catch (error) {
    console.error('Failed to fetch long-term schedule:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch schedule' },
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
    } = body;

    if (!jobKey || !month || !Array.isArray(weeks)) {
      return NextResponse.json(
        { success: false, error: 'jobKey, month, and weeks array are required' },
        { status: 400 }
      );
    }

    // Validate month format
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json(
        { success: false, error: 'Invalid month format. Use YYYY-MM' },
        { status: 400 }
      );
    }

    const [year, monthNum] = month.split('-');
    const monthDate = new Date(Number(year), Number(monthNum) - 1, 1);
    
    // Get the first day of the month
    const lastDayOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
    const startDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).toISOString().split('T')[0];
    const endDate = lastDayOfMonth.toISOString().split('T')[0];

    // Delete existing ActiveSchedule records for this job and month
    await prisma.activeSchedule.deleteMany({
      where: {
        jobKey,
        source: 'wip-page',
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    // Find the first weekday of the month
    const firstWeekday = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    while (firstWeekday <= lastDayOfMonth) {
      const dayOfWeek = firstWeekday.getDay();
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        // Found a weekday (Mon-Fri)
        break;
      }
      firstWeekday.setDate(firstWeekday.getDate() + 1);
    }

    const firstWeekdayStr = firstWeekday.toISOString().split('T')[0];

    // Calculate total monthly hours and create single entry for first weekday
    const totalMonthlyHours = weeks.reduce((sum: number, w: { hours?: number }) => sum + (w.hours || 0), 0);

    if (totalMonthlyHours > 0) {
      // Query all scopes for this job
      const projectScopes = await prisma.projectScope.findMany({
        where: {
          jobKey: jobKey,
        },
      });

      // Filter scopes active in this month
      const activeScopesInMonth = projectScopes.filter((scope) => {
        if (!scope.startDate || !scope.endDate) return true;
        const scopeStartStr = typeof scope.startDate === 'string' ? scope.startDate : (scope.startDate as Date).toISOString().split('T')[0];
        const scopeEndStr = typeof scope.endDate === 'string' ? scope.endDate : (scope.endDate as Date).toISOString().split('T')[0];
        return scopeStartStr <= endDate && scopeEndStr >= startDate;
      });

      const recordsToCreate = [];

      if (activeScopesInMonth.length === 0) {
        // No scopes found, use generic scope
        recordsToCreate.push({
          jobKey,
          date: firstWeekdayStr,
          hours: totalMonthlyHours,
          scopeOfWork: 'Project Work',
          source: 'wip-page',
        });
      } else {
        // Distribute hours proportionally among active scopes
        const totalScopeHours = activeScopesInMonth.reduce((sum, scope) => sum + (scope.hours || 0), 0);

        activeScopesInMonth.forEach((scope) => {
          const scopeHourFraction = totalScopeHours > 0 ? (scope.hours || 0) / totalScopeHours : 1 / activeScopesInMonth.length;
          const scopeHours = totalMonthlyHours * scopeHourFraction;

          recordsToCreate.push({
            jobKey,
            date: firstWeekdayStr,
            hours: scopeHours,
            scopeOfWork: scope.title || 'Scheduled Work',
            source: 'wip-page',
          });
        });
      }

      if (recordsToCreate.length > 0) {
        await prisma.activeSchedule.createMany({
          data: recordsToCreate,
          skipDuplicates: true,
        });
      }

      return NextResponse.json({
        success: true,
        message: `Scheduled ${totalMonthlyHours.toFixed(1)} hours for ${jobKey} on ${firstWeekdayStr}`,
        data: { 
          recordsCreated: recordsToCreate.length,
          month,
          scheduledDate: firstWeekdayStr,
          totalHours: totalMonthlyHours,
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: `No hours to schedule for ${month}`,
      data: { recordsCreated: 0 },
    });
  } catch (error) {
    console.error('Failed to save long-term schedule:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save schedule' },
      { status: 500 }
    );
  }
}
