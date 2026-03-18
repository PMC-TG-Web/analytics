import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type StoredTimeOffPayload = {
  startDate?: string;
  endDate?: string;
  type?: string;
  hours?: number;
  dates?: string[];
};

type StoredDayData = {
  dayNumber: number;
  hours: number;
  foreman?: string;
  employees?: string[];
};

type StoredWeekData = {
  weekNumber: number;
  days: StoredDayData[];
};

type StoredScheduleDoc = {
  jobKey: string;
  customer: string;
  projectNumber: string;
  projectName: string;
  month: string;
  weeks: StoredWeekData[];
  updatedAt?: string;
};

const DEFAULT_TIME_OFF_TYPE = 'Vacation';
const DEFAULT_TIME_OFF_HOURS = 10;

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function expandDateRange(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const dates: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    dates.push(toDateKey(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function normalizeTimeOffRecord(row: {
  id: string;
  employeeId: string;
  employeeName: string | null;
  dates: unknown;
  reason: string | null;
  status: string;
}) {
  const payload = (row.dates && typeof row.dates === 'object' && !Array.isArray(row.dates)
    ? (row.dates as StoredTimeOffPayload)
    : null);

  const explicitDates = Array.isArray(payload?.dates)
    ? payload.dates.filter((d): d is string => typeof d === 'string' && d.length > 0)
    : Array.isArray(row.dates)
      ? (row.dates as unknown[]).filter((d): d is string => typeof d === 'string' && d.length > 0)
      : [];

  const startDate =
    (typeof payload?.startDate === 'string' && payload.startDate) ||
    explicitDates[0] ||
    '';
  const endDate =
    (typeof payload?.endDate === 'string' && payload.endDate) ||
    explicitDates[explicitDates.length - 1] ||
    startDate;

  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    startDate,
    endDate,
    type: (payload?.type || DEFAULT_TIME_OFF_TYPE) as
      | 'Vacation'
      | 'Sick'
      | 'Personal'
      | 'Other'
      | 'Company timeoff',
    hours: Number(payload?.hours) > 0 ? Number(payload?.hours) : DEFAULT_TIME_OFF_HOURS,
    dates: explicitDates.length > 0 ? explicitDates : (startDate && endDate ? expandDateRange(startDate, endDate) : []),
    reason: row.reason || '',
    status: row.status || 'approved',
  };
}

async function ensureProjectScopeColumns() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ProjectScope"
      ADD COLUMN IF NOT EXISTS "schedulingMode" TEXT NOT NULL DEFAULT 'contiguous',
      ADD COLUMN IF NOT EXISTS "selectedDays" JSONB
  `);
}

async function ensureScheduleDataColumn() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Schedule"
      ADD COLUMN IF NOT EXISTS "scheduleData" JSONB
  `);
}

function isValidDayData(value: any): value is StoredDayData {
  return value && Number.isFinite(Number(value.dayNumber)) && Number.isFinite(Number(value.hours));
}

function normalizeScheduleDoc(value: any): StoredScheduleDoc | null {
  if (!value || typeof value !== 'object') return null;
  const month = typeof value.month === 'string' ? value.month : '';
  if (!month) return null;

  const weeks = Array.isArray(value.weeks)
    ? value.weeks
        .filter((week: any) => week && Number.isFinite(Number(week.weekNumber)))
        .map((week: any) => ({
          weekNumber: Number(week.weekNumber),
          days: Array.isArray(week.days)
            ? week.days
                .filter(isValidDayData)
                .map((day: any) => ({
                  dayNumber: Number(day.dayNumber),
                  hours: Number(day.hours),
                  foreman: typeof day.foreman === 'string' ? day.foreman : '',
                  employees: Array.isArray(day.employees)
                    ? day.employees.filter((employeeId: unknown): employeeId is string => typeof employeeId === 'string' && employeeId.length > 0)
                    : [],
                }))
            : [],
        }))
    : [];

  return {
    jobKey: typeof value.jobKey === 'string' ? value.jobKey : '',
    customer: typeof value.customer === 'string' ? value.customer : '',
    projectNumber: typeof value.projectNumber === 'string' ? value.projectNumber : '',
    projectName: typeof value.projectName === 'string' ? value.projectName : '',
    month,
    weeks,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
  };
}

async function getStoredScheduleData(jobKey: string): Promise<Record<string, StoredScheduleDoc>> {
  const rows = await prisma.$queryRaw<Array<{ scheduleData: unknown }>>`
    SELECT "scheduleData"
    FROM "Schedule"
    WHERE "jobKey" = ${jobKey}
    LIMIT 1
  `;

  const raw = rows[0]?.scheduleData;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const result: Record<string, StoredScheduleDoc> = {};
  for (const [month, doc] of Object.entries(raw as Record<string, unknown>)) {
    const normalized = normalizeScheduleDoc(doc);
    if (normalized) result[month] = normalized;
  }
  return result;
}

async function setStoredScheduleMonth(jobKey: string, doc: StoredScheduleDoc) {
  const existing = await getStoredScheduleData(jobKey);
  existing[doc.month] = { ...doc, updatedAt: new Date().toISOString() };
  await prisma.$executeRaw`
    UPDATE "Schedule"
    SET "scheduleData" = ${JSON.stringify(existing)}::jsonb
    WHERE "jobKey" = ${jobKey}
  `;
}

export async function GET(request: NextRequest) {
  try {
    await ensureProjectScopeColumns();
    await ensureScheduleDataColumn();
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action');
    const jobKey = searchParams.get('jobKey');
    const month = searchParams.get('month');

    if (!action && jobKey) {
      const stored = await getStoredScheduleData(jobKey);
      if (month) {
        const monthDoc = stored[month];
        if (!monthDoc) {
          return NextResponse.json({ success: false, error: 'Schedule not found' }, { status: 404 });
        }
        return NextResponse.json(monthDoc);
      }

      const currentMonth = toDateKey(new Date()).slice(0, 7);
      const fallbackDoc = stored[currentMonth] || Object.values(stored).sort((a, b) => b.month.localeCompare(a.month))[0];
      if (!fallbackDoc) {
        return NextResponse.json({ success: false, error: 'Schedule not found' }, { status: 404 });
      }

      return NextResponse.json(fallbackDoc);
    }

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
        data: timeOffRequests.map(normalizeTimeOffRecord),
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
          manpower: true,
          hours: true,
          description: true,
          tasks: true,
          schedulingMode: true,
          selectedDays: true,
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

    if (action === 'active-schedule' || action === 'activeSchedules') {
      // GET active schedule for date range
      const startDate = searchParams.get('startDate');
      const endDate = searchParams.get('endDate');

      const activeSchedules = await prisma.activeSchedule.findMany({
        where: {
          ...(startDate && endDate && {
            date: {
              gte: startDate,
              lte: endDate,
            },
          }),
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
        orderBy: { date: 'asc' },
      });

      // Parse jobKey to extract customer, projectNumber, projectName
      const enrichedSchedules = activeSchedules.map(schedule => {
        const parts = (schedule.jobKey || '').split('~');
        return {
          ...schedule,
          customer: parts[0] || '',
          projectNumber: parts[1] || '',
          projectName: parts[2] || '',
        };
      });

      return NextResponse.json({
        success: true,
        data: enrichedSchedules,
      });
    }

    // Default: return all critical data for schedule view
    const [employees, timeOffs, scopes, projects] = await Promise.all([
      prisma.employee.findMany({
        where: { isActive: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      prisma.timeOffRequest.findMany({
        select: {
          id: true,
          employeeId: true,
          employeeName: true,
          dates: true,
          reason: true,
          status: true,
        },
      }),
      prisma.projectScope.findMany({
        select: {
          id: true,
          jobKey: true,
          title: true,
          startDate: true,
          endDate: true,
          manpower: true,
          hours: true,
          description: true,
          tasks: true,
          schedulingMode: true,
          selectedDays: true,
        },
      }),
      prisma.project.findMany({
        where: {
          status: { notIn: ['Bid Submitted', 'Lost'] },
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
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        employees,
        timeOffs: timeOffs.map(normalizeTimeOffRecord),
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
    await ensureScheduleDataColumn();
    const body = await request.json();

    if (body?.scheduleData && body?.jobKey) {
      const scheduleData = normalizeScheduleDoc(body.scheduleData);
      if (!scheduleData) {
        return NextResponse.json(
          { success: false, error: 'Invalid scheduleData payload' },
          { status: 400 }
        );
      }

      const schedule = await prisma.schedule.upsert({
        where: { jobKey: body.jobKey },
        create: {
          jobKey: body.jobKey,
          customer: scheduleData.customer || null,
          projectNumber: scheduleData.projectNumber || null,
          projectName: scheduleData.projectName || null,
          status: 'In Progress',
        },
        update: {
          customer: scheduleData.customer || undefined,
          projectNumber: scheduleData.projectNumber || undefined,
          projectName: scheduleData.projectName || undefined,
        },
      });

      await setStoredScheduleMonth(schedule.jobKey, scheduleData);

      return NextResponse.json({
        success: true,
        message: 'Short-term schedule document saved successfully',
        data: scheduleData,
      });
    }

    const {
      jobKey,
      customer,
      projectNumber,
      projectName,
      month,
      hours,
      percent,
    } = body;

    if (!jobKey || !month) {
      return NextResponse.json(
        { success: false, error: 'jobKey and month are required' },
        { status: 400 }
      );
    }

    // Ensure Schedule exists
    const schedule = await prisma.schedule.upsert({
      where: { jobKey },
      create: {
        jobKey,
        customer,
        projectNumber,
        projectName,
        status: 'In Progress',
      },
      update: {},
    });

    // Create or update allocation for this month
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
        hours: hours || 0,
        percent: percent || 0,
      },
      update: {
        hours: hours || 0,
        percent: percent || 0,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Schedule allocation saved successfully',
      data: {
        scheduleId: schedule.id,
        allocation,
      },
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

    // Find the schedule and delete the allocation
    const schedule = await prisma.schedule.findUnique({
      where: { jobKey },
    });

    if (!schedule) {
      return NextResponse.json(
        { success: false, error: 'Schedule not found' },
        { status: 404 }
      );
    }

    await prisma.scheduleAllocation.delete({
      where: {
        scheduleId_period: {
          scheduleId: schedule.id,
          period: month,
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Schedule allocation deleted successfully',
    });
  } catch (error) {
    console.error('Failed to delete short-term schedule:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete schedule' },
      { status: 500 }
    );
  }
}
