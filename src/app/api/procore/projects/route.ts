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
      let totalFetched = 0;
      while (hasMore && page <= 10) { // Add safety limit
        const bidBoardEndpoint = `/rest/v2.0/companies/${companyId}/estimating/bid_board_projects?per_page=100&page=${page}`;
        console.log(`[Procore Projects] Fetching v2.0 page ${page}: ${bidBoardEndpoint}`);
        const bidResult = await makeRequest(bidBoardEndpoint, accessToken);
        
        // Debug the response structure
        console.log(`[Procore Projects] v2.0 Response type: ${typeof bidResult}, is array: ${Array.isArray(bidResult)}`);
        if (bidResult && typeof bidResult === 'object') {
          console.log(`[Procore Projects] v2.0 Response keys: ${Object.keys(bidResult).join(', ')}`);
        }
        
        const pageResults = Array.isArray(bidResult?.data) ? bidResult.data : Array.isArray(bidResult) ? bidResult : [];
        console.log(`[Procore Projects] Page ${page} returned ${pageResults.length} results`);
        
        bidBoardProjects = bidBoardProjects.concat(pageResults);
        totalFetched += pageResults.length;
        
        hasMore = pageResults.length === 100; // If we got exactly 100, there might be more pages
        if (hasMore) {
          console.log(`[Procore Projects] Got 100 results, fetching next page...`);
        }
        page++;
      }
      console.log(`[Procore Projects] Total fetched ${bidBoardProjects.length} projects from v2.0 (${totalFetched} total iterated)`);
    } catch (e) {
      console.error('[Procore Projects] v2.0 error:', e);
    }

    // Also fetch v1.1 projects for ID mapping - with pagination
    let v11Projects: any[] = [];
    try {
      let page = 1;
      let hasMore = true;
      let totalFetched = 0;
      while (hasMore && page <= 10) { // Add safety limit
        const v11Endpoint = `/rest/v1.1/projects?company_id=${companyId}&view=extended&per_page=100&filters[active]=any&page=${page}`;
        console.log(`[Procore Projects] Fetching v1.1 page ${page}: ${v11Endpoint}`);
        const v11Result = await makeRequest(v11Endpoint, accessToken);
        
        // Debug the response structure
        console.log(`[Procore Projects] v1.1 Response type: ${typeof v11Result}, is array: ${Array.isArray(v11Result)}`);
        if (v11Result && typeof v11Result === 'object' && !Array.isArray(v11Result)) {
          console.log(`[Procore Projects] v1.1 Response keys: ${Object.keys(v11Result).join(', ')}`);
        }
        
        const pageResults = Array.isArray(v11Result) ? v11Result : [];
        console.log(`[Procore Projects] v1.1 Page ${page} returned ${pageResults.length} results`);
        
        v11Projects = v11Projects.concat(pageResults);
        totalFetched += pageResults.length;
        
        hasMore = pageResults.length === 100; // If we got exactly 100, there might be more pages
        if (hasMore) {
          console.log(`[Procore Projects] Got 100 results, fetching next page...`);
        }
        page++;
      }
      console.log(`[Procore Projects] Total fetched ${v11Projects.length} projects from v1.1 (${totalFetched} total iterated)`);
      if (v11Projects.length > 0) {
        console.log(`[Procore Projects] First 3 v1.1 projects: ${v11Projects.slice(0, 3).map(p => `${p.project_number} (ID: ${p.id})`).join(', ')}`);
      }
    } catch (e) {
      console.error('[Procore Projects] v1.1 error:', e);
    }
    
    // Create a map of NORMALIZED project_number -> v1.1 ID for lookups
    // Normalize: lowercase and remove all spaces
    const v11Map = new Map();
    const normalizedV11Map = new Map(); // project_number -> id mapping with normalized keys
    v11Projects.forEach((p: any) => {
      if (p.project_number) {
        v11Map.set(p.project_number, p.id);
        const normalized = p.project_number.toLowerCase().replace(/\s+/g, '');
        normalizedV11Map.set(normalized, p.id);
      }
    });
    console.log(`[Procore Projects] Created v11Map with ${v11Map.size} entries, normalizedV11Map with ${normalizedV11Map.size} entries`);

    if (bidBoardProjects.length > 0) {
      console.log(`[Procore Projects] First 3 v2.0 projects and their numbers:`);
      bidBoardProjects.slice(0, 3).forEach((p: any, idx: number) => {
        console.log(`  [${idx}] project_number=${p.project_number}, fields: ${Object.keys(p).slice(0, 5).join(', ')}`);
      });
      console.log(`[Procore Projects] v2.0 sample keys: ${Object.keys(bidBoardProjects[0]).join(', ')}`);
    }
    
    if (v11Projects.length > 0) {
      console.log(`[Procore Projects] First 3 v1.1 projects and their numbers:`);
      v11Projects.slice(0, 3).forEach((p: any, idx: number) => {
        console.log(`  [${idx}] project_number=${p.project_number}, id=${p.id}`);
      });
      console.log(`[Procore Projects] v1.1 sample keys: ${Object.keys(v11Projects[0]).join(', ')}`);
    }

    const debug = request.nextUrl.searchParams.get('debug') === '1';

    // Map to return fields matching the projects list UI expectations
    // Only include projects that have v1.1 matches so dashboard links work
    const mappedProjects = bidBoardProjects
      .filter((p: any) => {
        if (!p.project_number) {
          console.log(`[Procore Projects] Skipping project with null/empty project_number`);
          return false;
        }
        // Try exact match first, then normalized match
        let v11Id = v11Map.get(p.project_number);
        if (!v11Id) {
          const normalized = p.project_number.toLowerCase().replace(/\s+/g, '');
          v11Id = normalizedV11Map.get(normalized);
          if (v11Id && bidBoardProjects.indexOf(p) < 5) {
            console.log(`[Procore Projects] Normalized match found: "${p.project_number}" => normalized "${normalized}" => v1.1 ID ${v11Id}`);
          }
        } else if (bidBoardProjects.indexOf(p) < 5) {
          console.log(`[Procore Projects] Exact match found: "${p.project_number}" => v1.1 ID ${v11Id}`);
        }
        return v11Id; // Only include if we have a v1.1 ID
      })
      .map((p: any) => {
        // Get ID using the same logic as filter (project_number is guaranteed to exist from filter)
        let v11Id = v11Map.get(p.project_number);
        if (!v11Id && p.project_number) {
          const normalized = p.project_number.toLowerCase().replace(/\s+/g, '');
          v11Id = normalizedV11Map.get(normalized);
        }
        
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
