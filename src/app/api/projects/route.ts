import { NextRequest, NextResponse } from 'next/server';

import { firebaseConfig } from '@/firebaseConfig';
import { getDocs, collection, getFirestore } from '@/firebaseStubs';

// Initialize stub Firebase
const db = getFirestore(undefined);

export async function GET(request: NextRequest) {
  try {
    const querySnapshot = await getDocs(collection(db, 'projects'));
    const projects = querySnapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
    }));
    return NextResponse.json({ data: projects });
  } catch (error) {
    console.error('Error retrieving projects:', error);
    return NextResponse.json({ error: 'Failed to retrieve projects' }, { status: 500 });
  }
}
