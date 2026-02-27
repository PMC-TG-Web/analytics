/**
 * activeScheduleLoader.ts
 * 
 * Simplified schedule loading that reads from activeSchedule table.
 * Uses API endpoints instead of direct Firebase access.
 */

import { ActiveScheduleEntry } from './activeScheduleUtils';

export interface DayProject {
  jobKey: string;
  scopeOfWork: string;
  customer: string;
  projectNumber: string;
  projectName: string;
  hours: number;
  foreman?: string;
  employees?: string[];
  source: 'gantt' | 'short-term' | 'long-term' | 'schedules';
  date: string; // YYYY-MM-DD
}

/**
 * Load schedule data for a date range from activeSchedule API
 */
export async function loadActiveScheduleForDateRange(
  startDate: Date,
  endDate: Date
): Promise<{
  projectsByDate: Record<string, DayProject[]>;
  allJobKeys: Set<string>;
}> {
  const startDateStr = formatDateKey(startDate);
  const endDateStr = formatDateKey(endDate);
  
  try {
    // Call API endpoint to fetch active schedule for date range
    const response = await fetch(`/api/short-term-schedule?action=active-schedule&startDate=${startDateStr}&endDate=${endDateStr}`);
    const data = await response.json();
    
    const activeSchedules = data.data || [];
    
    const projectsByDate: Record<string, DayProject[]> = {};
    const allJobKeys = new Set<string>();
    
    activeSchedules.forEach((entry: any) => {
      const dateKey = entry.date;
      
      if (!entry.jobKey || !dateKey || !entry.hours) return;
      
      if (!projectsByDate[dateKey]) {
        projectsByDate[dateKey] = [];
      }
      
      // For aggregation: sum hours by jobKey per day
      const existing = projectsByDate[dateKey].find(p => p.jobKey === entry.jobKey);
      
      if (existing) {
        existing.hours += entry.hours;
      } else {
        projectsByDate[dateKey].push({
          jobKey: entry.jobKey,
          scopeOfWork: entry.scopeOfWork || '',
          customer: extractCustomer(entry.jobKey),
          projectNumber: extractProjectNumber(entry.jobKey),
          projectName: extractProjectName(entry.jobKey),
          hours: entry.hours,
          foreman: entry.foreman,
          employees: [],
          source: 'schedules',
          date: dateKey
        });
      }
      
      allJobKeys.add(entry.jobKey);
    });
    
    return { projectsByDate, allJobKeys };
  } catch (error) {
    console.error('Error loading active schedule:', error);
    return { projectsByDate: {}, allJobKeys: new Set<string>() };
  }
}

/**
 * Helper: Format date as YYYY-MM-DD
 */
function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Extract customer from jobKey (format: "customer~projectNumber~projectName")
 */
function extractCustomer(jobKey: string): string {
  const parts = jobKey.split('~');
  return parts[0] || '';
}

/**
 * Extract project number from jobKey
 */
function extractProjectNumber(jobKey: string): string {
  const parts = jobKey.split('~');
  return parts[1] || '';
}

/**
 * Extract project name from jobKey
 */
function extractProjectName(jobKey: string): string {
  const parts = jobKey.split('~');
  return parts[2] || '';
}

/**
 * Get the Monday of the week for a given date
 */
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface WeekProject {
  jobKey: string;
  customer: string;
  projectNumber: string;
  projectName: string;
  weekHours: Record<string, number>; // weekStartDate ISO string -> hours
  totalHours: number;
}

/**
 * Load schedule data aggregated by week for long-term schedule view
 */
export async function loadActiveScheduleByWeek(
  startDate: Date,
  endDate: Date
): Promise<{
  weekColumns: Array<{ weekStartDate: Date; weekLabel: string }>;
  jobRows: WeekProject[];
}> {
  const startDateStr = formatDateKey(startDate);
  const endDateStr = formatDateKey(endDate);
  
  try {
    // Call API endpoint to fetch active schedule for date range
    const response = await fetch(`/api/short-term-schedule?action=active-schedule&startDate=${startDateStr}&endDate=${endDateStr}`);
    const data = await response.json();
    
    const activeSchedules = data.data || [];
    
    // Maps for aggregation
    const weekMap = new Map<string, { weekStartDate: Date; weekLabel: string }>();
    const jobMap = new Map<string, WeekProject>();
    
    activeSchedules.forEach((entry: any) => {
      // Parse the date
      const entryDate = new Date(entry.date);
      if (isNaN(entryDate.getTime())) return;
      
      // Get week start (Monday)
      const weekStart = getWeekStart(entryDate);
      const weekKey = weekStart.toISOString();
      
      // Add week column if not exists
      if (!weekMap.has(weekKey)) {
        weekMap.set(weekKey, {
          weekStartDate: weekStart,
          weekLabel: weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        });
      }
      
      // Add or update job row
      if (!jobMap.has(entry.jobKey)) {
        jobMap.set(entry.jobKey, {
          jobKey: entry.jobKey,
          customer: extractCustomer(entry.jobKey),
          projectNumber: extractProjectNumber(entry.jobKey),
          projectName: extractProjectName(entry.jobKey),
          weekHours: {},
          totalHours: 0,
        });
      }
      
      const job = jobMap.get(entry.jobKey)!;
      job.weekHours[weekKey] = (job.weekHours[weekKey] || 0) + entry.hours;
      job.totalHours += entry.hours;
    });
    
    // Convert to arrays and sort
    const weekColumns = Array.from(weekMap.values()).sort((a, b) => 
      a.weekStartDate.getTime() - b.weekStartDate.getTime()
    );
    
    const jobRows = Array.from(jobMap.values()).sort((a, b) => 
      a.projectName.localeCompare(b.projectName)
    );
    
    return { weekColumns, jobRows };
  } catch (error) {
    console.error('Error loading active schedule by week:', error);
    return { weekColumns: [], jobRows: [] };
  }
}
