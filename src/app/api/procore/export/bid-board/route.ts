// src/app/api/procore/export/bid-board/route.ts
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

  const keys = Array.from(new Set(data.flatMap(obj => Object.keys(obj))));
  const header = keys.map(k => `"${k.replace(/"/g, '""')}"`).join(',');
  
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

    // Fetch v2.0 bid board projects with pagination
    let bidBoardProjects: any[] = [];
    try {
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        if (page > maxPages) break;
        if (Date.now() - startTime > timeBudgetMs) break;

        const endpoint = `/rest/v2.0/companies/${effectiveCompanyId}/estimating/bid_board_projects?per_page=100&page=${page}`;
        const result = await makeRequestWithRefresh(endpoint, {
          headers: { 'Procore-Company-Id': effectiveCompanyId }
        });
        
        let pageResults: any[] = [];
        if (Array.isArray(result)) {
          pageResults = result;
        } else if (result?.data && Array.isArray(result.data)) {
          pageResults = result.data;
        } else if (result?.projects && Array.isArray(result.projects)) {
          pageResults = result.projects;
        }
        
        if (pageResults.length === 0) {
          hasMore = false;
        } else {
          bidBoardProjects = bidBoardProjects.concat(pageResults);
          page++;
          if (pageDelayMs > 0) await sleep(pageDelayMs);
        }
      }
    } catch (e) {
      console.error('Bid board fetch error:', e);
      if (isRateLimitError(e)) return rateLimitResponse();
      // Return what we have or empty array if nothing
    }

    if (Date.now() - startTime > timeBudgetMs || bidBoardProjects.length >= maxPages * 100) {
      truncated = true;
    }

    // Simplify bid board data for export
    const simplifiedBidBoard = bidBoardProjects.map((p: any) => ({
      id: p.id,
      name: p.name,
      project_number: p.project_number,
      status: p.status,
      customer_name: p.customer_name,
      client_name: p.client_name,
      estimator: p.estimator ? (typeof p.estimator === 'object' ? p.estimator.name : p.estimator) : '',
      project_manager: p.project_manager ? (typeof p.project_manager === 'object' ? p.project_manager.name : p.project_manager) : '',
      bid_amount: p.bid_amount,
      actual_amount: p.actual_amount,
      description: p.description,
      created_at: p.created_at,
      updated_at: p.updated_at,
    }));

    const headers: Record<string, string> = {
      'X-Export-Count': String(simplifiedBidBoard.length),
      'X-Export-Truncated': truncated ? '1' : '0',
    };

    if (format === 'json') {
      const jsonResponse = NextResponse.json(simplifiedBidBoard, { headers });
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

    const csv = convertToCSV(simplifiedBidBoard);
    
    const csvResponse = new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="procore-bid-board-${new Date().toISOString().slice(0, 10)}.csv"`,
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
    console.error('Export bid board error:', error);
    if (isRateLimitError(error)) return rateLimitResponse();
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Export failed' 
    }, { status: 500 });
  }
}
