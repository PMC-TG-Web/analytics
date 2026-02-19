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
    console.log(`[Procore Projects] Fetching from both v2.0 (customer data) and v1.1 (IDs for dashboard)`);

    // Fetch from v2.0 bid board (has customer names)
    const v2Endpoint = `/rest/v2.0/companies/${companyId}/estimating/bid_board_projects?per_page=100`;
    let bidBoardProjects = await makeRequest(v2Endpoint, accessToken);
    
    // Handle nested data structure
    if (bidBoardProjects && !Array.isArray(bidBoardProjects) && Array.isArray((bidBoardProjects as any).data)) {
      bidBoardProjects = (bidBoardProjects as any).data;
    }

    // Fetch from v1.1 (for dashboard-compatible IDs)
    const v1Endpoint = `/rest/v1.1/projects?company_id=${companyId}&view=extended&per_page=100&filters[active]=any`;
    let v1Projects = await makeRequest(v1Endpoint, accessToken);

    if (!Array.isArray(bidBoardProjects) || !Array.isArray(v1Projects)) {
      console.error('[Procore Projects] Expected arrays');
      return NextResponse.json({ error: 'Invalid response from Procore API' }, { status: 500 });
    }

    // Create lookup map: project_number -> v1.1 project ID
    const v1Map = new Map();
    v1Projects.forEach((p: any) => {
      if (p.project_number) {
        v1Map.set(p.project_number.trim().toLowerCase(), p);
      }
    });

    const debug = request.nextUrl.searchParams.get('debug') === '1';

    // Map to return fields - use v2.0 for customer, match to v1.1 ID by project number
    const mappedProjects = bidBoardProjects.map((p: any) => {
      const projectNumber = (p.project_number || '').trim().toLowerCase();
      const v1Match = v1Map.get(projectNumber);
      
      // Normalize status from v2.0
      let status = p.status || 'Unknown';
      if (status === 'IN_PROGRESS') status = 'In Progress';
      else if (status === 'WON') status = 'Accepted';
      else if (status === 'BID_SUBMITTED') status = 'Bid Submitted';
      else if (status === 'ESTIMATING') status = 'Estimating';
      else if (status === 'NEGOTIATING') status = 'Negotiating';
      else if (status === 'BIDDING') status = 'Bidding';
      else status = status.replace(/_/g, ' ');

      return {
        id: v1Match?.id || p.id, // Use v1.1 ID if matched, fallback to v2.0 ID
        name: p.name || 'Unknown Project',
        project_number: p.project_number || '',
        company_name: p.customer_name || p.client_name || p.customer?.name || 'Unknown',
        project_status: status,
        estimator: v1Match?.estimator || p.estimator,
        project_manager: v1Match?.project_manager || p.project_manager,
        _hasV1Match: !!v1Match, // Track if we found a matching v1.1 project
      };
    });

    if (debug) {
      const v2Sample = bidBoardProjects[0] || {};
      const v1Sample = v1Projects[0] || {};
      return NextResponse.json({
        success: true,
        debug: {
          v2_keys: Object.keys(v2Sample),
          v2_customer_name: v2Sample.customer_name,
          v2_client_name: v2Sample.client_name,
          v2_status: v2Sample.status,
          v2_project_number: v2Sample.project_number,
          v1_keys: Object.keys(v1Sample),
          v1_id: v1Sample.id,
          v1_project_number: v1Sample.project_number,
          v1_company: v1Sample.company,
          matchedCount: mappedProjects.filter((p: any) => p._hasV1Match).length,
          totalV2Projects: bidBoardProjects.length,
          totalV1Projects: v1Projects.length,
        },
        projects: mappedProjects.slice(0, 5),
      });
    }

    return NextResponse.json({ success: true, projects: mappedProjects });
  } catch (error) {
    console.error('[Procore Projects] Error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
