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
    console.log(`[Procore Projects] Fetching from v1.1 API for company ${companyId}`);

    // Fetch projects from v1.1 API (same as dashboard uses)
    const endpoint = `/rest/v1.1/projects?company_id=${companyId}&view=extended&per_page=100&filters[active]=any`;
    let projects = await makeRequest(endpoint, accessToken);

    if (!Array.isArray(projects)) {
      console.error('[Procore Projects] Expected array but got:', projects);
      return NextResponse.json({ error: 'Invalid response from Procore API' }, { status: 500 });
    }

    // Map to return fields matching the projects list UI expectations
    const mappedProjects = projects.map((p: any) => ({
      id: p.id,
      name: p.name || 'Unknown Project',
      project_number: p.project_number || '',
      company_name: p.company_name || 'Unknown',
      project_status: p.project_status || 'Unknown',
      estimator: p.estimator,
      project_manager: p.project_manager,
    }));

    return NextResponse.json({ success: true, projects: mappedProjects });
  } catch (error) {
    console.error('[Procore Projects] Error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
