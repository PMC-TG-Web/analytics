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

    // Fetch detailed info for first 20 projects to get customer data
    const detailPromises = projects.slice(0, 20).map((p: any) => 
      makeRequest(
        `/rest/v1.1/projects?company_id=${companyId}&view=extended&filters[id]=${p.id}`,
        accessToken
      ).then(result => Array.isArray(result) && result.length > 0 ? result[0] : null)
      .catch(() => null)
    );
    
    const detailedProjects = await Promise.all(detailPromises);
    
    // Create a map of project ID -> detailed data
    const detailsMap = new Map();
    detailedProjects.forEach(detail => {
      if (detail && detail.id) {
        detailsMap.set(detail.id, detail);
      }
    });

    const debug = request.nextUrl.searchParams.get('debug') === '1';

    // Map to return fields matching the projects list UI expectations
    const mappedProjects = projects.map((p: any) => {
      const detail = detailsMap.get(p.id) || p;
      return {
        id: p.id,
        name: p.name || 'Unknown Project',
        project_number: p.project_number || '',
        company_name:
          detail.customer_name ||
          detail.client_name ||
          detail.project_owner_name ||
          detail.project_owner?.name ||
          detail.owner?.name ||
          detail.customer?.name ||
          detail.client?.name ||
          'Unknown',
        project_status:
          (typeof detail.project_status === 'string' ? detail.project_status : detail.project_status?.name) ||
          (typeof detail.status === 'string' ? detail.status : detail.status?.name) ||
          detail.project_stage ||
          'Unknown',
        estimator: detail.estimator,
        project_manager: detail.project_manager,
      };
    });

    if (debug) {
      const sample = projects[0] || {};
      const detailedSample = detailsMap.get(sample.id) || sample;
      return NextResponse.json({
        success: true,
        debug: {
          keys: Object.keys(detailedSample),
          company_name: detailedSample.company_name,
          company: detailedSample.company,
          customer: detailedSample.customer,
          client: detailedSample.client,
          owner: detailedSample.owner,
          project_owner: detailedSample.project_owner,
          project_owner_name: detailedSample.project_owner_name,
          customer_name: detailedSample.customer_name,
          client_name: detailedSample.client_name,
          project_stage: detailedSample.project_stage,
          resolved_customer: mappedProjects[0]?.company_name,
          resolved_status: mappedProjects[0]?.project_status,
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
