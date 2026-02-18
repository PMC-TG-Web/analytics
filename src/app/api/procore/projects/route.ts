// src/app/api/procore/projects/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { makeRequest, procoreConfig } from '@/lib/procore';

export async function GET(request: NextRequest) {
  try {
    const accessToken = request.cookies.get('procore_access_token')?.value;

    if (!accessToken) {
      return NextResponse.json({ error: 'Not authenticated with Procore' }, { status: 401 });
    }

    const companyId = procoreConfig.companyId;
    console.log(`[Procore Projects] Fetching direct from company ${companyId}`);

    // Fetch data from the working v2.0 endpoint
    const endpoint = `/rest/v2.0/companies/${companyId}/estimating/bid_board_projects?per_page=100`;
    let projects = await makeRequest(endpoint, accessToken);

    // Handle nested data if present
    if (projects && !Array.isArray(projects) && Array.isArray((projects as any).data)) {
      projects = (projects as any).data;
    }

    if (!Array.isArray(projects)) {
      console.error('[Procore Projects] Expected array but got:', projects);
      return NextResponse.json({ error: 'Invalid response from Procore API' }, { status: 500 });
    }

    // Map to our internal Project schema
    const mappedProjects = projects.map((p: any) => {
      let status = p.status || 'Unknown';
      
      // Normalize Procore statuses to match our existing KPI dashboard logic
      if (status === 'IN_PROGRESS') status = 'In Progress';
      else if (status === 'WON') status = 'Accepted';
      else if (status === 'BID_SUBMITTED') status = 'Bid Submitted';
      else if (status === 'ESTIMATING') status = 'Estimating';
      else if (status === 'NEGOTIATING') status = 'Bid Submitted';
      else status = status.replace(/_/g, ' ');

      return {
        id: p.id,
        name: p.name || 'Unknown Project',
        project_number: p.project_number || '',
        company_name: p.customer_name || p.client_name || p.customer?.name || 'Procore Bid Board',
        project_status: status,
        sales: p.stats?.total || 0,
        hours: p.stats?.total_hours || 0,
        created_on: p.created_on || '',
        last_status_change: p.last_status_change || '',
        source: 'procore_live'
      };
    });

    return NextResponse.json({ success: true, projects: mappedProjects });
  } catch (error) {
    console.error('[Procore Projects] Error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
