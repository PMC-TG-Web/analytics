import { validateWipAllocations, type WipPlan } from './wipPlanning.ts';

export type WipSalesProject = {
  bidBoardId: string;
  procoreProjectId?: string | null;
  projectName?: string;
  projectNumber?: string;
  customer?: string;
  sales: number;
};
export type WipSalesEntry = {
  id: string; projectName: string; projectNumber: string; customer: string;
  value: number; dateLabel: string; projectValue?: number; percent: number;
};
export type WipScheduledSales = {
  reportProjectCount?: number;
  months: Record<string, number>;
  projectsByMonth: Record<string, WipSalesEntry[]>;
  years: string[];
  planCount: number;
  excludedDraftCount: number;
  localOnly: boolean;
};

/** Company-scoped inputs. Match saved plan IDs explicitly; never match project names. */
export function calculateWipScheduledSales(plans: Record<string, Pick<WipPlan, 'source' | 'allocations'>>, projects: WipSalesProject[]): Omit<WipScheduledSales, 'excludedDraftCount' | 'localOnly'> {
  const byBid = new Map<string, WipSalesProject[]>();
  for (const project of projects) byBid.set(project.bidBoardId, [...(byBid.get(project.bidBoardId) || []), project]);
  const months: Record<string, number> = {};
  const projectsByMonth: Record<string, WipSalesEntry[]> = {};
  for (const [projectId, plan] of Object.entries(plans)) {
    const matches = byBid.get(plan.source.bidBoardId) || [];
    const project = matches[0];
    if (matches.length !== 1 || project.procoreProjectId !== projectId) throw new Error('A saved WIP project value could not be matched by ID.');
    if (!Number.isFinite(project.sales) || project.sales <= 0) throw new Error('A saved WIP project has no positive sales value.');
    for (const { month, percent } of validateWipAllocations(plan.allocations)) {
      const value = project.sales * percent / 100;
      months[month] = (months[month] || 0) + value;
      (projectsByMonth[month] ||= []).push({ id: projectId, projectName: project.projectName || 'Unnamed project', projectNumber: project.projectNumber || '', customer: project.customer || '', value, dateLabel: month, projectValue: project.sales, percent });
    }
  }
  for (const month of Object.keys(months)) {
    months[month] = Math.round(months[month] * 1e6) / 1e6;
    projectsByMonth[month].sort((a, b) => b.value - a.value);
  }
  return { months, projectsByMonth, years: [...new Set(Object.keys(months).map(month => month.slice(0, 4)))].sort(), planCount: Object.keys(plans).length };
}
