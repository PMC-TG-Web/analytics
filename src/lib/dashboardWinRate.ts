import { dashboardDateRangeError, dashboardProjectDateKey } from './estimatingDashboardDates.ts';
import { isSoldEstimateStatus } from './financialWip.ts';

type WinRateProject = {
  id: string;
  status?: string;
  projectArchived?: boolean;
  dateCreated?: unknown;
  contractDate?: unknown;
};

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
    const status = String(project.status || '').trim().toLowerCase().replace(/_/g, ' ');
    const won = status === 'accepted' || isSoldEstimateStatus(status);
    const bid = won || status === 'bid submitted' || status === 'bidding' || status === 'lost';
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
