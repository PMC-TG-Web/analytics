import { prisma } from '@/lib/prisma';
import { readWipLocalStore, wipLocalStorePath } from '@/lib/wipLocalStore';
import { calculateWipScheduledHours, type WipScheduledHours } from '@/lib/wipScheduledHours';
import type { WipAllocation, WipSource } from '@/lib/wipPlanning';
import { loadWipReportProjects } from '@/lib/wipReportStore';
import { addWipReportHours } from '@/lib/wipReportTotals';

export async function loadWipScheduledHours(): Promise<WipScheduledHours> {
  const companyId = process.env.PROCORE_COMPANY_ID?.trim();
  if (!companyId) throw new Error('The Procore company is not configured.');
  const localPath = wipLocalStorePath();
  if (localPath) {
    const local = await readWipLocalStore(localPath, companyId);
    return addWipReportHours({ ...calculateWipScheduledHours(Object.values(local.plans)), excludedDraftCount: Object.keys(local.drafts).length, localOnly: true }, await loadWipReportProjects(companyId, [...Object.keys(local.plans), ...Object.keys(local.drafts)]));
  }
  const plans = await prisma.wipPlan.findMany({ where: { companyId }, select: { projectId: true, source: true, allocations: true } });
  const drafts = await prisma.wipImportDraft.findMany({ where: { companyId, projectId: { notIn: plans.map(plan => plan.projectId) } }, select: { projectId: true } });
  return addWipReportHours({
    ...calculateWipScheduledHours(plans.map(plan => ({ source: plan.source as unknown as WipSource, allocations: plan.allocations as unknown as WipAllocation[] }))),
    excludedDraftCount: drafts.length, localOnly: false,
  }, await loadWipReportProjects(companyId, [...plans.map(plan => plan.projectId), ...drafts.map(draft => draft.projectId)]));
}
