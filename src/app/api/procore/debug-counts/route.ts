// Debug endpoint to check project counts
import { NextRequest, NextResponse } from 'next/server';
import { makeRequest, procoreConfig } from '@/lib/procore';

export async function GET(request: NextRequest) {
  try {
    const accessToken = request.cookies.get('procore_access_token')?.value;

    if (!accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const companyId = procoreConfig.companyId;
    console.log('🔍 [Debug] Starting project count check...');

    // Test 1: Active projects
    let activeCount = 0;
    let page = 1;
    while (true) {
      const result = await makeRequest(
        `/rest/v1.1/projects?company_id=${companyId}&view=extended&per_page=100&page=${page}`,
        accessToken
      );
      const pageResults = Array.isArray(result) ? result : (result?.data || []);
      if (pageResults.length === 0) break;
      activeCount += pageResults.length;
      console.log(`  Page ${page}: ${pageResults.length} projects`);
      page++;
    }

    // Test 2: Inactive projects
    let inactiveCount = 0;
    page = 1;
    while (true) {
      const result = await makeRequest(
        `/rest/v1.1/projects?company_id=${companyId}&view=extended&filters[active]=false&per_page=100&page=${page}`,
        accessToken
      );
      const pageResults = Array.isArray(result) ? result : (result?.data || []);
      if (pageResults.length === 0) break;
      inactiveCount += pageResults.length;
      console.log(`  Inactive Page ${page}: ${pageResults.length} projects`);
      page++;
    }

    const summary = {
      active: activeCount,
      inactive: inactiveCount,
      total: activeCount + inactiveCount,
    };

    console.log('📊 [Debug] Counts:', summary);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[Debug] Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
