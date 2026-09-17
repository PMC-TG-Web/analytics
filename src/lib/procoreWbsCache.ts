import { prisma } from '@/lib/prisma';

type WbsRecord = Record<string, unknown>;
export type WbsSnapshot = { records: WbsRecord[]; fetchedAt: Date };
const CACHE_TTL_MS = 24 * 60 * 60_000;

export async function readCommitmentMakerWbs(options: {
  companyId: string; projectId: string; forceLive: boolean; load: () => Promise<WbsRecord[]>;
  read?: () => Promise<WbsSnapshot | null>;
  write?: (records: WbsRecord[]) => Promise<unknown>;
  now?: () => number;
}) {
  const read = options.read || (async () => {
    const [row] = await prisma.$queryRaw<Array<{ records: WbsRecord[]; fetched_at: Date }>>`
      SELECT records, fetched_at FROM procore_wbs_caches
      WHERE company_id = ${options.companyId} AND project_id = ${options.projectId}`;
    return row ? { records: row.records, fetchedAt: row.fetched_at } : null;
  });
  if (!options.forceLive) {
    const cached = await read();
    const age = (options.now?.() ?? Date.now()) - (cached?.fetchedAt.getTime() ?? 0);
    if (cached?.records.length && age >= 0 && age < CACHE_TTL_MS) return cached.records;
  }
  // Creation must never fall back to a cached value after a failed live read.
  const records = await options.load();
  if (records.length > 0) {
    const write = options.write || (async (value: WbsRecord[]) => {
      await prisma.$executeRaw`INSERT INTO procore_wbs_caches (company_id, project_id, records, fetched_at)
        VALUES (${options.companyId}, ${options.projectId}, ${JSON.stringify(value)}::jsonb, NOW())
        ON CONFLICT (company_id, project_id) DO UPDATE SET records = EXCLUDED.records, fetched_at = EXCLUDED.fetched_at`;
    });
    // A cache failure must not discard a successful authoritative read.
    await write(records).catch(() => console.warn('Procore WBS cache could not be updated.'));
  }
  return records;
}
