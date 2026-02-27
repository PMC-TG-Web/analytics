/**
 * activeScheduleLoader.ts
 * 
 * Simplified schedule loading that reads from activeSchedule collection.
 * Replaces the complex fallback logic with a single source of truth.
 */


import { db } from '@/firebase';
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
 * Load schedule data for a date range from activeSchedule
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
  
  // Query activeSchedule for date range
  const q = query(
    collection(db, 'activeSchedule'),
    where('date', '>=', startDateStr),
    where('date', '<=', endDateStr)
  );
  
  const snapshot = await getDocs(q);
  
  const projectsByDate: Record<string, DayProject[]> = {};
  const allJobKeys = new Set<string>();
  
  snapshot.docs.forEach(doc => {
    const entry = doc.data() as ActiveScheduleEntry;
    
    if (!entry.jobKey || !entry.date || !entry.hours) return;
    
    if (!projectsByDate[entry.date]) {
      projectsByDate[entry.date] = [];
    }
    
    // For aggregation: sum hours by jobKey per day
    // (Multiple scopes for same project on same day are shown as one card)
    const existing = projectsByDate[entry.date].find(p => p.jobKey === entry.jobKey);
    
    if (existing) {
      existing.hours += entry.hours;
    } else {
      projectsByDate[entry.date].push({
        jobKey: entry.jobKey,
        scopeOfWork: entry.scopeOfWork,
        customer: extractCustomer(entry.jobKey),
        projectNumber: extractProjectNumber(entry.jobKey),
        projectName: extractProjectName(entry.jobKey),
        hours: entry.hours,
        foreman: entry.foreman,
        employees: [],
        source: entry.source,
        date: entry.date
      });
    }
    
    allJobKeys.add(entry.jobKey);
  });
  
  return { projectsByDate, allJobKeys };
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
  
  // Query activeSchedule for date range
  const q = query(
    collection(db, 'activeSchedule'),
    where('date', '>=', startDateStr),
    where('date', '<=', endDateStr)
  );
  
  const snapshot = await getDocs(q);
  
  // Maps for aggregation
  const weekMap = new Map<string, { weekStartDate: Date; weekLabel: string }>();
  const jobMap = new Map<string, WeekProject>();
  
  snapshot.docs.forEach(doc => {
    const entry = doc.data() as ActiveScheduleEntry;
    
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
}
