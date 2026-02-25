import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase';
import { collection, getDocs, deleteDoc, doc } from 'firebase/firestore';

export async function POST(request: NextRequest) {
  try {
    // Find all scopes with title "Scope" or "Scheduled Work"
    const scopesSnapshot = await getDocs(collection(db, 'projectScopes'));
    const genericScopes = scopesSnapshot.docs.filter(doc => {
      const title = doc.data().title || '';
      return title === 'Scope' || title === 'Scheduled Work';
    });

    const results = {
      projectScopesDeleted: 0,
      scopeTrackingDeleted: 0,
      activeScheduleDeleted: 0,
      errors: [] as string[]
    };

    if (genericScopes.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No generic scopes found',
        results
      });
    }

    // Delete from projectScopes
    for (const docSnap of genericScopes) {
      try {
        await deleteDoc(doc(db, 'projectScopes', docSnap.id));
        results.projectScopesDeleted++;
      } catch (error) {
        results.errors.push(`Failed to delete projectScope ${docSnap.id}: ${error}`);
      }
    }

    // Delete from scopeTracking for these scopes
    const scopeTrackingSnapshot = await getDocs(collection(db, 'scopeTracking'));
    for (const docSnap of scopeTrackingSnapshot.docs) {
      const data = docSnap.data();
      if (data.scopeOfWork === 'Scope' || data.scopeOfWork === 'Scheduled Work') {
        try {
          await deleteDoc(doc(db, 'scopeTracking', docSnap.id));
          results.scopeTrackingDeleted++;
        } catch (error) {
          results.errors.push(`Failed to delete scopeTracking ${docSnap.id}: ${error}`);
        }
      }
    }

    // Delete from activeSchedule
    const activeScheduleSnapshot = await getDocs(collection(db, 'activeSchedule'));
    for (const docSnap of activeScheduleSnapshot.docs) {
      const data = docSnap.data();
      if (data.scopeOfWork === 'Scope' || data.scopeOfWork === 'Scheduled Work') {
        try {
          await deleteDoc(doc(db, 'activeSchedule', docSnap.id));
          results.activeScheduleDeleted++;
        } catch (error) {
          results.errors.push(`Failed to delete activeSchedule ${docSnap.id}: ${error}`);
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Cleanup complete. Deleted ${results.projectScopesDeleted} project scopes, ${results.scopeTrackingDeleted} tracking entries, and ${results.activeScheduleDeleted} schedule entries.`,
      results
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json(
      { error: 'Cleanup failed', details: String(error) },
      { status: 500 }
    );
  }
}
