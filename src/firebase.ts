/**
 * Firebase configuration
 * 
 * DEPRECATED: This file is being replaced with Prisma + Postgres
 * All Firestore queries should be migrated to Prisma
 * Import from @/lib/prisma instead
 */

// Stub export for module compatibility during migration
// This allows the app to build while we migrate to Prisma
export const db = null;

// Re-export all firebaseStubs so imports from @/firebase still work
export {
  getDocs,
  collection,
  query,
  where,
  orderBy,
  limit,
  setDoc,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  getDoc,
  writeBatch,
  Timestamp,
  getFirestore,
  serverTimestamp,
  increment
} from '@/firebaseStubs';
