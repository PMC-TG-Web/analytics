import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, updateDoc } from 'firebase/firestore';

export async function POST(request: NextRequest) {
  try {
    const { projectId, newStatus, projectNumber, projectName, customer } = await request.json();

    if (!projectId || !newStatus) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Update the document
    const projectRef = collection(db, 'projects');
    const q = query(
      projectRef,
      where('projectNumber', '==', projectNumber),
      where('projectName', '==', projectName),
      where('customer', '==', customer)
    );

    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Update all matching documents with the new status
    const updates = querySnapshot.docs.map((doc) =>
      updateDoc(doc.ref, {
        status: newStatus,
        dateUpdated: new Date(),
      })
    );

    await Promise.all(updates);

    console.log(`Updated ${updates.length} project(s) to status: ${newStatus}`);

    return NextResponse.json({
      success: true,
      message: `Status updated to "${newStatus}"`,
      count: updates.length,
    });
  } catch (error) {
    console.error('Error updating project status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update status' },
      { status: 500 }
    );
  }
}
