function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

export function shouldParkProjectOnboarding(project) {
  const projectNumber = normalize(project?.projectNumber);
  const projectName = normalize(project?.projectName);
  return projectNumber === 'pmc-ops' || projectName === 'pmc operations';
}
