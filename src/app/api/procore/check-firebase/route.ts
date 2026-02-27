// Check what data is currently in Firebase
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase';


export async function GET(request: NextRequest) {
  try {
    console.log('[Check Firebase] Analyzing current data...');

    // Get all logs
    const logsRef = collection(db, 'productivity_logs');
    const logsSnap = await getDocs(logsRef);
    const logsArray = logsSnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data
      };
    });

    // Get all summaries
    const summaryRef = collection(db, 'productivity_summary');
    const summarySnap = await getDocs(summaryRef);
    const summaryArray = summarySnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data
      };
    });

    console.log(`[Check Firebase] Found ${logsArray.length} logs and ${summaryArray.length} summaries`);

    // Analyze the data
    let totalHours = 0;
    let byProject: Record<string, number> = {};
    let sampleDocs = logsArray.slice(0, 3);

    logsArray.forEach((log: any) => {
      try {
        const hours = typeof log.hours === 'number' ? log.hours : parseFloat(log.hours) || 0;
        totalHours += hours;
        
        const projectName = log.projectName || 'Unknown';
        byProject[projectName] = (byProject[projectName] || 0) + hours;
      } catch (e) {
        console.error('[Check Firebase] Error processing log:', e, log);
      }
    });

    console.log(`[Check Firebase] Total hours: ${totalHours}`);

    return NextResponse.json({
      success: true,
      logsCount: logsArray.length,
      summariesCount: summaryArray.length,
      totalHours,
      byProject,
      sampleLogs: sampleDocs,
      firstSummary: summaryArray[0] || null,
      message: logsArray.length === 0 
        ? 'No data in Firebase. Sync productivity first!' 
        : `${logsArray.length} logs with ${totalHours.toFixed(1)} total hours`
    });

  } catch (error) {
    console.error('[Check Firebase] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : String(error)
    }, { status: 500 });
  }
}
