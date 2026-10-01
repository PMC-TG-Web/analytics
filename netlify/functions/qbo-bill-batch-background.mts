import type { Config } from '@netlify/functions';
export default async function handler(request: Request) {
  const secret = process.env.PROCORE_SYNC_SECRET || process.env.SYNC_SECRET;
  if (!secret || request.headers.get('x-sync-secret') !== secret) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (process.env.QBO_BILL_BATCH_ENABLED !== 'true') return Response.json({ enabled: false });
  const base = process.env.APP_BASE_URL || process.env.URL;
  if (!base || !base.startsWith('https://')) return Response.json({ error: 'Worker origin unavailable' }, { status: 503 });
  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    const response = await fetch(new URL('/api/cron/qbo-bill-batch', base), { method: 'POST', headers: { 'x-sync-secret': secret }, redirect: 'error', signal: AbortSignal.timeout(60_000) });
    const result = await response.json();
    if (!response.ok || !result.active || result.waiting) break;
  }
  return Response.json({ success: true });
}
export const config: Config = { path: '/api/background/qbo-bill-batch', method: 'POST' };
