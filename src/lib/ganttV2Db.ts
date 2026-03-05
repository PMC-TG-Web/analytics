import { prisma } from '@/lib/prisma';

export type GanttV2ProjectRow = {
  id: string;
  projectName: string;
  customer: string | null;
  projectNumber: string | null;
  status: string | null;
  scopeCount: number;
  scopedHours: number;
  startDate: string | null;
  endDate: string | null;
};

export type GanttV2ScopeRow = {
  id: string;
  projectId: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  totalHours: number;
  crewSize: number | null;
  notes: string | null;
  scheduledHours: number;
  remainingHours: number;
};

export type GanttV2LongTermProjectRow = {
  projectId: string;
  projectName: string;
  customer: string | null;
  projectNumber: string | null;
  status: string | null;
  totalScopeHours: number;
  totalScheduledHours: number;
  totalRemainingHours: number;
  unscheduledHours: number;
  byMonth: Record<string, number>;
};

export type GanttV2LongTermSummary = {
  months: string[];
  projects: GanttV2LongTermProjectRow[];
};

export type GanttV2ProjectWithScopes = {
  id: string;
  projectName: string;
  customer: string | null;
  projectNumber: string | null;
  status: string | null;
  scopeCount: number;
  scopedHours: number;
  startDate: string | null;
  endDate: string | null;
  scopes: GanttV2ScopeRow[];
  scheduleAllocations: Array<{
    period: string; // "2026-03" for months
    hours: number;
  }>;
};

const formatMonthKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const parseDate = (value: Date | string | null): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const isWeekday = (date: Date) => {
  const day = date.getDay();
  return day >= 1 && day <= 5;
};

const getWorkdayCountPerMonth = (start: Date, end: Date): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    if (!isWeekday(cursor)) continue;
    const key = formatMonthKey(cursor);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
};

export async function ensureGanttV2Schema(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS gantt_v2_projects (
      id TEXT PRIMARY KEY,
      project_name TEXT NOT NULL,
      customer TEXT,
      project_number TEXT,
      status TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS gantt_v2_scopes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      start_date DATE,
      end_date DATE,
      total_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
      crew_size DOUBLE PRECISION,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_gantt_v2_project
        FOREIGN KEY(project_id)
          REFERENCES gantt_v2_projects(id)
          ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS gantt_v2_schedule_entries (
      id TEXT PRIMARY KEY,
      scope_id TEXT NOT NULL,
      work_date DATE NOT NULL,
      scheduled_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_gantt_v2_scope
        FOREIGN KEY(scope_id)
          REFERENCES gantt_v2_scopes(id)
          ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_gantt_v2_scopes_project_id ON gantt_v2_scopes(project_id);
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_gantt_v2_schedule_scope_id ON gantt_v2_schedule_entries(scope_id);
  `);
}

export async function getGanttV2Projects(): Promise<GanttV2ProjectRow[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    project_name: string;
    customer: string | null;
    project_number: string | null;
    status: string | null;
    scope_count: number;
    scoped_hours: number;
    start_date: Date | null;
    end_date: Date | null;
  }>>(`
    SELECT
      p.id,
      p.project_name,
      p.customer,
      p.project_number,
      p.status,
      COUNT(s.id)::int AS scope_count,
      COALESCE(SUM(s.total_hours), 0)::float8 AS scoped_hours,
      MIN(s.start_date) AS start_date,
      MAX(s.end_date) AS end_date
    FROM gantt_v2_projects p
    LEFT JOIN gantt_v2_scopes s ON s.project_id = p.id
    WHERE p.status = 'In Progress'
    GROUP BY p.id, p.project_name, p.customer, p.project_number, p.status
    ORDER BY p.created_at DESC;
  `);

  return rows.map((row) => ({
    id: row.id,
    projectName: row.project_name,
    customer: row.customer,
    projectNumber: row.project_number,
    status: row.status,
    scopeCount: Number(row.scope_count || 0),
    scopedHours: Number(row.scoped_hours || 0),
    startDate: row.start_date ? row.start_date.toISOString().split('T')[0] : null,
    endDate: row.end_date ? row.end_date.toISOString().split('T')[0] : null,
  }));
}

export async function getGanttV2ProjectsWithScopes(): Promise<GanttV2ProjectWithScopes[]> {
  // First get all projects with summary info
  const projects = await getGanttV2Projects();
  
  // For each project, fetch its scopes and schedule allocations
  const projectsWithScopes: GanttV2ProjectWithScopes[] = await Promise.all(
    projects.map(async (project) => {
      const scopes = await getGanttV2Scopes(project.id);
      
      const scheduleOrFilters: Array<{
        projectId?: string;
        projectNumber?: string;
        projectName?: string;
      }> = [{ projectId: project.id }];

      if (project.projectNumber) {
        scheduleOrFilters.push({ projectNumber: project.projectNumber });
      }
      if (project.projectName) {
        scheduleOrFilters.push({ projectName: project.projectName });
      }

      const schedules = await prisma.schedule.findMany({
        where: { OR: scheduleOrFilters },
        include: {
          allocationsList: {
            where: { periodType: 'month' },
            select: { period: true, hours: true },
          },
        },
      });

      const allocationsByPeriod = new Map<string, number>();
      for (const schedule of schedules) {
        for (const allocation of schedule.allocationsList) {
          allocationsByPeriod.set(
            allocation.period,
            (allocationsByPeriod.get(allocation.period) || 0) + Number(allocation.hours || 0)
          );
        }
      }

      const scheduleAllocations = Array.from(allocationsByPeriod.entries())
        .map(([period, hours]) => ({ period, hours }))
        .sort((a, b) => a.period.localeCompare(b.period));
      
      return {
        ...project,
        scopes,
        scheduleAllocations,
      };
    })
  );

  return projectsWithScopes;
}

export async function getGanttV2Scopes(projectId: string): Promise<GanttV2ScopeRow[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    project_id: string;
    title: string;
    start_date: Date | null;
    end_date: Date | null;
    total_hours: number;
    crew_size: number | null;
    notes: string | null;
    scheduled_hours: number;
  }>>(
    `
      SELECT
        s.id,
        s.project_id,
        s.title,
        s.start_date,
        s.end_date,
        s.total_hours,
        s.crew_size,
        s.notes,
        COALESCE(SUM(e.scheduled_hours), 0)::float8 AS scheduled_hours
      FROM gantt_v2_scopes s
      LEFT JOIN gantt_v2_schedule_entries e ON e.scope_id = s.id
      WHERE s.project_id = $1
      GROUP BY s.id
      ORDER BY s.created_at ASC;
    `,
    projectId
  );

  return rows.map((row) => {
    const totalHours = Number(row.total_hours || 0);
    const scheduledHours = Number(row.scheduled_hours || 0);
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      startDate: row.start_date ? row.start_date.toISOString().split('T')[0] : null,
      endDate: row.end_date ? row.end_date.toISOString().split('T')[0] : null,
      totalHours,
      crewSize: row.crew_size === null ? null : Number(row.crew_size),
      notes: row.notes,
      scheduledHours,
      remainingHours: Math.max(totalHours - scheduledHours, 0),
    };
  });
}

export async function getGanttV2LongTermSummary(startMonth?: string, months = 15): Promise<GanttV2LongTermSummary> {
  const base = startMonth && /^\d{4}-\d{2}$/.test(startMonth)
    ? new Date(`${startMonth}-01T00:00:00`)
    : new Date();
  base.setDate(1);
  base.setHours(0, 0, 0, 0);

  const monthKeys: string[] = [];
  for (let i = 0; i < months; i++) {
    monthKeys.push(formatMonthKey(new Date(base.getFullYear(), base.getMonth() + i, 1)));
  }

  const rows = await prisma.$queryRawUnsafe<Array<{
    project_id: string;
    project_name: string;
    customer: string | null;
    project_number: string | null;
    status: string | null;
    scope_id: string;
    total_hours: number;
    start_date: Date | null;
    end_date: Date | null;
    scheduled_hours: number;
  }>>(`
    SELECT
      p.id AS project_id,
      p.project_name,
      p.customer,
      p.project_number,
      p.status,
      s.id AS scope_id,
      s.total_hours,
      s.start_date,
      s.end_date,
      COALESCE(SUM(e.scheduled_hours), 0)::float8 AS scheduled_hours
    FROM gantt_v2_projects p
    JOIN gantt_v2_scopes s ON s.project_id = p.id
    LEFT JOIN gantt_v2_schedule_entries e ON e.scope_id = s.id
    WHERE p.status = 'In Progress'
    GROUP BY p.id, p.project_name, p.customer, p.project_number, p.status, s.id
    ORDER BY p.project_name ASC;
  `);

  const projectMap = new Map<string, GanttV2LongTermProjectRow>();

  for (const row of rows) {
    if (!projectMap.has(row.project_id)) {
      projectMap.set(row.project_id, {
        projectId: row.project_id,
        projectName: row.project_name,
        customer: row.customer,
        projectNumber: row.project_number,
        status: row.status,
        totalScopeHours: 0,
        totalScheduledHours: 0,
        totalRemainingHours: 0,
        unscheduledHours: 0,
        byMonth: Object.fromEntries(monthKeys.map((key) => [key, 0])),
      });
    }

    const project = projectMap.get(row.project_id)!;
    const totalHours = Number(row.total_hours || 0);
    const scheduledHours = Number(row.scheduled_hours || 0);
    const remainingHours = Math.max(totalHours - scheduledHours, 0);

    project.totalScopeHours += totalHours;
    project.totalScheduledHours += scheduledHours;
    project.totalRemainingHours += remainingHours;

    const start = parseDate(row.start_date);
    const end = parseDate(row.end_date);

    if (!start || !end || end < start || totalHours <= 0) {
      project.unscheduledHours += totalHours;
      continue;
    }

    const workdaysByMonth = getWorkdayCountPerMonth(start, end);
    const totalWorkdays = Array.from(workdaysByMonth.values()).reduce((sum, count) => sum + count, 0);
    if (totalWorkdays <= 0) {
      project.unscheduledHours += totalHours;
      continue;
    }

    let distributed = 0;
    const keysInRange = Array.from(workdaysByMonth.keys()).filter((key) => monthKeys.includes(key));
    keysInRange.forEach((key, index) => {
      const share = (totalHours * (workdaysByMonth.get(key) || 0)) / totalWorkdays;
      const value = index === keysInRange.length - 1 ? totalHours - distributed : share;
      distributed += value;
      project.byMonth[key] = (project.byMonth[key] || 0) + value;
    });
  }

  return {
    months: monthKeys,
    projects: Array.from(projectMap.values()),
  };
}

/**
 * Sync activeSchedule hours to gantt_v2_schedule_entries for a given scope
 * This aggregates daily hours from activeSchedule and populates gantt_v2_schedule_entries
 */
export async function syncActiveScheduleToScope(scopeId: string, jobKey: string): Promise<number> {
  // Find activeSchedule entries for this jobKey and aggregate by date
  // Only sync entries from Gantt (source: 'gantt'), exclude custom scopes (source: 'wip-page')
  const activeScheduleHours = await prisma.activeSchedule.findMany({
    where: {
      jobKey,
      OR: [{ source: 'gantt' }, { source: null }], // Include gantt entries and entries without source
    },
  });

  if (!activeScheduleHours || activeScheduleHours.length === 0) {
    // No active schedule entries, clear any existing entries for this scope
    await prisma.$executeRawUnsafe(`
      DELETE FROM gantt_v2_schedule_entries
      WHERE scope_id = $1
    `, scopeId);
    return 0;
  }

  // Aggregate by date
  const hoursByDate = new Map<string, number>();
  for (const entry of activeScheduleHours) {
    const date = entry.date; // Already in YYYY-MM-DD format
    const hours = Number(entry.hours || 0);
    hoursByDate.set(date, (hoursByDate.get(date) || 0) + hours);
  }

  // Clear existing entries for this scope
  await prisma.$executeRawUnsafe(`
    DELETE FROM gantt_v2_schedule_entries
    WHERE scope_id = $1
  `, scopeId);

  // Insert new entries from activeSchedule data
  let totalHours = 0;
  for (const [workDate, hours] of hoursByDate.entries()) {
    totalHours += hours;
    const id = crypto.randomUUID();
    
    await prisma.$executeRawUnsafe(`
      INSERT INTO gantt_v2_schedule_entries (id, scope_id, work_date, scheduled_hours)
      VALUES ($1, $2, $3, $4)
    `, id, scopeId, workDate, hours);
  }

  return totalHours;
}
