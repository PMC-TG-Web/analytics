import { prisma } from "@/lib/prisma";
import { reconcileDailyAssignment } from "@/lib/scheduling/dailyAssignment";

type SyncGanttScopeParams = {
  scopeId?: string;
  projectId: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  totalHours: number;
  crewSize: number | null;
};

type ScopeTask = {
  name?: string | null;
  startDate?: string | null;
  days?: number | null;
  manpower?: number | null;
};

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toPositiveNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

function toPositiveWholeDays(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric);
}

function isDateKey(value: unknown): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function getNextWorkingDate(date: Date, paidHolidaySet: Set<string>): Date {
  const next = new Date(date);
  while (true) {
    const key = formatDateOnly(next);
    const day = next.getDay();
    if (day >= 1 && day <= 5 && !paidHolidaySet.has(key)) {
      return next;
    }
    next.setDate(next.getDate() + 1);
  }
}

function buildTaskBasedDailyHours(
  tasks: ScopeTask[],
  paidHolidaySet: Set<string>
): Array<{ date: string; hours: number }> {
  const byDate = new Map<string, number>();

  tasks.forEach((task) => {
    const startDate = String(task?.startDate || "").trim();
    if (!isDateKey(startDate)) return;

    const days = toPositiveWholeDays(task?.days);
    const manpower = toPositiveNumber(task?.manpower);
    if (!days || !manpower) return;

    const perDayHours = manpower * 10;
    let cursor = parseDateOnly(startDate);

    for (let i = 0; i < days; i += 1) {
      const workingDate = getNextWorkingDate(cursor, paidHolidaySet);
      const dateKey = formatDateOnly(workingDate);
      byDate.set(dateKey, (byDate.get(dateKey) || 0) + perDayHours);

      cursor = new Date(workingDate);
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  return Array.from(byDate.entries())
    .map(([date, hours]) => ({ date, hours }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeDistributionHours(
  distribution: Array<{ date: string; hours: number }>,
  targetTotalHours: number
): Array<{ date: string; hours: number }> {
  if (!Array.isArray(distribution) || distribution.length === 0) return [];

  const safeTarget = Number(targetTotalHours || 0);
  if (!Number.isFinite(safeTarget) || safeTarget <= 0) return distribution;

  const currentTotal = distribution.reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
  if (!Number.isFinite(currentTotal) || currentTotal <= 0) return distribution;

  const delta = Math.abs(currentTotal - safeTarget);
  if (delta < 0.0001) return distribution;

  const scale = safeTarget / currentTotal;
  const scaled = distribution.map((entry) => ({
    date: entry.date,
    hours: Number(entry.hours || 0) * scale,
  }));

  // Keep floating-point drift from accumulating by correcting the last day.
  const scaledTotal = scaled.reduce((sum, entry) => sum + entry.hours, 0);
  const correction = safeTarget - scaledTotal;
  if (scaled.length > 0 && Math.abs(correction) >= 0.0001) {
    scaled[scaled.length - 1].hours += correction;
  }

  return scaled;
}

async function getPaidHolidaySet(startDate: string, endDate: string): Promise<Set<string>> {
  const rows = await prisma.holiday.findMany({
    where: {
      isPaid: true,
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: { date: true },
  });
  return new Set(rows.map((row) => row.date));
}

export async function syncGanttScopeToActiveSchedule(params: SyncGanttScopeParams): Promise<void> {
  const { scopeId, projectId, title, startDate, endDate, totalHours, crewSize } = params;

  const project = await prisma.$queryRawUnsafe<
    Array<{ customer: string | null; project_number: string | null; project_name: string }>
  >(
    `SELECT customer, project_number, project_name FROM gantt_v2_projects WHERE id = $1 LIMIT 1`,
    projectId
  );

  if (!project || project.length === 0) {
    return;
  }

  const { customer, project_number, project_name } = project[0];
  const jobKey = `${customer || ""}~${project_number || ""}~${project_name || ""}`;

  let schedulingMode: "contiguous" | "specific-days" = "contiguous";
  let selectedDays: Array<{ date: string; hours: number; foreman: string | null }> = [];
  let scopeTasks: ScopeTask[] = [];

  if (scopeId) {
    const scopeRows = await prisma.$queryRawUnsafe<Array<{
      schedulingMode: string | null;
      selectedDays: unknown;
      tasks: unknown;
    }>>(
      `
        SELECT "schedulingMode", "selectedDays", "tasks"
        FROM "ProjectScope"
        WHERE "jobKey" = $1 AND "title" = $2
        ORDER BY "updatedAt" DESC
        LIMIT 1
      `,
      jobKey,
      title
    );

    const scopeMeta = scopeRows[0];
    if (scopeMeta?.schedulingMode === "specific-days") {
      schedulingMode = "specific-days";
      const raw = Array.isArray(scopeMeta.selectedDays)
        ? (scopeMeta.selectedDays as Array<{ date?: unknown; hours?: unknown; foreman?: unknown }>)
        : [];
      selectedDays = raw
        .map((entry) => ({
          date: String(entry?.date || "").trim(),
          hours: Number(entry?.hours || 0),
          foreman: entry?.foreman ? String(entry.foreman) : null,
        }))
        .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && Number.isFinite(entry.hours) && entry.hours > 0);
    }

    scopeTasks = Array.isArray(scopeMeta?.tasks)
      ? (scopeMeta.tasks as ScopeTask[])
      : [];
  }

  if (schedulingMode === "specific-days") {
    const paidHolidays = await prisma.holiday.findMany({
      where: {
        isPaid: true,
        date: { in: selectedDays.map((entry) => entry.date) },
      },
      select: { date: true },
    });
    const paidHolidaySet = new Set(paidHolidays.map((h) => h.date));

    const existingAssignments = await prisma.activeSchedule.findMany({
      where: {
        jobKey,
        scopeOfWork: title,
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
    const defaultForeman = existingAssignments.find((entry) => Boolean(entry.foreman))?.foreman ?? null;

    await prisma.activeSchedule.deleteMany({
      where: {
        jobKey,
        scopeOfWork: title,
      },
    });

    if (scopeId) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM gantt_v2_schedule_entries WHERE scope_id = $1`,
        scopeId
      );
    }

    for (const entry of selectedDays) {
      const [year, month, day] = entry.date.split('-').map(Number);
      const weekday = new Date(year, month - 1, day).getDay();
      if (weekday === 0 || weekday === 6) {
        continue;
      }
      if (paidHolidaySet.has(entry.date)) {
        continue;
      }

      await reconcileDailyAssignment({
        jobKey,
        scopeOfWork: title,
        targetDateKey: entry.date,
        targetForemanId: entry.foreman ?? foremanByDate.get(entry.date) ?? defaultForeman,
        hours: entry.hours,
        fallbackSource: "gantt",
        enforceScopeHourCap: false,
      });

      await prisma.activeSchedule.updateMany({
        where: {
          jobKey,
          scopeOfWork: title,
          date: entry.date,
          source: "gantt",
        },
        data: {
          manpower: crewSize && crewSize > 0 ? Math.round(crewSize) : null,
        },
      });

      if (scopeId) {
        await prisma.$executeRawUnsafe(
          `
            INSERT INTO gantt_v2_schedule_entries (id, scope_id, work_date, scheduled_hours)
            VALUES ($1, $2, $3::date, $4)
          `,
          crypto.randomUUID(),
          scopeId,
          entry.date,
          entry.hours
        );
      }
    }

    return;
  }

  if (!startDate || !endDate || totalHours <= 0) {
    console.warn('[GANTT-SCOPE-SYNC] Clearing active schedule for unscheduled scope', {
      projectId,
      jobKey,
      title,
      startDate,
      endDate,
      totalHours,
    });
    await prisma.activeSchedule.deleteMany({
      where: {
        jobKey,
        scopeOfWork: title,
      },
    });

    if (scopeId) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM gantt_v2_schedule_entries WHERE scope_id = $1`,
        scopeId
      );
    }

    return;
  }

  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  const paidHolidaySet = await getPaidHolidaySet(startDate, endDate);

  const taskBasedDays = buildTaskBasedDailyHours(scopeTasks, paidHolidaySet);
  const hasTaskBasedDistribution = taskBasedDays.length > 0;

  const workingDays: Date[] = [];
  if (!hasTaskBasedDistribution) {
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      const dateKey = formatDateOnly(d);
      if (dayOfWeek >= 1 && dayOfWeek <= 5 && !paidHolidaySet.has(dateKey)) {
        workingDays.push(new Date(d));
      }
    }
  }

  if (!hasTaskBasedDistribution && workingDays.length === 0) {
    console.warn('[GANTT-SCOPE-SYNC] Clearing active schedule for scope with zero working days', {
      projectId,
      jobKey,
      title,
      startDate,
      endDate,
    });
    await prisma.activeSchedule.deleteMany({
      where: {
        jobKey,
        scopeOfWork: title,
      },
    });

    if (scopeId) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM gantt_v2_schedule_entries WHERE scope_id = $1`,
        scopeId
      );
    }

    return;
  }

  // Use explicit task distribution when dated task inputs are complete; otherwise
  // fall back to even distribution from the scope total across working days.
  const hoursPerDay = hasTaskBasedDistribution ? 0 : totalHours / workingDays.length;

  const existingAssignments = await prisma.activeSchedule.findMany({
    where: {
      jobKey,
      scopeOfWork: title,
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
  const defaultForeman = existingAssignments.find((entry) => Boolean(entry.foreman))?.foreman ?? null;

  console.warn('[GANTT-SCOPE-SYNC] Replacing gantt active schedule rows', {
    projectId,
    jobKey,
    title,
    workingDays: workingDays.length,
  });

  await prisma.activeSchedule.deleteMany({
    where: {
      jobKey,
      scopeOfWork: title,
    },
  });

  if (scopeId) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM gantt_v2_schedule_entries WHERE scope_id = $1`,
      scopeId
    );
  }

  const rawDistribution = hasTaskBasedDistribution
    ? taskBasedDays
    : workingDays.map((date) => ({ date: formatDateOnly(date), hours: hoursPerDay }));

  const distribution = normalizeDistributionHours(rawDistribution, totalHours);

  for (const entry of distribution) {
    const dateStr = entry.date;
    const scheduledHours = Number(entry.hours || 0);
    if (!Number.isFinite(scheduledHours) || scheduledHours <= 0) continue;

    await reconcileDailyAssignment({
      jobKey,
      scopeOfWork: title,
      targetDateKey: dateStr,
      targetForemanId: foremanByDate.get(dateStr) ?? defaultForeman,
      hours: scheduledHours,
      fallbackSource: "gantt",
      enforceScopeHourCap: false,
    });

    await prisma.activeSchedule.updateMany({
      where: {
        jobKey,
        scopeOfWork: title,
        date: dateStr,
        source: "gantt",
      },
      data: {
        manpower: crewSize && crewSize > 0 ? Math.round(crewSize) : null,
      },
    });

    if (scopeId) {
      await prisma.$executeRawUnsafe(
        `
          INSERT INTO gantt_v2_schedule_entries (id, scope_id, work_date, scheduled_hours)
          VALUES ($1, $2, $3::date, $4)
        `,
        crypto.randomUUID(),
        scopeId,
        dateStr,
        scheduledHours
      );
    }
  }
}
