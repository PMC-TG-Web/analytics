import { KPI_ESTIMATE_PROCESS_START, type EstimatePreviewReport } from './kpiEstimatePreview.ts';

export type EstimateMetric = 'sales' | 'hours';
export type EstimateAmount = { value: number; missing: number; calculated: boolean; pending: boolean; failed: boolean };
export function isCalculatedEstimateMonth(year: string, month: number) {
  return `${year}-${String(month).padStart(2, '0')}-01` >= KPI_ESTIMATE_PROCESS_START;
}

/** Saved history remains authoritative before the cutover. New months never
 * fall back to manual figures or an older population during loading/errors. */
export function resolvePublishedEstimateMonth(year: string, month: number, metric: EstimateMetric, historicalValue: number, report: EstimatePreviewReport | null, error = ''): EstimateAmount {
  if (!isCalculatedEstimateMonth(year, month)) return { value: historicalValue, missing: 0, calculated: false, pending: false, failed: false };
  const row = report?.months[`${year}-${String(month).padStart(2, '0')}`];
  return { value: error || !report ? 0 : row?.[metric] ?? 0,
    missing: error || !report ? 0 : row?.[metric === 'sales' ? 'missingSales' : 'missingHours'] ?? 0,
    calculated: true, pending: !report && !error, failed: Boolean(error) };
}

export function totalEstimateAmounts(values: EstimateAmount[]): EstimateAmount {
  return values.reduce((sum, value) => ({ value: sum.value + value.value, missing: sum.missing + value.missing,
    calculated: sum.calculated || value.calculated, pending: sum.pending || value.pending, failed: sum.failed || value.failed }),
  { value: 0, missing: 0, calculated: false, pending: false, failed: false });
}
