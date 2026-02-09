/**
 * Project Query Utilities
 * 
 * This file contains all Firestore query functions used across the dashboard.
 * Each function has a specific purpose and should not be modified without
 * considering its impact on all pages that use it.
 */

import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/firebase";

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

/**
 * DASHBOARD: Fetch all project documents for aggregation
 * 
 * Used by: src/app/dashboard/page.tsx
 * Purpose: Gets ALL project documents to be aggregated by the dashboard logic
 * 
 * Note: This returns ALL documents, including 829 separate Giant line items.
 * The dashboard will group these by projectNumber + customer and aggregate.
 * 
 * DO NOT add filters here - the dashboard handles filtering in memory.
 */
export async function getAllProjectsForDashboard(): Promise<Project[]> {
  const querySnapshot = await getDocs(collection(db, "projects"));
  return querySnapshot.docs.map((doc) => ({ 
    id: doc.id, 
    ...doc.data() 
  } as Project));
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
  const q = query(
    collection(db, "projects"),
    where("projectNumber", "==", projectNumber),
    where("projectName", "==", projectName || ""),
    where("customer", "==", customer || "")
  );
  
  const snapshot = await getDocs(q);
  const projectDocs = snapshot.docs;
  
  if (projectDocs.length === 0) {
    return [];
  }
  
  // Check if first document has items array (consolidated format)
  const firstDocData = projectDocs[0].data();
  if (firstDocData.items && Array.isArray(firstDocData.items)) {
    // Use the items array from the consolidated document
    return firstDocData.items as Project[];
  } else if (projectDocs.length > 1) {
    // Multiple documents found - treat each as a separate line item
    return projectDocs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    } as Project));
  } else {
    // Single document without items array - treat as single line item
    return [
      {
        id: projectDocs[0].id,
        ...firstDocData,
      } as Project,
    ];
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
  
  // Firestore limitation: 'in' queries limited to 10 values
  // If more than 10 statuses, we'd need to split into multiple queries
  const q = query(
    collection(db, "projects"),
    where("status", "in", statuses.slice(0, 10))
  );
  
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ 
    id: doc.id, 
    ...doc.data() 
  } as Project));
}

/**
 * SEARCH: Fetch projects matching search criteria
 * 
 * Used by: Future search functionality
 * Purpose: Gets projects that match specific field values
 * 
 * Note: Firestore doesn't support full-text search. For complex searches,
 * consider using getAllProjectsForDashboard() and filtering in memory.
 * 
 * @param field - The field to search in
 * @param value - The value to search for
 */
export async function searchProjects(field: string, value: any): Promise<Project[]> {
  const q = query(
    collection(db, "projects"),
    where(field, "==", value)
  );
  
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ 
    id: doc.id, 
    ...doc.data() 
  } as Project));
}
