// app/api/procore/explore/route.ts - Endpoint to explore available Procore data
import { NextRequest, NextResponse } from 'next/server';
import { makeRequest, procoreConfig } from '@/lib/procore';

export async function POST(request: NextRequest) {
  try {
    const accessToken = request.cookies.get('procore_access_token')?.value;

    if (!accessToken) {
      return NextResponse.json(
        { error: 'No access token found. Please authenticate first.' },
        { status: 401 }
      );
    }

    // Fetch various endpoints to show what's available in parallel
    const data: Record<string, any> = {};

    const results = await Promise.allSettled([
      // 0: User info
      makeRequest('/rest/v1.0/me', accessToken),
      // 1: Companies
      makeRequest('/rest/v1.0/companies', accessToken),
      // 2: Projects (v2 -> v1)
      makeRequest(`/rest/v2.0/companies/${procoreConfig.companyId}/projects`, accessToken).catch(() => 
        makeRequest(`/rest/v1.0/companies/${procoreConfig.companyId}/projects`, accessToken)
      ),
      // 3: Project Templates (v2 -> v1)
      makeRequest(`/rest/v2.0/companies/${procoreConfig.companyId}/project_templates`, accessToken).catch(() => 
        makeRequest(`/rest/v1.0/companies/${procoreConfig.companyId}/project_templates`, accessToken)
      ),
      // 4: Vendors (v2 -> v1)
      makeRequest(`/rest/v2.0/companies/${procoreConfig.companyId}/vendors`, accessToken).catch(() => 
        makeRequest(`/rest/v1.0/companies/${procoreConfig.companyId}/vendors`, accessToken)
      ),
      // 5: Users (v2 -> v1)
      makeRequest(`/rest/v2.0/companies/${procoreConfig.companyId}/users`, accessToken).catch(() => 
        makeRequest(`/rest/v1.0/companies/${procoreConfig.companyId}/users`, accessToken)
      ),
      // 6: Bid board projects
      makeRequest(`/rest/v2.0/companies/${procoreConfig.companyId}/estimating/bid_board_projects`, accessToken)
    ]);

    const labels = ['user', 'companies', 'projects', 'projectTemplates', 'vendors', 'users', 'bidBoardProjects'];
    results.forEach((result, idx) => {
      const label = labels[idx];
      if (result.status === 'fulfilled') {
        data[label] = result.value;
      } else {
        data[label] = { error: String(result.reason) };
      }
    });

    return NextResponse.json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
