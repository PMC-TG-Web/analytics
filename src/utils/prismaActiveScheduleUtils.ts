/**
 * activeScheduleUtils.ts (Prisma version)
 * 
 * Utilities for managing the activeSchedule table - the single source of truth
 * for all schedule views (short-term, long-term, and Gantt).
 */

import { prisma } from "@/lib/prisma";

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
 * Write an entry to activeSchedule
 */
export const writeActiveScheduleEntry = async (entry: ActiveScheduleEntry): Promise<void> => {
  await prisma.activeSchedule.upsert({
    where: {
      jobKey_scopeOfWork_date: {
        jobKey: entry.jobKey,
        scopeOfWork: entry.scopeOfWork,
        date: entry.date
      }
    },
    create: {
      jobKey: entry.jobKey,
      scopeOfWork: entry.scopeOfWork,
      date: entry.date,
      hours: entry.hours,
      foreman: entry.foreman,
      manpower: entry.manpower,
      source: entry.source
    },
    update: {
      hours: entry.hours,
      foreman: entry.foreman,
      manpower: entry.manpower,
      source: entry.source,
      lastModified: new Date()
    }
  });
};

/**
 * Delete an entry from activeSchedule
 */
export const deleteActiveScheduleEntry = async (jobKey: string, scopeOfWork: string, date: string): Promise<void> => {
  await prisma.activeSchedule.deleteMany({
    where: {
      jobKey,
      scopeOfWork,
      date
    }
  });
};

/**
 * Get all activeSchedule entries for a jobKey
 */
export const getActiveScheduleForJob = async (jobKey: string): Promise<ActiveScheduleEntry[]> => {
  const entries = await prisma.activeSchedule.findMany({
    where: { jobKey }
  });
  return entries as ActiveScheduleEntry[];
};

/**
 * Get all activeSchedule entries for a date range
 */
export const getActiveScheduleForDateRange = async (startDate: string, endDate: string): Promise<ActiveScheduleEntry[]> => {
  const entries = await prisma.activeSchedule.findMany({
    where: {
      date: {
        gte: startDate,
        lte: endDate
      }
    }
  });
  return entries as ActiveScheduleEntry[];
};

/**
 * Update scopeTracking for a specific scope
 */
export const updateScopeTracking = async (
  jobKey: string,
  scopeOfWork: string,
  totalHours: number,
  scheduledHours: number,
  unscheduledHours: number
): Promise<void> => {
  await prisma.scopeTracking.upsert({
    where: {
      jobKey_scopeOfWork: {
        jobKey,
        scopeOfWork
      }
    },
    create: {
      jobKey,
      scopeOfWork,
      totalHours,
      scheduledHours,
      unscheduledHours
    },
    update: {
      totalHours,
      scheduledHours,
      unscheduledHours,
      lastUpdated: new Date()
    }
  });
};

/**
 * Get scope tracking by jobKey
 */
export const getScopeTracking = async (jobKey: string): Promise<ScopeTracking[]> => {
  const tracking = await prisma.scopeTracking.findMany({
    where: { jobKey }
  });
  return tracking as ScopeTracking[];
};

/**
 * Delete all activeSchedule entries for a jobKey
 */
export const clearActiveScheduleForJob = async (jobKey: string): Promise<void> => {
  await prisma.activeSchedule.deleteMany({
    where: { jobKey }
  });
};
