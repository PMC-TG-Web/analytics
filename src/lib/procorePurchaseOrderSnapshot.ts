import type { PrismaClient } from '@prisma/client';

type SourceRecord = Record<string, unknown>;

// Only a complete, unfiltered project roster can establish that a PO is gone.
// Never treat malformed, repeated, truncated or failed pages as an empty roster.
export async function fetchCompletePurchaseOrderSnapshot(
  fetchPage: (page: number) => Promise<unknown>, perPage: number, maxPages = 100,
): Promise<SourceRecord[]> {
  const records: SourceRecord[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= maxPages; page++) {
    const response = await fetchPage(page);
    const envelope = response as { data?: unknown; results?: unknown } | null;
    const batch = Array.isArray(response) ? response : envelope?.data ?? envelope?.results;
    if (!Array.isArray(batch)) throw new Error('Invalid purchase-order snapshot response.');
    for (const record of batch) {
      const id = record && typeof record === 'object' ? String(record.id ?? '').trim() : '';
      if (!id || seen.has(id)) throw new Error('Missing or repeated purchase-order ID; snapshot is incomplete.');
      seen.add(id);
      records.push(record);
    }
    if (batch.length < perPage) return records;
  }
  throw new Error('Purchase-order snapshot exceeded the pagination limit.');
}

export async function retireMissingPurchaseOrders(
  db: Pick<PrismaClient, 'purchaseOrderContract'>,
  { companyId, projectId, contracts, startedAt }: {
    companyId: string; projectId: string; contracts: SourceRecord[]; startedAt: Date;
  },
) {
  if (!companyId.trim() || !projectId.trim() || !Number.isFinite(startedAt.getTime())) {
    throw new Error('A scoped, completed purchase-order snapshot is required.');
  }
  const ids = contracts.map(contract => String(contract.id ?? '').trim());
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('Invalid purchase-order snapshot IDs.');
  const result = await db.purchaseOrderContract.updateMany({
    where: {
      procoreCompanyId: companyId, procoreProjectId: projectId,
      procoreId: { not: null, notIn: ids }, procoreDeletedAt: null,
      // A newer overlapping sync may already have observed a newly created PO.
      updatedAt: { lte: startedAt },
    },
    data: { procoreDeletedAt: startedAt },
  });
  return result.count;
}

// Shared by Analytics and its closeout views. Historical lines/logs stay saved;
// absence is based on the exact company/project/contract ID, never the PO number.
export const ACTIVE_PRODUCTIVITY_PO_SQL = `NOT EXISTS (
  SELECT 1 FROM "PurchaseOrderContract" retired_po
  WHERE retired_po."procoreCompanyId" = v.company_id
    AND retired_po."procoreProjectId" = v.project_id
    AND retired_po."procoreId" = v.contract_id
    AND retired_po."procoreDeletedAt" IS NOT NULL
)`;
