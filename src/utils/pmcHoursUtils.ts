/**
 * Calculate hours aggregated by PMC Group across all projects
 * @param projects Array of projects with pmcGroup data (9 main categories: SITE, FOUNDATION, STRUCTURES, EXTERIOR, INTERIOR, MEP, EQUIPMENT, MATERIALS, SPECIAL)
 * @returns Object with total hours and breakdown by group
 */
export function calculatePMCGroupHours(projects: any[]) {
  const pmcGroupHours: Record<string, number> = {};
  
  projects.forEach(project => {
    // Use pmcGroup - the aggregated 9 PMC groups
    if (project.pmcGroup && typeof project.pmcGroup === 'object') {
      Object.entries(project.pmcGroup).forEach(([group, hours]) => {
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
 * Filter hours to only include labor/work categories (exclude material/structural info)
 * For PMC groups: excludes MATERIALS and includes all work categories
 */
export function filterLaborHours(pmcGroupHours: Record<string, number>) {
  // PMC groups that represent actual labor/work (exclude MATERIALS which is non-labor supplies)
  const laborCategories = new Set([
    'SITE', 'FOUNDATION', 'STRUCTURES', 'EXTERIOR', 'INTERIOR', 'MEP', 'EQUIPMENT', 'SPECIAL'
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
