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

    // 1. Fetch ACTIVE projects (try to get construction projects, fallback to all active)
    let allProjects: any[] = [];
    
    try {
      // Try with status filters first
      const activeStatuses = ['Pre-Construction', 'Pre-Construction Complete', 'In Progress', 'Post-Construction Complete'];
      const statusFilter = activeStatuses.map(s => `filters[project_status][]=${encodeURIComponent(s)}`).join('&');
      
      const coreProjectsResponse = await makeRequest(
        `/rest/v1.1/projects?company_id=${companyId}&view=extended&per_page=100&filters[active]=true&${statusFilter}`,
        accessToken
      );
      allProjects = Array.isArray(coreProjectsResponse) ? coreProjectsResponse : [];
    } catch (error) {
      console.log('[Productivity Sync] Status filter failed, trying without status filter...');
      // Fallback: get all active projects
      const coreProjectsResponse = await makeRequest(
        `/rest/v1.1/projects?company_id=${companyId}&view=extended&per_page=100&filters[active]=true`,
        accessToken
      );
      allProjects = Array.isArray(coreProjectsResponse) ? coreProjectsResponse : [];
    }

    console.log(`[Productivity Sync] Found ${allProjects.length} active projects to sync`);

    // 2. Fetch timecard entries for each project (primary labor tracking source)
    let totalLogs = 0;
    let projectsProcessed = 0;
    const monthlySummary: Record<string, any> = {};

    for (const project of allProjects) {
      try {
        const projectId = project.id;
        const projectName = project.name || 'Unknown Project';
        
        console.log(`[Productivity Sync] Fetching timecard entries for: ${projectName} (${projectId})`);

        const logs = await makeRequest(
          `/rest/v1.0/projects/${projectId}/timecard_entries?start_date=${startDateStr}&end_date=${endDateStr}&per_page=100`,
          accessToken
        );

        const logsArray = Array.isArray(logs) ? logs : [];
        
        if (logsArray.length > 0) {
          console.log(`[Productivity Sync] Found ${logsArray.length} timecard entries for ${projectName}`);
          
          // Debug: Log first entry structure
          if (logsArray[0]) {
            console.log('[Productivity Sync] Sample timecard entry structure:', JSON.stringify(logsArray[0], null, 2));
          }
          
          // Write raw logs
          const batch = writeBatch(db);
          const logsRef = collection(db, 'productivity_logs');

          logsArray.forEach((log: any) => {
            const logDate = log.date || log.worked_date || '';
            const logId = `${projectId}_${logDate}_${log.id || Math.random()}`;
            
            // Convert hours to number
            const hours = typeof log.hours === 'number' ? log.hours : parseFloat(log.hours) || 0;
            
            // Extract employee name from various possible locations
            const employeeName = log.employee?.name 
              || log.resource?.name 
              || log.worker?.name
              || log.crew_member?.name
              || log.vendor?.name
              || 'Unknown';
            
            const employeeId = log.employee?.id 
              || log.resource?.id 
              || log.worker?.id
              || log.crew_member?.id
              || null;
            
            batch.set(doc(logsRef, logId), {
              projectId,
              projectName,
              date: logDate,
              employeeName,
              employeeId,
              hours,
              costCode: log.cost_code?.full_code || log.cost_code?.name || '',
              description: log.description || '',
              createdAt: new Date().toISOString(),
              source: 'procore_timecard',
              rawEmployee: log.employee || log.resource || log.worker || null  // Store for debugging
            });

            // Aggregate for summary
            const monthKey = logDate ? logDate.substring(0, 7) : ''; // YYYY-MM
            if (monthKey) {
              const summaryKey = `${projectId}_${monthKey}`;
              if (!monthlySummary[summaryKey]) {
                monthlySummary[summaryKey] = {
                  projectId,
                  projectName,
                  month: monthKey,
                  totalHours: 0,
                  uniqueEmployees: new Set(),
                  workingDays: new Set(),
                  byEmployee: {}
                };
              }

              // Add as number, not string
              monthlySummary[summaryKey].totalHours += hours;
              monthlySummary[summaryKey].workingDays.add(logDate);
              
              monthlySummary[summaryKey].uniqueEmployees.add(employeeName);
              
              if (!monthlySummary[summaryKey].byEmployee[employeeName]) {
                monthlySummary[summaryKey].byEmployee[employeeName] = { hours: 0, days: new Set() };
              }
              monthlySummary[summaryKey].byEmployee[employeeName].hours += hours;
              monthlySummary[summaryKey].byEmployee[employeeName].days.add(logDate);
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
        projectId: summary.projectId,
        projectName: summary.projectName,
        month: summary.month,
        totalHours: summary.totalHours,
        workingDays: summary.workingDays.size,
        uniqueEmployees: summary.uniqueEmployees.size,
        byEmployee: Object.fromEntries(
          Object.entries(summary.byEmployee).map(([name, data]: [string, any]) => [
            name,
            { hours: data.hours, days: data.days.size }
          ])
        ),
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
