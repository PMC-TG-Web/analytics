import { authorizedMarketSync } from '@/lib/marketSyncAuth';
import { syncMarketOutlook } from '@/lib/syncMarketOutlook';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!authorizedMarketSync(request.headers.get('x-sync-secret'))) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  if (process.env.MARKET_SYNC_ENABLED !== 'true') return Response.json({ error: 'Market refresh is disabled' }, { status: 503, headers });
  try {
    const result = await syncMarketOutlook();
    return Response.json(result, { status: result.ok ? 200 : 503, headers });
  } catch {
    return Response.json({ error: 'Market refresh failed; saved observations retained' }, { status: 503, headers });
  }
}
