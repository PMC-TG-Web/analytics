/** Total-column values for saved KPI card rows. Monthly percentages cannot be
 * added or averaged into a period rate, so a percentage row has a total only
 * when its card supplies the weights; otherwise the total is omitted.
 */
const parsePercent = (value: unknown) => parseFloat(String(value ?? '').replace('%', '').trim());
const parseWeight = (value: unknown) => parseFloat(String(value ?? '').replace(/[$,]/g, '').trim());
const parseAmount = (value: unknown) => parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));

/** Uses every saved year, so a year with no entries is not mistaken for amounts. */
export function isKpiPercentageRow(kpi: string | null | undefined, values: readonly unknown[] | null | undefined): boolean {
  return String(kpi ?? '').includes('%') || (values ?? []).some(value => String(value ?? '').includes('%'));
}

export function sumKpiCardValues(values: readonly unknown[]): number {
  return values.reduce<number>((sum, value) => {
    const amount = parseAmount(value);
    return sum + (Number.isNaN(amount) ? 0 : amount);
  }, 0);
}

/** Null when no month has both a percentage and a positive weight. */
export function weightedKpiPercentage(values: readonly unknown[], weights: readonly unknown[] | null | undefined): number | null {
  if (!weights) return null;
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    const percent = parsePercent(value);
    const weight = parseWeight(weights[index]);
    if (Number.isNaN(percent) || Number.isNaN(weight) || weight <= 0) return;
    numerator += (percent / 100) * weight;
    denominator += weight;
  });
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}
