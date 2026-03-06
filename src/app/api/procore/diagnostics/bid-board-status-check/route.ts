import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { makeRequest, procoreConfig } from "@/lib/procore";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accessToken: bodyToken } = body;

    const cookieStore = await cookies();
    const token = cookieStore.get('procore_access_token')?.value || bodyToken;
    const companyId = cookieStore.get('procore_company_id')?.value || procoreConfig.companyId;

    if (!token || !companyId) {
      return NextResponse.json({ error: 'Not authenticated or missing company ID' }, { status: 401 });
    }

    // 1. Fetch All V1 Projects (to get their Status)
    const allV1Projects: any[] = [];
    let page = 1;
    while (true) {
      const endpoint = `/rest/v1.0/projects?company_id=${companyId}&page=${page}&per_page=100`;
      const data = await makeRequest(endpoint, token);
      if (!Array.isArray(data) || data.length === 0) break;
      allV1Projects.push(...data);
      if (data.length < 100) break;
      page++;
      if (page > 20) break;
    }

    // Map V1 projects by ID for quick lookup
    const v1StatusMap = new Map();
    allV1Projects.forEach(p => {
      // Procore V1 projects have status or stage
      const status = p.status || p.project_status?.name || p.project_stage?.name || 'Unknown';
      v1StatusMap.set(String(p.id), status);
    });

    // 2. Fetch All V2 Bid Board Projects
    // We try the successful host first
    const host = 'https://api.procore.com';
    const allBidBoardProjects: any[] = [];
    page = 1;
    while (true) {
      const url = `${host}/rest/v2.0/companies/${companyId}/estimating/bid_board_projects?page=${page}&per_page=100`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Procore-Company-Id': String(companyId)
        }
      });
      if (!response.ok) break;
      const json = await response.json();
      const pageItems = Array.isArray(json) ? json : (json?.data || []);
      if (pageItems.length === 0) break;
      allBidBoardProjects.push(...pageItems);
      if (pageItems.length < 100) break;
      page++;
      if (page > 20) break;
    }

    // 3. Compare and Match
    const results = allBidBoardProjects.map(bb => {
      const procoreProjectId = String(bb.project_id || '');
      const v1Status = v1StatusMap.get(procoreProjectId);
      
      return {
        bidBoardId: bb.id,
        bidBoardName: bb.name,
        procoreProjectId: procoreProjectId || 'None',
        bidBoardStatus: bb.status, // The status from Estimating API
        v1ProjectStatus: v1Status || 'No matching Project found'
      };
    });

    const matchedCount = results.filter(r => r.v1ProjectStatus !== 'No matching Project found').length;

    return NextResponse.json({
      summary: {
        totalBidBoardProjects: allBidBoardProjects.length,
        totalV1Projects: allV1Projects.length,
        bidBoardProjectsMatchedToV1: matchedCount,
        percentMatched: ((matchedCount / allBidBoardProjects.length) * 100).toFixed(1) + '%'
      },
      results
    });
  } catch (error) {
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
