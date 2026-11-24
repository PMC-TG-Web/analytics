import path from 'node:path';
import { createJiti } from 'jiti';
import { cents } from '../../src/lib/jobCloseout.mjs';

export async function readProcore(companyId, projectId) {
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
    async function list(endpoint) {
      const rows = [],
        ids = new Set();
      for (let page = 1; page <= 100; page++) {
        const response = await get(
          endpoint + (endpoint.includes('?') ? '&' : '?') + 'page=' + page + '&per_page=100',
        );
        const batch = Array.isArray(response) ? response : response?.data;
        if (!Array.isArray(batch)) throw Error('Procore list unavailable.');
        for (const r of batch) {
          if (!r.id || ids.has(String(r.id))) throw Error('Incomplete or repeated Procore list.');
          ids.add(String(r.id));
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
    const summaries = await list(base + 'summary_rows?' + filter);
    const selected = summaries.filter((s) => s.biller_type === 'Project' && String(s.id) === projectId);
    if (selected.length !== 1) throw Error('Project budget summary unavailable.');
    const budget = selected[0],
      lines = await list(base + 'detail_rows?' + filter);
    const direct = 'projects/' + projectId + '/direct_costs';
    const headers = await list(direct);
    const directLines = await list(direct + '/line_items');
    const totals = new Map();
    for (const l of directLines) {
      if (String(l.project?.id) !== projectId) throw Error('Direct cost line returned for another project.');
      const id = String(l.holder?.id);
      totals.set(id, (totals.get(id) ?? 0) + cents(l.amount));
    }
    let directTotal = 0;
    for (const h of headers) {
      const id = String(h.id),
        value = cents(h.amount);
      if ((totals.get(id) ?? 0) !== value) throw Error('Direct cost ' + id + ' differs from its line items.');
      totals.delete(id);
      directTotal += value;
    }
    if (totals.size || directTotal !== cents(budget['Direct Costs']))
      throw Error('Direct cost detail does not tie to the Standard Budget.');
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
    return { budget, lines, headers, primes, changes };
  });
}
