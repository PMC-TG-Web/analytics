import { prisma } from '@/lib/prisma';

/**
 * Sync ScheduleAllocations to ActiveSchedule
 * When an allocation is saved/updated, we expand it to daily entries
 */

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  errors: string[];
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWorkingDaysInMonth(year: number, month: number): number {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  
  let workingDays = 0;
  for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay();
    // Count Monday-Friday (1-5)
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      workingDays++;
    }
  }
  return workingDays;
}

function getAllDatesInMonth(year: number, month: number): string[] {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  
  const dates: string[] = [];
  for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

/**
 * Sync a single allocation to activeSchedule
 * Expands monthly allocation to daily entries spread across working days
 */
export async function syncAllocationToActiveSchedule(
  scheduleId: string,
  period: string, // "2026-03"
  hours: number,
  sourceType: 'schedules' = 'schedules'
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, deleted: 0, errors: [] };

  try {
    // Get schedule info
    const schedule = await prisma.schedule.findUnique({
      where: { id: scheduleId },
      select: {
        jobKey: true,
        projectId: true,
      },
    });

    if (!schedule) {
      result.errors.push(`Schedule not found: ${scheduleId}`);
      return result;
    }

    // Parse period (YYYY-MM)
    const [yearStr, monthStr] = period.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    if (isNaN(year) || isNaN(month) || year < 2000 || month < 1 || month > 12) {
      result.errors.push(`Invalid period format: ${period}`);
      return result;
    }

    // Get all dates in the month
    const datesInMonth = getAllDatesInMonth(year, month);
    
    // Calculate daily hours (evenly distributed across all days)
    const dailyHours = datesInMonth.length > 0 ? hours / datesInMonth.length : 0;

    // Delete existing activeSchedule entries for this month
    const deleteResult = await prisma.activeSchedule.deleteMany({
      where: {
        jobKey: schedule.jobKey,
        scopeOfWork: 'Scheduled work',
        date: {
          gte: datesInMonth[0],
          lte: datesInMonth[datesInMonth.length - 1],
        },
        source: sourceType,
      },
    });

    result.deleted = deleteResult.count;

    // Create new daily entries
    for (const date of datesInMonth) {
      try {
        await prisma.activeSchedule.upsert({
          where: {
            jobKey_scopeOfWork_date: {
              jobKey: schedule.jobKey,
              scopeOfWork: 'Scheduled work',
              date,
            },
          },
          create: {
            jobKey: schedule.jobKey,
            projectId: schedule.projectId,
            scopeOfWork: 'Scheduled work',
            date,
            hours: dailyHours,
            source: sourceType,
          },
          update: {
            hours: dailyHours,
            source: sourceType,
          },
        });
        result.created++;
      } catch (error) {
        result.errors.push(`Failed to sync ${date}: ${String(error)}`);
      }
    }

    return result;
  } catch (error) {
    result.errors.push(`Sync failed: ${String(error)}`);
    return result;
  }
}

/**
 * Sync all allocations for a schedule to activeSchedule
 */
export async function syncScheduleToActiveSchedule(
  scheduleId: string,
  sourceType: 'schedules' = 'schedules'
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, deleted: 0, errors: [] };

  try {
    // Get all allocations for this schedule
    const allocations = await prisma.scheduleAllocation.findMany({
      where: { scheduleId, periodType: 'month' },
    });

    // Sync each allocation
    for (const alloc of allocations) {
      const syncResult = await syncAllocationToActiveSchedule(
        scheduleId,
        alloc.period,
        alloc.hours,
        sourceType
      );
      result.created += syncResult.created;
      result.updated += syncResult.updated;
      result.deleted += syncResult.deleted;
      result.errors.push(...syncResult.errors);
    }

    return result;
  } catch (error) {
    result.errors.push(`Failed to sync schedule: ${String(error)}`);
    return result;
  }
}

/**
 * Delete activeSchedule entries for an allocation
 */
export async function deleteAllocationFromActiveSchedule(
  scheduleId: string,
  period: string
): Promise<void> {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    select: { jobKey: true },
  });

  if (!schedule) return;

  const [yearStr, monthStr] = period.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  const datesInMonth = getAllDatesInMonth(year, month);

  if (datesInMonth.length > 0) {
    await prisma.activeSchedule.deleteMany({
      where: {
        jobKey: schedule.jobKey,
        scopeOfWork: 'Scheduled work',
        date: {
          gte: datesInMonth[0],
          lte: datesInMonth[datesInMonth.length - 1],
        },
      },
    });
  }
}

/**
 * Sync a ProjectScope to ActiveSchedule
 * Creates daily entries for each working day in the scope's date range
 */
export async function syncProjectScopeToActiveSchedule(
  scopeId: string
): Promise<SyncResult> {
  const result: SyncResult = {
    created: 0,
    updated: 0,
    deleted: 0,
    errors: [],
  };

  try {
    const scope = await prisma.projectScope.findUnique({
      where: { id: scopeId },
    });

    if (!scope) {
      result.errors.push(`Scope ${scopeId} not found`);
      return result;
    }

    if (!scope.startDate || !scope.endDate) {
      // No dates set, remove any existing activeSchedule entries for this scope
      await prisma.activeSchedule.deleteMany({
        where: {
          jobKey: scope.jobKey,
          scopeOfWork: scope.title,
          source: 'gantt',
        },
      });
      result.deleted++;
      return result;
    }

    const startDate = parseDateOnly(scope.startDate);
    const endDate = parseDateOnly(scope.endDate);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      result.errors.push(`Invalid dates for scope ${scopeId}`);
      return result;
    }

    // Calculate working days in range
    let workingDays = 0;
    const workingDates: Date[] = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        workingDays++;
        workingDates.push(new Date(d));
      }
    }

    if (workingDays === 0) {
      result.errors.push(`No working days in scope ${scopeId} date range`);
      return result;
    }

    // Calculate hours per day
    const totalHours = scope.hours || 0;
    const manpower = scope.manpower || 0;
    const hoursPerDay = manpower > 0 ? manpower * 10 : totalHours / workingDays;

    const existingAssignments = await prisma.activeSchedule.findMany({
      where: {
        jobKey: scope.jobKey,
        scopeOfWork: scope.title,
        source: 'gantt',
      },
      select: {
        date: true,
        foreman: true,
      },
    });

    const foremanByDate = new Map(
      existingAssignments
        .filter((entry) => Boolean(entry.foreman))
        .map((entry) => [entry.date, entry.foreman as string])
    );
    const defaultForeman =
      existingAssignments.find((entry) => Boolean(entry.foreman))?.foreman ?? null;

    // Delete existing entries for this scope
    await prisma.activeSchedule.deleteMany({
      where: {
        jobKey: scope.jobKey,
        scopeOfWork: scope.title,
        source: 'gantt',
      },
    });

    // Create new entries for each working day
    for (const date of workingDates) {
      const dateStr = formatDateOnly(date);
      
      await prisma.activeSchedule.upsert({
        where: {
          jobKey_scopeOfWork_date: {
            jobKey: scope.jobKey,
            scopeOfWork: scope.title,
            date: dateStr,
          },
        },
        create: {
          jobKey: scope.jobKey,
          scopeOfWork: scope.title,
          date: dateStr,
          hours: hoursPerDay,
          manpower: manpower > 0 ? Math.round(manpower) : null,
          foreman: foremanByDate.get(dateStr) ?? defaultForeman,
          source: 'gantt',
        },
        update: {
          hours: hoursPerDay,
          manpower: manpower > 0 ? Math.round(manpower) : null,
          source: 'gantt',
        },
      });
      result.created++;
    }

    return result;
  } catch (error) {
    result.errors.push(`Failed to sync scope: ${String(error)}`);
    return result;
  }
}

/**
 * Delete activeSchedule entries for a ProjectScope
 */
export async function deleteProjectScopeFromActiveSchedule(
  scopeId: string
): Promise<void> {
  const scope = await prisma.projectScope.findUnique({
    where: { id: scopeId },
    select: { jobKey: true, title: true },
  });

  if (!scope) return;

  await prisma.activeSchedule.deleteMany({
    where: {
      jobKey: scope.jobKey,
      scopeOfWork: scope.title,
      source: 'gantt',
    },
  });
}
