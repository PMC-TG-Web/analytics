import { Project, Scope } from "@/types";

export const parseDateValue = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && typeof value.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  return null;
};

export const getProjectDate = (project: Project): Date | null => {
  const updated = parseDateValue(project.dateUpdated);
  const created = parseDateValue(project.dateCreated);
  if (updated && created) return updated > created ? updated : created;
  return updated || created || null;
};

export const getProjectKey = (project: Project): string => {
  const customer = (project.customer ?? "").toString().trim();
  const number = (project.projectNumber ?? "").toString().trim();
  const name = (project.projectName ?? "").toString().trim();

  if (!customer && !number && !name) {
    return `__noKey__${project.id || Math.random().toString(36).substr(2, 9)}`;
  }

  return `${customer}~${number}~${name}`;
};

export function calculateAggregated(projects: Project[]): { aggregated: Project[]; dedupedByCustomer: Project[] } {
  // Group by project identifier (number or name) to find duplicates across different customers
  const projectIdentifierMap = new Map<string, Project[]>();
  projects.forEach((project) => {
    const identifier = (project.projectNumber ?? project.projectName ?? "").toString().trim();
    if (!identifier) return;
    
    if (!projectIdentifierMap.has(identifier)) {
      projectIdentifierMap.set(identifier, []);
    }
    projectIdentifierMap.get(identifier)!.push(project);
  });
  
  // For each project identifier, keep only the most recent/relevant customer version
  const dedupedByCustomer: Project[] = [];
  projectIdentifierMap.forEach((projectList) => {
    const customerMap = new Map<string, Project[]>();
    projectList.forEach(p => {
      const customer = (p.customer ?? "").toString().trim();
      if (!customerMap.has(customer)) {
        customerMap.set(customer, []);
      }
      customerMap.get(customer)!.push(p);
    });
    
    if (customerMap.size > 1) {
      const priorityStatuses = ["Accepted", "In Progress", "Complete"];
      let selectedProjects: Project[] = [];
      
      let foundPriorityCustomer = false;
      customerMap.forEach((projs) => {
        const hasPriorityStatus = projs.some(p => priorityStatuses.includes(p.status || ""));
        if (hasPriorityStatus && !foundPriorityCustomer) {
          selectedProjects = projs;
          foundPriorityCustomer = true;
        }
      });
      
      if (!foundPriorityCustomer) {
        let latestDate: Date | null = null;
        let latestCustomerProjs: Project[] = [];
        
        customerMap.forEach((projs) => {
          const mostRecentProj = projs.reduce((latest, current) => {
            const currentDate = parseDateValue(current.dateCreated);
            const latestDateVal = parseDateValue(latest.dateCreated);
            if (!currentDate) return latest;
            if (!latestDateVal) return current;
            return currentDate > latestDateVal ? current : latest;
          }, projs[0]);
          
          const projDate = parseDateValue(mostRecentProj.dateCreated);
          if (projDate && (!latestDate || projDate > latestDate)) {
            latestDate = projDate;
            latestCustomerProjs = projs;
          }
        });
        
        selectedProjects = latestCustomerProjs;
      }
      dedupedByCustomer.push(...selectedProjects);
    } else {
      projectList.forEach(p => dedupedByCustomer.push(p));
    }
  });
  
  // Aggregate multiple line items for the same project number + customer
  const keyGroupMap = new Map<string, Project[]>();
  dedupedByCustomer.forEach((project) => {
    const key = getProjectKey(project);
    if (!keyGroupMap.has(key)) {
      keyGroupMap.set(key, []);
    }
    keyGroupMap.get(key)!.push(project);
  });
  
  const aggregated: Project[] = [];
  keyGroupMap.forEach((groupProjects) => {
    const sorted = groupProjects.sort((a, b) => {
      const nameA = (a.projectName ?? "").toString().toLowerCase();
      const nameB = (b.projectName ?? "").toString().toLowerCase();
      return nameA.localeCompare(nameB);
    });
    
    const baseProject = { ...sorted[0] };
    baseProject.sales = sorted.reduce((sum, p) => sum + (p.sales ?? 0), 0);
    baseProject.cost = sorted.reduce((sum, p) => sum + (p.cost ?? 0), 0);
    baseProject.hours = sorted.reduce((sum, p) => sum + (p.hours ?? 0), 0);
    baseProject.projectedPreconstHours = sorted.reduce((sum, p) => sum + (Number(p.projectedPreconstHours) || 0), 0);
    baseProject.laborSales = sorted.reduce((sum, p) => sum + (p.laborSales ?? 0), 0);
    baseProject.laborCost = sorted.reduce((sum, p) => sum + (p.laborCost ?? 0), 0);

    const mostRecentProject = sorted.reduce((latest, current) => {
      const latestDate = getProjectDate(latest);
      const currentDate = getProjectDate(current);
      if (!currentDate) return latest;
      if (!latestDate) return current;
      return currentDate > latestDate ? current : latest;
    }, sorted[0]);
    
    baseProject.dateUpdated = mostRecentProject.dateUpdated;
    baseProject.dateCreated = mostRecentProject.dateCreated;
    
    aggregated.push(baseProject);
  });
  
  return { aggregated, dedupedByCustomer };
}

export const isExcludedFromDashboard = (project: Project): boolean => {
  if (project.projectArchived) return true;
  
  const status = (project.status || "").toString().toLowerCase().trim();
  if (status === "invitations" || status === "to do" || status === "todo" || status === "to-do") return true;

  const customer = (project.customer ?? "").toString().toLowerCase();
  if (customer.includes("sop inc")) return true;

  const projectName = (project.projectName ?? "").toString().toLowerCase();
  const excludedNames = [
    "pmc operations",
    "pmc shop time",
    "pmc test project",
    "alexander drive addition latest"
  ];
  if (excludedNames.includes(projectName)) return true;
  if (projectName.includes("sandbox")) return true;
  if (projectName.includes("raymond king")) return true;

  const projectNumber = (project.projectNumber ?? "").toString().toLowerCase();
  if (projectNumber === "701 poplar church rd") return true;

  return false;
};

export const getEnrichedScopes = (scopes: Scope[], projects: Project[]): Scope[] => {
  const projectCostItems: Record<string, Array<{ costitems: string; scopeOfWork: string; sales: number; cost: number; hours: number; costType: string }>> = {};

  projects.forEach((p) => {
    const jobKey = p.jobKey || getProjectKey(p);
    if (!jobKey) return;
    if (!projectCostItems[jobKey]) projectCostItems[jobKey] = [];

    projectCostItems[jobKey].push({
      costitems: (p.costitems || "").toLowerCase(),
      scopeOfWork: (p.scopeOfWork || "").toLowerCase(),
      sales: typeof p.sales === "number" ? p.sales : 0,
      cost: typeof p.cost === "number" ? p.cost : 0,
      hours: typeof p.hours === "number" ? p.hours : 0,
      costType: typeof p.costType === "string" ? p.costType : "",
    });
  });

  return scopes.map((s) => {
    const jobKey = s.jobKey;
    if (!jobKey) return s;

    const title = (s.title || "Scope").trim().toLowerCase();
    const titleWithoutQty = title
      .replace(/^[\d,]+\s*(sq\s*ft\.?|ln\s*ft\.?|each|lf)?\s*([-–]\s*)?/i, "")
      .trim();

    const costItems = projectCostItems[jobKey] || [];
    const matchedItems = costItems.filter((item) =>
      item.scopeOfWork.includes(titleWithoutQty) || 
      titleWithoutQty.includes(item.scopeOfWork) ||
      item.costitems.includes(titleWithoutQty) || 
      titleWithoutQty.includes(item.costitems)
    );

    const totals = matchedItems.reduce(
      (acc, item) => {
        acc.sales += item.sales;
        acc.cost += item.cost;
        if (!item.costType.toLowerCase().includes("management")) {
          acc.hours += item.hours;
        }
        return acc;
      },
      { sales: 0, cost: 0, hours: 0 }
    );

    return {
      ...s,
      sales: matchedItems.length > 0 ? totals.sales : s.sales,
      cost: matchedItems.length > 0 ? totals.cost : s.cost,
      hours: matchedItems.length > 0 ? totals.hours : s.hours,
    };
  });
};
