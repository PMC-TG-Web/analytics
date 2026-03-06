import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, accessToken: bodyToken, companyId: bodyCompanyId } = body;

    // Remove strict projectId requirement if we want to allow fetching all
    // if (!projectId) {
    //   return NextResponse.json(
    //     { error: 'projectId parameter is required' },
    //     { status: 400 }
    //   );
    // }

    // Get token from cookie or body
    const cookieStore = await cookies();
    const token =
      cookieStore.get('procore_access_token')?.value || bodyToken;

    if (!token) {
      return NextResponse.json(
        { error: 'No access token provided' },
        { status: 401 }
      );
    }

    // Get company ID from body, cookie, or env
    const companyId = bodyCompanyId || cookieStore.get('procore_company_id')?.value || process.env.PROCORE_COMPANY_ID;
    
    if (!companyId) {
      return NextResponse.json(
        { error: 'No company ID provided. Pass it in the request body or set PROCORE_COMPANY_ID env variable' },
        { status: 401 }
      );
    }

    // Try multiple hosts for bid board endpoint
    const hosts = [
      'https://qa-estimating.procore.com',
      process.env.PROCORE_ESTIMATING_API_URL,
      'https://qa.procore.com',
      'https://api.procore.com',
    ].filter(Boolean);

    const allProjects: Array<Record<string, unknown>> = [];
    let successfulHost: string | null = null;
    const attempts: { host: string; status?: number; error?: string }[] = [];

    for (const host of hosts) {
      try {
        let page = 1;
        let foundPage = false;

        while (true) {
          const url = `${host}/rest/v2.0/companies/${companyId}/estimating/bid_board_projects?page=${page}&per_page=100`;

          const response = await fetch(url, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${token}`,
              'Procore-Company-Id': companyId,
            },
          });

          if (response.status === 404) {
            attempts.push({
              host,
              status: 404,
              error: 'Endpoint not found on this host',
            });
            break;
          }

          if (!response.ok) {
            attempts.push({
              host,
              status: response.status,
              error: `HTTP ${response.status}`,
            });
            break;
          }

          const text = await response.text();
          let data: any;
          try {
            data = JSON.parse(text);
          } catch (e) {
            attempts.push({
              host,
              status: response.status,
              error: `Invalid JSON response: ${text.substring(0, 100)}`,
            });
            break;
          }

          if (!Array.isArray(data)) {
            // Check if it's the specific format we sometimes see: { data: [...] } or { projects: [...] }
            if (data && typeof data === 'object' && Array.isArray((data as any).data)) {
              data = (data as any).data;
            } else if (data && typeof data === 'object' && Array.isArray((data as any).projects)) {
              data = (data as any).projects;
            } else if (data && typeof data === 'object' && Array.isArray((data as any).bid_board_projects)) {
              data = (data as any).bid_board_projects;
            } else {
              attempts.push({
                host,
                status: response.status,
                error: `Response is not an array. Keys: ${Object.keys(data || {}).join(', ')}`,
              });
              break;
            }
          }

          if (data.length === 0) {
            if (page === 1) {
              attempts.push({
                host,
                status: 200,
              });
            }
            break;
          }

          allProjects.push(...data);

          page++;
        }

        if (allProjects.length > 0) {
          successfulHost = host;
          attempts.push({
            host,
            status: 200,
          });
          break;
        }
      } catch (error) {
        attempts.push({
          host,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Find the matching project
    const matchingProject = allProjects.find(
      (p: Record<string, unknown>) =>
        p.id === parseInt(projectId) ||
        p.project_id === parseInt(projectId) ||
        p.id === projectId ||
        p.project_id === projectId
    );

    return NextResponse.json({
      found: !!matchingProject,
      project: matchingProject || null,
      totalProjectsFetched: allProjects.length,
      allProjectInfo: allProjects.map((p: any) => ({
        id: p.id,
        project_id: p.project_id,
        name: p.name || p.display_name,
        project_number: p.project_number,
        status: p.status,
        created_at: p.created_at,
        raw: p // Return raw data for debugging
      })),
      successfulHost,
      attempts,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        details: error instanceof Error ? error.stack : null,
      },
      { status: 500 }
    );
  }
}
