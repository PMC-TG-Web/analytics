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
    let v11Projects: any[] = [];
    try {
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const v11Endpoint = `/rest/v1.1/projects?company_id=${companyId}&view=extended&per_page=100&filters[active]=any&page=${page}`;
        console.log(`[Procore Projects] Fetching v1.1 page ${page}: ${v11Endpoint}`);
        const v11Result = await makeRequest(v11Endpoint, accessToken);
        
        // Handle different response formats
        let pageResults: any[] = [];
        if (Array.isArray(v11Result)) {
          pageResults = v11Result;
        } else if (v11Result?.data && Array.isArray(v11Result.data)) {
          pageResults = v11Result.data;
        }
        
        console.log(`[Procore Projects] v1.1 page ${page}: received ${pageResults.length} results (total so far: ${v11Projects.length + pageResults.length})`);
        
        if (pageResults.length === 0) {
          console.log(`[Procore Projects] v1.1 page ${page}: empty response, pagination complete`);
          hasMore = false;
        } else {
          v11Projects = v11Projects.concat(pageResults);
          // Always try next page - keep going until we get 0 results
          page++;
        }
      }
      console.log(`[Procore Projects] Total fetched ${v11Projects.length} projects from v1.1`);
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
    const v11ByNormalizedName = new Map(); // normalized name -> id mapping (case/space insensitive)
    
    v11Projects.forEach((p: any) => {
      if (p.project_number) {
        v11Map.set(p.project_number, p.id);
        const normalized = p.project_number.toLowerCase().replace(/\s+/g, '');
        normalizedV11Map.set(normalized, p.id);
      }
      if (p.name) {
        v11ByName.set(p.name, p.id);
        // Also add normalized version (trim, lowercase)
        const normalizedName = p.name.trim().toLowerCase();
        v11ByNormalizedName.set(normalizedName, p.id);
      }
    });
    console.log(`[Procore Projects] Created v11Map with ${v11Map.size} entries, normalizedV11Map with ${normalizedV11Map.size} entries, v11ByName with ${v11ByName.size} entries, v11ByNormalizedName with ${v11ByNormalizedName.size} entries`);
    
    // Log some samples from the normalized name map
    if (v11ByNormalizedName.size > 0) {
      const samples = Array.from(v11ByNormalizedName.keys()).slice(0, 3);
      console.log(`[Procore Projects] v11ByNormalizedName sample keys: ${samples.map(k => `"${k}"`).join(', ')}`);
    }

    if (bidBoardProjects.length > 0) {
      console.log(`[Procore Projects] First 5 v2.0 project_numbers:`);
      bidBoardProjects.slice(0, 5).forEach((p: any, idx: number) => {
        const normalized = p.project_number ? p.project_number.toLowerCase().replace(/\s+/g, '') : 'NULL';
        console.log(`  v2.0[${idx}] "${p.project_number}" => normalized: "${normalized}"`);
      });
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
    // Return ALL v2.0 projects - they are the source of truth for project listing
    // v1.1 IDs are optional for dashboard integration but shouldn't block project display
    let matchCount = 0;
    let exactMatches = 0;
    let normalizedMatches = 0;
    let nameMatches = 0;
    let normalizedNameMatches = 0;
    
    const mappedProjects = bidBoardProjects
      .map((p: any, idx: number) => {
        // Try matching strategies in order of preference (for dashboard integration):
        // 1. Exact project_number match
        // 2. Normalized project_number match (lowercase, no spaces)
        // 3. Exact name match
        // 4. Normalized name match (trim, lowercase)
        // Note: Not matching is OK - we still return the project, just without v1.1 link
        
        let v11Id: any = null;
        let matchType = 'none';
        
        if (p.project_number) {
          v11Id = v11Map.get(p.project_number);
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
              // Try exact name match
              v11Id = v11ByName.get(p.name);
              if (v11Id) {
                matchType = 'name_exact';
                nameMatches++;
                matchCount++;
              } else {
                // Try normalized name match (trim, lowercase)
                const normalizedName = p.name.trim().toLowerCase();
                v11Id = v11ByNormalizedName.get(normalizedName);
                if (v11Id) {
                  matchType = 'name_normalized';
                  normalizedNameMatches++;
                  matchCount++;
                  if (idx < 20) {
                    console.log(`[Procore Projects] [${idx}] NAME MATCH (normalized): "${p.name}" => "${normalizedName}"`);
                  }
                }
              }
            }
          }
        }
        
        if (idx < 15) {
          console.log(`[Procore Projects] [${idx}] num="${p.project_number}" name="${p.name?.substring(0, 35)}" => ${v11Id ? `v1.1_ID: ${v11Id} (${matchType})` : 'no_v1.1_match'}`);
        }
        
        return {
          id: p.id, // Always use v2.0 ID for uniqueness
          name: p.name || 'Unknown Project',
          project_number: p.project_number || '',
          company_name: p.customer_name || p.client_name || 'Unknown',
          project_status: p.status || 'Unknown',
          estimator: p.estimator,
          project_manager: p.project_manager,
          v11_id: v11Id, // Track which ones have real v1.1 IDs for dashboard
          has_dashboard_link: !!v11Id, // Flag for UI to determine if dashboard link is available
          match_type: matchType, // Debug field
        };
      });
    
    console.log(`[Procore Projects] Match summary: ${matchCount} v1.1 matches (${exactMatches} exact_number, ${normalizedMatches} normalized_number, ${nameMatches} name_exact, ${normalizedNameMatches} name_normalized), returning ALL ${mappedProjects.length} v2.0 projects`);

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
            if (v11Id) {
              matchType = 'name_exact';
            } else {
              const normalizedName = p.name.trim().toLowerCase();
              v11Id = v11ByNormalizedName.get(normalizedName);
              matchType = v11Id ? 'name_normalized' : 'none';
            }
          }
        }
        return {
          v2_0_project_number: p.project_number,
          v2_0_id: p.id,
          v2_0_name: p.name,
          v2_0_name_normalized: (p.name || '').trim().toLowerCase(),
          v11_id: v11Id,
          match_type: matchType,
        };
      });
      
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
          v11ByNameCount: v11ByName.size,
          v11ByNormalizedNameCount: v11ByNormalizedName.size,
          samples: debugProjects,
          normalizedNameSamples: Array.from(v11ByNormalizedName.keys()).slice(0, 5),
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
