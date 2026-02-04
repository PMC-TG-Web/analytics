// app/api/procore/explore/route.ts - Endpoint to explore available Procore data
import { NextRequest, NextResponse } from 'next/server';
import { makeRequest, procoreConfig } from '@/lib/procore';

export async function POST(request: NextRequest) {
  try {
    const accessToken = request.cookies.get('procore_access_token')?.value;

    if (!accessToken) {
      return NextResponse.json(
        { error: 'No access token found. Please authenticate first.' },
        { status: 401 }
      );
    }

    // Fetch various endpoints to show what's available
    const data: Record<string, any> = {};

    try {
      // Get current user info
      data.user = await makeRequest('/rest/v1.0/me', accessToken);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      console.error('User info error:', err);
      data.user = { error: `Failed to fetch user info: ${err}` };
    }

    try {
      // Get companies
      data.companies = await makeRequest('/rest/v1.0/companies', accessToken);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      console.error('Companies error:', err);
      data.companies = { error: `Failed to fetch companies: ${err}` };
    }

    try {
      // Get projects using v2.0 endpoint
      data.projects = await makeRequest(
        `/rest/v2.0/companies/${procoreConfig.companyId}/projects`,
        accessToken
      );
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      console.error('Projects error (v2.0):', err);
      // Fallback to v1.0
      try {
        data.projects = await makeRequest(
          `/rest/v1.0/companies/${procoreConfig.companyId}/projects`,
          accessToken
        );
      } catch (e2) {
        const err2 = e2 instanceof Error ? e2.message : String(e2);
        console.error('Projects error (v1.0):', err2);
        data.projects = { error: `Failed to fetch projects: ${err2}` };
      }
    }

    try {
      // Get project templates using v2.0 endpoint
      data.projectTemplates = await makeRequest(
        `/rest/v2.0/companies/${procoreConfig.companyId}/project_templates`,
        accessToken
      );
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      console.error('Project templates error (v2.0):', err);
      // Fallback to v1.0
      try {
        data.projectTemplates = await makeRequest(
          `/rest/v1.0/companies/${procoreConfig.companyId}/project_templates`,
          accessToken
        );
      } catch (e2) {
        const err2 = e2 instanceof Error ? e2.message : String(e2);
        console.error('Project templates error (v1.0):', err2);
        data.projectTemplates = { error: `Failed to fetch project templates: ${err2}` };
      }
    }

    try {
      // Get vendors using v2.0 endpoint
      data.vendors = await makeRequest(
        `/rest/v2.0/companies/${procoreConfig.companyId}/vendors`,
        accessToken
      );
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      console.error('Vendors error (v2.0):', err);
      // Fallback to v1.0
      try {
        data.vendors = await makeRequest(
          `/rest/v1.0/companies/${procoreConfig.companyId}/vendors`,
          accessToken
        );
      } catch (e2) {
        const err2 = e2 instanceof Error ? e2.message : String(e2);
        console.error('Vendors error (v1.0):', err2);
        data.vendors = { error: `Failed to fetch vendors: ${err2}` };
      }
    }

    try {
      // Get users using v2.0 endpoint
      data.users = await makeRequest(
        `/rest/v2.0/companies/${procoreConfig.companyId}/users`,
        accessToken
      );
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      console.error('Users error (v2.0):', err);
      // Fallback to v1.0
      try {
        data.users = await makeRequest(
          `/rest/v1.0/companies/${procoreConfig.companyId}/users`,
          accessToken
        );
      } catch (e2) {
        const err2 = e2 instanceof Error ? e2.message : String(e2);
        console.error('Users error (v1.0):', err2);
        data.users = { error: `Failed to fetch users: ${err2}` };
      }
    }

    try {
      // Get bid board projects (estimating module)
      data.bidBoardProjects = await makeRequest(
        `/rest/v2.0/companies/${procoreConfig.companyId}/estimating/bid_board_projects`,
        accessToken
      );
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      console.error('Bid board projects error:', err);
      data.bidBoardProjects = { error: `Failed to fetch bid board projects: ${err}` };
    }

    return NextResponse.json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
