// src/app/api/procore/export/projects/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { makeRequest, procoreConfig, refreshAccessToken } from '@/lib/procore';

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
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const companyId = procoreConfig.companyId;
    const format = request.nextUrl.searchParams.get('format') || 'csv'; // csv or json
    
    // Fetch v1.0 company projects
    let allProjects: any[] = [];
    try {
      let page = 1;
      while (true) {
        const endpoint = `/rest/v1.0/companies/${companyId}/projects?per_page=100&page=${page}`;
        const result = await makeRequest(endpoint, accessToken);
        const pageResults = Array.isArray(result) ? result : (result?.data || []);
        
        if (pageResults.length === 0) break;
        allProjects = allProjects.concat(pageResults);
        page++;
      }
    } catch (e) {
      // Fallback to v1.1
      let page = 1;
      while (true) {
        const endpoint = `/rest/v1.1/projects?company_id=${companyId}&view=extended&per_page=100&page=${page}`;
        const result = await makeRequest(endpoint, accessToken);
        const pageResults = Array.isArray(result) ? result : (result?.data || []);
        
        if (pageResults.length === 0) break;
        allProjects = allProjects.concat(pageResults);
        page++;
      }
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

    if (format === 'json') {
      return NextResponse.json(simplifiedProjects);
    }

    const csv = convertToCSV(simplifiedProjects);
    
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="procore-projects-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    console.error('Export projects error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Export failed' 
    }, { status: 500 });
  }
}
