/**
 * Project Query Utilities
 * 
 * This file contains all Firestore query functions used across the dashboard.
 * Each function has a specific purpose and should not be modified without
 * considering its impact on all pages that use it.
 */

const DEFAULT_PAGE_SIZE = 500;

type ProjectsApiResponse = {
  success: boolean;
  data?: Project[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasNextPage?: boolean;
};

async function fetchProjectsPage(params: URLSearchParams): Promise<ProjectsApiResponse> {
  const response = await fetch(`/api/projects?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed projects API call: ${response.status}`);
  }

  const json = await response.json();
  if (!json?.success) {
    throw new Error('Projects API returned unsuccessful response');
  }

  return json as ProjectsApiResponse;
}

async function fetchAllProjects(params: URLSearchParams): Promise<Project[]> {
  const allRows: Project[] = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    params.set('page', String(page));
    params.set('pageSize', String(DEFAULT_PAGE_SIZE));

    const json = await fetchProjectsPage(params);
    const rows = Array.isArray(json.data) ? json.data : [];
    allRows.push(...rows);

    hasNextPage = Boolean(json.hasNextPage);
    page += 1;
  }

  return allRows;
}

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
  dateUpdated?: any;
  dateCreated?: any;
  projectArchived?: boolean;
  estimator?: string;
  projectManager?: string;
  [key: string]: any;
};

export type DashboardSummary = {
  totalSales: number;
  totalCost: number;
  totalHours: number;
  statusGroups: Record<string, { 
    sales: number; 
    cost: number; 
    hours: number; 
    count: number;
    laborByGroup?: Record<string, number>;
  }>;
  contractors: Record<string, { 
    sales: number; 
    cost: number; 
    hours: number; 
    count: number;
    byStatus: Record<string, { sales: number; cost: number; hours: number; count: number }>;
  }>;
  pmcGroupHours: Record<string, number>;
  laborBreakdown?: Record<string, number>;
  lastUpdated: any;
};

/**
 * DASHBOARD: Fetch projects by customer
 */
export async function getProjectsByCustomer(customerName: string): Promise<Project[]> {
  if (!customerName) return [];

  const params = new URLSearchParams();
  params.set('mode', 'dashboard');
  params.set('customer', customerName);

  return fetchAllProjects(params);
}

export async function getDashboardSummary(): Promise<DashboardSummary | null> {
  try {
    const response = await fetch('/api/dashboard-summary');
    if (!response.ok) {
      return null;
    }

    const json = await response.json();
    if (!json?.success || !json?.data) {
      return null;
    }

    return json.data as DashboardSummary;
  } catch {
    return null;
  }
}

/**
 * DASHBOARD: Fetch all relevant project documents for aggregation
 */
export async function getAllProjectsForDashboard(): Promise<Project[]> {
  const params = new URLSearchParams();
  params.set('mode', 'dashboard');

  return fetchAllProjects(params);
}

/**
 * MODAL: Fetch line items for a specific project
 * 
 * Used by: src/app/dashboard/DrillThroughModals.tsx (JobDetailsModal)
 * Purpose: Gets all line items (documents) for ONE specific project
 * 
 * Filters by THREE fields to prevent pulling wrong projects:
 * - projectNumber (e.g., "2508 - GI")
 * - projectName (e.g., "Giant #6582")
 * - customer (e.g., "Ames Construction")
 * 
 * Example: Giant #6582 has 829 line items, all returned by this query.
 * 
 * @param projectNumber - The project number to filter by
 * @param projectName - The project name to filter by
 * @param customer - The customer name to filter by
 */
export async function getProjectLineItems(
  projectNumber: string,
  projectName: string,
  customer: string
): Promise<Project[]> {
  const params = new URLSearchParams();
  params.set('mode', 'dashboard');
  if (projectNumber) params.set('projectNumber', projectNumber);
  if (projectName) params.set('projectName', projectName);
  if (customer) params.set('customer', customer);

  return fetchAllProjects(params);
}

/**
 * SCHEDULING: Fetch projects by status for scheduling page
 * 
 * Used by: src/app/scheduling/page.tsx (if needed in future)
 * Purpose: Gets projects filtered by specific statuses
 * 
 * @param statuses - Array of status values to filter by
 */
export async function getProjectsByStatus(statuses: string[]): Promise<Project[]> {
  if (statuses.length === 0) {
    return getAllProjectsForDashboard();
  }

  const params = new URLSearchParams();
  params.set('mode', 'dashboard');
  params.set('statuses', statuses.join(','));

  return fetchAllProjects(params);
}

/**
 * SEARCH: Fetch projects matching search criteria
 * 
 * Used by: Future search functionality
 * Purpose: Gets projects that match specific field values
 * 
 * @param field - The field to search in
 * @param value - The value to search for
 */
export async function searchProjects(field: string, value: any): Promise<Project[]> {
  const allowedFields = new Set(['customer', 'projectNumber', 'projectName']);
  if (!allowedFields.has(field) || value === undefined || value === null || value === '') {
    return [];
  }

  const params = new URLSearchParams();
  params.set('mode', 'dashboard');
  params.set(field, String(value));

  return fetchAllProjects(params);
}
