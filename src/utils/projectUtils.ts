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
  const number = String(project.projectNumber ?? "").trim();
  const customer = String(project.customer ?? "").trim();
  const name = String(project.projectName ?? "").trim();
  // Using a consistent grouping key
  return `${customer}~${number}~${name}`.replace(/\s+/g, ' ');
};

export const getEnrichedScopes = (scopes: Scope[], projects: Project[]): Scope[] => {
  const projectCostItems: Record<string, Array<{ costitems: string; sales: number; cost: number; hours: number; costType: string }>> = {};

  projects.forEach((p) => {
    const jobKey = p.jobKey || getProjectKey(p);
    if (!jobKey) return;
    if (!projectCostItems[jobKey]) projectCostItems[jobKey] = [];

    projectCostItems[jobKey].push({
      costitems: (p.costitems || "").toLowerCase(),
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
      item.costitems.includes(titleWithoutQty) || titleWithoutQty.includes(item.costitems)
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
