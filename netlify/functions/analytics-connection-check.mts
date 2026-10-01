import { timingSafeEqual } from 'node:crypto';

export default async function handler(request: Request) {
  const expected = process.env.PROCORE_SYNC_SECRET || '';
  const supplied = request.headers.get('x-sync-secret') || '';
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST' || !expected || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return json({ error: 'Unauthorized' }, 401);
  const clientId = process.env.PROCORE_ANALYTICS_SYNC_CLIENT_ID?.trim();
  const clientSecret = process.env.PROCORE_ANALYTICS_SYNC_CLIENT_SECRET?.trim();
  const companyId = process.env.PROCORE_COMPANY_ID;
  if (!clientId || !clientSecret || !companyId) return json({ configured: false }, 503);
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
    return json({ configured: true, authenticated: true, projectReadStatus: probe.status, limit: probe.headers.get('x-rate-limit-limit'), remaining: probe.headers.get('x-rate-limit-remaining') });
  } catch { return json({ error: 'Connection check could not complete.' }, 502); }
}

export const config = { path: '/api/background/analytics-connection-check', method: 'POST' };
