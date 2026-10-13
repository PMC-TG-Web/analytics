import { prisma } from '@/lib/prisma';
import { loadEstimatingDashboardProjects } from '@/lib/estimatingDashboard';
import { readWipLocalStore, wipLocalStorePath } from '@/lib/wipLocalStore';
import { calculateWipScheduledSales, type WipScheduledSales } from '@/lib/wipScheduledSales';
import type { WipPlan } from '@/lib/wipPlanning';

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
  const projects = Object.keys(plans).length ? await loadEstimatingDashboardProjects() : [];
  return { ...calculateWipScheduledSales(plans, projects), excludedDraftCount: local ? Object.keys(local.drafts).length : await prisma.wipImportDraft.count({ where: { companyId, projectId: { notIn: Object.keys(plans) } } }), localOnly: !!local };
}
