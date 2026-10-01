import { timingSafeEqual } from 'node:crypto';

export default async function handler(request: Request) {
  const expected = process.env.PROCORE_SYNC_SECRET || '';
  const supplied = request.headers.get('x-sync-secret') || '';
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST' || !expected || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return json({ error: 'Unauthorized' }, 401);
  // Keep the existing protected diagnostic URL; no activation or mutations.
  const input = await request.json().catch(() => ({}));
  const connection = input.connection || 'analytics-sync';
  if (!['analytics-sync', 'billing'].includes(connection)) return json({ error: 'Unsupported connection.' }, 400);
  const prefix = connection === 'billing' ? 'PROCORE_BILLING' : 'PROCORE_ANALYTICS_SYNC';
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim();
  const companyId = process.env.PROCORE_COMPANY_ID;
  if (!clientId || !clientSecret || !companyId) return json({ configured: false }, 503);
  const otherPrefixes = ['PROCORE', 'PROCORE_PM_DASHBOARD', 'PROCORE_COMMITMENT_MAKER', connection === 'billing' ? 'PROCORE_ANALYTICS_SYNC' : 'PROCORE_BILLING'];
  if (otherPrefixes.some(other => process.env[`${other}_CLIENT_ID`]?.trim() === clientId)) return json({ configured: false, error: 'Connection must use a distinct OAuth client.' }, 409);
  const projectId = input.projectId;
  if (projectId !== undefined && (typeof projectId !== 'string' || !/^\d+$/.test(projectId))) return json({ error: 'Invalid project ID.' }, 400);
  try {
    const response = await fetch('https://api.procore.com/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }), signal: AbortSignal.timeout(15000),
    });
    const body = await response.json();
    if (!response.ok || !body.access_token) return json({ configured: true, authenticated: false, tokenStatus: response.status });
    const probe = await fetch(`https://api.procore.com/rest/v1.0/projects?company_id=${encodeURIComponent(companyId)}&page=1&per_page=1`, {
      headers: { Authorization: `Bearer ${body.access_token}`, 'Procore-Company-Id': companyId }, signal: AbortSignal.timeout(15000),
    });
    await probe.body?.cancel();
    const reads: { resource: string; status: number }[] = [];
    if (connection === 'billing' && projectId && probe.ok) {
      const paths = [
        ['purchase_orders', `/rest/v1.0/purchase_order_contracts?company_id=${companyId}&project_id=${projectId}&page=1&per_page=1`],
        ['catalogs', `/rest/v2.0/companies/${companyId}/estimating/catalogs?page=1&per_page=1`],
        ['daily_logs', `/rest/v1.0/projects/${projectId}/productivity_logs?page=1&per_page=1`],
        ['timecards', `/rest/v1.0/projects/${projectId}/timecard_entries?page=1&per_page=1`],
        ['wbs', `/rest/v1.0/projects/${projectId}/work_breakdown_structure/wbs_codes?page=1&per_page=1`],
        ['budget', `/rest/v1.1/budget_line_items?project_id=${projectId}&page=1&per_page=1`],
      ];
      for (const [resource, path] of paths) {
        const result = await fetch(`https://api.procore.com${path}`, { headers: { Authorization: `Bearer ${body.access_token}`, 'Procore-Company-Id': companyId }, signal: AbortSignal.timeout(8000) });
        await result.body?.cancel();
        reads.push({ resource, status: result.status });
        if (!result.ok) break;
      }
    }
    return json({ connection, configured: true, authenticated: true, projectReadStatus: probe.status, limit: probe.headers.get('x-rate-limit-limit'), remaining: probe.headers.get('x-rate-limit-remaining'), reads });
  } catch { return json({ error: 'Connection check could not complete.' }, 502); }
}

export const config = { path: '/api/background/analytics-connection-check', method: 'POST' };
