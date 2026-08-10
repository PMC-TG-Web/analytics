function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

export function buildEmbeddedDrillthroughProjects(qboCostDrillthrough) {
  const projects = Array.isArray(qboCostDrillthrough?.projects) ? qboCostDrillthrough.projects : [];
  if (!projects.length) return null;

  const map = {};
  for (const project of projects) {
    const key = String(project?.qboCustomerId || project?.qboCostDrillthroughKey || '').trim();
    if (!key) continue;

    const lines = Array.isArray(project?.lines) ? project.lines : [];
    const breakdown = Array.isArray(project?.breakdown) ? project.breakdown : [];
    const lineCount = Number.isFinite(Number(project?.lineCount))
      ? Math.max(0, Math.trunc(Number(project.lineCount)))
      : lines.length;
    const total = project?.total == null || project.total === '' ? null : Number(project.total);

    map[key] = {
      status: String(project?.status || 'available').trim() || 'available',
      total: Number.isFinite(total) ? total : null,
      lineCount,
      projectName: project?.projectName == null ? null : String(project.projectName),
      fullyQualifiedName: project?.fullyQualifiedName == null ? null : String(project.fullyQualifiedName),
      breakdown,
      lines,
    };
  }

  return Object.keys(map).length ? map : null;
}

export function mergeSnapshotSummary(summary, embeddedProjects) {
  if (!embeddedProjects) return asObject(summary);
  return {
    ...asObject(summary),
    qboCostDrillthroughProjects: embeddedProjects,
  };
}
