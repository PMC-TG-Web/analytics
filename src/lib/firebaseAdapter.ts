/**
 * Firebase Adapter with Fallback
 * 
 * Automatically switches to mock data if Firebase is unavailable.
 * Transparent to the rest of the app.
 */

import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { db } from "@/firebase";
import mockFirestore, { type Project, type DashboardSummary } from "@/lib/mockFirestore";

let useMockData = false;
let mockDataReason = "";

const FIRESTORE_TIMEOUT_MS = 6000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Check Firebase connectivity
 */
async function checkFirebaseConnection(): Promise<boolean> {
  try {
    // Try to read a single metadata document
    const testRef = doc(db, "metadata", "dashboard_summary");
    const snap = await withTimeout(getDoc(testRef), FIRESTORE_TIMEOUT_MS, "checkFirebaseConnection");
    // If we get here without error, Firebase is working
    return true;
  } catch (error: any) {
    // Check if it's a permission/connection error
    if (
      error.code === "permission-denied" ||
      error.code === "unavailable" ||
      error.code === "unauthenticated" ||
      error.message?.includes("offline") ||
      error.message?.includes("suspended")
    ) {
      return false;
    }
    // For other errors, let it fail (data might be missing, not a connection issue)
    return true;
  }
}

/**
 * Get all projects with fallback to mock data
 */
export async function getAllProjectsForDashboard(): Promise<Project[]> {
  // Try real Firebase first
  try {
    console.log("[firebaseAdapter] Attempting to get projects from Firebase...");
    const snapshot = await withTimeout(
      getDocs(collection(db, "projects")),
      FIRESTORE_TIMEOUT_MS,
      "getAllProjectsForDashboard"
    );
    const projects = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Project[];

   console.log(`[firebaseAdapter] Firebase returned ${projects.length} projects`);
    if (projects.length > 0) {
      useMockData = false;
      console.log("[firebaseAdapter] Using Firebase projects");
      return projects;
    }
    console.log("[firebaseAdapter] Firebase returned empty, will use mock");
  } catch (error: any) {
    console.warn("[firebaseAdapter] Firebase error:", error.message);
    useMockData = true;
    mockDataReason = error.message;
  }

  // Fallback to mock data
  console.log("[firebaseAdapter] Loading from mock Firestore...");
  const mockProjects = await mockFirestore.getProjects();
  console.log(`[firebaseAdapter] Mock returned ${mockProjects.length} projects`);
  return mockProjects;
}

/**
 * Get dashboard summary with fallback
 */
export async function getDashboardSummary(): Promise<DashboardSummary | null> {
  try {
    const summaryRef = doc(db, "metadata", "dashboard_summary");
    const snap = await withTimeout(getDoc(summaryRef), FIRESTORE_TIMEOUT_MS, "getDashboardSummary");
    
    if (snap.exists()) {
      useMockData = false;
      return snap.data() as DashboardSummary;
    }
  } catch (error: any) {
    console.warn("Firebase unavailable, using mock summary:", error.message);
    useMockData = true;
    mockDataReason = error.message;
  }

  // Return mock summary
  return mockFirestore.getDashboardSummary();
}

/**
 * Get projects by customer with fallback
 */
export async function getProjectsByCustomer(
  customerName: string
): Promise<Project[]> {
  try {
    const projectsRef = collection(db, "projects");
    const q = query(projectsRef, where("customer", "==", customerName));
    const snapshot = await withTimeout(getDocs(q), FIRESTORE_TIMEOUT_MS, "getProjectsByCustomer");
    
    if (snapshot.docs.length > 0 || useMockData === false) {
      useMockData = false;
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Project[];
    }
  } catch (error: any) {
    console.warn("Firebase unavailable, using mock data");
    useMockData = true;
  }

  return mockFirestore.getProjectsByCustomer(customerName);
}

/**
 * Get project line items with fallback
 */
export async function getProjectLineItems(
  projectNumber: string,
  projectName: string,
  customer: string
): Promise<Project[]> {
  try {
    const q = query(
      collection(db, "projects"),
      where("projectNumber", "==", projectNumber),
      where("projectName", "==", projectName || ""),
      where("customer", "==", customer || "")
    );

    const snapshot = await withTimeout(getDocs(q), FIRESTORE_TIMEOUT_MS, "getProjectLineItems");
    if (snapshot.docs.length > 0 || useMockData === false) {
      useMockData = false;
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Project[];
    }
  } catch (error: any) {
    console.warn("Firebase unavailable, using mock data");
    useMockData = true;
  }

  return mockFirestore.getProjectLineItems(projectNumber, projectName, customer);
}

/**
 * Check if currently using mock data
 */
export function isUsingMockData(): boolean {
  return useMockData;
}

/**
 * Get the reason for using mock data (if any)
 */
export function getMockDataReason(): string {
  return mockDataReason;
}

/**
 * Initialize Firebase adapter (run once on app start)
 */
export async function initializeFirebaseAdapter(): Promise<void> {
  console.log("Initializing Firebase adapter...");
  
  const isConnected = await checkFirebaseConnection();
  if (!isConnected) {
    console.warn("⚠️ Firebase is unavailable. Using mock data for demo.");
    useMockData = true;
    mockDataReason = "Firebase project suspended or unreachable";
  } else {
    console.log("✓ Firebase connection successful");
    useMockData = false;
  }
}
