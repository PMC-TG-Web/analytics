import { KPI_OLD_COMPANY } from './kpiWinRate.ts';
import type { LegacyEstimateEvidence } from './kpiLegacyEstimateLedger.ts';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const id = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : typeof value === 'string' && /^\d+$/.test(value) ? value : '';
const finite = (value: unknown): number | null => (typeof value === 'number' || (typeof value === 'string' && value.trim())) && Number.isFinite(Number(value)) ? Number(value) : null;

/** Complete, read-only capture of the uniquely primary old-instance estimate.
 * The caller supplies the central Procore client and an explicitly chosen
 * connection; this module cannot mutate Procore or publish database records.
 */
export async function captureLegacyPrimaryEstimate(
  bidBoardId: string,
  read: (path: string) => Promise<unknown>,
): Promise<LegacyEstimateEvidence & { lineItemCount: number; sourceUpdatedAt: string | null }> {
  if (!id(bidBoardId)) throw new Error('An exact old-instance Bid Board ID is required.');
  const base = `/rest/v2.0/companies/${KPI_OLD_COMPANY}/estimating/bid_board_projects/${bidBoardId}/proposals`;
  async function pages(path: string, keys: string[], maxPages: number) {
    const rows: RecordValue[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= maxPages; page++) {
      const payload = await read(`${path}?page=${page}&per_page=100`);
      const root = record(payload);
      const batch = Array.isArray(payload) ? payload : keys.map(key => root[key]).find(Array.isArray);
      if (!Array.isArray(batch)) throw new Error('Incomplete old-estimate response.');
      if (!batch.length) return rows;
      for (const item of batch) {
        const row = record(item), sourceId = id(row.id);
        if (!sourceId || seen.has(sourceId)) throw new Error('Repeated or invalid old-estimate source IDs; pagination is incomplete.');
        seen.add(sourceId); rows.push(row);
      }
    }
    throw new Error('Old-estimate pagination reached its limit before completion.');
  }
  const proposals = await pages(base, ['data', 'proposals', 'items', 'results'], 10);
  const primary = proposals.filter(row => row.type === 'ESTIMATE' && row.is_primary === true && row.is_procore_bid_form_alternate !== true);
  if (primary.length !== 1) throw new Error('Old bid does not have one uniquely primary estimate.');
  const proposal = primary[0], proposalId = id(proposal.id);
  const sales = finite(proposal.total);
  if (sales === null || sales < 0) throw new Error('Primary estimate sales are unavailable.');
  const lines = await pages(`${base}/${proposalId}/line_items`, ['data', 'line_items', 'items', 'results'], 100);
  if (!lines.length) throw new Error('Primary estimate has no saved line items; hours remain unavailable.');
  let hours = 0;
  for (const line of lines) {
    const costItem = record(line.cost_item);
    // Same hours basis as the normalized estimate mirror: hour-unit line
    // quantities, including PM/travel. Do not turn EA, LS or cost into hours.
    const unit = String(costItem.unit ?? costItem.uom ?? line.unit ?? line.uom ?? '').trim().toUpperCase();
    if (!['HOUR', 'HOURS', 'HR', 'HRS'].includes(unit)) continue;
    const quantity = finite(line.count ?? line.quantity);
    if (quantity === null) throw new Error('An hourly estimate line has no valid quantity.');
    hours += quantity;
  }
  if (!Number.isFinite(hours) || hours < 0) throw new Error('Invalid full estimated hours.');
  const confirmPayload = await read(`${base}/${proposalId}`);
  const confirm = record(record(confirmPayload).data ?? confirmPayload);
  if (id(confirm.id) !== proposalId || confirm.is_primary !== true || confirm.type !== 'ESTIMATE'
    || confirm.updated_at !== proposal.updated_at || finite(confirm.total) !== sales) throw new Error('The primary estimate changed during capture. Retry this bid.');
  return { companyId: KPI_OLD_COMPANY, bidBoardId, proposalId, hours: Number(hours.toFixed(4)), sales: Number(sales.toFixed(2)),
    includesProjectManagement: true, source: `Complete old-instance primary estimate ${proposalId}; ${lines.length} source lines`,
    lineItemCount: lines.length, sourceUpdatedAt: typeof proposal.updated_at === 'string' ? proposal.updated_at : null, capturedAt: new Date().toISOString() };
}
