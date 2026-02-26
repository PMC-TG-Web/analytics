/**
 * Real Project Data from JSON
 * 
 * This module loads real project data from public/projects-backup.json
 * (previously exported from Bid_Distro-Preconstruction.csv)
 * and provides it as the mock data source instead of hardcoded samples.
 */

export type Project = {
  id: string;
  projectNumber?: string;
  projectName?: string;
  customer?: string;
  status?: string;
  sales?: number;
  cost?: number;
  hours?: number;
  laborSales?: number;
  laborCost?: number;
  pmcGroup?: string;
  estimator?: string;
  projectManager?: string;
  dateCreated?: any;
  dateUpdated?: any;
  projectArchived?: boolean;
  costitems?: string;
  [key: string]: any;
};

export type DashboardSummary = {
  totalSales: number;
  totalCost: number;
  totalHours: number;
  statusGroups: Record<string, any>;
  contractors: Record<string, any>;
  pmcGroupHours: Record<string, number>;
  lastUpdated: any;
};

/**
 * Load real project data from public/projects-backup.json
 */
async function loadRealProjectData(): Promise<Project[]> {
  try {
    console.log('Loading real project data from backup JSON...');
    
    // Try to load from file system first (for server-side rendering)
    if (typeof window === 'undefined') {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const filePath = path.join(process.cwd(), 'public', 'projects-backup.json');
        const data = fs.readFileSync(filePath, 'utf-8');
        const projects = JSON.parse(data);
        console.log(`✓ Loaded ${projects.length} real projects from backup (server-side)`);
        return projects;
      } catch (fsError: any) {
        console.warn('Could not load from filesystem:', fsError.message);
      }
    }
    
    // Fallback to fetch for browser context
    const response = await fetch('/projects-backup.json');
    if (!response.ok) {
      console.warn('projects-backup.json not found');
      return [];
    }
    
    const projects = await response.json();
    console.log(`✓ Loaded ${projects.length} real projects from backup`);
    
    return projects;

  } catch (error: any) {
    console.error('Error loading projects backup:', error.message);
    // Return empty if JSON not found (will show demo data instead)
    return [];
  }
}

// Load once on module init - using Promise pattern
let REAL_PROJECTS: Project[] = [];

// Initialize the loading promise immediately
const loadPromise = (async () => {
  try {
    REAL_PROJECTS = await loadRealProjectData();
  } catch (error) {
    console.warn('Could not load real projects, will use defaults');
    REAL_PROJECTS = [];
  }
  return REAL_PROJECTS;
})();

/**
 * Get all real projects - waits for async load to complete
 */
export async function getRealProjects(): Promise<Project[]> {
  // Wait for the loading promise to complete
  await loadPromise;
  return REAL_PROJECTS;
}

/**
 * Generate summary from real project data
 */
export function generateSummary(): DashboardSummary {
  const summary: DashboardSummary = {
    totalSales: 0,
    totalCost: 0,
    totalHours: 0,
    statusGroups: {},
    contractors: {},
    pmcGroupHours: {},
    lastUpdated: new Date().toISOString()
  };

  REAL_PROJECTS.forEach(project => {
    const status = project.status || "Unknown";
    const customer = project.customer || "Unknown";

    // Totals
    summary.totalSales += project.sales || 0;
    summary.totalCost += project.cost || 0;
    summary.totalHours += project.hours || 0;

    // Status groups
    if (!summary.statusGroups[status]) {
      summary.statusGroups[status] = {
        sales: 0,
        cost: 0,
        hours: 0,
        count: 0
      };
    }
    summary.statusGroups[status].sales += project.sales || 0;
    summary.statusGroups[status].cost += project.cost || 0;
    summary.statusGroups[status].hours += project.hours || 0;
    summary.statusGroups[status].count += 1;

    // Contractors
    if (!summary.contractors[customer]) {
      summary.contractors[customer] = {
        sales: 0,
        cost: 0,
        hours: 0,
        count: 0,
        byStatus: {}
      };
    }
    const c = summary.contractors[customer];
    c.sales += project.sales || 0;
    c.cost += project.cost || 0;
    c.hours += project.hours || 0;
    c.count += 1;

    if (!c.byStatus[status]) {
      c.byStatus[status] = { sales: 0, cost: 0, hours: 0, count: 0 };
    }
    c.byStatus[status].sales += project.sales || 0;
    c.byStatus[status].cost += project.cost || 0;
    c.byStatus[status].hours += project.hours || 0;
    c.byStatus[status].count += 1;
  });

  return summary;
}
