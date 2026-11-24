import path from 'node:path';
import { createJiti } from 'jiti';
import { checkDirectCostLines } from '../../src/lib/jobCloseout.mjs';
import { applyForecastPlan, forecastPlan } from './jobCloseoutForecast.mjs';

async function withBudget(companyId, projectId, action) {
  const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('src') } });
  const api = await jiti.import(path.resolve('src/lib/procore.ts'));
  const secret = process.env.PROCORE_SYNC_SECRET || process.env.CRON_SECRET;
  if (!secret || !/^\d+$/.test(projectId) || companyId !== process.env.PROCORE_COMPANY_ID)
    throw Error('Check the Analytics sync connection and project ID.');
  const request = new Request('http://internal/job-closeout', {
    headers: { 'x-sync-secret': secret, 'x-procore-connection': 'analytics-sync' },
  });
  return api.withProcoreLiveApiBypassForSyncSecret(request, async () => {
    const token = await api.getClientCredentialsToken();
    const get = (endpoint) => api.makeRequest('/rest/v1.0/' + endpoint, token, {}, companyId);
    async function list(endpoint, rowKey = (r) => r.id) {
      const rows = [],
        ids = new Set();
      for (let page = 1; page <= 100; page++) {
        const response = await get(
          endpoint + (endpoint.includes('?') ? '&' : '?') + 'page=' + page + '&per_page=100',
        );
        const batch = Array.isArray(response) ? response : response?.data;
        if (!Array.isArray(batch)) throw Error('Procore list unavailable.');
        for (const r of batch) {
          const key = rowKey(r);
          if (!key || ids.has(String(key))) throw Error('Incomplete or repeated Procore list.');
          ids.add(String(key));
          rows.push(r);
        }
        if (batch.length < 100) return rows;
      }
      throw Error('Procore list exceeds pagination limit.');
    }
    const filter = 'project_id=' + projectId;
    const views = (await list('budget_views?' + filter)).filter((v) => v.name === 'Procore Standard Budget');
    if (views.length !== 1) throw Error('Select a unique Procore Standard Budget view.');
    const base = 'budget_views/' + views[0].id + '/';
    const readRows = () =>
      list(
        base + 'detail_rows?' + filter + '&budget_row_type=all',
        (r) =>
          r.id ||
          (r.budgeted === false &&
            [r.biller_type, r.biller_id, r.wbs_code_id, r.root_cost_code_id, r.cost_code_id, r.category_id].join(
              '/',
            )),
      );
    return action({ viewId: String(views[0].id), base, filter, list, get, readRows, api, token });
  });
}

export function zeroProcoreForecast(companyId, projectId, plan, checkClaim) {
  return withBudget(companyId, projectId, ({ viewId, readRows, api, token }) =>
    applyForecastPlan(
      plan,
      { companyId, projectId, viewId },
      readRows,
      (rows) =>
        api.makeRequest(
          '/rest/v2.0/companies/' + companyId + '/projects/' + projectId + '/advanced_forecastings/rows',
          token,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ async: false, budget_view_id: viewId, forecasting_rows: rows }),
          },
          companyId,
        ),
      checkClaim,
    ),
  );
}

export function readProcore(companyId, projectId) {
  return withBudget(companyId, projectId, async ({ viewId, base, filter, list, get, readRows }) => {
    const summaries = await list(base + 'summary_rows?' + filter);
    const selected = summaries.filter((s) => s.biller_type === 'Project' && String(s.id) === projectId);
    if (selected.length !== 1) throw Error('Project budget summary unavailable.');
    const budget = selected[0],
      allRows = await readRows(),
      lines = allRows.filter((r) => r.budgeted);
    const forecasts = forecastPlan(companyId, projectId, viewId, allRows);
    const direct = 'projects/' + projectId + '/direct_costs';
    const headers = await list(direct);
    const directLines = await list(direct + '/line_items');
    const directExceptions = checkDirectCostLines(projectId, headers, directLines);
    const primes = await list('prime_contracts?' + filter + '&view=extended'),
      changes = [];
    for (const contract of primes) {
      const scope = filter + '&contract_id=' + contract.id;
      for (const co of await list('change_order_packages?' + scope)) {
        const detail = await get('change_order_packages/' + co.id + '?' + scope);
        if (String(detail.id) !== String(co.id) || !Array.isArray(detail.line_items))
          throw Error('Change order detail unavailable.');
        changes.push(detail);
      }
    }
    return { budget, lines, headers, primes, changes, directExceptions, forecasts };
  });
}
