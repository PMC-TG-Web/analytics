/** Sales % of Goal ($) on the KPI page: year-to-date Actual Sales against the
 * year-to-date Goal, shown in the last completed month so it moves forward
 * automatically. Other months keep the values recorded on Manage.
 */
const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function previousKpiMonth(month: string): string {
  const match = MONTH_KEY.exec(month);
  if (!match) throw new Error('Invalid KPI month.');
  const year = Number(match[1]), index = Number(match[2]);
  return index === 1 ? `${year - 1}-12` : `${year}-${String(index - 1).padStart(2, '0')}`;
}

/** Percent over (positive) or under (negative) goal for January through the given month.
 * `goals` holds that year's twelve monthly goals. Null when any of those goals is missing.
 */
export function salesPercentOfGoal(sales: Record<string, number>, goals: readonly unknown[], throughMonth: string): number | null {
  const match = MONTH_KEY.exec(throughMonth);
  if (!match) throw new Error('Invalid KPI month.');
  let actual = 0, goal = 0;
  for (let index = 1; index <= Number(match[2]); index++) {
    const text = String(goals[index - 1] ?? '').replace(/[$,\s]/g, '');
    const monthGoal = Number(text);
    if (!text || !Number.isFinite(monthGoal) || monthGoal < 0) return null;
    goal += monthGoal;
    const monthSales = sales[`${match[1]}-${String(index).padStart(2, '0')}`] ?? 0;
    if (!Number.isFinite(monthSales)) return null;
    actual += monthSales;
  }
  return goal > 0 ? (actual / goal - 1) * 100 : null;
}

/** Whole percent with an explicit sign, matching the saved entries (for example +21%). */
export function formatSignedPercent(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded === 0 ? 0 : rounded}%`;
}
