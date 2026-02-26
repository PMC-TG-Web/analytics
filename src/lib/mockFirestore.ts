/**
 * Mock Firebase/Firestore Data Service
 * 
 * Provides real project data from CSV when Firebase is suspended,
 * or sample data if CSV is not available.
 * Automatically activates when Firebase is unavailable.
 */

import { getRealProjects } from "@/lib/realProjectData";

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

// Try to load real projects, fallback to sample data
const REAL_PROJECTS = getRealProjects();

// Sample projects for demo (fallback only)
const SAMPLE_PROJECTS: Project[] = [
  {
    id: "proj_1",
    projectNumber: "2508",
    projectName: "Giant #6582",
    customer: "Ames Construction",
    status: "In Progress",
    sales: 125000,
    cost: 87500,
    hours: 450,
    pmcGroup: "Concrete",
    estimator: "John Smith",
    projectManager: "Sarah Johnson",
    dateCreated: new Date("2025-12-01"),
    dateUpdated: new Date("2026-02-20")
  },
  {
    id: "proj_2",
    projectNumber: "2509",
    projectName: "Washburn Dam Expansion",
    customer: "Washburn Solutions",
    status: "Bid Submitted",
    sales: 89500,
    cost: 62300,
    hours: 320,
    pmcGroup: "Structural",
    estimator: "Mike Brown",
    projectManager: "Lisa Davis",
    dateCreated: new Date("2026-01-15"),
    dateUpdated: new Date("2026-02-18")
  },
  {
    id: "proj_3",
    projectNumber: "2510",
    projectName: "Kemper Project Phase 2",
    customer: "Kemper Construction",
    status: "Accepted",
    sales: 225000,
    cost: 145000,
    hours: 680,
    pmcGroup: "Concrete",
    estimator: "John Smith",
    projectManager: "Robert Wilson",
    dateCreated: new Date("2025-10-20"),
    dateUpdated: new Date("2026-02-15")
  },
  {
    id: "proj_4",
    projectNumber: "2511",
    projectName: "Goods Store Quarryville",
    customer: "Goods Store Inc",
    status: "Complete",
    sales: 78900,
    cost: 52100,
    hours: 290,
    pmcGroup: "General Labor",
    estimator: "Emma Taylor",
    projectManager: "Sarah Johnson",
    dateCreated: new Date("2025-09-01"),
    dateUpdated: new Date("2026-02-12")
  },
  {
    id: "proj_5",
    projectNumber: "2512",
    projectName: "UGI Site Remediation",
    customer: "UGI Utilities",
    status: "In Progress",
    sales: 156000,
    cost: 108400,
    hours: 520,
    pmcGroup: "Safety",
    estimator: "Tom Anderson",
    projectManager: "Michael Taylor",
    dateCreated: new Date("2025-11-05"),
    dateUpdated: new Date("2026-02-19")
  },
  {
    id: "proj_6",
    projectNumber: "2513",
    projectName: "Memorial Care Center 3A",
    customer: "Memorial Care",
    status: "Bid Submitted",
    sales: 198500,
    cost: 132300,
    hours: 610,
    pmcGroup: "Concrete",
    estimator: "John Smith",
    projectManager: "Lisa Davis",
    dateCreated: new Date("2025-12-10"),
    dateUpdated: new Date("2026-02-17")
  },
  {
    id: "proj_7",
    projectNumber: "2514",
    projectName: "AB Martin Renovation",
    customer: "AB Martin Inc",
    status: "Accepted",
    sales: 95000,
    cost: 63500,
    hours: 380,
    pmcGroup: "General Labor",
    estimator: "Emma Taylor",
    projectManager: "Robert Wilson",
    dateCreated: new Date("2025-12-20"),
    dateUpdated: new Date("2026-02-14")
  },
  {
    id: "proj_8",
    projectNumber: "2515",
    projectName: "Stevens Feed Mill Expansion",
    customer: "Stevens Farm Supply",
    status: "In Progress",
    sales: 142000,
    cost: 94000,
    hours: 510,
    pmcGroup: "Structural",
    estimator: "Mike Brown",
    projectManager: "Sarah Johnson",
    dateCreated: new Date("2026-01-01"),
    dateUpdated: new Date("2026-02-16")
  }
];

/**
 * Generate summary from real or sample data
 */
function generateSummary(projects: Project[]): DashboardSummary {
  // Fallback to sample projects if empty
  const projectsToUse = projects.length > 0 ? projects : SAMPLE_PROJECTS;
  
  const summary: DashboardSummary = {
    totalSales: 0,
    totalCost: 0,
    totalHours: 0,
    statusGroups: {},
    contractors: {},
    pmcGroupHours: {},
    lastUpdated: new Date().toISOString()
  };

  projectsToUse.forEach(project => {
    const status = project.status || "Unknown";
    const customer = project.customer || "Unknown";

    summary.totalSales += project.sales || 0;
    summary.totalCost += project.cost || 0;
    summary.totalHours += project.hours || 0;

    if (!summary.statusGroups[status]) {
      summary.statusGroups[status] = {
        sales: 0,
        cost: 0,
        hours: 0,
        count: 0,
        laborByGroup: {}
      };
    }
    summary.statusGroups[status].sales += project.sales || 0;
    summary.statusGroups[status].cost += project.cost || 0;
    summary.statusGroups[status].hours += project.hours || 0;
    summary.statusGroups[status].count += 1;

    // Aggregate pmcBreakdown hours by group for this status
    if (project.pmcBreakdown && typeof project.pmcBreakdown === 'object') {
      Object.entries(project.pmcBreakdown).forEach(([group, hours]) => {
        const h = Number(hours) || 0;
        if (h > 0) {
          if (!summary.statusGroups[status].laborByGroup) {
            summary.statusGroups[status].laborByGroup = {};
          }
          summary.statusGroups[status].laborByGroup[group] = 
            (summary.statusGroups[status].laborByGroup[group] || 0) + h;
        }
      });
    }

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
    c.byStatus[status].hours += project.sales || 0;
    c.byStatus[status].count += 1;

    const pmcGroup = project.pmcGroup || "Unassigned";
    summary.pmcGroupHours[pmcGroup] = (summary.pmcGroupHours[pmcGroup] || 0) + (project.hours || 0);
  });

  return summary;
}

/**
 * Mock Firestore interface matching real Firestore usage
 */
export const mockFirestore = {
  enableOfflineMode: () => {
    console.log(`✓ Mock Firestore activated (loading real data...)`);
  },

  async getProjects(): Promise<Project[]> {
    // Wait for real projects to load
    const realProjects = await getRealProjects();
    // Simulate network delay
    await new Promise(r => setTimeout(r, 100));
    // Use real projects if available, otherwise sample
    return realProjects.length > 0 ? realProjects : SAMPLE_PROJECTS;
  },

  async getProjectsByCustomer(customer: string): Promise<Project[]> {
    const realProjects = await getRealProjects();
    await new Promise(r => setTimeout(r, 100));
    const projects = realProjects.length > 0 ? realProjects : SAMPLE_PROJECTS;
    return projects.filter(p => p.customer === customer);
  },

  async getDashboardSummary(): Promise<DashboardSummary> {
    const realProjects = await getRealProjects();
    await new Promise(r => setTimeout(r, 50));
    return generateSummary(realProjects);
  },

  async getProjectLineItems(
    projectNumber: string,
    projectName: string,
    customer: string
  ): Promise<Project[]> {
    const realProjects = await getRealProjects();
    await new Promise(r => setTimeout(r, 100));
    const projects = realProjects.length > 0 ? realProjects : SAMPLE_PROJECTS;
    return projects.filter(
      p => p.projectNumber === projectNumber &&
           p.projectName === projectName &&
           p.customer === customer
    );
  },

  async searchProjects(query: string): Promise<Project[]> {
    const realProjects = await getRealProjects();
    await new Promise(r => setTimeout(r, 100));
    const lowerQuery = query.toLowerCase();
    const projects = realProjects.length > 0 ? realProjects : SAMPLE_PROJECTS;
    return projects.filter(p =>
      (p.projectName?.toLowerCase().includes(lowerQuery)) ||
      (p.projectNumber?.toLowerCase().includes(lowerQuery)) ||
      (p.customer?.toLowerCase().includes(lowerQuery))
    );
  }
};

export default mockFirestore;
