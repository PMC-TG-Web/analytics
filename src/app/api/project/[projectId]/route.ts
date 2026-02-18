import { NextRequest, NextResponse } from 'next/server';
import { makeRequest } from '@/lib/procore';

export async function GET(request: NextRequest, props: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await props.params;
    const accessToken = request.cookies.get('procore_access_token')?.value;

    console.log(`[Project Overview] Fetching data for project ${projectId}`);
    console.log(`[Project Overview] Access token present: ${!!accessToken}`);

    if (!accessToken) {
      console.log('[Project Overview] No access token found');
      return NextResponse.json({
        error: 'Not authenticated with Procore',
        message: 'Please authenticate with Procore first',
        details: 'Visit /dev-login or complete Procore authentication'
      }, { status: 401 });
    }

    // Fetch all data in parallel
    const [projectDetails, timecardEntries, lineItems, scheduleEntries, team] = await Promise.allSettled([
      // Project details
      makeRequest(`/rest/v1.1/projects/${projectId}?include=team`, accessToken),
      
      // Labor hours (last 6 months)
      (async () => {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 6);
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];
        return makeRequest(
          `/rest/v1.0/projects/${projectId}/timecard_entries?start_date=${startDateStr}&end_date=${endDateStr}&per_page=100`,
          accessToken
        );
      })(),
      
      // Budget and costs
      makeRequest(`/rest/v1.1/projects/${projectId}/line_items?page=1&per_page=100`, accessToken),
      
      // Schedule progress
      makeRequest(`/rest/v1.0/projects/${projectId}/schedule_log_entries?per_page=50`, accessToken),
      
      // Team members
      makeRequest(`/rest/v1.1/projects/${projectId}/users?per_page=100`, accessToken),
    ]);

    // Log results for debugging
    console.log(`[Project Overview] Project: ${projectDetails.status}`, projectDetails.status === 'rejected' ? projectDetails.reason : '');
    console.log(`[Project Overview] Timecards: ${timecardEntries.status}`, timecardEntries.status === 'rejected' ? timecardEntries.reason : '');
    console.log(`[Project Overview] Costs: ${lineItems.status}`, lineItems.status === 'rejected' ? lineItems.reason : '');
    console.log(`[Project Overview] Schedules: ${scheduleEntries.status}`, scheduleEntries.status === 'rejected' ? scheduleEntries.reason : '');
    console.log(`[Project Overview] Team: ${team.status}`, team.status === 'rejected' ? team.reason : '');

    // Process results
    const project = projectDetails.status === 'fulfilled' ? projectDetails.value : null;
    const timecards = timecardEntries.status === 'fulfilled' ? (Array.isArray(timecardEntries.value) ? timecardEntries.value : []) : [];
    const costs = lineItems.status === 'fulfilled' ? (Array.isArray(lineItems.value) ? lineItems.value : []) : [];
    const schedules = scheduleEntries.status === 'fulfilled' ? (Array.isArray(scheduleEntries.value) ? scheduleEntries.value : []) : [];
    const teamMembers = team.status === 'fulfilled' ? (Array.isArray(team.value) ? team.value : []) : [];

    // Calculate metrics
    const totalHours = timecards.reduce((sum, tc) => {
      const hours = typeof tc.hours === 'number' ? tc.hours : parseFloat(tc.hours) || 0;
      return sum + hours;
    }, 0);

    const uniqueEmployees = new Set(
      timecards.map(tc => tc.party?.name || tc.login_information?.name || 'Unknown')
    ).size;

    const workingDays = new Set(timecards.map(tc => tc.date)).size;

    const totalBudget = costs.reduce((sum, item) => sum + (item.budgeted_amount || 0), 0);
    const totalSpent = costs.reduce((sum, item) => sum + (item.actual_cost || 0), 0);

    // Group timecard entries by employee
    const byEmployee: Record<string, { hours: number; days: Set<string>; roles: Set<string> }> = {};
    timecards.forEach(tc => {
      const name = tc.party?.name || tc.login_information?.name || 'Unknown';
      const workClass = tc.work_classification?.abbreviation || 'Other';
      
      if (!byEmployee[name]) {
        byEmployee[name] = { hours: 0, days: new Set(), roles: new Set() };
      }
      
      const hourValue = typeof tc.hours === 'number' ? tc.hours : parseFloat(tc.hours) || 0;
      byEmployee[name].hours += hourValue;
      byEmployee[name].days.add(tc.date);
      byEmployee[name].roles.add(workClass);
    });

    const employeeBreakdown = Object.entries(byEmployee).map(([name, data]) => ({
      name,
      hours: parseFloat(data.hours.toFixed(2)),
      days: data.days.size,
      roles: Array.from(data.roles),
      avgHoursPerDay: parseFloat((data.hours / data.days.size).toFixed(2)),
    }));

    // Group by date for daily trends
    const byDate: Record<string, { hours: number; employees: Set<string> }> = {};
    timecards.forEach(tc => {
      const date = tc.date;
      if (!byDate[date]) {
        byDate[date] = { hours: 0, employees: new Set() };
      }
      const hourValue = typeof tc.hours === 'number' ? tc.hours : parseFloat(tc.hours) || 0;
      byDate[date].hours += hourValue;
      byDate[date].employees.add(tc.party?.name || tc.login_information?.name || 'Unknown');
    });

    const dailyTrends = Object.entries(byDate)
      .map(([date, data]) => ({
        date,
        hours: parseFloat(data.hours.toFixed(2)),
        employeesWorked: data.employees.size,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      success: true,
      projectId,
      project: {
        id: project?.id,
        name: project?.name,
        number: project?.project_number,
        status: project?.project_status,
        description: project?.description,
        customer: project?.company_name,
        estimator: project?.estimator?.name,
        projectManager: project?.project_manager?.name,
      },
      metrics: {
        totalHours: parseFloat(totalHours.toFixed(2)),
        uniqueEmployees,
        workingDays,
        avgHoursPerDay: parseFloat((totalHours / (workingDays || 1)).toFixed(2)),
        totalBudget: parseFloat(totalBudget.toFixed(2)),
        totalSpent: parseFloat(totalSpent.toFixed(2)),
        budgetRemaining: parseFloat((totalBudget - totalSpent).toFixed(2)),
        budgetUtilization: totalBudget > 0 ? parseFloat(((totalSpent / totalBudget) * 100).toFixed(1)) : 0,
      },
      team: {
        total: teamMembers.length,
        members: teamMembers.slice(0, 20).map((m: any) => ({
          id: m.id,
          name: m.name,
          login: m.login,
          role: m.role,
        })),
      },
      laborAnalytics: {
        employeeBreakdown: employeeBreakdown.sort((a, b) => b.hours - a.hours),
        dailyTrends: dailyTrends.slice(-30), // Last 30 days
      },
      costAnalysis: {
        lineItems: costs.slice(0, 20).map((item: any) => ({
          id: item.id,
          name: item.name,
          code: item.code,
          budgeted: parseFloat(item.budgeted_amount || 0),
          actual: parseFloat(item.actual_cost || 0),
          variance: (item.budgeted_amount || 0) - (item.actual_cost || 0),
        })),
      },
      scheduleProgress: {
        entries: schedules.slice(0, 10).map((entry: any) => ({
          id: entry.id,
          date: entry.created_at,
          description: entry.log_entry,
          status: entry.status,
        })),
      },
    });
  } catch (error) {
    console.error('[Project Overview] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch project data' },
      { status: 500 }
    );
  }
}
