import type { PrismaClient } from '@prisma/client';

type SourceRecord = Record<string, unknown>;

// Membership is authoritative only after every page of the unfiltered scope
// succeeds. Missing records must never be inferred from partial/error responses.
export async function fetchCompleteChangeOrderSnapshot(
  fetchPage: (page: number) => Promise<unknown>, perPage: number, maxPages = 50,
): Promise<SourceRecord[]> {
  const records: SourceRecord[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= maxPages; page++) {
    const response = await fetchPage(page);
    const envelope = response as { data?: unknown; change_order_packages?: unknown } | null;
    const batch = Array.isArray(response) ? response : envelope?.data ?? envelope?.change_order_packages;
    if (!Array.isArray(batch)) throw new Error('Invalid change-order snapshot response.');
    for (const record of batch) {
      const rawId = record && typeof record === 'object' ? record.id : null;
      const id = typeof rawId === 'string' || (typeof rawId === 'number' && Number.isFinite(rawId)) ? String(rawId).trim() : '';
      if (!id || seen.has(id)) throw new Error('Missing or repeated change-order ID; snapshot is incomplete.');
      seen.add(id);
      records.push(record);
    }
    if (batch.length < perPage) return records;
  }
  throw new Error('Change-order snapshot exceeded the pagination limit.');
}

export async function retireMissingChangeOrderPackages(
  db: Pick<PrismaClient, 'procoreChangeOrderPackage'>,
  { companyId, projectId, contractId, packageIds, startedAt }: {
    companyId: string; projectId: string; contractId: string; packageIds: string[]; startedAt: Date;
  },
) {
  if (![companyId, projectId, contractId].every(value => value.trim()) || !Number.isFinite(startedAt.getTime())
    || packageIds.some(id => !id.trim()) || new Set(packageIds).size !== packageIds.length) {
    throw new Error('A valid complete company/project/prime-contract snapshot is required.');
  }
  const result = await db.procoreChangeOrderPackage.updateMany({
    where: {
      companyId, projectId, contractId, packageId: { notIn: packageIds },
      missingFromSourceAt: null, syncedAt: { lte: startedAt },
    },
    // Preserve source status, amounts, payload and lines for historical reports.
    data: { missingFromSourceAt: startedAt },
  });
  return result.count;
}
