export interface Project {
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
  jobKey?: string;
  costitems?: string;
  costType?: string;
  [key: string]: any;
}

export interface Scope {
  id: string;
  title: string;
  jobKey?: string;
  startDate?: string;
  endDate?: string;
  manpower?: number;
  description?: string;
  tasks?: string[];
  sales?: number;
  cost?: number;
  hours?: number;
}

export interface Holiday {
  id?: string;
  name: string;
  date: string; // YYYY-MM-DD
  isPaid?: boolean;
}

export interface ProjectInfo {
  jobKey: string;
  customer: string;
  projectNumber: string;
  projectName: string;
  projectDocId: string;
}

export type ViewMode = "day" | "week" | "month";

export interface GanttTask {
  type: "project" | "scope";
  jobKey: string;
  customer: string;
  projectNumber: string;
  projectName: string;
  projectDocId: string;
  scopeId?: string;
  title?: string;
  start: Date;
  end: Date;
  totalHours: number;
  manpower?: number;
  description?: string;
  tasks?: string[];
  sales?: number;
  cost?: number;
  hours?: number;
}
