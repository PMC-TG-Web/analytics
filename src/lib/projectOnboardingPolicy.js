function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

export function shouldParkProjectOnboarding(project) {
  const projectId = normalize(project?.projectId);
  const projectNumber = normalize(project?.projectNumber);
  const projectName = normalize(project?.projectName);
  return projectId === '598134326542330'
    || projectNumber === 'pmc-ops'
    || projectName === 'pmc operations';
}
