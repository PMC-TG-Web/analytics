// src/app/api/procore/projects/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { makeRequest, procoreConfig, refreshAccessToken } from '@/lib/procore';

export async function GET(request: NextRequest) {
  try {
    let accessToken = request.cookies.get('procore_access_token')?.value;
    const refreshToken = request.cookies.get('procore_refresh_token')?.value;

    const requestedCompanyId = request.nextUrl.searchParams.get('companyId')?.trim();
    const includeBidBoard = request.nextUrl.searchParams.get('includeBidBoard') !== '0';
    const maxBidBoardPages = Math.max(
      1,
      Number(request.nextUrl.searchParams.get('maxBidBoardPages')) || 5
    );
    const bidBoardTimeBudgetMs = Math.max(
      5000,
      Number(request.nextUrl.searchParams.get('bidBoardTimeBudgetMs')) || 15000
    );

    if (!accessToken) {
      console.log('[Procore Projects] No access token available');
      return NextResponse.json({ 
        error: 'Not authenticated with Procore',
        needsReauth: true
      }, { status: 401 });
    }

    const companyId = procoreConfig.companyId;
    const effectiveCompanyId = requestedCompanyId || companyId;
    console.log(`[Procore Projects] Fetching from v2.0 bid board and v1.1 projects`);

    // Fetch from v2.0 bid board (has customer data) - with pagination
    let bidBoardProjects: any[] = [];
    if (includeBidBoard) {
      try {
        const bidBoardStart = Date.now();
        let page = 1;
        let hasMore = true;
        while (hasMore) {
          if (page > maxBidBoardPages) {
            console.log(`[Procore Projects] v2.0 page limit reached (${maxBidBoardPages}). Stopping.`);
            break;
          }
          if (Date.now() - bidBoardStart > bidBoardTimeBudgetMs) {
            console.log('[Procore Projects] v2.0 time budget reached. Stopping.');
            break;
          }

          const bidBoardEndpoint = `/rest/v2.0/companies/${effectiveCompanyId}/estimating/bid_board_projects?per_page=100&page=${page}`;
          console.log(`[Procore Projects] Fetching v2.0 page ${page}: ${bidBoardEndpoint}`);
          const bidResult = await makeRequest(bidBoardEndpoint, accessToken, {
            headers: { 'Procore-Company-Id': effectiveCompanyId }
          });
          
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
    } else {
      console.log('[Procore Projects] Skipping v2.0 bid board fetch (includeBidBoard=0)');
    }

    // Also fetch v1.1 projects for ID mapping - with pagination
    // Try multiple endpoints and filter approaches to get ALL projects
    let v11Projects: any[] = [];

    const fetchProjectsForCompany = async (targetCompanyId: string) => {
      // Approach 1: Try v1.0 company projects endpoint (might include all statuses)
      console.log(`[Procore Projects] Attempting v1.0 company projects endpoint for ${targetCompanyId}...`);
      let allProjects: any[] = [];
      try {
        let page = 1;
        while (true) {
          const endpoint = `/rest/v1.0/companies/${targetCompanyId}/projects?per_page=100&page=${page}`;
          console.log(`[Procore Projects] Fetching v1.0 company projects page ${page}`);
          const result = await makeRequest(endpoint, accessToken, {
            headers: { 'Procore-Company-Id': targetCompanyId }
          });
          const pageResults = Array.isArray(result) ? result : (result?.data || []);
          
          if (pageResults.length === 0) break;
          console.log(`[Procore Projects] v1.0 page ${page}: got ${pageResults.length} projects`);
          allProjects = allProjects.concat(pageResults);
          page++;
        }
        console.log(`[Procore Projects] ✅ v1.0 company endpoint returned ${allProjects.length} total projects`);
        
        // Log status breakdown
        if (allProjects.length > 0) {
          const statusCounts = {} as Record<string, number>;
          allProjects.forEach((p: any) => {
            const status = p.project_status || p.status || 'unknown';
            statusCounts[status] = (statusCounts[status] || 0) + 1;
          });
          console.log('[Procore Projects] Status breakdown:', statusCounts);
          console.log('[Procore Projects] Sample project:', {
            name: allProjects[0].name,
            status: allProjects[0].project_status || allProjects[0].status,
            id: allProjects[0].id,
            active: allProjects[0].active
          });
        }
        
        return allProjects;
      } catch (e1) {
        console.error('[Procore Projects] v1.0 company endpoint failed:', e1);
      }
      
      // Fallback: Try v1.1 default endpoint
      console.log('[Procore Projects] Falling back to v1.1 default endpoint...');
      let page = 1;
      let fallbackProjects: any[] = [];
      while (true) {
        const endpoint = `/rest/v1.1/projects?company_id=${targetCompanyId}&view=extended&per_page=100&page=${page}`;
        console.log(`[Procore Projects] Fetching v1.1 page ${page}`);
        const result = await makeRequest(endpoint, accessToken, {
          headers: { 'Procore-Company-Id': targetCompanyId }
        });
        const pageResults = Array.isArray(result) ? result : (result?.data || []);
        
        if (pageResults.length === 0) break;
        console.log(`[Procore Projects] v1.1 page ${page}: got ${pageResults.length} projects`);
        fallbackProjects = fallbackProjects.concat(pageResults);
        page++;
      }
      console.log(`[Procore Projects] ✅ v1.1 endpoint returned ${fallbackProjects.length} total projects`);
      return fallbackProjects;
    };

    const fetchCompanies = async () => {
      const url = `${procoreConfig.apiUrl}/rest/v1.0/companies`;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
          }
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
          const errorBody = await response.text();
          console.error('[Procore Projects] Failed to list companies:', response.status, errorBody);
          return [] as any[];
        }
        const result = await response.json();
        return Array.isArray(result) ? result : (result?.data || []);
      } catch (err) {
        console.error('[Procore Projects] Companies fetch error:', err);
        return [] as any[];
      }
    };

    try {
      v11Projects = await fetchProjectsForCompany(effectiveCompanyId);

      if (v11Projects.length === 0 && !requestedCompanyId) {
        const companies = await fetchCompanies();
        if (companies.length > 0) {
          const fallbackCompanyId = String(companies[0].id || '');
          if (fallbackCompanyId && fallbackCompanyId !== effectiveCompanyId) {
            console.log(`[Procore Projects] No projects for company ${effectiveCompanyId}. Retrying with ${fallbackCompanyId}.`);
            v11Projects = await fetchProjectsForCompany(fallbackCompanyId);
          }
        }
      }
    } catch (e) {
      console.error('[Procore Projects] Project fetch error:', e);
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
