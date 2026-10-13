import { prisma } from '@/lib/prisma';
import { readWipLocalStore, wipLocalStorePath } from '@/lib/wipLocalStore';
import { calculateWipScheduledHours, type WipScheduledHours } from '@/lib/wipScheduledHours';
import type { WipAllocation, WipSource } from '@/lib/wipPlanning';

export async function loadWipScheduledHours(): Promise<WipScheduledHours> {
  const companyId = process.env.PROCORE_COMPANY_ID?.trim();
  if (!companyId) throw new Error('The Procore company is not configured.');
  const localPath = wipLocalStorePath();
  if (localPath) {
    const local = await readWipLocalStore(localPath, companyId);
    return { ...calculateWipScheduledHours(Object.values(local.plans)), excludedDraftCount: Object.keys(local.drafts).length, localOnly: true };
  }
  const plans = await prisma.wipPlan.findMany({ where: { companyId }, select: { projectId: true, source: true, allocations: true } });
  return {
    ...calculateWipScheduledHours(plans.map(plan => ({ source: plan.source as unknown as WipSource, allocations: plan.allocations as unknown as WipAllocation[] }))),
    excludedDraftCount: await prisma.wipImportDraft.count({ where: { companyId, projectId: { notIn: plans.map(plan => plan.projectId) } } }), localOnly: false,
  };
}
