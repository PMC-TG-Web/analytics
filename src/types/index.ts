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
  predecessorScopeId?: string | null;
  jobKey?: string;
  startDate?: string;
  endDate?: string;
  manpower?: number;
  description?: string;
  tasks?: Array<string | ScheduleTask>;
  color?: string; // Hex color code for scope (e.g., "#3B82F6")
  taskColors?: Record<string, string>; // Map of task names to color codes
  schedulingMode?: "contiguous" | "specific-days";
  selectedDays?: Array<{
    date: string;
    hours: number;
    foreman?: string | null;
  }>;
  sales?: number;
  cost?: number;
  hours?: number;
}

export interface ScheduleTask {
  name: string;
  startDate?: string;
  endDate?: string;
  days?: number | null;
  manpower?: number | null;
  yards?: number | null;
  concreteConfirmed?: boolean;
}

export interface Holiday {
  id?: string;
  name: string;
  date: string; // YYYY-MM-DD
  isPaid?: boolean;
  description?: string;
}

export interface ProjectInfo {
  jobKey: string;
  customer: string;
  projectNumber: string;
  projectName: string;
  projectDocId: string;
  projectManager?: string;
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
  tasks?: Array<string | ScheduleTask>;
  sales?: number;
  cost?: number;
  hours?: number;
}
