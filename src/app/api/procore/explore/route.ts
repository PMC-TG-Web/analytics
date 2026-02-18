// app/api/procore/explore/route.ts - Endpoint to explore available Procore data
import { NextRequest, NextResponse } from 'next/server';
import { makeRequest, procoreConfig } from '@/lib/procore';

export async function POST(request: NextRequest) {
  try {
    const accessToken = request.cookies.get('procore_access_token')?.value;

    if (!accessToken) {
      console.error('Procore Explore: No access token found in cookies');
      return NextResponse.json(
        { error: 'No access token found. Please authenticate first.' },
        { status: 401 }
      );
    }

    console.log('Procore Explore: Access token found, starting requests...');
    const data: Record<string, any> = {};

    // Get Company ID from our robust config
    const companyId = procoreConfig.companyId;
    console.log(`Procore Explore: Using Company ID ${companyId}`);

    // Build exhaustive filters for Estimating v2.0
    const statuses = ['ESTIMATING', 'BIDDING', 'BID_SUBMITTED', 'NEGOTIATING', 'WON', 'LOST', 'DECLINED'];
    const statusFilter = `&filters[status][]=${statuses.join('&filters[status][]=')}`;

    const results = await Promise.allSettled([
      // 0: User info
      makeRequest('/rest/v1.0/me', accessToken),
      // 1: Companies
      makeRequest('/rest/v1.0/companies', accessToken),
      // 2: Projects (v1.1) - include archived
      makeRequest(`/rest/v1.1/projects?company_id=${companyId}&view=extended&per_page=100&filters[active]=any`, accessToken),
      // 3: Project Templates
      makeRequest(`/rest/v1.0/project_templates?company_id=${companyId}&per_page=100`, accessToken),
      // 4: Vendors
      makeRequest(`/rest/v1.0/vendors?company_id=${companyId}&per_page=100`, accessToken),
      // 5: Users
      makeRequest(`/rest/v1.0/users?company_id=${companyId}&per_page=100`, accessToken),
      // 6: Bid board projects (Standard)
      makeRequest('/rest/v1.0/bid_board_projects?per_page=100', accessToken),
      // 7: Estimating projects (Alternate)
      makeRequest('/rest/v1.0/estimating_projects?per_page=100', accessToken),
      // 8: Estimating v2.0 (Verified Winner) - include all statuses
      makeRequest(`/rest/v2.0/companies/${companyId}/estimating/bid_board_projects?per_page=100${statusFilter}`, accessToken)
    ]);

    const labels = [
      'user', 
      'companies', 
      'projects', 
      'projectTemplates', 
      'vendors', 
      'users', 
      'bidBoardProjects', 
      'estimatingProjects',
      'bidBoardV2'
    ];
    results.forEach((result, idx) => {
      const label = labels[idx];
      if (result.status === 'fulfilled') {
        data[label] = result.value;
      } else {
        data[label] = { error: String(result.reason) };
      }
    });

    // Create a unified projects list for the UI
    const coreProjects = Array.isArray(data.projects) ? data.projects : [];
    const bidProjects = (data.bidBoardV2 && Array.isArray(data.bidBoardV2.data)) ? data.bidBoardV2.data : [];
    
    // Add a flag to distinguish them
    const unified = [
      ...coreProjects.map((p: any) => ({ ...p, _source: 'Core Project' })),
      ...bidProjects.map((p: any) => ({ ...p, _source: 'Bid Board' }))
    ];
    
    data.unifiedProjects = unified;

    // 9: Fetch Manpower Logs for Giant #6582 specifically if found, otherwise sample 5
    const giantProject = unified.find((p: any) => p.name?.includes('Giant') && p.project_number?.includes('6582')) 
                      || unified.find((p: any) => p.name?.includes('6582'));

    const projectsToFetch = giantProject ? [giantProject, ...coreProjects.slice(0, 4)] : coreProjects.slice(0, 5);
    const uniqueProjects = Array.from(new Map(projectsToFetch.map((p: any) => [p.id, p])).values()).slice(0, 6);
    
    // Default to last 90 days of data
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);
    const dateStr = startDate.toISOString().split('T')[0];

    const logResults = await Promise.allSettled(
      uniqueProjects.map((p: any) => 
        makeRequest(`/rest/v1.0/projects/${p.id}/manpower_logs?start_date=${dateStr}&per_page=100`, accessToken)
      )
    );

    data.productivityLogs = logResults.map((result, idx) => ({
      projectId: uniqueProjects[idx].id,
      projectName: uniqueProjects[idx].name,
      logs: result.status === 'fulfilled' ? result.value : { error: String(result.reason) }
    }));

    // SPECIAL PULL: Productivity Logs (Field Productivity) for Giant #6582
    if (giantProject) {
      try {
        const prodLogs = await makeRequest(`/rest/v1.0/projects/${giantProject.id}/productivity_logs?start_date=${dateStr}&per_page=100`, accessToken);
        data.giantProductivity = {
          name: giantProject.name,
          id: giantProject.id,
          data: prodLogs
        };
      } catch (e) {
        console.error('Error fetching Giant productivity:', e);
      }
    }

    return NextResponse.json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
