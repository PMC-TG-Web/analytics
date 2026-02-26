/**
 * Calculate hours aggregated by PMC Group across all projects
 * @param projects Array of projects with pmcBreakdown data
 * @returns Object with total hours and breakdown by group
 */
export function calculatePMCGroupHours(projects: any[]) {
  const pmcGroupHours: Record<string, number> = {};
  
  projects.forEach(project => {
    // Use pmcBreakdown if available (from Status.csv export)
    if (project.pmcBreakdown && typeof project.pmcBreakdown === 'object') {
      Object.entries(project.pmcBreakdown).forEach(([group, hours]) => {
        const h = Number(hours) || 0;
        if (h > 0) {
          pmcGroupHours[group] = (pmcGroupHours[group] || 0) + h;
        }
      });
    }
  });
  
  const totalHours = Object.values(pmcGroupHours).reduce((sum, h) => sum + h, 0);
  
  // Sort by hours descending
  const breakdown = Object.entries(pmcGroupHours)
    .sort((a, b) => b[1] - a[1])
    .map(([group, hours]) => ({
      group,
      hours,
      percent: totalHours > 0 ? (hours / totalHours) * 100 : 0,
    }));
  
  return { totalHours, breakdown, hoursByGroup: pmcGroupHours };
}

/**
 * Filter hours to only include labor categories (exclude Part, Equipment, Subcontractor)
 */
export function filterLaborHours(pmcGroupHours: Record<string, number>) {
  const laborCategories = new Set([
    '1. Labor', '1. Labor Prep', 'Assembly', 'Excavation And Backfill Labor',
    'Finish Labor', 'Foundation Labor', 'Labor', 'PM', 'Pour And Finish Labor',
    'Site Concrete Labor', 'Slab On Grade Labor', 'Stone Grading Labor',
    'Travel Labor', 'Travel', 'Wall Labor', 'fab labor', 'welder'
  ]);
  
  const laborHours: Record<string, number> = {};
  let totalLaborHours = 0;
  
  Object.entries(pmcGroupHours).forEach(([group, hours]) => {
    if (laborCategories.has(group)) {
      laborHours[group] = hours;
      totalLaborHours += hours;
    }
  });
  
  return { laborHours, totalLaborHours };
}

/**
 * Get hours breakdown for a specific status
 */
export function calculateStatusPMCHours(projects: any[], status: string) {
  const statusProjects = projects.filter(p => p.status === status);
  return calculatePMCGroupHours(statusProjects);
}
