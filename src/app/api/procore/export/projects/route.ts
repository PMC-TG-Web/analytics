// src/app/api/procore/export/projects/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { makeRequest, procoreConfig, refreshAccessToken } from '@/lib/procore';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRateLimitError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('429') || message.toLowerCase().includes('rate limit');
};

const rateLimitResponse = () =>
  NextResponse.json(
    {
      error: 'Rate limited by Procore. Please wait and try again.',
      retryAfterSeconds: 60,
    },
    { status: 429, headers: { 'Retry-After': '60' } }
  );

function convertToCSV(data: any[]): string {
  if (data.length === 0) return '';

  // Get all unique keys
  const keys = Array.from(new Set(data.flatMap(obj => Object.keys(obj))));
  
  // Create header
  const header = keys.map(k => `"${k.replace(/"/g, '""')}"`).join(',');
  
  // Create rows
  const rows = data.map(obj => 
    keys.map(key => {
      const value = obj[key];
      if (value === null || value === undefined) return '';
      if (typeof value === 'object') return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
      return `"${String(value).replace(/"/g, '""')}"`;
    }).join(',')
  );
  
  return [header, ...rows].join('\n');
}

export async function GET(request: NextRequest) {
  try {
    const accessToken = request.cookies.get('procore_access_token')?.value;
    const refreshToken = request.cookies.get('procore_refresh_token')?.value;
    let refreshedAccessToken: string | null = null;
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const requestedCompanyId = searchParams.get('companyId')?.trim();
    const companyId = procoreConfig.companyId;
    const effectiveCompanyId = requestedCompanyId || companyId;
    const format = searchParams.get('format') || 'csv'; // csv or json
    const maxPages = Math.max(1, Number(searchParams.get('maxPages')) || 10);
    const pageDelayMs = Math.max(0, Number(searchParams.get('pageDelayMs')) || 250);
    const timeBudgetMs = Math.max(5000, Number(searchParams.get('timeBudgetMs')) || 30000);
    const startTime = Date.now();
    
    const makeRequestWithRefresh = async (endpoint: string, options?: RequestInit) => {
      try {
        return await makeRequest(endpoint, accessToken, options);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('401') && refreshToken) {
          const newToken = await refreshAccessToken(refreshToken);
          refreshedAccessToken = newToken.access_token;
          return await makeRequest(endpoint, newToken.access_token, options);
        }
        throw error;
      }
    };

    let truncated = false;

    // Fetch v1.0 company projects
    let allProjects: any[] = [];
    try {
      let page = 1;
      while (true) {
        if (page > maxPages) break;
        if (Date.now() - startTime > timeBudgetMs) break;

        const endpoint = `/rest/v1.0/companies/${effectiveCompanyId}/projects?per_page=100&page=${page}`;
        const result = await makeRequestWithRefresh(endpoint, {
          headers: { 'Procore-Company-Id': effectiveCompanyId }
        });
        const pageResults = Array.isArray(result) ? result : (result?.data || []);
        
        if (pageResults.length === 0) break;
        allProjects = allProjects.concat(pageResults);
        page++;
        if (pageDelayMs > 0) await sleep(pageDelayMs);
      }
    } catch (e) {
      if (isRateLimitError(e)) return rateLimitResponse();
      // Fallback to v1.1
      let page = 1;
      while (true) {
        if (page > maxPages) break;
        if (Date.now() - startTime > timeBudgetMs) break;

        const endpoint = `/rest/v1.1/projects?company_id=${effectiveCompanyId}&view=extended&per_page=100&page=${page}`;
        const result = await makeRequestWithRefresh(endpoint, {
          headers: { 'Procore-Company-Id': effectiveCompanyId }
        });
        const pageResults = Array.isArray(result) ? result : (result?.data || []);
        
        if (pageResults.length === 0) break;
        allProjects = allProjects.concat(pageResults);
        page++;
        if (pageDelayMs > 0) await sleep(pageDelayMs);
      }
    }

    if (Date.now() - startTime > timeBudgetMs || allProjects.length >= maxPages * 100) {
      truncated = true;
    }

    // Simplify project data for export
    const simplifiedProjects = allProjects.map((p: any) => ({
      id: p.id,
      name: p.name,
      project_number: p.project_number,
      project_status: p.project_status || (p.active ? 'Active' : 'Inactive'),
      company_name: p.company_name,
      address: p.address,
      city: p.city,
      state: p.state,
      zip: p.zip,
      country: p.country,
      active: p.active,
      created_at: p.created_at,
      updated_at: p.updated_at,
    }));

    const headers: Record<string, string> = {
      'X-Export-Count': String(simplifiedProjects.length),
      'X-Export-Truncated': truncated ? '1' : '0',
    };

    if (format === 'json') {
      const jsonResponse = NextResponse.json(simplifiedProjects, { headers });
      if (refreshedAccessToken) {
        jsonResponse.cookies.set('procore_access_token', refreshedAccessToken, {
          httpOnly: true,
          secure: request.url.startsWith('https://') || process.env.NODE_ENV === 'production',
          sameSite: request.url.startsWith('https://') || process.env.NODE_ENV === 'production' ? 'none' : 'lax',
          path: '/',
          maxAge: 3600,
        });
      }
      return jsonResponse;
    }

    const csv = convertToCSV(simplifiedProjects);
    
    const csvResponse = new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="procore-projects-${new Date().toISOString().slice(0, 10)}.csv"`,
        ...headers,
      },
    });
    if (refreshedAccessToken) {
      csvResponse.cookies.set('procore_access_token', refreshedAccessToken, {
        httpOnly: true,
        secure: request.url.startsWith('https://') || process.env.NODE_ENV === 'production',
        sameSite: request.url.startsWith('https://') || process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        path: '/',
        maxAge: 3600,
      });
    }
    return csvResponse;
  } catch (error) {
    console.error('Export projects error:', error);
    if (isRateLimitError(error)) return rateLimitResponse();
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Export failed' 
    }, { status: 500 });
  }
}
