// Diagnostic endpoint to check what productivity data is available
import { NextRequest, NextResponse } from 'next/server';
import { makeRequest, procoreConfig } from '@/lib/procore';

export async function POST(request: NextRequest) {
  try {
    const accessToken = request.cookies.get('procore_access_token')?.value;

    if (!accessToken) {
      return NextResponse.json({ error: 'Not authenticated with Procore' }, { status: 401 });
    }

    const companyId = procoreConfig.companyId;

    // Get last 10 core construction projects (most likely to have data)
    const projects = await makeRequest(
      `/rest/v1.1/projects?company_id=${companyId}&view=extended&per_page=10&filters[active]=true`,
      accessToken
    );

    const projectsArray = Array.isArray(projects) ? projects : [];
    
    // Test multiple date ranges
    const now = new Date();
    const ranges = [
      { label: 'Last 7 days', days: 7 },
      { label: 'Last 30 days', days: 30 },
      { label: 'Last 90 days', days: 90 },
      { label: 'Last 6 months', days: 180 }
    ];

    const results = [];

    for (const project of projectsArray.slice(0, 3)) {
      const projectResult: any = {
        id: project.id,
        name: project.name,
        status: project.active ? 'Active' : 'Inactive',
        ranges: {}
      };

      for (const range of ranges) {
        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() - range.days);
        const startStr = startDate.toISOString().split('T')[0];
        const endStr = now.toISOString().split('T')[0];

        try {
          // Try manpower logs
          const manpower = await makeRequest(
            `/rest/v1.0/projects/${project.id}/manpower_logs?start_date=${startStr}&end_date=${endStr}`,
            accessToken
          );

          // Try work logs (narrative)
          const workLogs = await makeRequest(
            `/rest/v1.0/projects/${project.id}/work_logs?start_date=${startStr}&end_date=${endStr}`,
            accessToken
          );

          // Try timecard entries
          const timecards = await makeRequest(
            `/rest/v1.0/projects/${project.id}/timecard_entries?start_date=${startStr}&end_date=${endStr}`,
            accessToken
          );

          projectResult.ranges[range.label] = {
            manpower: Array.isArray(manpower) ? manpower.length : 0,
            workLogs: Array.isArray(workLogs) ? workLogs.length : 0,
            timecards: Array.isArray(timecards) ? timecards.length : 0,
            firstManpower: Array.isArray(manpower) && manpower[0] ? manpower[0] : null
          };
        } catch (e) {
          projectResult.ranges[range.label] = { error: String(e) };
        }
      }

      results.push(projectResult);
    }

    return NextResponse.json({
      message: 'Diagnostic complete',
      projectsTested: results.length,
      results,
      recommendation: results.length > 0 ? getRecommendation(results) : 'No projects to analyze'
    });

  } catch (error) {
    console.error('[Debug Productivity] Error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

function getRecommendation(results: any[]) {
  const hasManpower = results.some(r => Object.values(r.ranges).some((range: any) => range.manpower > 0));
  const hasTimecards = results.some(r => Object.values(r.ranges).some((range: any) => range.timecards > 0));
  const hasWorkLogs = results.some(r => Object.values(r.ranges).some((range: any) => range.workLogs > 0));

  if (hasTimecards) return 'Use TIMECARD_ENTRIES for detailed labor tracking';
  if (hasWorkLogs) return 'Use WORK_LOGS for daily narrative data';
  if (hasManpower) return 'Use MANPOWER_LOGS (current source)';
  
  return 'No daily log data found. Projects may not be using Procore Daily Logs feature.';
}
