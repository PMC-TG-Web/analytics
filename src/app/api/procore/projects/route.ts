// src/app/api/procore/projects/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { makeRequest, procoreConfig, refreshAccessToken } from '@/lib/procore';

export async function GET(request: NextRequest) {
  try {
    let accessToken = request.cookies.get('procore_access_token')?.value;
    const refreshToken = request.cookies.get('procore_refresh_token')?.value;

    if (!accessToken) {
      console.log('[Procore Projects] No access token available');
      return NextResponse.json({ 
        error: 'Not authenticated with Procore',
        needsReauth: true
      }, { status: 401 });
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
        console.log(`[Procore Projects] Fetching v2.0 page ${page}: ${bidBoardEndpoint}`);
        const bidResult = await makeRequest(bidBoardEndpoint, accessToken);
        
        // Handle different response formats
        let pageResults: any[] = [];
        if (Array.isArray(bidResult)) {
          pageResults = bidResult;
        } else if (bidResult?.data && Array.isArray(bidResult.data)) {
          pageResults = bidResult.data;
        } else if (bidResult?.projects && Array.isArray(bidResult.projects)) {
          pageResults = bidResult.projects;
        }
        
        console.log(`[Procore Projects] v2.0 page ${page}: received ${pageResults.length} results (total so far: ${bidBoardProjects.length + pageResults.length})`);
        
        if (pageResults.length === 0) {
          console.log(`[Procore Projects] v2.0 page ${page}: empty response, pagination complete`);
          hasMore = false;
        } else {
          bidBoardProjects = bidBoardProjects.concat(pageResults);
          // Always try next page - keep going until we get 0 results
          page++;
        }
      }
      console.log(`[Procore Projects] Total fetched ${bidBoardProjects.length} projects from v2.0`);
    } catch (e) {
      console.error('[Procore Projects] v2.0 error:', e);
    }

    // Also fetch v1.1 projects for ID mapping - with pagination
    // v1.1 API defaults to active projects only, so we need to fetch both active and inactive
    let v11Projects: any[] = [];
    try {
      // Fetch 1: Active projects (default behavior when no filters specified)
      let activeProjects: any[] = [];
      try {
        let page = 1;
        let hasMore = true;
        while (hasMore) {
          const v11Endpoint = `/rest/v1.1/projects?company_id=${companyId}&view=extended&per_page=100&page=${page}`;
          console.log(`[Procore Projects] Fetching v1.1 ACTIVE page ${page}: ${v11Endpoint}`);
          const v11Result = await makeRequest(v11Endpoint, accessToken);
          
          // Handle different response formats
          let pageResults: any[] = [];
          if (Array.isArray(v11Result)) {
            pageResults = v11Result;
          } else if (v11Result?.data && Array.isArray(v11Result.data)) {
            pageResults = v11Result.data;
          }
          
          console.log(`[Procore Projects] v1.1 ACTIVE page ${page}: received ${pageResults.length} results (total so far: ${activeProjects.length + pageResults.length})`);
          
          if (pageResults.length === 0) {
            console.log(`[Procore Projects] v1.1 ACTIVE page ${page}: empty response, pagination complete`);
            hasMore = false;
          } else {
            activeProjects = activeProjects.concat(pageResults);
            page++;
          }
        }
        console.log(`[Procore Projects] Total fetched ${activeProjects.length} ACTIVE projects from v1.1`);
      } catch (e) {
        console.error('[Procore Projects] v1.1 ACTIVE fetch error:', e);
      }

      // Fetch 2: Inactive projects (with filters[active]=false)
      let inactiveProjects: any[] = [];
      try {
        let page = 1;
        let hasMore = true;
        while (hasMore) {
          const v11Endpoint = `/rest/v1.1/projects?company_id=${companyId}&view=extended&filters[active]=false&per_page=100&page=${page}`;
          console.log(`[Procore Projects] Fetching v1.1 INACTIVE page ${page}: ${v11Endpoint}`);
          const v11Result = await makeRequest(v11Endpoint, accessToken);
          
          // Handle different response formats
          let pageResults: any[] = [];
          if (Array.isArray(v11Result)) {
            pageResults = v11Result;
          } else if (v11Result?.data && Array.isArray(v11Result.data)) {
            pageResults = v11Result.data;
          }
          
          console.log(`[Procore Projects] v1.1 INACTIVE page ${page}: received ${pageResults.length} results (total so far: ${inactiveProjects.length + pageResults.length})`);
          
          if (pageResults.length === 0) {
            console.log(`[Procore Projects] v1.1 INACTIVE page ${page}: empty response, pagination complete`);
            hasMore = false;
          } else {
            inactiveProjects = inactiveProjects.concat(pageResults);
            page++;
          }
        }
        console.log(`[Procore Projects] Total fetched ${inactiveProjects.length} INACTIVE projects from v1.1`);
      } catch (e) {
        console.error('[Procore Projects] v1.1 INACTIVE fetch error:', e);
      }

      // Combine both lists and deduplicate by ID
      const projectMap = new Map();
      activeProjects.forEach((p: any) => {
        if (p.id) {
          projectMap.set(p.id, p);
        }
      });
      inactiveProjects.forEach((p: any) => {
        if (p.id && !projectMap.has(p.id)) {
          projectMap.set(p.id, p);
        }
      });
      v11Projects = Array.from(projectMap.values());

      console.log(`[Procore Projects] Total fetched ${activeProjects.length} active + ${inactiveProjects.length} inactive = ${v11Projects.length} combined unique projects from v1.1`);
      if (v11Projects.length > 0) {
        console.log(`[Procore Projects] First 3 v1.1 projects: ${v11Projects.slice(0, 3).map(p => `${p.project_number} (ID: ${p.id}, active: ${p.active})`).join(', ')}`);
      }
    } catch (e) {
      console.error('[Procore Projects] v1.1 error:', e);
    }
    
    // Build index of v2.0 projects for quick matching
    const v20ByExactNumber = new Map();
    const v20ByNormalizedNumber = new Map();
    const v20ByExactName = new Map();
    const v20ByNormalizedName = new Map();
    
    bidBoardProjects.forEach((p: any) => {
      if (p.project_number) {
        v20ByExactNumber.set(p.project_number, p);
        const normalized = p.project_number.toLowerCase().replace(/\s+/g, '');
        v20ByNormalizedNumber.set(normalized, p);
      }
      if (p.name) {
        v20ByExactName.set(p.name, p);
        const normalizedName = p.name.trim().toLowerCase();
        v20ByNormalizedName.set(normalizedName, p);
      }
    });
    
    console.log(`[Procore Projects] Built v2.0 indices: ${v20ByExactNumber.size} by number, ${v20ByNormalizedNumber.size} normalized, ${v20ByExactName.size} by name, ${v20ByNormalizedName.size} normalized name`);

    const debug = request.nextUrl.searchParams.get('debug') === '1';

    // Map to return fields matching the projects list UI expectations
    // Use v1.1 as PRIMARY source (has all ~300 projects)
    // Enrich with v2.0 bid board data where available (customer names, estimator, etc.)
    let matchCount = 0;
    let exactMatches = 0;
    let normalizedMatches = 0;
    let nameMatches = 0;
    let normalizedNameMatches = 0;
    
    const mappedProjects = v11Projects
      .map((p: any, idx: number) => {
        // Try to find matching v2.0 project to enrich with customer/estimator data
        let v20Data: any = null;
        let matchType = 'none';
        
        if (p.project_number) {
          // Try exact match on project_number
          v20Data = v20ByExactNumber.get(p.project_number);
          if (v20Data) {
            matchType = 'exact_number';
            exactMatches++;
            matchCount++;
          } else {
            // Try normalized match
            const normalized = p.project_number.toLowerCase().replace(/\s+/g, '');
            v20Data = v20ByNormalizedNumber.get(normalized);
            if (v20Data) {
              matchType = 'normalized_number';
              normalizedMatches++;
              matchCount++;
            }
          }
        }
        
        // Fallback to name match if no number match
        if (!v20Data && p.name) {
          v20Data = v20ByExactName.get(p.name);
          if (v20Data) {
            matchType = 'name_exact';
            nameMatches++;
            matchCount++;
          } else {
            const normalizedName = p.name.trim().toLowerCase();
            v20Data = v20ByNormalizedName.get(normalizedName);
            if (v20Data) {
              matchType = 'name_normalized';
              normalizedNameMatches++;
              matchCount++;
            }
          }
        }
        
        if (idx < 15) {
          console.log(`[Procore Projects] v1.1[${idx}] name="${p.name?.substring(0, 35)}" => ${v20Data ? `enriched_with_v2.0(${matchType})` : 'no_v2.0_data'}`);
        }
        
        return {
          id: p.id,
          name: p.name || 'Unknown Project',
          project_number: p.project_number || '',
          // Use v2.0 customer if available, otherwise try v1.1 company_name
          company_name: v20Data?.customer_name || v20Data?.client_name || p.company_name || 'Unknown',
          project_status: v20Data?.status || p.project_status || (p.active ? 'Active' : 'Inactive') || 'Unknown',
          estimator: v20Data?.estimator,
          project_manager: v20Data?.project_manager,
          v20_matched: !!v20Data,
          match_type: matchType,
        };
      });
    
    console.log(`[Procore Projects] PRIMARY SOURCE: v1.1 (${v11Projects.length} projects total)`);
    console.log(`[Procore Projects] ENRICHMENT: v2.0 bid board (${matchCount} matches: ${exactMatches} exact, ${normalizedMatches} norm, ${nameMatches} name, ${normalizedNameMatches} name_norm)`);
    console.log(`[Procore Projects] Returning ${mappedProjects.length} total projects from v1.1`);

    if (debug) {
      // Debug mode: show summary stats and sample projects
      return NextResponse.json({
        success: true,
        debug: {
          bidBoardCount: bidBoardProjects.length,
          v11Count: v11Projects.length,
          matchCount: matchCount,
          matchBreakdown: {
            exact_number: exactMatches,
            normalized_number: normalizedMatches,
            name_exact: nameMatches,
            name_normalized: normalizedNameMatches,
          },
        },
        projects: mappedProjects.slice(0, 10),
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
