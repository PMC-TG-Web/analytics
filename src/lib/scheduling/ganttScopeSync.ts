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
        source: "gantt",
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

  const workingDays: Date[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      workingDays.push(new Date(d));
    }
  }

  if (workingDays.length === 0) {
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
        source: "gantt",
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

  const hoursPerDay = crewSize && crewSize > 0 ? crewSize * 10 : totalHours / workingDays.length;

  const existingAssignments = await prisma.activeSchedule.findMany({
    where: {
      jobKey,
      scopeOfWork: title,
      source: "gantt",
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
      source: "gantt",
    },
  });

  if (scopeId) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM gantt_v2_schedule_entries WHERE scope_id = $1`,
      scopeId
    );
  }

  for (const date of workingDays) {
    const dateStr = formatDateOnly(date);

    await reconcileDailyAssignment({
      jobKey,
      scopeOfWork: title,
      targetDateKey: dateStr,
      targetForemanId: foremanByDate.get(dateStr) ?? defaultForeman,
      hours: hoursPerDay,
      fallbackSource: "gantt",
      enforceScopeHourCap: true,
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
        hoursPerDay
      );
    }
  }
}
