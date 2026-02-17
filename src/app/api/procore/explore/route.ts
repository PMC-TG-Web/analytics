// app/api/procore/explore/route.ts - Endpoint to explore available Procore data
import { NextRequest, NextResponse } from 'next/server';
import { makeRequest, procoreConfig } from '@/lib/procore';

export async function POST(request: NextRequest) {
  try {
    const accessToken = request.cookies.get('procore_access_token')?.value;

    if (!accessToken) {
      console.error('Procore Explore: No access token found in cookies');
      return NextResponse.json(
        { error: 'No access token found. Please authenticate first.' },
        { status: 401 }
      );
    }

    console.log('Procore Explore: Access token found, starting requests...');
    const data: Record<string, any> = {};

    // Get Company ID from our robust config
    const companyId = procoreConfig.companyId;
    console.log(`Procore Explore: Using Company ID ${companyId}`);

    const results = await Promise.allSettled([
      // 0: User info
      makeRequest('/rest/v1.0/me', accessToken),
      // 1: Companies
      makeRequest('/rest/v1.0/companies', accessToken),
      // 2: Projects (v1.1)
      makeRequest(`/rest/v1.1/projects?company_id=${companyId}&view=extended`, accessToken),
      // 3: Project Templates
      makeRequest(`/rest/v1.0/project_templates?company_id=${companyId}`, accessToken),
      // 4: Vendors
      makeRequest(`/rest/v1.0/vendors?company_id=${companyId}`, accessToken),
      // 5: Users
      makeRequest(`/rest/v1.0/users?company_id=${companyId}`, accessToken),
      // 6: Bid board projects (Standard)
      makeRequest('/rest/v1.0/bid_board_projects', accessToken),
      // 7: Estimating projects (Alternate)
      makeRequest('/rest/v1.0/estimating_projects', accessToken),
      // 8: Company Bids
      makeRequest(`/rest/v1.0/companies/${companyId}/bids`, accessToken),
      // 9: Company Bid Packages
      makeRequest(`/rest/v1.0/companies/${companyId}/bid_packages`, accessToken)
    ]);

    const labels = [
      'user', 
      'companies', 
      'projects', 
      'projectTemplates', 
      'vendors', 
      'users', 
      'bidBoardProjects', 
      'estimatingProjects',
      'companyBids',
      'companyBidPackages'
    ];
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
