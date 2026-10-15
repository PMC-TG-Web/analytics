import type { Config } from '@netlify/functions';

export default async function handler() {
  if (process.env.MARKET_SYNC_ENABLED !== 'true') return new Response('Disabled', { status: 200 });
  const secret = process.env.PROCORE_SYNC_SECRET?.trim();
  const origin = process.env.APP_BASE_URL?.replace(/\/$/, '');
  if (!secret || !origin) return new Response('Missing scheduler configuration', { status: 503 });
  try {
    const response = await fetch(`${origin}/api/cron/market-outlook`, { method: 'POST', headers: { 'x-sync-secret': secret }, redirect: 'error', signal: AbortSignal.timeout(55_000) });
    return new Response(response.ok ? 'Market refresh complete' : 'Market refresh incomplete', { status: response.ok ? 200 : 503 });
  } catch {
    return new Response('Market refresh unavailable', { status: 503 });
  }
}

// 15:15 UTC is after common U.S. morning releases, regardless of daylight saving time.
export const config: Config = { schedule: '15 15 * * *' };
