/** Leadtimes by Month on the KPI page. The current month is calculated from the
 * same saved WIP hours as the Scheduled Hours row, so it moves to the new month
 * automatically. Other months keep the values recorded on Manage; history is
 * not rebuilt from today's WIP plans.
 */
export const KPI_LEADTIME_HOURS_PER_MONTH = 3938;

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export function kpiMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Saved WIP hours scheduled in the given month and every later month. */
export function wipHoursFromMonth(months: Record<string, number>, fromMonth: string): number {
  if (!MONTH_KEY.test(fromMonth)) throw new Error('Invalid leadtime month.');
  let total = 0;
  for (const [month, hours] of Object.entries(months)) {
    if (MONTH_KEY.test(month) && month >= fromMonth && Number.isFinite(hours)) total += hours;
  }
  return Math.round(total * 1e6) / 1e6;
}

/** Twelve values for one year: the calculated value in the current month, recorded values elsewhere. */
export function leadtimeYearValues<Recorded, Live>(
  year: string | number,
  currentMonth: string,
  recorded: readonly Recorded[],
  live: Live,
): (Recorded | Live)[] {
  return Array.from({ length: 12 }, (_, index) =>
    `${year}-${String(index + 1).padStart(2, '0')}` === currentMonth ? live : recorded[index]);
}
