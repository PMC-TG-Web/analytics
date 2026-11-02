import { prisma } from '@/lib/prisma';
import { loadEstimatingDashboardProjects } from '@/lib/estimatingDashboard';
import { readWipLocalStore, wipLocalStorePath } from '@/lib/wipLocalStore';
import { buildWipUnscheduledProjects, calculateWipScheduledSales, type WipScheduledSales } from '@/lib/wipScheduledSales';
import { buildWipProjects, type WipPlan } from '@/lib/wipPlanning';
import { loadWipReportProjects } from '@/lib/wipReportStore';
import { addWipReportSales } from '@/lib/wipReportTotals';

export async function loadWipScheduledSales(): Promise<WipScheduledSales> {
  const companyId = process.env.PROCORE_COMPANY_ID?.trim();
  if (!companyId) throw new Error('The Procore company is not configured.');
  const localPath = wipLocalStorePath();
  const local = localPath ? await readWipLocalStore(localPath, companyId) : null;
  const plans: Record<string, Pick<WipPlan, 'source' | 'allocations'>> = local ? local.plans : Object.fromEntries(
    (await prisma.wipPlan.findMany({ where: { companyId }, select: { projectId: true, source: true, allocations: true } }))
      .map(plan => [plan.projectId, { source: plan.source, allocations: plan.allocations } as unknown as WipPlan]),
  );
  // The estimating loader reads company-scoped synchronized mirrors, never the live API.
  const [projects, canonical] = await Promise.all([
    loadEstimatingDashboardProjects(),
    prisma.pmcProject.findMany({ where: { companyId }, select: { procoreProjectId: true, bidBoardId: true, projectManager: true } }),
  ]);
  const draftIds = local ? Object.keys(local.drafts) : (await prisma.wipImportDraft.findMany({ where: { companyId, projectId: { notIn: Object.keys(plans) } }, select: { projectId: true } })).map(draft => draft.projectId);
  const unscheduledProjects = buildWipUnscheduledProjects(buildWipProjects(projects, canonical), Object.keys(plans), draftIds);
  return addWipReportSales({ ...calculateWipScheduledSales(plans, projects), unscheduledProjects, excludedDraftCount: draftIds.length, localOnly: !!local }, await loadWipReportProjects(companyId, [...Object.keys(plans), ...draftIds]));
}
