import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { loadEstimatingDashboardProjects } from '@/lib/estimatingDashboard';
import { buildWipProjects, type WipAllocation, type WipSource } from '@/lib/wipPlanning';
import { readWipLocalStore, wipLocalStorePath } from '@/lib/wipLocalStore';
import { loadWipProjectTeams } from '@/lib/wipProjectTeamStore';

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
  const localPath = wipLocalStorePath();
  const local = localPath ? await readWipLocalStore(localPath, companyId) : null;
  const [estimates, canonical, plans, drafts] = await Promise.all([
    loadEstimatingDashboardProjects({ force }),
    prisma.pmcProject.findMany({ where: { companyId }, select: { procoreProjectId: true, bidBoardId: true, projectManager: true } }),
    local ? Promise.resolve([]) : prisma.wipPlan.findMany({ where: { companyId } }),
    local ? Promise.resolve([]) : prisma.wipImportDraft.findMany({ where: { companyId } }),
  ]);
  const plansByProject = new Map(plans.map(plan => [plan.projectId, plan]));
  const draftsByProject = new Map(drafts.map(draft => [draft.projectId, draft]));
  const projects = buildWipProjects(estimates, canonical);
  const teams = await loadWipProjectTeams(companyId, projects.flatMap(project => project.projectId ? [project.projectId] : []));
  return projects.map(project => {
    const plan = project.projectId ? plansByProject.get(project.projectId) : null;
    return {
      ...project,
      projectManager: teams.get(project.projectId)?.managers.map(manager => manager.name).join(', ') || 'Unassigned',
      projectManagers: teams.get(project.projectId)?.managers || [],
      teamSyncedAt: teams.get(project.projectId)?.syncedAt || null,
      fingerprint: wipSourceFingerprint(project.source),
      importDraft: project.projectId && !plan ? local?.drafts[project.projectId] || draftsByProject.get(project.projectId) : undefined,
      plan: (project.projectId ? local?.plans[project.projectId] : null) || (plan ? {
        revision: plan.revision,
        source: plan.source as unknown as WipSource,
        allocations: plan.allocations as unknown as WipAllocation[],
        notes: plan.notes,
        updatedBy: plan.updatedBy,
        updatedAt: plan.updatedAt.toISOString(),
      } : null),
    };
  });
}
