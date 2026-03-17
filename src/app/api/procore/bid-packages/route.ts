import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { makeRequest, procoreConfig } from '@/lib/procore';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' ? (value as JsonObject) : null;
}

function readText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = readText(value);
    if (text) return text;
  }
  return null;
}

async function fetchBidPackagesPage(params: {
  accessToken: string;
  projectId: string;
  page: number;
  perPage: number;
}) {
  const { accessToken, projectId, page, perPage } = params;

  const endpoints = [
    `/rest/v1.0/projects/${encodeURIComponent(projectId)}/bid_packages?page=${page}&per_page=${perPage}`,
    `/rest/v1.0/bid_packages?project_id=${encodeURIComponent(projectId)}&page=${page}&per_page=${perPage}`,
  ];

  const failures: string[] = [];

  for (const endpoint of endpoints) {
    try {
      const data = await makeRequest(endpoint, accessToken);
      return { data, endpoint, failures };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${endpoint} => ${message}`);
    }
  }

  throw new Error(failures.join(' | '));
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = String(url.searchParams.get('projectId') || '').trim();
    const fetchAll = String(url.searchParams.get('fetchAll') || '').toLowerCase() !== 'false';
    const page = Math.max(1, Number.parseInt(String(url.searchParams.get('page') || '1'), 10) || 1);
    const perPage = Math.min(100, Math.max(1, Number.parseInt(String(url.searchParams.get('perPage') || '100'), 10) || 100));

    if (!projectId) {
      return NextResponse.json({ success: false, error: 'Missing projectId.' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const accessToken = cookieStore.get('procore_access_token')?.value;
    const companyId = String(cookieStore.get('procore_company_id')?.value || procoreConfig.companyId).trim();

    if (!accessToken) {
      return NextResponse.json({ success: false, error: 'Missing access token. Please login via OAuth.' }, { status: 401 });
    }

    const allRows: JsonObject[] = [];
    const usedEndpoints: string[] = [];
    let currentPage = page;

    while (true) {
      const { data, endpoint } = await fetchBidPackagesPage({
        accessToken,
        projectId,
        page: currentPage,
        perPage,
      });

      usedEndpoints.push(endpoint);

      const rows = Array.isArray(data)
        ? data.map(asObject).filter((v): v is JsonObject => Boolean(v))
        : [];

      if (rows.length === 0) break;
      allRows.push(...rows);
      if (!fetchAll || rows.length < perPage) break;
      currentPage += 1;
      if (currentPage - page > 50) break;
    }

    return NextResponse.json({
      success: true,
      companyId,
      projectId,
      count: allRows.length,
      pagesFetched: currentPage - page + 1,
      endpointTried: usedEndpoints[0] || null,
      bidPackages: allRows.map((row) => ({
        id: firstText(row.id, row.bid_package_id),
        name: firstText(row.name, row.title),
        status: firstText(row.status),
        createdAt: firstText(row.created_at),
        raw: row,
      })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    const isAccessIssue = lower.includes('error 403') || lower.includes('sufficient access');
    const help = isAccessIssue
      ? 'Your Procore user/token does not have Bidding access for this project. Ask for read access to Bidding/Bid Packages on the project, then reconnect Procore.'
      : 'Verify projectId is correct and belongs to the same company context as your Procore login.';
    return NextResponse.json(
      { success: false, error: `Failed to fetch bid packages: ${message}`, help },
      { status: 500 }
    );
  }
}
