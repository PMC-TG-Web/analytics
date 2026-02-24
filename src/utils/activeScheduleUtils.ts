/**
 * activeScheduleUtils.ts
 * 
 * Utilities for managing the activeSchedule collection - the single source of truth
 * for all schedule views (short-term, long-term, and Gantt).
 */

import { collection, doc, setDoc, deleteDoc, getDocs, query, where, writeBatch, Timestamp } from 'firebase/firestore';
import { db } from '@/firebase';

export interface ActiveScheduleEntry {
  id?: string;
  jobKey: string;
  scopeOfWork: string;
  date: string; // YYYY-MM-DD
  hours: number;
  foreman?: string;
  manpower?: number;
  source: 'gantt' | 'short-term' | 'long-term' | 'schedules';
  lastModified: Date | Timestamp;
}

export interface ScopeTracking {
  id?: string;
  jobKey: string;
  scopeOfWork: string;
  totalHours: number;
  scheduledHours: number;
  unscheduledHours: number;
  lastUpdated: Date | Timestamp;
}

/**
 * Generate a document ID for activeSchedule
 */
export const getActiveScheduleDocId = (jobKey: string, scopeOfWork: string, date: string): string => {
  // Sanitize for Firestore document ID (remove special chars)
  const sanitize = (str: string) => str.replace(/[\/\\#?]/g, '_');
  return `${sanitize(jobKey)}_${sanitize(scopeOfWork)}_${date}`;
};

/**
 * Generate a document ID for scopeTracking
 */
export const getScopeTrackingDocId = (jobKey: string, scopeOfWork: string): string => {
  const sanitize = (str: string) => str.replace(/[\/\\#?]/g, '_');
  return `${sanitize(jobKey)}_${sanitize(scopeOfWork)}`;
};

/**
 * Write an entry to activeSchedule
 */
export const writeActiveScheduleEntry = async (entry: ActiveScheduleEntry): Promise<void> => {
  const docId = getActiveScheduleDocId(entry.jobKey, entry.scopeOfWork, entry.date);
  const docRef = doc(db, 'activeSchedule', docId);
  
  await setDoc(docRef, {
    ...entry,
    lastModified: Timestamp.now()
  }, { merge: true });
};

/**
 * Delete an entry from activeSchedule
 */
export const deleteActiveScheduleEntry = async (jobKey: string, scopeOfWork: string, date: string): Promise<void> => {
  const docId = getActiveScheduleDocId(jobKey, scopeOfWork, date);
  const docRef = doc(db, 'activeSchedule', docId);
  await deleteDoc(docRef);
};

/**
 * Get all activeSchedule entries for a jobKey
 */
export const getActiveScheduleForJob = async (jobKey: string): Promise<ActiveScheduleEntry[]> => {
  const q = query(collection(db, 'activeSchedule'), where('jobKey', '==', jobKey));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ActiveScheduleEntry));
};

/**
 * Get all activeSchedule entries for a date range
 */
export const getActiveScheduleForDateRange = async (startDate: string, endDate: string): Promise<ActiveScheduleEntry[]> => {
  const q = query(
    collection(db, 'activeSchedule'),
    where('date', '>=', startDate),
    where('date', '<=', endDate)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ActiveScheduleEntry));
};

/**
 * Update scopeTracking for a specific scope
 */
export const updateScopeTracking = async (
  jobKey: string,
  scopeOfWork: string,
  totalHours: number,
  scheduledHours: number
): Promise<void> => {
  const docId = getScopeTrackingDocId(jobKey, scopeOfWork);
  const docRef = doc(db, 'scopeTracking', docId);
  
  await setDoc(docRef, {
    jobKey,
    scopeOfWork,
    totalHours,
    scheduledHours,
    unscheduledHours: totalHours - scheduledHours,
    lastUpdated: Timestamp.now()
  });
};

/**
 * Recalculate scopeTracking from activeSchedule for a job
 */
export const recalculateScopeTracking = async (jobKey: string, scopeTotals: Record<string, number>): Promise<void> => {
  // Get all activeSchedule entries for this job
  const entries = await getActiveScheduleForJob(jobKey);
  
  // Sum scheduled hours by scope
  const scheduledByScope: Record<string, number> = {};
  entries.forEach(entry => {
    if (!scheduledByScope[entry.scopeOfWork]) {
      scheduledByScope[entry.scopeOfWork] = 0;
    }
    scheduledByScope[entry.scopeOfWork] += entry.hours;
  });
  
  // Update scopeTracking for each scope
  const batch = writeBatch(db);
  
  Object.entries(scopeTotals).forEach(([scopeOfWork, totalHours]) => {
    const scheduledHours = scheduledByScope[scopeOfWork] || 0;
    const docId = getScopeTrackingDocId(jobKey, scopeOfWork);
    const docRef = doc(db, 'scopeTracking', docId);
    
    batch.set(docRef, {
      jobKey,
      scopeOfWork,
      totalHours,
      scheduledHours,
      unscheduledHours: totalHours - scheduledHours,
      lastUpdated: Timestamp.now()
    });
  });
  
  await batch.commit();
};

/**
 * Get scopeTracking for a jobKey
 */
export const getScopeTracking = async (jobKey: string): Promise<ScopeTracking[]> => {
  const q = query(collection(db, 'scopeTracking'), where('jobKey', '==', jobKey));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ScopeTracking));
};

/**
 * Clear all activeSchedule entries for a jobKey and apply fallback
 */
export const clearAndFallback = async (
  jobKey: string,
  scopeOfWork: string,
  date: string,
  source: 'short-term' | 'long-term'
): Promise<void> => {
  // Delete from activeSchedule
  await deleteActiveScheduleEntry(jobKey, scopeOfWork, date);
  
  // TODO: Implement fallback logic
  // 1. Check long-term if source was short-term
  // 2. Check schedules if no long-term
  // 3. Update scopeTracking
};
