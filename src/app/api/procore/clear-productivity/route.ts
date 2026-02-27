// Clear old productivity data from Firebase before resyncing
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase';


export async function POST(request: NextRequest) {
  try {
    console.log('[Clear Productivity] Starting...');

    // Clear productivity_logs collection
    const logsRef = collection(db, 'productivity_logs');
    const logsSnap = await getDocs(logsRef);
    let logsDeleted = 0;
    
    for (const document of logsSnap.docs) {
      await deleteDoc(doc(db, 'productivity_logs', document.id));
      logsDeleted++;
    }

    // Clear productivity_summary collection
    const summaryRef = collection(db, 'productivity_summary');
    const summarySnap = await getDocs(summaryRef);
    let summariesDeleted = 0;
    
    for (const document of summarySnap.docs) {
      await deleteDoc(doc(db, 'productivity_summary', document.id));
      summariesDeleted++;
    }

    console.log(`[Clear Productivity] Deleted ${logsDeleted} logs and ${summariesDeleted} summaries`);

    return NextResponse.json({
      success: true,
      logsCleared: logsDeleted,
      summariesCleared: summariesDeleted,
      message: `Cleared ${logsDeleted} productivity logs and ${summariesDeleted} monthly summaries. Ready to sync fresh data.`
    });

  } catch (error) {
    console.error('[Clear Productivity] Error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown sync error'
    }, { status: 500 });
  }
}
