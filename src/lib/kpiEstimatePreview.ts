import {
  calculateWinRate, KPI_CURRENT_COMPANY, mergeWinRateGroups, winRateStatus,
  type WinRateBid, type WinRatePolicy,
} from './kpiWinRate.ts';
import { calculateEstimateRevisions, estimateRevisionDate, type EstimateRevisionEvent } from './kpiEstimateRevisions.ts';
import type { LegacyEstimateSnapshot } from './kpiLegacyEstimateLedger.ts';

// Earlier KPI actuals remain saved history. Older versions are still needed to
// measure rebids after this cutover without recounting the original estimate.
export const KPI_ESTIMATE_PROCESS_START = '2026-10-01';

export type EstimatePreviewBid = WinRateBid & { procoreProjectId?: string | null };
export type EstimatePreviewValue = {
  bidBoardId: string;
  selectedProposalId?: string | null;
  customer?: string;
  hours: number;
  sales: number;
  customFields: { estimateLineCount?: unknown };
};
export type EstimatePreviewProposal = {
  bidBoardId: string;
  proposalId: string;
  name: string;
  type: string;
  primary: boolean;
  order?: number | null;
  alternate?: boolean;
  updatedAt: string | null;
  hours: number | null;
  sales: number | null;
};
export type EstimatePreviewProject = {
  key: string;
  name: string;
  createdDate: string;
  status: string;
  bidBoardId: string | null;
  customer: string;
  sourceCount: number;
  hours: number | null;
  sales: number | null;
  issues: string[];
  proposals: EstimatePreviewProposal[];
  events: EstimateRevisionEvent[];
  legacySource?: string;
};
export type EstimatePreviewMonth = {
  count: number;
  hours: number;
  sales: number;
  missingHours: number;
  missingSales: number;
  rebids: number;
};
export type EstimatePreviewReport = {
  startDate: string;
  months: Record<string, EstimatePreviewMonth>;
  years: string[];
  projects: EstimatePreviewProject[];
  missingCreatedDates: number;
  asOf: string;
  legacyLedger?: { source: 'local-preview' | 'database'; records: number; contributingProjects: number; missingHours: number };
};

const eligible = new Set(['ESTIMATING', 'ESTIMATED', 'BID_SUBMITTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETE']);
const round = (value: number, digits: number) => Number(value.toFixed(digits));
const nonnegative = (value: number) => Number.isFinite(value) && value >= 0 ? value : null;
const sourceId = (row: WinRateBid) => `${row.companyId}:${row.bidBoardId}`;

/** Read-only local review, using newer primary versions for supported rebids.
 * The approved reporting groups preserve original dates across migration copies.
 */
export function calculateEstimatePreview(
  bids: EstimatePreviewBid[],
  values: EstimatePreviewValue[],
  proposals: EstimatePreviewProposal[],
  policy: WinRatePolicy,
  canonical: { procoreProjectId: string; bidBoardId: string | null }[] = [],
  asOf = new Date(),
  legacy: LegacyEstimateSnapshot[] = [],
): EstimatePreviewReport {
  const canonicalBoards = new Set(canonical.map(row => row.bidBoardId).filter(Boolean));
  const currentBids = bids.filter(row => row.companyId === KPI_CURRENT_COMPANY && !row.bidBoardId.includes(':'));
  // Exact execution-project links precede name grouping. Approved aliases below
  // may additionally combine contractor-specific records for reporting only.
  const byExecutionId = new Map<string, EstimatePreviewBid[]>();
  for (const row of currentBids) {
    if (!row.procoreProjectId) continue;
    const rows = byExecutionId.get(row.procoreProjectId) ?? [];
    rows.push(row); byExecutionId.set(row.procoreProjectId, rows);
  }
  const identityRules = [...byExecutionId].flatMap(([id, rows]) => {
    if (rows.length < 2) return [];
    const ordered = rows.map(row => ({ row, date: String((row.payload as Record<string, unknown> | null)?.created_on ?? '') }))
      .filter(row => Number.isFinite(Date.parse(row.date)))
      .sort((a, b) => a.date.localeCompare(b.date) || a.row.bidBoardId.localeCompare(b.row.bidBoardId));
    if (!ordered.length) return [];
    const preferred = rows.find(row => canonicalBoards.has(row.bidBoardId)) ?? ordered[0].row;
    return [{ key: `project:${KPI_CURRENT_COMPANY}:${id}`, names: [], preferredSource: sourceId(preferred), sourceIds: rows.map(sourceId), createdDate: ordered[0].date }];
  });
  const groups = mergeWinRateGroups([...policy.groups, ...identityRules]);
  // Older Created Dates can still have a current-year rebid. Win Rate itself
  // retains its 2026 default; only this preview asks for older identities.
  const grouped = calculateWinRate(bids, { ...policy, groups }, null, asOf, 1900);
  const rules = new Map(groups.map(rule => [rule.key, rule]));
  const byBoard = new Map(values.map(value => [value.bidBoardId, value]));
  const projects: EstimatePreviewProject[] = [];
  for (const group of grouped.projects) {
    const current = group.sources.filter(source => source.companyId === KPI_CURRENT_COMPANY);
    const sources = current.length ? current : group.sources;
    const qualified = sources.filter(source => eligible.has(winRateStatus(source.status)));
    if (!qualified.length) continue;
    if (!current.length) {
      const retained = legacy.filter(snapshot => qualified.some(source => source.companyId === snapshot.companyId && source.bidBoardId === snapshot.bidBoardId)
        && !snapshot.archived && !snapshot.deleted && !snapshot.template && !snapshot.sourceMissing);
      if (retained.length) {
        if (group.createdDate < KPI_ESTIMATE_PROCESS_START) continue;
        const preferred = rules.get(group.key)?.preferredSource;
        const equal = retained.every(row => row.hours === retained[0].hours && row.sales === retained[0].sales);
        const selected = retained.find(row => `${row.companyId}:${row.bidBoardId}` === preferred) ?? (retained.length === 1 || equal ? retained[0] : null);
        const hours = selected?.hours ?? null, sales = selected?.sales ?? null;
        const issues: string[] = [];
        if (!selected) issues.push('Old-instance customer copies have different values; select the retained estimate before totaling this project.');
        if (hours === null) issues.push('Historical full estimate hours have not been recovered.');
        if (sales === null) issues.push('Historical estimate dollars have not been recovered.');
        projects.push({ key: group.key, name: group.name, createdDate: group.createdDate.slice(0, 10), status: qualified[0].status,
          bidBoardId: selected?.bidBoardId ?? null, customer: selected?.customer ?? '', sourceCount: group.sources.length,
          hours, sales, issues, proposals: [], legacySource: selected?.valueSource ?? 'Old-instance ledger awaiting source review',
          events: [{ date: group.createdDate.slice(0, 10), kind: 'initial', hours, sales, previous: null, revised: null }] });
        continue;
      }
    }
    const candidates = qualified.filter(source => source.companyId === KPI_CURRENT_COMPANY)
      .flatMap(source => byBoard.has(source.bidBoardId) ? [byBoard.get(source.bidBoardId)!] : []);
    const preferredSource = rules.get(group.key)?.preferredSource;
    const preferred = candidates.find(value => `${KPI_CURRENT_COMPANY}:${value.bidBoardId}` === preferredSource);
    const canonicalCandidates = candidates.filter(value => canonicalBoards.has(value.bidBoardId));
    const equalValues = candidates.length > 0 && candidates.every(value =>
      round(value.hours, 4) === round(candidates[0].hours, 4) && round(value.sales, 2) === round(candidates[0].sales, 2)
      && Number(value.customFields.estimateLineCount) > 0 && Number(candidates[0].customFields.estimateLineCount) > 0);
    const selected = preferred ?? (canonicalCandidates.length === 1 ? canonicalCandidates[0] : undefined)
      ?? (candidates.length === 1 || equalValues ? candidates[0] : undefined);
    const issues: string[] = [];
    if (!selected) issues.push(candidates.length > 1
      ? 'Customer copies have different estimates; select the source before totaling this project.'
      : 'No current synchronized estimate is available for this project.');
    const hours = selected && selected.selectedProposalId && Number(selected.customFields.estimateLineCount) > 0 ? nonnegative(selected.hours) : null;
    const sales = selected && (selected.sales !== 0 || (selected.selectedProposalId && Number(selected.customFields.estimateLineCount) > 0))
      ? nonnegative(selected.sales) : null;
    if (selected && hours === null) issues.push('Estimated hours have not been verified from synchronized estimate lines.');
    if (selected && sales === null) issues.push('Estimated dollars are missing or invalid.');
    const sourceBoards = new Set(current.map(source => source.bidBoardId));
    const versions = proposals.filter(proposal => sourceBoards.has(proposal.bidBoardId) && proposal.type === 'ESTIMATE')
      .sort((a, b) => a.bidBoardId.localeCompare(b.bidBoardId) || a.name.localeCompare(b.name) || a.proposalId.localeCompare(b.proposalId));
    const revision = selected ? calculateEstimateRevisions(group.createdDate.slice(0, 10), versions.filter(version => version.bidBoardId === selected.bidBoardId)) : null;
    const events = revision?.events ?? [{ date: group.createdDate.slice(0, 10), kind: 'initial' as const, hours: null, sales: null, previous: null, revised: null }];
    const postCutoverEvidence = versions.some(version => version.primary && (estimateRevisionDate(version.updatedAt) ?? '') >= KPI_ESTIMATE_PROCESS_START);
    if (group.createdDate < KPI_ESTIMATE_PROCESS_START && !events.some(event => event.date >= KPI_ESTIMATE_PROCESS_START) && !(versions.length > 1 && postCutoverEvidence)) continue;
    if (revision) issues.push(...revision.issues);
    projects.push({
      key: group.key, name: group.name, createdDate: group.createdDate.slice(0, 10),
      status: qualified.find(source => source.bidBoardId === selected?.bidBoardId)?.status ?? qualified[0].status,
      bidBoardId: selected?.bidBoardId ?? null, customer: selected?.customer ?? '', sourceCount: current.length || group.sources.length,
      hours: hours === null ? null : round(hours, 4), sales: sales === null ? null : round(sales, 2), issues,
      proposals: versions, events,
    });
  }
  const months: Record<string, EstimatePreviewMonth> = {};
  for (const project of projects) {
    const projectMonths = new Set<string>();
    const rebidMonths = new Set<string>();
    const missingHours = new Set<string>();
    const missingSales = new Set<string>();
    for (const event of project.events) {
      if (event.date < KPI_ESTIMATE_PROCESS_START) continue;
      const key = event.date.slice(0, 7);
      const month = months[key] ??= { count: 0, hours: 0, sales: 0, missingHours: 0, missingSales: 0, rebids: 0 };
      month.hours = round(month.hours + (event.hours ?? 0), 4);
      month.sales = round(month.sales + (event.sales ?? 0), 2);
      if (!projectMonths.has(key)) { month.count++; projectMonths.add(key); }
      if (event.kind === 'rebid' && !rebidMonths.has(key)) { month.rebids++; rebidMonths.add(key); }
      if (event.hours === null && !missingHours.has(key)) { month.missingHours++; missingHours.add(key); }
      if (event.sales === null && !missingSales.has(key)) { month.missingSales++; missingSales.add(key); }
    }
  }
  return { startDate: KPI_ESTIMATE_PROCESS_START, months, projects, years: [...new Set(Object.keys(months).map(key => key.slice(0, 4)))].sort(), missingCreatedDates: grouped.missingCreatedDates, asOf: asOf.toISOString() };
}

/** Multiple ESTIMATE proposals on one bid may be rebids, copies, or options.
 * Separate contractor bids alone are not evidence of a revision.
 */
export function hasEstimateVersions(project: EstimatePreviewProject): boolean {
  return project.proposals.some(proposal => project.proposals.filter(other => other.bidBoardId === proposal.bidBoardId).length > 1);
}
