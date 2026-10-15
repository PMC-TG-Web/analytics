import { PrismaClient, type Prisma } from '@prisma/client';
import { marketSeries, normalizeMarketPoints, type MarketFeedResult, type MarketPoint, type SavedMarketSeries } from './marketSeries.ts';
import { lancasterId, type LancasterData, type LancasterFeedResult, type SavedLancaster } from './marketLancaster.ts';

// Optional isolated local preview database. Production normally uses the application database.
const globalMarket = globalThis as unknown as { marketPrisma?: PrismaClient };
export async function marketDatabase() {
  if (!process.env.MARKET_DATABASE_URL) return (await import('./prisma.ts')).prisma;
  if (!globalMarket.marketPrisma) {
    const url = process.env.MARKET_DATABASE_URL || process.env.DATABASE_URL;
    globalMarket.marketPrisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
  }
  return globalMarket.marketPrisma;
}

export function mergeMarketHistory(previous: MarketPoint[], incoming: MarketPoint[]): MarketPoint[] {
  // Re-fetching history replaces revised periods while retaining older observations.
  const points = new Map(previous.map(point => [point.period, point]));
  for (const point of incoming) {
    const saved = points.get(point.period);
    // A rolling publisher feed must never undo a revision already saved from a newer release.
    if (saved?.publishedAt && point.publishedAt && saved.publishedAt > point.publishedAt) continue;
    points.set(point.period, point);
  }
  return normalizeMarketPoints([...points.values()]);
}

export async function readMarketSnapshots(db?: PrismaClient): Promise<SavedMarketSeries[]> {
  db ??= await marketDatabase();
  const rows = await db.marketSeriesSnapshot.findMany({ where: { id: { in: marketSeries.map(s => s.id) } } });
  return rows.map(row => ({ id: row.id, points: normalizeMarketPoints(row.points as unknown as MarketPoint[]), status: row.status as SavedMarketSeries['status'], message: row.message, checkedAt: row.checkedAt.toISOString(), lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null }));
}

export async function readLancasterSnapshot(db?: PrismaClient): Promise<SavedLancaster | null> {
  db ??= await marketDatabase();
  const row = await db.marketLocalSnapshot.findUnique({ where: { id: lancasterId } });
  return row ? { status: row.status as SavedLancaster['status'], message: row.message, data: row.data as LancasterData | null, checkedAt: row.checkedAt.toISOString(), lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null } : null;
}

export async function saveLancasterResult(tx: Prisma.TransactionClient, result: LancasterFeedResult) {
  if (result.status === 'ok' && !result.data) throw new Error('Successful county feed requires data');
  const previous = await tx.marketLocalSnapshot.findUnique({ where: { id: lancasterId } });
  const data = { status: result.status, message: result.message, checkedAt: new Date(result.checkedAt), lastSuccessAt: result.status === 'ok' ? new Date(result.checkedAt) : previous?.lastSuccessAt ?? null, ...(result.status === 'ok' ? { data: result.data as unknown as Prisma.InputJsonValue } : {}) };
  await tx.marketLocalSnapshot.upsert({ where: { id: lancasterId }, create: { id: lancasterId, ...data }, update: data });
}

export async function saveMarketResults(results: MarketFeedResult[], db?: PrismaClient, leaseToken?: string, local?: LancasterFeedResult) {
  db ??= await marketDatabase();
  await db.$transaction(async tx => {
    if (leaseToken) {
      const fence = await tx.marketSyncLease.updateMany({ where: { id: 'public-feeds', token: leaseToken, expiresAt: { gt: new Date() } }, data: { token: leaseToken } });
      if (!fence.count) throw new Error('Market sync lease expired');
    }
    for (const result of results) {
      if (result.status === 'ok' && !result.points.length) throw new Error('Successful market feed must contain observations');
      const previous = await tx.marketSeriesSnapshot.findUnique({ where: { id: result.id } });
      const successful = result.status === 'ok' && result.points.length > 0;
      const points = successful ? mergeMarketHistory((previous?.points ?? []) as unknown as MarketPoint[], result.points) : previous?.points ?? [];
      const data = { status: result.status, message: result.message, checkedAt: new Date(result.checkedAt), lastSuccessAt: successful ? new Date(result.checkedAt) : previous?.lastSuccessAt ?? null, points: points as unknown as Prisma.InputJsonValue };
      await tx.marketSeriesSnapshot.upsert({ where: { id: result.id }, create: { id: result.id, ...data }, update: data });
    }
    if (local) await saveLancasterResult(tx, local);
  }, { timeout: 15_000 });
}
