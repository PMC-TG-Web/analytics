import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { loadEstimatingDashboardProjects } from '@/lib/estimatingDashboard';
import { buildWipProjects, type WipAllocation, type WipSource } from '@/lib/wipPlanning';

export function wipCompanyId(): string {
  const companyId = process.env.PROCORE_COMPANY_ID?.trim();
  if (!companyId) throw new Error('The Procore company is not configured.');
  return companyId;
}

export function wipSourceFingerprint(source: WipSource): string {
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}

export async function loadWipPlanning(force = false) {
  const companyId = wipCompanyId();
  const [estimates, canonical, plans] = await Promise.all([
    loadEstimatingDashboardProjects({ force }),
    prisma.pmcProject.findMany({ where: { companyId }, select: { procoreProjectId: true, bidBoardId: true, projectManager: true } }),
    prisma.wipPlan.findMany({ where: { companyId } }),
  ]);
  const plansByProject = new Map(plans.map(plan => [plan.projectId, plan]));
  return buildWipProjects(estimates, canonical).map(project => {
    const plan = project.projectId ? plansByProject.get(project.projectId) : null;
    return {
      ...project,
      fingerprint: wipSourceFingerprint(project.source),
      plan: plan ? {
        revision: plan.revision,
        source: plan.source as unknown as WipSource,
        allocations: plan.allocations as unknown as WipAllocation[],
        notes: plan.notes,
        updatedBy: plan.updatedBy,
        updatedAt: plan.updatedAt.toISOString(),
      } : null,
    };
  });
}
