export const KPI_ESTIMATE_ORIGINALS_KEY = 'kpi-estimates:confirmed-originals';

export type ConfirmedEstimateOriginal = {
  companyId: string;
  bidBoardId: string;
  proposalId: string;
  confirmedAt: string;
  confirmedBy: string;
};
export type ConfirmedEstimateOriginals = { version: 1; originals: ConfirmedEstimateOriginal[] };

/** Confirmations are reporting policy, separate from replaceable Procore mirrors. */
export function parseConfirmedEstimateOriginals(value: string | null): ConfirmedEstimateOriginals {
  if (value === null) return { version: 1, originals: [] };
  const parsed = JSON.parse(value) as ConfirmedEstimateOriginals;
  if (parsed?.version !== 1 || !Array.isArray(parsed.originals)) throw new Error('Invalid confirmed estimate originals.');
  const sources = new Set<string>();
  for (const row of parsed.originals) {
    if (!row || [row.companyId, row.bidBoardId, row.proposalId].some(id => typeof id !== 'string' || !/^\d+$/.test(id))
      || typeof row.confirmedAt !== 'string' || !Number.isFinite(Date.parse(row.confirmedAt))
      || typeof row.confirmedBy !== 'string' || !row.confirmedBy.trim()) throw new Error('Invalid estimate original confirmation.');
    const key = `${row.companyId}:${row.bidBoardId}`;
    if (sources.has(key)) throw new Error('Duplicate estimate original confirmation.');
    sources.add(key);
  }
  return parsed;
}

/** Append new confirmations; retain the original audit and reject replacement. */
export function mergeConfirmedEstimateOriginals(existing: ConfirmedEstimateOriginals, incoming: ConfirmedEstimateOriginals): ConfirmedEstimateOriginals {
  const originals = new Map(existing.originals.map(row => [`${row.companyId}:${row.bidBoardId}`, row]));
  for (const row of incoming.originals) {
    const key = `${row.companyId}:${row.bidBoardId}`;
    const previous = originals.get(key);
    if (previous && previous.proposalId !== row.proposalId) throw new Error('This project already has a different confirmed original.');
    if (!previous) originals.set(key, row);
  }
  return { version: 1, originals: [...originals.values()].sort((a, b) => a.companyId.localeCompare(b.companyId) || a.bidBoardId.localeCompare(b.bidBoardId)) };
}

export function confirmedEstimateOriginalId(originals: ConfirmedEstimateOriginal[], companyId: string, bidBoardId: string): string | null {
  return originals.find(row => row.companyId === companyId && row.bidBoardId === bidBoardId)?.proposalId ?? null;
}
