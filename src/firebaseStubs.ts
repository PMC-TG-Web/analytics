// Firebase stub functions for migration to Postgres
// These provide temporary placeholders during the Firebase->Prisma migration

export async function getDocs(...args: any[]): Promise<any> {
  console.warn("getDocs() stub called - Firebase has been migrated to Postgres");
  return { 
    docs: [] as any[],
    forEach: (callback: any) => {},
  } as any;
}

export function collection(...args: any[]): any {
  console.warn("collection() stub called");
  return null;
}

export function query(...args: any[]): any {
  console.warn("query() stub called");
  return null;
}

export function where(...args: any[]): any {
  console.warn("where() stub called");
  return null;
}

export function orderBy(...args: any[]): any {
  console.warn("orderBy() stub called");
  return null;
}

export function limit(...args: any[]): any {
  console.warn("limit() stub called");
  return null;
}

export async function setDoc(...args: any[]): Promise<any> {
  console.warn("setDoc() stub called - use API instead");
  return Promise.resolve();
}

export function doc(...args: any[]): any {
  console.warn("doc() stub called");
  return null;
}

export async function updateDoc(...args: any[]): Promise<any> {
  console.warn("updateDoc() stub called - use API instead");
  return Promise.resolve();
}

export async function deleteDoc(...args: any[]): Promise<any> {
  console.warn("deleteDoc() stub called - use API instead");
  return Promise.resolve();
}

export async function addDoc(...args: any[]): Promise<any> {
  console.warn("addDoc() stub called - use API instead");
  return Promise.resolve({ id: "stub" });
}

export async function getDoc(...args: any[]): Promise<any> {
  console.warn("getDoc() stub called");
  return { exists: () => false, data: () => ({}) };
}

export async function writeBatch(...args: any[]): Promise<any> {
  console.warn("writeBatch() stub called - use API instead");
  return {
    set: () => {},
    update: () => {},
    delete: () => {},
    commit: async () => Promise.resolve()
  };
}

export function Timestamp(...args: any[]): any {
  return new Date();
}

export function getFirestore(...args: any[]): any {
  console.warn("getFirestore() stub called");
  return null;
}

export function serverTimestamp(...args: any[]): any {
  return new Date();
}

export function increment(...args: any[]): any {
  return (prev: number) => prev + 1;
}

