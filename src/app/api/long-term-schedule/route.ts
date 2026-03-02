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
    const firstDayOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const lastDayOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

    const startDate = firstDayOfMonth.toISOString().split('T')[0];
    const endDate = lastDayOfMonth.toISOString().split('T')[0];

    // Find all scopes for this project that are active in this month
    const projectScopes = await prisma.projectScope.findMany({
      where: {
        jobKey: jobKey,
      },
    });

    // Filter scopes active in this month (date range overlap)
    const activeScopesInMonth = projectScopes.filter((scope) => {
      if (!scope.startDate || !scope.endDate) return true; // Include scopes without dates
      return scope.startDate <= endDate && scope.endDate >= startDate;
    });

    // If no scopes found, create records with generic "Scheduled Work" scope
    if (activeScopesInMonth.length === 0) {
      // Delete existing ActiveSchedule records for this job and month
      await prisma.activeSchedule.deleteMany({
        where: {
          jobKey,
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      // Create records for generic scope
      const recordsToCreate = [];
      weeks.forEach((week: { weekNumber?: number; hours?: number }) => {
        const weekNumber = week.weekNumber || 1;
        const hours = week.hours || 0;

        if (hours <= 0) return;

        const weekStartDay = (weekNumber - 1) * 7 + 1;
        const weekEndDay = Math.min(weekNumber * 7, lastDayOfMonth.getDate());

        const businessDays = [];
        for (let day = weekStartDay; day <= weekEndDay; day++) {
          const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
          const dayOfWeek = date.getDay();
          if (dayOfWeek >= 1 && dayOfWeek <= 5) {
            businessDays.push(date);
          }
        }

        const hoursPerDay = businessDays.length > 0 ? hours / businessDays.length : 0;

        businessDays.forEach((date) => {
          const dateStr = date.toISOString().split('T')[0];
          recordsToCreate.push({
            jobKey,
            customer: customer || '',
            projectNumber: projectNumber || '',
            projectName: projectName || '',
            date: dateStr,
            hours: hoursPerDay,
            scopeOfWork: 'Project Work',
            source: 'wip-page',
          });
        });
      });

      if (recordsToCreate.length > 0) {
        await prisma.activeSchedule.createMany({
          data: recordsToCreate,
          skipDuplicates: true,
        });
      }

      return NextResponse.json({
        success: true,
        message: `Updated ${recordsToCreate.length} schedule records for ${jobKey} (no scopes found)`,
        data: { recordsCreated: recordsToCreate.length },
      });
    }

    // Calculate total hours of all active scopes
    const totalScopeHours = activeScopesInMonth.reduce((sum, scope) => sum + (scope.hours || 0), 0);

    // Delete existing ActiveSchedule records for this job and month
    await prisma.activeSchedule.deleteMany({
      where: {
        jobKey,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    // Distribute monthly hours across scopes proportionally
    const recordsToCreate = [];

    weeks.forEach((week: { weekNumber?: number; hours?: number }) => {
      const weekNumber = week.weekNumber || 1;
      const weekHours = week.hours || 0;

      if (weekHours <= 0) return;

      const weekStartDay = (weekNumber - 1) * 7 + 1;
      const weekEndDay = Math.min(weekNumber * 7, lastDayOfMonth.getDate());

      const businessDays = [];
      for (let day = weekStartDay; day <= weekEndDay; day++) {
        const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
        const dayOfWeek = date.getDay();
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          businessDays.push(date);
        }
      }

      // Distribute week's hours across scopes
      activeScopesInMonth.forEach((scope) => {
        const scopeHourFraction = totalScopeHours > 0 ? (scope.hours || 0) / totalScopeHours : 1 / activeScopesInMonth.length;
        const scopeWeekHours = weekHours * scopeHourFraction;
        const hoursPerDay = businessDays.length > 0 ? scopeWeekHours / businessDays.length : 0;

        businessDays.forEach((date) => {
          const dateStr = date.toISOString().split('T')[0];
          recordsToCreate.push({
            jobKey,
            customer: customer || '',
            projectNumber: projectNumber || '',
            projectName: projectName || '',
            date: dateStr,
            hours: hoursPerDay,
            scopeOfWork: scope.title || 'Scheduled Work',
            source: 'wip-page',
          });
        });
      });
    });

    if (recordsToCreate.length > 0) {
      await prisma.activeSchedule.createMany({
        data: recordsToCreate,
        skipDuplicates: true,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Updated ${recordsToCreate.length} schedule records for ${jobKey} across ${activeScopesInMonth.length} scope(s)`,
      data: { 
        recordsCreated: recordsToCreate.length,
        scopesUsed: activeScopesInMonth.length,
      },
    });
  } catch (error) {
    console.error('Failed to save long-term schedule:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save schedule' },
      { status: 500 }
    );
  }
}
