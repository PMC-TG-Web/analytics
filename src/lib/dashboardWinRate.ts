import { dashboardDateRangeError, dashboardProjectDateKey } from './estimatingDashboardDates.ts';
import { isSoldEstimateStatus } from './financialWip.ts';
import {
  calculateWinRate, combineWinRateSources, KPI_CURRENT_COMPANY, KPI_OLD_COMPANY,
  type WinRateBaseline, type WinRatePolicy,
} from './kpiWinRate.ts';

type WinRateProject = {
  id: string;
  status?: string;
  projectArchived?: boolean;
  dateCreated?: unknown;
  contractDate?: unknown;
  bid?: boolean;
  won?: boolean;
};

export type DashboardWinRateHistoryProject = WinRateProject & {
  projectName: string;
  status: string;
  dateCreated: string;
  contractDate: string | null;
  bid: boolean;
  won: boolean;
  hasSavedHistory: boolean;
  hasCurrentRecord: boolean;
  contractDateIssue: string | null;
};

export type DashboardWinRateHistory = {
  savedAt: string;
  projects: DashboardWinRateHistoryProject[];
};

function statusCounts(status: unknown) {
  const normalized = String(status || '').trim().toLowerCase().replace(/_/g, ' ');
  const won = normalized === 'accepted' || isSoldEstimateStatus(normalized);
  return { won, bid: won || normalized === 'bid submitted' || normalized === 'bidding' || normalized === 'lost' };
}

export function buildDashboardWinRateHistory(
  current: (WinRateProject & { bidBoardId: string; projectName?: string })[],
  baseline: WinRateBaseline,
  policy: WinRatePolicy,
): DashboardWinRateHistory {
  const active = current.filter(project => !project.projectArchived);
  const currentById = new Map(active.map(project => [project.bidBoardId, project]));
  const bids = active.map(project => ({
    companyId: KPI_CURRENT_COMPANY, bidBoardId: project.bidBoardId,
    projectName: project.projectName || '', status: project.status || null,
    payload: { created_on: project.dateCreated, status: project.status },
  }));
  // Retain pre-2026 originals too: a migrated older job must not become a new bid.
  const grouped = calculateWinRate(combineWinRateSources(bids, baseline), policy, null, new Date(), 0);
  if (grouped.missingCreatedDates) throw new Error('Win-rate history contains missing or invalid Created Dates.');
  const projects = grouped.projects.map(group => {
    const currentRows = group.sources.flatMap(source => {
      const project = source.companyId === KPI_CURRENT_COMPANY ? currentById.get(source.bidBoardId) : undefined;
      return project ? [project] : [];
    });
    const winners = currentRows.filter(project => statusCounts(project.status).won);
    const dates = winners.map(project => dashboardProjectDateKey({ dateCreated: project.contractDate }));
    const uniqueDates = new Set(dates);
    const contractDateIssue = dates.includes(null) ? 'Missing linked Contract Date.'
      : uniqueDates.size > 1 ? 'Conflicting Contract Dates in this reporting group.' : null;
    const bidSource = group.sources.find(source => statusCounts(source.status).bid);
    return {
      id: group.key,
      projectName: group.name || 'Unnamed project',
      status: winners[0]?.status || bidSource?.status || group.status,
      dateCreated: group.createdDate,
      contractDate: contractDateIssue ? null : dates[0] ?? null,
      bid: Boolean(bidSource),
      // Frozen bid status alone cannot establish a dated win; keep the existing current-contract win source.
      won: winners.length > 0,
      hasSavedHistory: group.sources.some(source => source.companyId === KPI_OLD_COMPANY),
      hasCurrentRecord: currentRows.length > 0,
      contractDateIssue,
    };
  });
  return { savedAt: baseline.savedAt, projects };
}

export type DashboardWinRate = {
  won: number;
  bid: number;
  rate: number | null;
  wonIds: string[];
  bidIds: string[];
  missingWonDateIds: string[];
  missingBidDateIds: string[];
};

/** Apply the two event-date filters to the full eligible Bid Board population, not activity-filtered rows. */
export function calculateDashboardWinRate(projects: WinRateProject[], start = '', end = ''): DashboardWinRate {
  const error = dashboardDateRangeError(start, end);
  if (error) throw new Error(error);
  const report: DashboardWinRate = {
    won: 0, bid: 0, rate: null, wonIds: [], bidIds: [], missingWonDateIds: [], missingBidDateIds: [],
  };
  const seen = new Set<string>();
  const includeDate = (value: unknown, id: string, missingIds: string[]) => {
    if (!start && !end) return true;
    const date = dashboardProjectDateKey({ dateCreated: value });
    if (!date) {
      missingIds.push(id);
      return false;
    }
    return (!start || date >= start) && (!end || date <= end);
  };
  for (const project of projects) {
    if (project.projectArchived || seen.has(project.id)) continue;
    seen.add(project.id);
    const status = statusCounts(project.status);
    const won = project.won ?? status.won;
    const bid = project.bid ?? status.bid;
    if (bid && includeDate(project.dateCreated, project.id, report.missingBidDateIds)) report.bidIds.push(project.id);
    if (won && includeDate(project.contractDate, project.id, report.missingWonDateIds)) report.wonIds.push(project.id);
  }
  report.won = report.wonIds.length;
  report.bid = report.bidIds.length;
  if (report.bid && !report.missingWonDateIds.length && !report.missingBidDateIds.length) {
    report.rate = report.won / report.bid;
  }
  return report;
}
