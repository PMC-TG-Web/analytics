import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDocs, getDoc, query, where } from 'firebase/firestore';
import { firebaseConfig } from '@/firebaseConfig';

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobKey, customer, projectNumber, projectName, status, totalHours, allocations } = body;

    if (!projectName) {
      return NextResponse.json({ error: 'projectName is required' }, { status: 400 });
    }

    // Find existing schedule by projectName (not by jobKey as doc ID, since doc IDs don't match jobKey format)
    const q = query(collection(db, 'schedules'), where('projectName', '==', projectName));
    const querySnapshot = await getDocs(q);
    
    let docRef;
    let existingData = null;
    
    if (querySnapshot.docs.length > 0) {
      // Update existing document
      docRef = querySnapshot.docs[0].ref;
      existingData = querySnapshot.docs[0].data();
    } else {
      // Create new document with jobKey as ID (now safe with tildes instead of pipes)
      docRef = doc(db, 'schedules', jobKey);
    }
    
    // Merge existing allocations with new ones (new ones take precedence)
    const mergedAllocations = {
      ...(existingData?.allocations || {}),
      ...allocations
    };

    // Save to Firestore under 'schedules' collection
    await setDoc(docRef, {
      jobKey,
      customer,
      projectNumber,
      projectName,
      status: status || existingData?.status || 'In Progress', // Preserve existing status or default to In Progress
      totalHours,
      allocations: mergedAllocations,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, projectName });
  } catch (error) {
    console.error('Error saving schedule:', error);
    return NextResponse.json({ error: 'Failed to save schedule' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobKey = searchParams.get('jobKey');

    if (jobKey) {
      // Get specific schedule
      const docRef = doc(db, 'schedules', jobKey);
      const docSnap = await getDocs(collection(db, 'schedules'));
      const schedule = docSnap.docs.find(d => d.id === jobKey);
      
      if (schedule) {
        return NextResponse.json({ data: schedule.data() });
      } else {
        return NextResponse.json({ data: null });
      }
    } else {
      // Get all schedules
      const querySnapshot = await getDocs(collection(db, 'schedules'));
      const schedules = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      return NextResponse.json({ data: schedules });
    }
  } catch (error) {
    console.error('Error retrieving schedules:', error);
    return NextResponse.json({ error: 'Failed to retrieve schedules' }, { status: 500 });
  }
}
