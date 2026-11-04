export const DASHBOARD_TIME_ZONE = 'America/New_York';

type ProjectDates = { dateCreated?: unknown; dateUpdated?: unknown };
const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DASHBOARD_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

function parseDate(value: unknown): { time: number; value: string } | null {
  if (!(value instanceof Date) && (typeof value !== 'string' || !value.trim())) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const iso = date.toISOString();
  if (typeof value === 'string' && calendarDatePattern.test(value)) {
    return iso.slice(0, 10) === value ? { time: date.getTime(), value } : null;
  }
  return { time: date.getTime(), value: iso };
}

function latestDate(...values: unknown[]): string | null {
  let latest: ReturnType<typeof parseDate> = null;
  for (const value of values) {
    const parsed = parseDate(value);
    if (parsed && (!latest || parsed.time > latest.time)) latest = parsed;
  }
  return latest?.value ?? null;
}

export function estimatingDashboardSourceDates(payload: unknown, proposalUpdatedAt?: unknown) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown> : {};
  return {
    dateCreated: parseDate(source.created_on)?.value ?? parseDate(source.created_at)?.value ?? null,
    dateUpdated: latestDate(source.updated_at, source.updated_on, proposalUpdatedAt),
  };
}

export function dashboardProjectDateKey(project: ProjectDates): string | null {
  const date = latestDate(project.dateUpdated, project.dateCreated);
  if (!date) return null;
  // A source calendar date is already a day, not midnight UTC to shift to yesterday.
  if (calendarDatePattern.test(date)) return date;
  const parts = dateFormatter.formatToParts(new Date(date));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function dashboardDateRangeError(start: string, end: string): string | null {
  for (const date of [start, end]) {
    if (date && (!calendarDatePattern.test(date) || !parseDate(date))) {
      return 'Enter a valid From and To date.';
    }
  }
  return start && end && start > end ? 'From date must be on or before To date.' : null;
}

export function filterDashboardProjectDates<T extends ProjectDates>(projects: T[], start: string, end: string): T[] {
  const error = dashboardDateRangeError(start, end);
  if (error) throw new Error(error);
  if (!start && !end) return projects;
  return projects.filter(project => {
    const date = dashboardProjectDateKey(project);
    return date !== null && (!start || date >= start) && (!end || date <= end);
  });
}
