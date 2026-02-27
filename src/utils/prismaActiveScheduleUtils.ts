/**
 * activeScheduleUtils.ts (Prisma version)
 * 
 * Stub implementations for static export mode - database connectivity removed.
 */

export interface ActiveScheduleEntry {
  id?: string;
  jobKey: string;
  scopeOfWork: string;
  date: string; // YYYY-MM-DD
  hours: number;
  foreman?: string;
  manpower?: number;
  source: 'gantt' | 'short-term' | 'long-term' | 'schedules';
  lastModified?: Date;
}

export interface ScopeTracking {
  id?: string;
  jobKey: string;
  scopeOfWork: string;
  totalHours: number;
  scheduledHours: number;
  unscheduledHours: number;
  lastUpdated?: Date;
}

/**
 * Write an entry to activeSchedule (no-op in static mode)
 */
export const writeActiveScheduleEntry = async (entry: ActiveScheduleEntry): Promise<void> => {
  console.warn('writeActiveScheduleEntry: Database operations not available in static export mode');
};

/**
 * Delete an entry from activeSchedule (no-op in static mode)
 */
export const deleteActiveScheduleEntry = async (jobKey: string, scopeOfWork: string, date: string): Promise<void> => {
  console.warn('deleteActiveScheduleEntry: Database operations not available in static export mode');
};

/**
 * Get all activeSchedule entries for a jobKey (returns empty in static mode)
 */
export const getActiveScheduleForJob = async (jobKey: string): Promise<ActiveScheduleEntry[]> => {
  return [];
};

/**
 * Get all activeSchedule entries for a date range (returns empty in static mode)
 */
export const getActiveScheduleForDateRange = async (startDate: string, endDate: string): Promise<ActiveScheduleEntry[]> => {
  return [];
};

/**
 * Update scopeTracking for a specific scope (no-op in static mode)
 */
export const updateScopeTracking = async (
  jobKey: string,
  scopeOfWork: string,
  totalHours?: number,
  scheduledHours?: number,
  unscheduledHours?: number
): Promise<void> => {
  console.warn('updateScopeTracking: Database operations not available in static export mode');
};

/**
 * Get scope tracking by jobKey (returns empty in static mode)
 */
export const getScopeTracking = async (jobKey: string): Promise<ScopeTracking[]> => {
  return [];
};

/**
 * Delete all activeSchedule entries for a jobKey (no-op in static mode)
 */
export const clearActiveScheduleForJob = async (jobKey: string): Promise<void> => {
  console.warn('clearActiveScheduleForJob: Database operations not available in static export mode');
};
