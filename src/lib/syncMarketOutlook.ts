import { randomUUID } from 'node:crypto';
import { fetchMarketFeeds } from './marketFeeds.ts';
import { marketDatabase, saveMarketResults } from './marketStore.ts';

export async function syncMarketOutlook(options: { force?: boolean } = {}) {
  const db = await marketDatabase();
  const now = new Date();
  const token = randomUUID();
  await db.marketSyncLease.upsert({ where: { id: 'public-feeds' }, create: { id: 'public-feeds', token: '', expiresAt: new Date(0) }, update: {} });
  const claim = await db.marketSyncLease.updateMany({ where: { id: 'public-feeds', OR: [{ expiresAt: { lte: now } }, ...(options.force ? [{ token: '' }] : [])] }, data: { token, expiresAt: new Date(now.getTime() + 120_000) } });
  if (!claim.count) return { ok: true, busy: true, results: [] };
  try {
    const results = await fetchMarketFeeds({ now });
    await saveMarketResults(results, db, token);
    return { ok: results.every(result => result.status === 'ok'), busy: false, results: results.map(({ id, status, message, points }) => ({ id, status, message, observations: points.length, latestPeriod: points.at(-1)?.period ?? null })) };
  } finally {
    // Cooldown also prevents repeated manual invocations exhausting unregistered BLS quota.
    await db.marketSyncLease.updateMany({ where: { id: 'public-feeds', token }, data: { token: '', expiresAt: new Date(Date.now() + 3_600_000) } });
  }
}
