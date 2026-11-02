import { financialDate, isSoldEstimateStatus } from './financialWip.ts';

type SalesProject = {
  bidBoardId: string; procoreProjectId?: string | null; projectName?: string;
  projectNumber?: string; customer?: string; sales: number; status?: string; projectArchived: boolean;
  selectedProposalId?: string | null; hours?: number;
  pmcGroup?: Record<string, number>; customFields?: Record<string, unknown>;
};
export type ActualSalesEntry = {
  projectId: string; bidBoardId: string; projectName: string; projectNumber: string;
  customer: string; contractDate: string; value: number;
};
export type ActualSalesHoursEntry = ActualSalesEntry & {
  estimatedHours: number | null; projectManagementHours: number | null;
  hours: number | null; issue: string | null;
};
export type KpiActualSales = {
  months: Record<string, number>;
  years: string[];
  projects: ActualSalesEntry[];
  excluded: { projectId: string | null; projectName: string; reason: string }[];
  hours: { months: Record<string, number | null>; projects: ActualSalesHoursEntry[] };
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
  const report: KpiActualSales = { months: {}, years: [], projects: [], excluded: [], hours: { months: {}, projects: [] } };
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
    const entry = { projectId: id, bidBoardId: project.bidBoardId, projectName: project.projectName || 'Unnamed project', projectNumber: project.projectNumber || '', customer: project.customer || '', contractDate, value: project.sales };
    report.projects.push(entry);
    // Use the exact sales selection and Contract Date, with WIP's selected
    // estimate minus PM basis. Missing hours never turn into partial totals.
    const estimatedHours = project.hours;
    const projectManagementHours = project.pmcGroup?.PM ?? 0;
    let issue: string | null = null;
    if (!project.selectedProposalId || !(Number(project.customFields?.estimateLineCount) > 0)) {
      issue = 'Waiting for estimated line-item hours to synchronize.';
    } else if (typeof estimatedHours !== 'number' || !Number.isFinite(estimatedHours)
      || !project.pmcGroup || !Number.isFinite(projectManagementHours)
      || projectManagementHours < 0 || estimatedHours < projectManagementHours) {
      issue = 'Estimated hours or Project Management hours need source review.';
    }
    const hours = issue ? null : Math.round((estimatedHours! - projectManagementHours) * 10000) / 10000;
    report.hours.projects.push({ ...entry, estimatedHours: Number.isFinite(estimatedHours) ? estimatedHours! : null,
      projectManagementHours: Number.isFinite(projectManagementHours) ? projectManagementHours : null, hours, issue });
    report.hours.months[month] = hours === null || report.hours.months[month] === null
      ? null : (report.hours.months[month] || 0) + hours;
  }
  for (const month of Object.keys(report.months)) report.months[month] = Math.round(report.months[month] * 100) / 100;
  for (const [month, hours] of Object.entries(report.hours.months)) {
    if (hours !== null) report.hours.months[month] = Math.round(hours * 10000) / 10000;
  }
  report.years = [...new Set(Object.keys(report.months).map(month => month.slice(0, 4)))].sort();
  report.projects.sort((a, b) => a.contractDate.localeCompare(b.contractDate) || a.projectName.localeCompare(b.projectName));
  report.hours.projects.sort((a, b) => a.contractDate.localeCompare(b.contractDate) || a.projectName.localeCompare(b.projectName));
  return report;
}
