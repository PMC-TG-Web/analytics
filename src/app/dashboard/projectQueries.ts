/**
 * Project Query Utilities
 * 
 * This file contains all Firestore query functions used across the dashboard.
 * Each function has a specific purpose and should not be modified without
 * considering its impact on all pages that use it.
 */

import { prisma } from "@/lib/prisma";

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
  try {
    const projects = await prisma.project.findMany({
      where: {
        customer: customerName
      }
    });
    return projects as Project[];
  } catch (error) {
    console.error("Error fetching projects by customer:", error);
    return [];
  }
}

export async function getDashboardSummary(): Promise<DashboardSummary | null> {
  try {
    const summary = await prisma.dashboardSummary.findUnique({
      where: { id: "summary" }
    });
    if (summary) {
      return {
        totalSales: summary.totalSales,
        totalCost: summary.totalCost,
        totalHours: summary.totalHours,
        statusGroups: (summary.statusGroups as any) || {},
        contractors: (summary.contractors as any) || {},
        pmcGroupHours: (summary.pmcGroupHours as any) || {},
        laborBreakdown: (summary.laborBreakdown as any),
        lastUpdated: summary.lastUpdated
      };
    }
    return null;
  } catch (error) {
    console.error("Error fetching dashboard summary:", error);
    return null;
  }
}

/**
 * DASHBOARD: Fetch all relevant project documents for aggregation
 */
export async function getAllProjectsForDashboard(): Promise<Project[]> {
  try {
    const projects = await prisma.project.findMany();
    return projects as Project[];
  } catch (error) {
    console.error("Error fetching projects:", error);
    return [];
  }
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
  try {
    const projects = await prisma.project.findMany({
      where: {
        projectNumber,
        projectName,
        customer
      }
    });
    return projects as Project[];
  } catch (error) {
    console.error("Error fetching project line items:", error);
    return [];
  }
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
  
  const projects = await prisma.project.findMany({
    where: {
      status: { in: statuses }
    }
  });
  return projects as Project[];
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
  const projects = await prisma.project.findMany({
    where: {
      [field]: value
    }
  });
  return projects as Project[];
}
