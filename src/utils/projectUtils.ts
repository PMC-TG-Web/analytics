import { Project } from "@/types";

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
  const number = (project.projectNumber ?? "").toString().trim();
  const customer = (project.customer ?? "").toString().trim();
  const name = (project.projectName ?? "").toString().trim();
  // Using a consistent grouping key
  return `${customer}~${number}~${name}`;
};
