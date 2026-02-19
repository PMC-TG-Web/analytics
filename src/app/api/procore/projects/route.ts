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
    
    // Create TWO maps for lookups:
    // 1. project_number -> v1.1 ID (for the projects that have matching project numbers)
    // 2. name -> v1.1 ID (for fallback matching when project_number doesn't match)
    const v11Map = new Map();
    const normalizedV11Map = new Map(); // project_number -> id mapping with normalized keys
    const v11ByName = new Map(); // name -> id mapping (exact name match)
    v11Projects.forEach((p: any) => {
      if (p.project_number) {
        v11Map.set(p.project_number, p.id);
        const normalized = p.project_number.toLowerCase().replace(/\s+/g, '');
        normalizedV11Map.set(normalized, p.id);
      }
      if (p.name) {
        v11ByName.set(p.name, p.id);
      }
    });
    console.log(`[Procore Projects] Created v11Map with ${v11Map.size} entries, normalizedV11Map with ${normalizedV11Map.size} entries, v11ByName with ${v11ByName.size} entries`);

    if (bidBoardProjects.length > 0) {
      console.log(`[Procore Projects] First 5 v2.0 project_numbers:`);
      bidBoardProjects.slice(0, 5).forEach((p: any, idx: number) => {
        const normalized = p.project_number ? p.project_number.toLowerCase().replace(/\s+/g, '') : 'NULL';
        console.log(`  v2.0[${idx}] "${p.project_number}" => normalized: "${normalized}"`);
      });
      console.log(`[Procore Projects] v2.0 sample ALL keys: ${Object.keys(bidBoardProjects[0]).join(', ')}`);
    }
    
    if (v11Projects.length > 0) {
      console.log(`[Procore Projects] First 5 v1.1 project_numbers:`);
      v11Projects.slice(0, 5).forEach((p: any, idx: number) => {
        const normalized = p.project_number ? p.project_number.toLowerCase().replace(/\s+/g, '') : 'NULL';
        console.log(`  v1.1[${idx}] id=${p.id}, project_number="${p.project_number}" => normalized: "${normalized}"`);
      });
      console.log(`[Procore Projects] v1.1 sample ALL keys: ${Object.keys(v11Projects[0]).join(', ')}`);
    }

    // Debug: count how many have project_number
    const v2WithProjectNumber = bidBoardProjects.filter((p: any) => p.project_number).length;
    const v11WithProjectNumber = v11Projects.filter((p: any) => p.project_number).length;
    console.log(`[Procore Projects] v2.0 projects with project_number: ${v2WithProjectNumber}/${bidBoardProjects.length}`);
    console.log(`[Procore Projects] v1.1 projects with project_number: ${v11WithProjectNumber}/${v11Projects.length}`);

    const debug = request.nextUrl.searchParams.get('debug') === '1';

    // Map to return fields matching the projects list UI expectations
    // Include ALL v2.0 projects, but track which have v1.1 matches for dashboard linking
    let matchCount = 0;
    let skipCount = 0;
    let exactMatches = 0;
    let normalizedMatches = 0;
    let nameMatches = 0;
    
    const mappedProjects = bidBoardProjects
      .filter((p: any, idx: number) => {
        if (!p.project_number) {
          if (idx < 10) console.log(`[Procore Projects] SKIP [${idx}] null/empty project_number, name: ${p.name}`);
          skipCount++;
          return false;
        }
        return true; // Include projects without null project_number
      })
      .map((p: any, idx: number) => {
        // Try matching strategies in order of preference:
        // 1. Exact project_number match
        // 2. Normalized project_number match (lowercase, no spaces)
        // 3. Exact name match (fallback)
        
        let v11Id = v11Map.get(p.project_number);
        let matchType = 'none';
        
        if (v11Id) {
          matchType = 'exact_number';
          exactMatches++;
          matchCount++;
        } else {
          const normalized = p.project_number.toLowerCase().replace(/\s+/g, '');
          v11Id = normalizedV11Map.get(normalized);
          
          if (v11Id) {
            matchType = 'normalized_number';
            normalizedMatches++;
            matchCount++;
          } else if (p.name) {
            // Try name matching as fallback
            v11Id = v11ByName.get(p.name);
            if (v11Id) {
              matchType = 'name_match';
              nameMatches++;
              matchCount++;
            }
          }
        }
        
        if (idx < 10) {
          console.log(`[Procore Projects] [${idx}] "${p.project_number}" name="${p.name}" => ${v11Id ? `MATCH(${matchType}): ${v11Id}` : 'NO MATCH'}`);
        }
        
        return {
          id: v11Id || p.id, // Use v1.1 ID if available, otherwise use v2.0 ID
          name: p.name || 'Unknown Project',
          project_number: p.project_number || '',
          company_name: p.customer_name || p.client_name || 'Unknown',
          project_status: p.status || 'Unknown',
          estimator: p.estimator,
          project_manager: p.project_manager,
          v11_id: v11Id, // Track which ones have real v1.1 IDs
          has_dashboard_link: !!v11Id, // Flag for UI to determine if dashboard link is available
          match_type: matchType, // Debug field
        };
      });
    
    console.log(`[Procore Projects] Match summary: ${matchCount} matches (${exactMatches} exact, ${normalizedMatches} normalized, ${nameMatches} by-name), ${skipCount} skipped, returning ${mappedProjects.length} total projects`);
    
    console.log(`[Procore Projects] Match summary: ${matchCount} matches, ${skipCount} skipped, returning ${mappedProjects.length} projects`);
    
    console.log(`[Procore Projects] Returning ${mappedProjects.length} projects with valid v1.1 IDs`);

    if (debug) {
      // Show matching data for first few v2.0 projects
      const debugProjects = bidBoardProjects.slice(0, 5).map(p => {
        let v11Id = v11Map.get(p.project_number);
        let matchType = 'none';
        if (v11Id) {
          matchType = 'exact_number';
        } else {
          const normalized = p.project_number ? p.project_number.toLowerCase().replace(/\s+/g, '') : '';
          v11Id = normalizedV11Map.get(normalized);
          if (v11Id) {
            matchType = 'normalized_number';
          } else if (p.name) {
            v11Id = v11ByName.get(p.name);
            matchType = v11Id ? 'name_match' : 'none';
          }
        }
        return {
          v2_0_project_number: p.project_number,
          v2_0_id: p.id,
          v2_0_name: p.name,
          v11_id: v11Id,
          match_type: matchType,
        };
      });
      
      return NextResponse.json({
        success: true,
        debug: {
          bidBoardCount: bidBoardProjects.length,
          bidBoardWithProjectNumber: bidBoardProjects.filter((p: any) => p.project_number).length,
          v11Count: v11Projects.length,
          v11WithProjectNumber: v11Projects.filter((p: any) => p.project_number).length,
          v11ByNameCount: v11ByName.size,
          v2_0_sample_keys: bidBoardProjects.length > 0 ? Object.keys(bidBoardProjects[0]) : [],
          v1_1_sample_keys: v11Projects.length > 0 ? Object.keys(v11Projects[0]) : [],
          samples: debugProjects,
          normalizedMapSample: Array.from(normalizedV11Map.keys()).slice(0, 3),
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
