import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDocs, getDoc, query, where } from 'firebase/firestore';
import { firebaseConfig } from '@/firebaseConfig';
import { promises as fs } from 'fs';
import path from 'path';

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

const FIRESTORE_TIMEOUT_MS = 3000;
const SCHEDULES_PATH = path.join(process.cwd(), 'public', 'schedules.json');

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

// Local file storage helpers
async function readLocalSchedules(): Promise<any[]> {
  try {
    const fileContent = await fs.readFile(SCHEDULES_PATH, 'utf-8');
    return JSON.parse(fileContent);
  } catch (error) {
    console.log('[Scheduling] No local schedules.json found, returning empty array');
    return [];
  }
}

async function writeLocalSchedules(data: any[]): Promise<void> {
  await fs.writeFile(SCHEDULES_PATH, JSON.stringify(data, null, 2), 'utf-8');
  console.log('[Scheduling] Saved to local schedules.json');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobKey, customer, projectNumber, projectName, status, totalHours, allocations } = body;

    if (!projectName) {
      return NextResponse.json({ error: 'projectName is required' }, { status: 400 });
    }

    const scheduleData = {
      jobKey,
      customer,
      projectNumber,
      projectName,
      status: status || 'In Progress',
      totalHours,
      allocations: allocations || {},
      updatedAt: new Date().toISOString(),
    };

    // Try Firebase first, fall back to local storage
    try {
      // Find existing schedule by projectName
      const q = query(collection(db, 'schedules'), where('projectName', '==', projectName));
      const querySnapshot = await withTimeout(
        getDocs(q),
        FIRESTORE_TIMEOUT_MS,
        'findExistingSchedule'
      );
      
      let docRef;
      let existingData = null;
      
      if (querySnapshot.docs.length > 0) {
        // Update existing document
        docRef = querySnapshot.docs[0].ref;
        existingData = querySnapshot.docs[0].data();
      } else {
        // Create new document with jobKey as ID
        docRef = doc(db, 'schedules', jobKey);
      }
      
      // Merge existing allocations with new ones
      const mergedAllocations = {
        ...(existingData?.allocations || {}),
        ...allocations
      };

      await withTimeout(
        setDoc(docRef, {
          ...scheduleData,
          allocations: mergedAllocations,
        }, { merge: true }),
        FIRESTORE_TIMEOUT_MS,
        'saveSchedule'
      );
      
      console.log('[Scheduling] Saved to Firebase:', projectName);
    } catch (firebaseError) {
      console.log('[Scheduling] Firebase save failed, using local storage:', firebaseError);
      
      // Use local file storage
      const localSchedules = await readLocalSchedules();
      const existingIndex = localSchedules.findIndex(s => s.projectName === projectName);
      
      if (existingIndex >= 0) {
        // Merge allocations for existing schedule
        const merged = {
          ...localSchedules[existingIndex],
          ...scheduleData,
          allocations: {
            ...(localSchedules[existingIndex].allocations || {}),
            ...allocations
          }
        };
        localSchedules[existingIndex] = merged;
      } else {
        scheduleData.id = jobKey;
        localSchedules.push(scheduleData);
      }
      
      await writeLocalSchedules(localSchedules);
    }

    return NextResponse.json({ success: true, projectName });
  } catch (error) {
    console.error('[Scheduling] Error saving schedule:', error);
    return NextResponse.json({ error: 'Failed to save schedule: ' + (error as Error).message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobKey = searchParams.get('jobKey');

    if (jobKey) {
      // Get specific schedule directly by doc ID (jobKey)
      try {
        const docRef = doc(db, 'schedules', jobKey);
        const docSnap = await withTimeout(
          getDoc(docRef),
          FIRESTORE_TIMEOUT_MS,
          'getSchedule'
        );
        
        if (docSnap.exists()) {
          return NextResponse.json({ data: docSnap.data() });
        } else {
          // Check local storage
          const localSchedules = await readLocalSchedules();
          const foundSchedule = localSchedules.find(s => s.id === jobKey || s.jobKey === jobKey);
          return NextResponse.json({ data: foundSchedule || null });
        }
      } catch (firebaseError) {
        console.log('[Scheduling] Firebase get failed, using local storage:', firebaseError);
        const localSchedules = await readLocalSchedules();
        const foundSchedule = localSchedules.find(s => s.id === jobKey || s.jobKey === jobKey);
        return NextResponse.json({ data: foundSchedule || null });
      }
    } else {
      // Get all schedules
      try {
        const querySnapshot = await withTimeout(
          getDocs(collection(db, 'schedules')),
          FIRESTORE_TIMEOUT_MS,
          'getAllSchedules'
        );
        const schedules = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));
        console.log('[Scheduling] Retrieved from Firebase:', schedules.length, 'schedules');
        return NextResponse.json({ data: schedules });
      } catch (firebaseError) {
        console.log('[Scheduling] Firebase get failed, using local storage:', firebaseError);
        const localSchedules = await readLocalSchedules();
        console.log('[Scheduling] Retrieved from local storage:', localSchedules.length, 'schedules');
        return NextResponse.json({ data: localSchedules });
      }
    }
  } catch (error) {
    console.error('[Scheduling] Error retrieving schedules:', error);
    return NextResponse.json({ data: [], error: 'Failed to retrieve schedules' }, { status: 500 });
  }
}
