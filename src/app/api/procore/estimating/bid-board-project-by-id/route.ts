import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function unwrapProjectList(payload: unknown): UnknownRecord[] | null {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }

  if (!isRecord(payload)) {
    return null;
  }

  const candidates = [
    payload.data,
    payload.projects,
    payload.bid_board_projects,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }
  }

  return null;
}

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

    const requestedCompanyId = String(bodyCompanyId || cookieStore.get('procore_company_id')?.value || '').trim();
    if (requestedCompanyId && requestedCompanyId !== '598134325805519') {
      return NextResponse.json(
        { error: 'Forbidden company context for this deployment.' },
        { status: 403 }
      );
    }

    const companyId = requestedCompanyId || '598134325805519';
    
    if (!companyId) {
      return NextResponse.json(
        { error: 'No company ID provided.' },
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
          let data: unknown;
          try {
            data = JSON.parse(text);
          } catch {
            attempts.push({
              host,
              status: response.status,
              error: `Invalid JSON response: ${text.substring(0, 100)}`,
            });
            break;
          }

          const pageItems = unwrapProjectList(data);
          if (!pageItems) {
            attempts.push({
              host,
              status: response.status,
              error: `Response is not an array. Keys: ${isRecord(data) ? Object.keys(data).join(', ') : 'none'}`,
            });
            break;
          }

          if (pageItems.length === 0) {
            if (page === 1) {
              attempts.push({
                host,
                status: 200,
              });
            }
            break;
          }

          allProjects.push(...pageItems);

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

    const projectIdNumber = Number.parseInt(String(projectId), 10);
    // Find the matching project
    const matchingProject = allProjects.find(
      (p) =>
        p.id === projectId ||
        p.project_id === projectId ||
        (!Number.isNaN(projectIdNumber) &&
          (p.id === projectIdNumber || p.project_id === projectIdNumber))
    );

    return NextResponse.json({
      found: !!matchingProject,
      project: matchingProject || null,
      totalProjectsFetched: allProjects.length,
      allProjectInfo: allProjects.map((p) => ({
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
