import { financialDate, isSoldEstimateStatus } from './financialWip.ts';

type SalesProject = {
  bidBoardId: string; procoreProjectId?: string | null; projectName?: string;
  projectNumber?: string; customer?: string; sales: number; status?: string; projectArchived: boolean;
};
export type ActualSalesEntry = {
  projectId: string; bidBoardId: string; projectName: string; projectNumber: string;
  customer: string; contractDate: string; value: number;
};
export type KpiActualSales = {
  months: Record<string, number>;
  years: string[];
  projects: ActualSalesEntry[];
  excluded: { projectId: string | null; projectName: string; reason: string }[];
};

function isActualSalesStatus(status: unknown): boolean {
  return String(status || '').trim().toLowerCase() === 'accepted' || isSoldEstimateStatus(status);
}

/** Company-scoped mirrors only. Calendar months come exclusively from Financial WIP's project Contract Date. */
export function calculateKpiActualSales(
  projects: SalesProject[],
  dates: Map<string, { contractDate: string | null }>,
  canonical: { procoreProjectId: string; bidBoardId: string | null }[],
): KpiActualSales {
  const report: KpiActualSales = { months: {}, years: [], projects: [], excluded: [] };
  const links = new Map(canonical.map(project => [project.procoreProjectId, project.bidBoardId]));
  const groups = new Map<string, SalesProject[]>();
  for (const project of projects) {
    if (project.projectArchived) continue;
    const key = project.procoreProjectId || `bid:${project.bidBoardId}`;
    groups.set(key, [...(groups.get(key) || []), project]);
  }
  for (const candidates of groups.values()) {
    const id = candidates[0].procoreProjectId || null;
    const linked = id ? candidates.filter(project => project.bidBoardId === links.get(id)) : [];
    const project = linked.length === 1 ? linked[0] : candidates[0];
    const exclude = (reason: string) => report.excluded.push({ projectId: id, projectName: project.projectName || 'Unnamed project', reason });
    if (candidates.length > 1 && linked.length !== 1) {
      if (candidates.some(candidate => isActualSalesStatus(candidate.status))) exclude('Multiple bids link to this project; review the project link.');
      continue;
    }
    // KPI Actual Sales also includes Accepted, per the owner's reporting rule.
    if (!isActualSalesStatus(project.status)) continue;
    if (!id) { exclude('Missing linked Procore project.'); continue; }
    const contractDate = financialDate(dates.get(id)?.contractDate);
    if (!contractDate) { exclude('Missing or invalid Contract Date.'); continue; }
    if (!Number.isFinite(project.sales) || project.sales <= 0) { exclude('Missing positive project sales value.'); continue; }
    const month = contractDate.slice(0, 7);
    report.months[month] = (report.months[month] || 0) + project.sales;
    report.projects.push({ projectId: id, bidBoardId: project.bidBoardId, projectName: project.projectName || 'Unnamed project', projectNumber: project.projectNumber || '', customer: project.customer || '', contractDate, value: project.sales });
  }
  for (const month of Object.keys(report.months)) report.months[month] = Math.round(report.months[month] * 100) / 100;
  report.years = [...new Set(Object.keys(report.months).map(month => month.slice(0, 4)))].sort();
  report.projects.sort((a, b) => a.contractDate.localeCompare(b.contractDate) || a.projectName.localeCompare(b.projectName));
  return report;
}
