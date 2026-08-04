export const KPI_CARD_START_YEAR = 2026;
export const KPI_CARD_END_YEAR = 2027;
export const KPI_CARD_MONTHS_PER_YEAR = 12;

export const KPI_CARD_YEARS = Array.from(
  { length: KPI_CARD_END_YEAR - KPI_CARD_START_YEAR + 1 },
  (_, index) => KPI_CARD_START_YEAR + index,
);

export const KPI_CARD_VALUE_COUNT = KPI_CARD_YEARS.length * KPI_CARD_MONTHS_PER_YEAR;

export function getKpiCardValueIndex(year: string | number, month: number): number | null {
  const numericYear = Number(year);
  if (!Number.isInteger(numericYear) || !Number.isInteger(month)) return null;
  if (numericYear < KPI_CARD_START_YEAR || numericYear > KPI_CARD_END_YEAR) return null;
  if (month < 1 || month > KPI_CARD_MONTHS_PER_YEAR) return null;

  return (numericYear - KPI_CARD_START_YEAR) * KPI_CARD_MONTHS_PER_YEAR + (month - 1);
}

export function getKpiCardValue(
  values: readonly string[] | undefined,
  year: string | number,
  month: number,
): string {
  const index = getKpiCardValueIndex(year, month);
  return index === null ? "" : String(values?.[index] ?? "");
}

export function getKpiCardYearValues(
  values: readonly string[] | undefined,
  year: string | number,
): string[] {
  return Array.from(
    { length: KPI_CARD_MONTHS_PER_YEAR },
    (_, index) => getKpiCardValue(values, year, index + 1),
  );
}

export function normalizeKpiCardValues(values: readonly string[] | undefined): string[] {
  return Array.from(
    { length: KPI_CARD_VALUE_COUNT },
    (_, index) => String(values?.[index] ?? ""),
  );
}
