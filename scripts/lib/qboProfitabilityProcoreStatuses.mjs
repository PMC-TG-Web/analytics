function clean(value) {
  return String(value ?? '').trim();
}

export function buildQboProfitabilityProcoreStatusExport(
  projects,
  { companyId, generatedAt = new Date().toISOString() },
) {
  const entries = (Array.isArray(projects) ? projects : [])
    .map((project) => ({
      projectId: clean(project?.procoreProjectId),
      status: clean(project?.bidBoardStatus) || clean(project?.status),
    }))
    .filter(({ projectId, status }) => projectId && status)
    .sort((left, right) => left.projectId.localeCompare(right.projectId));
  const byProjectId = Object.fromEntries(
    entries.map(({ projectId, status }) => [projectId, status]),
  );

  return {
    generatedAt,
    companyId: clean(companyId),
    sourceProjectCount: Array.isArray(projects) ? projects.length : 0,
    exportedProjectCount: Object.keys(byProjectId).length,
    statuses: [...new Set(Object.values(byProjectId))]
      .sort((left, right) => left.localeCompare(right)),
    byProjectId,
  };
}
