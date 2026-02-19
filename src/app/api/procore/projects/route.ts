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
    console.log(`[Procore Projects] Fetching from v2.0 bid board and v1.1 projects`);

    // Fetch from v2.0 bid board (has customer data) - with pagination
    let bidBoardProjects: any[] = [];
    try {
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const bidBoardEndpoint = `/rest/v2.0/companies/${companyId}/estimating/bid_board_projects?per_page=100&page=${page}`;
        const bidResult = await makeRequest(bidBoardEndpoint, accessToken);
        const pageResults = Array.isArray(bidResult?.data) ? bidResult.data : Array.isArray(bidResult) ? bidResult : [];
        bidBoardProjects = bidBoardProjects.concat(pageResults);
        console.log(`[Procore Projects] Fetched ${pageResults.length} projects from v2.0 page ${page}`);
        hasMore = pageResults.length === 100; // If we got exactly 100, there might be more pages
        page++;
      }
      console.log(`[Procore Projects] Total fetched ${bidBoardProjects.length} projects from v2.0`);
    } catch (e) {
      console.error('[Procore Projects] v2.0 error:', e);
    }

    // Also fetch v1.1 projects for ID mapping - with pagination
    let v11Projects: any[] = [];
    try {
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const v11Endpoint = `/rest/v1.1/projects?company_id=${companyId}&view=extended&per_page=100&filters[active]=any&page=${page}`;
        const v11Result = await makeRequest(v11Endpoint, accessToken);
        const pageResults = Array.isArray(v11Result) ? v11Result : [];
        v11Projects = v11Projects.concat(pageResults);
        console.log(`[Procore Projects] Fetched ${pageResults.length} projects from v1.1 page ${page}`);
        hasMore = pageResults.length === 100; // If we got exactly 100, there might be more pages
        page++;
      }
      console.log(`[Procore Projects] Total fetched ${v11Projects.length} projects from v1.1`);
      if (v11Projects.length > 0) {
        console.log(`[Procore Projects] First 3 v1.1 projects: ${v11Projects.slice(0, 3).map(p => `${p.project_number} (ID: ${p.id})`).join(', ')}`);
      }
    } catch (e) {
      console.error('[Procore Projects] v1.1 error:', e);
    }
    
    // Create a map of project_number -> v1.1 ID for lookups
    const v11Map = new Map();
    v11Projects.forEach((p: any) => {
      if (p.project_number) {
        v11Map.set(p.project_number, p.id);
      }
    });

    if (bidBoardProjects.length > 0) {
      console.log(`[Procore Projects] First 3 v2.0 projects: ${bidBoardProjects.slice(0, 3).map((p: any) => `${p.project_number}`).join(', ')}`);
    }

    const debug = request.nextUrl.searchParams.get('debug') === '1';

    // Map to return fields matching the projects list UI expectations
    // Only include projects that have v1.1 matches so dashboard links work
    const mappedProjects = bidBoardProjects
      .filter((p: any) => {
        const v11Id = v11Map.get(p.project_number);
        if (v11Id) {
          console.log(`[Procore Projects] Match found: ${p.project_number} => v1.1 ID ${v11Id}`);
        }
        return v11Id; // Only include if we have a v1.1 ID
      })
      .map((p: any) => {
        const v11Id = v11Map.get(p.project_number)!; // We know it exists after filter
        
        return {
          id: v11Id,
          name: p.name || 'Unknown Project',
          project_number: p.project_number || '',
          company_name: p.customer_name || p.client_name || 'Unknown',
          project_status: p.status || 'Unknown',
          estimator: p.estimator,
          project_manager: p.project_manager,
        };
      });
    
    console.log(`[Procore Projects] Returning ${mappedProjects.length} projects with valid v1.1 IDs`);

    if (debug) {
      const sample = bidBoardProjects[0] || {};
      return NextResponse.json({
        success: true,
        debug: {
          bidBoardCount: bidBoardProjects.length,
          v11Count: v11Projects.length,
          customer_name: sample.customer_name,
          client_name: sample.client_name,
          status: sample.status,
          project_number: sample.project_number,
          v11_id_for_first: v11Map.get(sample.project_number),
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
