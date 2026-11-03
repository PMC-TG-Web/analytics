import { createHash } from 'node:crypto';
import { KPI_CURRENT_COMPANY, KPI_OLD_COMPANY, mergeWinRateGroups, winRateName, type WinRateBid, type WinRatePolicy } from './kpiWinRate.ts';

export type LegacyEstimateEvidence = {
  companyId: string;
  bidBoardId: string;
  proposalId: string | null;
  hours: number | null;
  sales: number | null;
  includesProjectManagement: true;
  source: string;
  capturedAt?: string;
  sourceUpdatedAt?: string | null;
};
export type LegacyEstimateSnapshot = {
  version: 1;
  companyId: typeof KPI_OLD_COMPANY;
  bidBoardId: string;
  projectName: string;
  customer: string;
  status: string | null;
  createdDate: string | null;
  archived: boolean;
  deleted: boolean;
  template: boolean;
  sourceMissing: boolean;
  proposalId: string | null;
  sales: number | null;
  hours: number | null;
  includesProjectManagement: true;
  valueSource: string;
  sourceAsOf: string | null;
  estimateCapturedAt?: string | null;
  estimateUpdatedAt?: string | null;
};
export type LegacyLedgerFile = {
  version: 1;
  companyId: typeof KPI_OLD_COMPANY;
  preparedAt: string;
  skippedMigrated: number;
  records: { hash: string; snapshot: LegacyEstimateSnapshot }[];
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const numeric = (value: unknown, digits: number): number | null => {
  if (value === null || value === undefined || (typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Number(number.toFixed(digits)) : null;
};
const externalId = (value: unknown) => typeof value === 'string' && /^\d+$/.test(value);

// Stable allowlist serialization: no raw Procore payloads, contact details or credentials.
export function legacySnapshotHash(snapshot: LegacyEstimateSnapshot): string {
  return createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(snapshot).sort(([a], [b]) => a.localeCompare(b))))).digest('hex');
}

export function legacyReportingKeys(policy: WinRatePolicy) {
  const groups = mergeWinRateGroups(policy.groups);
  const bySource = new Map(groups.flatMap(group => [group.preferredSource, ...(group.sourceIds ?? [])].map(source => [source, group.key] as const)));
  const byName = new Map(groups.flatMap(group => group.names.map(name => [winRateName(name), group.key] as const)));
  return (row: Pick<WinRateBid, 'companyId' | 'bidBoardId' | 'projectName'>) => bySource.get(`${row.companyId}:${row.bidBoardId}`) ?? byName.get(winRateName(row.projectName)) ?? (winRateName(row.projectName) || `${row.companyId}:${row.bidBoardId}`);
}

/** Report-level migration matching, never canonical joins or writes. Include
 * archived/currently excluded new records in the moved set so old history
 * cannot reactivate a project that already moved and was later retired.
 */
export function unmigratedLegacySnapshots(records: LegacyEstimateSnapshot[], current: WinRateBid[], policy: WinRatePolicy) {
  const key = legacyReportingKeys(policy);
  const moved = new Set(current.filter(row => row.companyId === KPI_CURRENT_COMPANY && !row.bidBoardId.includes(':')).map(key));
  return records.filter(row => !moved.has(key(row)));
}

export function buildLegacyEstimateLedger(
  oldRows: (WinRateBid & { customer?: string | null; syncedAt?: Date | string })[],
  currentRows: WinRateBid[],
  policy: WinRatePolicy,
  evidence: LegacyEstimateEvidence[] = [],
  now = new Date(),
): LegacyLedgerFile {
  const supplements = new Map<string, LegacyEstimateEvidence>();
  for (const row of evidence) {
    if (row.companyId !== KPI_OLD_COMPANY || !externalId(row.bidBoardId) || (row.proposalId !== null && !externalId(row.proposalId))
      || row.includesProjectManagement !== true || !row.source?.trim()
      || (row.capturedAt !== undefined && !Number.isFinite(Date.parse(row.capturedAt)))
      || (row.sourceUpdatedAt != null && !Number.isFinite(Date.parse(row.sourceUpdatedAt)))
      || (row.hours !== null && numeric(row.hours, 4) === null) || (row.sales !== null && numeric(row.sales, 2) === null)) throw new Error('Invalid old-instance estimate evidence. Full hours including PM and an explicit source are required.');
    if (supplements.has(row.bidBoardId)) throw new Error('Duplicate estimate evidence needs a single reviewed primary source.');
    supplements.set(row.bidBoardId, row);
  }
  const seen = new Set<string>();
  const snapshots = oldRows.filter(row => row.companyId === KPI_OLD_COMPANY && !row.bidBoardId.includes(':')).map(row => {
    if (!externalId(row.bidBoardId) || seen.has(row.bidBoardId)) throw new Error('Invalid or duplicated old Bid Board identity.');
    seen.add(row.bidBoardId);
    const payload = object(row.payload);
    const extra = supplements.get(row.bidBoardId);
    const created = typeof payload.created_on === 'string' && Number.isFinite(Date.parse(payload.created_on)) ? payload.created_on.slice(0, 10) : null;
    const sourceAsOf = row.syncedAt && Number.isFinite(new Date(row.syncedAt).getTime()) ? new Date(row.syncedAt).toISOString() : null;
    const snapshot: LegacyEstimateSnapshot = {
      version: 1, companyId: KPI_OLD_COMPANY, bidBoardId: row.bidBoardId,
      projectName: row.projectName, customer: row.customer ?? String(object(payload.customer_company).name ?? ''),
      status: row.status, createdDate: created, archived: Boolean(payload.archived), deleted: Boolean(payload.deleted),
      template: Boolean(payload.is_template), sourceMissing: Boolean(payload.sync_missing_from_procore),
      proposalId: extra?.proposalId ?? null, sales: extra?.sales != null ? numeric(extra.sales, 2) : numeric(object(payload.stats).total, 2),
      hours: extra?.hours != null ? numeric(extra.hours, 4) : null, includesProjectManagement: true,
      valueSource: extra ? `${extra.source.trim()}${extra.sales === null ? '; dollars from retained Bid Board header' : ''}` : 'Retained old-instance Bid Board header; estimate hours unavailable',
      sourceAsOf,
      estimateCapturedAt: extra?.capturedAt ?? null,
      estimateUpdatedAt: extra?.sourceUpdatedAt ?? null,
    };
    return snapshot;
  });
  for (const id of supplements.keys()) if (!seen.has(id)) throw new Error('Estimate evidence has no exact old-instance Bid Board record.');
  const unmatched = unmigratedLegacySnapshots(snapshots, currentRows, policy);
  const records = unmatched.sort((a, b) => a.bidBoardId.localeCompare(b.bidBoardId)).map(snapshot => ({ hash: legacySnapshotHash(snapshot), snapshot }));
  return { version: 1, companyId: KPI_OLD_COMPANY, preparedAt: now.toISOString(), skippedMigrated: snapshots.length - records.length, records };
}

export function parseLegacyEstimateLedger(input: unknown): LegacyLedgerFile {
  const file = object(input);
  if (file.version !== 1 || file.companyId !== KPI_OLD_COMPANY || typeof file.preparedAt !== 'string'
    || !Number.isFinite(Date.parse(file.preparedAt)) || !Number.isInteger(file.skippedMigrated) || Number(file.skippedMigrated) < 0 || !Array.isArray(file.records)) throw new Error('Invalid legacy estimate ledger.');
  const ids = new Set<string>();
  const allowed = new Set(['version', 'companyId', 'bidBoardId', 'projectName', 'customer', 'status', 'createdDate', 'archived', 'deleted', 'template', 'sourceMissing', 'proposalId', 'sales', 'hours', 'includesProjectManagement', 'valueSource', 'sourceAsOf', 'estimateCapturedAt', 'estimateUpdatedAt']);
  for (const record of file.records) {
    const snapshot = object(record.snapshot);
    if (Object.keys(snapshot).some(key => !allowed.has(key)) || snapshot.version !== 1 || snapshot.companyId !== KPI_OLD_COMPANY || !externalId(snapshot.bidBoardId)
      || typeof snapshot.projectName !== 'string' || typeof snapshot.customer !== 'string' || typeof snapshot.valueSource !== 'string' || !snapshot.valueSource.trim()
      || (snapshot.status !== null && typeof snapshot.status !== 'string') || snapshot.includesProjectManagement !== true
      || (snapshot.proposalId !== null && !externalId(snapshot.proposalId))
      || !['archived', 'deleted', 'template', 'sourceMissing'].every(key => typeof snapshot[key] === 'boolean')
      || (snapshot.createdDate !== null && (typeof snapshot.createdDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.createdDate) || !Number.isFinite(Date.parse(snapshot.createdDate))))
      || (snapshot.sourceAsOf !== null && (typeof snapshot.sourceAsOf !== 'string' || !Number.isFinite(Date.parse(snapshot.sourceAsOf))))
      || !['estimateCapturedAt', 'estimateUpdatedAt'].every(key => snapshot[key] == null || (typeof snapshot[key] === 'string' && Number.isFinite(Date.parse(snapshot[key]))))
      || !['sales', 'hours'].every(key => snapshot[key] === null || (typeof snapshot[key] === 'number' && Number.isFinite(snapshot[key]) && Number(snapshot[key]) >= 0))
      || record.hash !== legacySnapshotHash(snapshot as LegacyEstimateSnapshot) || ids.has(String(snapshot.bidBoardId))) throw new Error('Invalid, altered or duplicated legacy estimate snapshot.');
    ids.add(String(snapshot.bidBoardId));
  }
  return file as LegacyLedgerFile;
}
