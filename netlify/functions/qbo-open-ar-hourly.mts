import type { Config } from '@netlify/functions';

export default async function handler() {
  const secret = (process.env.PROCORE_SYNC_SECRET || process.env.SYNC_SECRET || '').trim();
  const base = process.env.APP_BASE_URL || process.env.URL;
  if (!secret || !base) {
    console.error('[qbo-open-ar-hourly] Missing worker configuration');
    return Response.json({ error: 'Hourly A/R worker is not configured.' }, { status: 503 });
  }
  try {
    const url = new URL('/api/cron/qbo-open-ar', base);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid worker origin');
    const response = await fetch(url, {
      method: 'POST', headers: { 'x-sync-secret': secret }, redirect: 'error', signal: AbortSignal.timeout(20_000),
    });
    if (![200, 202].includes(response.status)) throw new Error(`Queue rejected with status ${response.status}`);
    const result = await response.json();
    if (typeof result.refresh?.id !== 'string' || !['queued', 'succeeded'].includes(result.refresh?.state)) throw new Error('Invalid queue response');
    console.log(JSON.stringify({ event: 'qbo-open-ar-hourly', state: result.refresh.state }));
    return Response.json({ accepted: true, state: result.refresh.state });
  } catch (error) {
    console.error('[qbo-open-ar-hourly] Dispatch failed', { errorType: error instanceof Error ? error.name : 'UnknownError' });
    return Response.json({ error: 'Hourly A/R dispatch failed. The saved report was retained.' }, { status: 503 });
  }
}
export const config: Config = { schedule: '0 * * * *' };
