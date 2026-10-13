export type WipAllocation = { month: string; percent: number };
export type WipSource = {
  bidBoardId: string;
  proposalId: string;
  estimatedHours: number;
  projectManagementHours: number;
  allocatableHours: number;
};
export type WipPlan = {
  revision: number;
  source: WipSource;
  allocations: WipAllocation[];
  notes: string;
  updatedBy: string;
  updatedAt: string;
};
export type WipProject = {
  key: string;
  projectId: string | null;
  projectName: string;
  projectNumber: string;
  customer: string;
  projectManager: string;
  source: WipSource;
  issue: string | null;
  plan: WipPlan | null;
};
type EstimateProject = {
  bidBoardId: string;
  procoreProjectId?: string | null;
  selectedProposalId?: string | null;
  projectName?: string;
  projectNumber?: string;
  customer?: string;
  projectManager?: string | null;
  status?: string;
  projectArchived: boolean;
  hours: number;
  pmcGroup: Record<string, number>;
  customFields: Record<string, unknown>;
};
type CanonicalProject = { procoreProjectId: string; bidBoardId: string | null; projectManager: string | null };

export function isWipInProgress(status: string | undefined): boolean {
  return String(status || '').toLowerCase().replace(/[\s_-]+/g, '') === 'inprogress';
}

/** Inputs are scoped to one company. Only explicit external IDs establish identity. */
export function buildWipProjects(estimates: EstimateProject[], canonical: CanonicalProject[]): WipProject[] {
  const projectsById = new Map(canonical.map(project => [project.procoreProjectId, project]));
  const eligible = estimates.filter(project => !project.projectArchived && isWipInProgress(project.status));
  const groups = new Map<string, EstimateProject[]>();
  for (const project of eligible) {
    const key = project.procoreProjectId || `bid:${project.bidBoardId}`;
    groups.set(key, [...(groups.get(key) || []), project]);
  }
  return [...groups.entries()].map(([key, candidates]) => {
    const canonicalProject = projectsById.get(key);
    const linked = candidates.filter(project => project.bidBoardId === canonicalProject?.bidBoardId);
    const project = linked.length === 1 ? linked[0] : candidates[0];
    const estimatedHours = project.hours;
    const projectManagementHours = project.pmcGroup.PM || 0;
    const allocatableHours = Math.round((estimatedHours - projectManagementHours) * 10000) / 10000;
    let issue: string | null = null;
    if (!canonicalProject) issue = 'Waiting for the linked Procore project to synchronize.';
    else if (candidates.length > 1 && linked.length !== 1) issue = 'Multiple estimates link to this project. Review its Bid Board link before allocating.';
    else if (!project.selectedProposalId || Number(project.customFields.estimateLineCount || 0) === 0) issue = 'Waiting for estimated line-item hours to synchronize.';
    else if (![estimatedHours, projectManagementHours, allocatableHours].every(Number.isFinite)
      || projectManagementHours < 0 || allocatableHours <= 0) issue = 'No positive estimated hours available after excluding Project Management.';
    return {
      key,
      projectId: canonicalProject?.procoreProjectId || null,
      projectName: project.projectName || 'Unnamed project',
      projectNumber: project.projectNumber || '',
      customer: project.customer || '',
      projectManager: canonicalProject?.projectManager || project.projectManager || 'Unassigned',
      source: { bidBoardId: project.bidBoardId, proposalId: project.selectedProposalId || '', estimatedHours, projectManagementHours, allocatableHours },
      issue,
      plan: null,
    };
  }).sort((left, right) => left.projectName.localeCompare(right.projectName));
}

export function sameWipSource(left: WipSource, right: WipSource): boolean {
  // JSON/database round trips can differ by a few floating-point bits.
  const sameHours = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-8;
  return left.bidBoardId === right.bidBoardId && left.proposalId === right.proposalId
    && sameHours(left.estimatedHours, right.estimatedHours) && sameHours(left.projectManagementHours, right.projectManagementHours)
    && sameHours(left.allocatableHours, right.allocatableHours);
}

export function allocationPercent(allocations: WipAllocation[]): number {
  return allocations.reduce((sum, allocation) => sum + Math.round(allocation.percent * 100), 0) / 100;
}

export function allocationHours(hours: number, percent: number): number {
  return hours * percent / 100;
}

export function validateWipAllocations(value: unknown): WipAllocation[] {
  if (!Array.isArray(value) || !value.length || value.length > 120) throw new Error('Allocate between 1 and 120 months.');
  const months = new Set<string>();
  const allocations = value.map(item => {
    if (!item || typeof item.month !== 'string' || !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(item.month)) throw new Error('Choose a valid month and year.');
    if (months.has(item.month)) throw new Error('Each month can appear only once.');
    months.add(item.month);
    if (typeof item.percent !== 'number' || !Number.isFinite(item.percent) || item.percent <= 0 || item.percent > 100
      || Math.abs(item.percent * 100 - Math.round(item.percent * 100)) > 0.000001) throw new Error('Percentages must be greater than 0 and at most 100, with up to two decimal places.');
    return { month: item.month, percent: item.percent };
  });
  if (allocationPercent(allocations) !== 100) throw new Error('Monthly percentages must total 100% before saving.');
  return allocations.sort((left, right) => left.month.localeCompare(right.month));
}

export function wipPlanStatus(project: WipProject): string {
  if (project.issue) return 'Needs source review';
  if (!project.plan) return 'Needs allocation';
  return sameWipSource(project.source, project.plan.source) ? 'Allocated' : 'Estimate changed';
}
