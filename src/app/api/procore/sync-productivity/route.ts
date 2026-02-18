// src/app/api/procore/sync-productivity/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { makeRequest, procoreConfig } from '@/lib/procore';
import { db } from '@/firebase';
import { collection, writeBatch, doc } from 'firebase/firestore';

export async function POST(request: NextRequest) {
  try {
    const accessToken = request.cookies.get('procore_access_token')?.value;

    if (!accessToken) {
      return NextResponse.json({ error: 'Not authenticated with Procore' }, { status: 401 });
    }

    const companyId = procoreConfig.companyId;
    console.log(`[Productivity Sync] Starting 6-month productivity sync for company ${companyId}`);

    // Calculate 6 months date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 6);
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    console.log(`[Productivity Sync] Date range: ${startDateStr} to ${endDateStr}`);

    // 1. Fetch all projects
    const statuses = ['ESTIMATING', 'BIDDING', 'BID_SUBMITTED', 'NEGOTIATING', 'WON', 'LOST', 'DECLINED'];
    const statusFilter = `&filters[status][]=${statuses.join('&filters[status][]=')}`;

    const [bidBoardResponse, coreProjectsResponse] = await Promise.all([
      makeRequest(`/rest/v2.0/companies/${companyId}/estimating/bid_board_projects?per_page=100${statusFilter}`, accessToken),
      makeRequest(`/rest/v1.1/projects?company_id=${companyId}&view=extended&per_page=100&filters[active]=any`, accessToken)
    ]);

    const bidProjects = Array.isArray(bidBoardResponse) ? bidBoardResponse : (bidBoardResponse?.data || []);
    const coreProjects = Array.isArray(coreProjectsResponse) ? coreProjectsResponse : [];
    const allProjects = [...coreProjects, ...bidProjects];

    console.log(`[Productivity Sync] Found ${allProjects.length} projects to sync`);

    // 2. Fetch manpower logs for each project
    let totalLogs = 0;
    let projectsProcessed = 0;
    const monthlySummary: Record<string, any> = {};

    for (const project of allProjects) {
      try {
        const projectId = project.id;
        const projectName = project.name || 'Unknown Project';
        
        console.log(`[Productivity Sync] Fetching logs for: ${projectName} (${projectId})`);

        const logs = await makeRequest(
          `/rest/v1.0/projects/${projectId}/manpower_logs?start_date=${startDateStr}&end_date=${endDateStr}&per_page=100`,
          accessToken
        );

        const logsArray = Array.isArray(logs) ? logs : [];
        
        if (logsArray.length > 0) {
          // Write raw logs
          const batch = writeBatch(db);
          const logsRef = collection(db, 'productivity_logs');

          logsArray.forEach((log: any) => {
            const logId = `${projectId}_${log.date || log.id}_${log.id || Math.random()}`;
            batch.set(doc(logsRef, logId), {
              projectId,
              projectName,
              date: log.date,
              vendor: log.vendor?.name || 'Unknown',
              workers: log.quantity || 0,
              hours: log.hours || 0,
              notes: log.notes || '',
              costCode: log.cost_code?.name || '',
              createdAt: new Date().toISOString(),
              source: 'procore_manpower'
            });

            // Aggregate for summary
            const monthKey = log.date ? log.date.substring(0, 7) : ''; // YYYY-MM
            if (monthKey) {
              const summaryKey = `${projectId}_${monthKey}`;
              if (!monthlySummary[summaryKey]) {
                monthlySummary[summaryKey] = {
                  projectId,
                  projectName,
                  month: monthKey,
                  totalHours: 0,
                  totalWorkers: 0,
                  workingDays: new Set(),
                  byVendor: {}
                };
              }

              monthlySummary[summaryKey].totalHours += log.hours || 0;
              monthlySummary[summaryKey].totalWorkers += log.quantity || 0;
              monthlySummary[summaryKey].workingDays.add(log.date);

              const vendor = log.vendor?.name || 'Unknown';
              if (!monthlySummary[summaryKey].byVendor[vendor]) {
                monthlySummary[summaryKey].byVendor[vendor] = { hours: 0, workers: 0 };
              }
              monthlySummary[summaryKey].byVendor[vendor].hours += log.hours || 0;
              monthlySummary[summaryKey].byVendor[vendor].workers += log.quantity || 0;
            }
          });

          await batch.commit();
          totalLogs += logsArray.length;
        }

        projectsProcessed++;
      } catch (error) {
        console.error(`[Productivity Sync] Error syncing project ${project.id}:`, error);
      }
    }

    // 3. Write monthly summaries
    const summaryBatch = writeBatch(db);
    const summaryRef = collection(db, 'productivity_summary');

    Object.entries(monthlySummary).forEach(([key, summary]: [string, any]) => {
      summaryBatch.set(doc(summaryRef, key), {
        ...summary,
        workingDays: summary.workingDays.size,
        byVendor: summary.byVendor,
        updatedAt: new Date().toISOString()
      });
    });

    await summaryBatch.commit();

    console.log(`[Productivity Sync] Complete: ${totalLogs} logs, ${Object.keys(monthlySummary).length} monthly summaries`);

    return NextResponse.json({
      success: true,
      projectsProcessed,
      totalLogs,
      monthlySummaries: Object.keys(monthlySummary).length,
      dateRange: { start: startDateStr, end: endDateStr },
      message: `Successfully synced ${totalLogs} productivity logs across ${projectsProcessed} projects (6 months).`
    });

  } catch (error) {
    console.error('[Productivity Sync] Error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown sync error'
    }, { status: 500 });
  }
}
