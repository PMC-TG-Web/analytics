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
    const companyId = '598134325658789';
    const [projectDetails, timecardEntries, budgetData, changeOrderData] = await Promise.allSettled([
      // Use v1.1 API for project detail lookup with company_id query param
      (async () => {
        console.log(`[Project Overview] Fetching v1.1 project ${projectId}`);
        const endpoint = `/rest/v1.1/projects?company_id=${companyId}&view=extended&per_page=100&filters[id]=${projectId}`;
        console.log(`[Project Overview] Endpoint: ${endpoint}`);
        const response = await makeRequest(endpoint, accessToken);
        console.log(`[Project Overview] Response type: ${Array.isArray(response) ? 'array' : typeof response}, length: ${Array.isArray(response) ? response.length : 'N/A'}`);
        // v1.1 returns an array, extract the matching project
        if (Array.isArray(response) && response.length > 0) {
          console.log(`[Project Overview] Found project: ${response[0].name}`);
          return response[0];
        }
        throw new Error(`Project ${projectId} not found in v1.1 API`);
      })(),
      
      // Labor hours (last 6 months) - v1.0 endpoint works with just project ID
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
      
      // Budget data
      (async () => {
        return makeRequest(
          `/rest/v1.0/projects/${projectId}/budgets?per_page=100`,
          accessToken
        );
      })(),
      
      // Change orders
      (async () => {
        return makeRequest(
          `/rest/v1.0/projects/${projectId}/change_orders?per_page=100`,
          accessToken
        );
      })(),
    ]);

    // Log results for debugging with full error messages
    console.log(`[Project Overview] Project: ${projectDetails.status}${projectDetails.status === 'rejected' ? ` - ${projectDetails.reason}` : ''}`);
    console.log(`[Project Overview] Timecards: ${timecardEntries.status}${timecardEntries.status === 'rejected' ? ` - ${timecardEntries.reason}` : ''}`);
    console.log(`[Project Overview] Budget: ${budgetData.status}${budgetData.status === 'rejected' ? ` - ${budgetData.reason}` : ''}`);
    console.log(`[Project Overview] Change Orders: ${changeOrderData.status}${changeOrderData.status === 'rejected' ? ` - ${changeOrderData.reason}` : ''}`);

    // Process results
    const project = projectDetails.status === 'fulfilled' ? projectDetails.value : null;
    const timecards = timecardEntries.status === 'fulfilled' ? (Array.isArray(timecardEntries.value) ? timecardEntries.value : []) : [];
    const budgets = budgetData.status === 'fulfilled' ? (Array.isArray(budgetData.value) ? budgetData.value : []) : [];
    const changeOrders = changeOrderData.status === 'fulfilled' ? (Array.isArray(changeOrderData.value) ? changeOrderData.value : []) : [];

    if (!project) {
      console.log('[Project Overview] No project data returned');
      return NextResponse.json({
        error: 'Project not found or failed to fetch',
        projectId,
        details: {
          projectFailed: projectDetails.status === 'rejected',
          projectError: projectDetails.status === 'rejected' ? String(projectDetails.reason) : null,
          timecardsFailed: timecardEntries.status === 'rejected',
          timecardsError: timecardEntries.status === 'rejected' ? String(timecardEntries.reason) : null,
          budgetFailed: budgetData.status === 'rejected',
          budgetError: budgetData.status === 'rejected' ? String(budgetData.reason) : null,
          changeOrdersFailed: changeOrderData.status === 'rejected',
          changeOrdersError: changeOrderData.status === 'rejected' ? String(changeOrderData.reason) : null,
        }
      }, { status: 404 });
    }

    // Calculate metrics
    const totalHours = timecards.reduce((sum, tc) => {
      const hours = typeof tc.hours === 'number' ? tc.hours : parseFloat(tc.hours) || 0;
      return sum + hours;
    }, 0);

    // Calculate budget metrics
    const totalBudget = budgets.reduce((sum, budget) => {
      const amount = typeof budget.amount === 'number' ? budget.amount : parseFloat(budget.amount) || 0;
      return sum + amount;
    }, 0);

    const totalChangeOrders = changeOrders.reduce((sum, co) => {
      const amount = typeof co.amount === 'number' ? co.amount : parseFloat(co.amount) || 0;
      return sum + amount;
    }, 0);

    // Calculate productivity cost: total hours × average hourly rate from budget
    // Extract hourly rates from budget items if available
    interface BudgetItem {
      rate?: string | number;
    }
    interface BudgetData {
      line_items?: BudgetItem[];
    }
    const budgetItems = budgets.flatMap((budget: BudgetData) => budget.line_items || []);
    const hourlyRates = budgetItems
      .map((item: BudgetItem) => typeof item.rate === 'number' ? item.rate : parseFloat(String(item.rate)) || 0)
      .filter((rate: number) => rate > 0);
    const avgHourlyRate = hourlyRates.length > 0 
      ? hourlyRates.reduce((sum: number, rate: number) => sum + rate, 0) / hourlyRates.length 
      : 0;
    const productivityCost = totalHours * avgHourlyRate;

    const uniqueEmployees = new Set(
      timecards.map(tc => tc.party?.name || tc.login_information?.name || 'Unknown')
    ).size;

    const workingDays = new Set(timecards.map(tc => tc.date)).size;

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
      },
      financialMetrics: {
        totalBudget: parseFloat(totalBudget.toFixed(2)),
        totalChangeOrders: parseFloat(totalChangeOrders.toFixed(2)),
        avgHourlyRate: parseFloat(avgHourlyRate.toFixed(2)),
        productivityCost: parseFloat(productivityCost.toFixed(2)),
      },
      laborAnalytics: {
        employeeBreakdown: employeeBreakdown.sort((a, b) => b.hours - a.hours),
        dailyTrends: dailyTrends.slice(-30), // Last 30 days
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch project data';
    console.error('[Project Overview] Error:', errorMessage, error);
    return NextResponse.json(
      { 
        error: errorMessage,
        message: 'Failed to fetch project data',
        details: error instanceof Error ? error.stack : 'See server logs'
      },
      { status: 500 }
    );
  }
}
