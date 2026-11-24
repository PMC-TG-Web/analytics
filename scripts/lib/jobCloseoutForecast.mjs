import { cents } from '../../src/lib/jobCloseout.mjs';

export class ForecastChanged extends Error {}

export function forecastPlan(companyId, projectId, viewId, rows) {
  const editable = [],
    partial = [],
    seen = new Set();
  for (const row of rows) {
    if (String(row.project_id) !== projectId || String(row.company_id) !== companyId)
      throw Error('Forecast row returned for another project.');
    const amount = cents(row.budget_forecast?.amount);
    const entry = {
      lineId: row.id == null ? null : String(row.id),
      wbsId: row.wbs_code_id == null ? null : String(row.wbs_code_id),
      code: row.wbs_code?.flat_code || '',
      description: row.wbs_code?.description || row.cost_code || 'Unbudgeted row',
      strategy: row.budget_forecast.calculation_strategy,
      amount,
    };
    if (row.budgeted === false && !entry.lineId) {
      if (amount) partial.push(entry);
      continue;
    }
    if (
      row.budgeted !== true ||
      !/^\d+$/.test(entry.lineId) ||
      !/^\d+$/.test(entry.wbsId) ||
      !entry.strategy ||
      seen.has(entry.wbsId)
    )
      throw Error('Budget forecast row identity is incomplete or duplicated.');
    seen.add(entry.wbsId);
    if (amount) editable.push(entry);
  }
  return { companyId, projectId, viewId: String(viewId), editable, partial };
}

// Only send reviewed positive or negative balances. The API selects lump sum when given a fixed forecast.
export async function applyForecastPlan(approved, scope, readRows, writeRows, checkClaim) {
  if (!approved?.editable?.length || ['companyId', 'projectId', 'viewId'].some((k) => approved[k] !== scope[k]))
    throw new ForecastChanged('The approved forecast scope changed. Refresh and review again.');
  const read = async () => {
    const rows = await readRows();
    forecastPlan(scope.companyId, scope.projectId, scope.viewId, rows);
    return new Map(rows.filter((r) => r.budgeted).map((r) => [String(r.id), r]));
  };
  let live = await read();
  const pending = [];
  for (const item of approved.editable) {
    const row = live.get(item.lineId);
    if (!row || String(row.wbs_code_id) !== item.wbsId)
      throw new ForecastChanged('A reviewed budget row changed. Refresh and review again.');
    const forecast = row.budget_forecast;
    if (cents(forecast.amount) === 0) continue;
    if (cents(forecast.amount) !== item.amount || forecast.calculation_strategy !== item.strategy)
      throw new ForecastChanged(
        'The forecast for ' + (item.code || item.lineId) + ' changed. Refresh and review again.',
      );
    pending.push({ budget_line_item_id: item.lineId, wbs_code_id: item.wbsId, forecast_to_complete: 0 });
  }
  if (pending.length) {
    await checkClaim();
    await writeRows(pending);
    live = await read();
    for (const item of pending) {
      const row = live.get(item.budget_line_item_id);
      const forecast = row?.budget_forecast;
      if (
        String(row?.wbs_code_id) !== item.wbs_code_id ||
        forecast?.calculation_strategy !== 'lump sum' ||
        cents(forecast.amount) !== 0 ||
        cents(forecast.manual_amount) !== 0
      )
        throw Error('Procore has not verified the lump sum zero for every submitted row.');
    }
  }
  let manualZeros = 0;
  for (const item of approved.editable) {
    const row = live.get(item.lineId);
    if (String(row?.wbs_code_id) !== item.wbsId || cents(row?.budget_forecast?.amount) !== 0)
      throw new ForecastChanged('A forecast changed during verification. Refresh and review again.');
    if (row.budget_forecast.calculation_strategy === 'lump sum' && cents(row.budget_forecast.manual_amount) === 0)
      manualZeros++;
  }
  return { manualZeros, alreadyZero: approved.editable.length - manualZeros };
}
