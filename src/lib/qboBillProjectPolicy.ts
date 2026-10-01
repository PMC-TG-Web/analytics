// Canonical company + Procore project identity, verified against pmc_projects.
// Internal operations sources remain available outside the direct-cost bill workflow.
export function billProjectExclusion(companyId: string, projectId: string): string | null {
  return companyId === '598134325805519' && projectId === '598134326626273'
    ? 'PMC Operations is an internal operations project and is excluded from direct-cost bills.'
    : null;
}

export function eligibleBillProjects<T extends { procoreProjectId: string }>(companyId: string, projects: T[]): T[] {
  return projects.filter(project => !billProjectExclusion(companyId, project.procoreProjectId));
}

export function assertBillProjectEligible(companyId: string, projectId: string) {
  const reason = billProjectExclusion(companyId, projectId);
  if (reason) throw new Error(reason);
}
