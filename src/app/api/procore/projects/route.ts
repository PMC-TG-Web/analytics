// API endpoint to fetch Procore projects
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig } from "@/lib/procore";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = searchParams.get("page") || 1;
    const perPage = searchParams.get("perPage") || 100;
    const fetchAll = searchParams.get("fetchAll") !== "false";
    const companyIdFromUrl = searchParams.get("companyId");

    const cookieStore = await cookies();
    const accessToken = cookieStore.get("procore_access_token")?.value;

    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const companyId = String(companyIdFromUrl || procoreConfig.companyId || "").trim();
    const allProjects: any[] = [];
    const safePerPage = 100;
    let currentPage = 1;

    while (true) {
      const endpoint = `/rest/v1.0/projects?company_id=${encodeURIComponent(companyId)}&page=${currentPage}&per_page=${safePerPage}`;
      const projects = await makeRequest(endpoint, accessToken);
      const pageItems = Array.isArray(projects) ? projects : [];
      if (pageItems.length === 0) break;
      allProjects.push(...pageItems);
      if (!fetchAll || pageItems.length < safePerPage || currentPage > 10) break;
      currentPage += 1;
    }

    return NextResponse.json(allProjects);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      accessToken: bodyToken,
      page = 1,
      perPage = 100,
      fetchAll = true,
      companyId: companyIdFromBody,
    } = body;

    // Try to get token from cookies (OAuth flow) first, then request body
    const cookieStore = await cookies();
    const cookieToken = cookieStore.get("procore_access_token")?.value;
    const accessToken = cookieToken || bodyToken;

    if (!accessToken) {
      return NextResponse.json(
        {
          error:
            "Missing access token. Please authenticate via OAuth first or provide accessToken in request body.",
        },
        { status: 401 }
      );
    }

    const companyId = String(companyIdFromBody || procoreConfig.companyId || "").trim();
    if (!companyId) {
      return NextResponse.json(
        { error: "Missing companyId. Set PROCORE_COMPANY_ID or provide companyId in request body." },
        { status: 400 }
      );
    }

    const safePerPage = Math.min(Math.max(Number(perPage) || 100, 1), 100);
    let currentPage = Math.max(Number(page) || 1, 1);
    const allProjects: any[] = [];

    console.log(
      `Fetching Procore projects (company ${companyId}, fetchAll: ${fetchAll})`
    );

    while (true) {
      // Fetch projects using Procore API v1.0
      const endpoint = `/rest/v1.0/projects?company_id=${encodeURIComponent(
        companyId
      )}&page=${currentPage}&per_page=${safePerPage}`;

      const projects = await makeRequest(endpoint, accessToken);

      const pageItems = Array.isArray(projects) ? projects : [];

      if (pageItems.length === 0) {
        break;
      }

      allProjects.push(...pageItems);

      // Stop if we're not fetching all, or if we got fewer than requested (end of data)
      if (!fetchAll || pageItems.length < safePerPage) {
        break;
      }

      currentPage += 1;

      // Safety cap (1000 projects)
      if (currentPage > 10) break;
    }

    return NextResponse.json({
      success: true,
      count: allProjects.length,
      projects: allProjects,
      companyId,
      fetchAll,
      totalFetched: allProjects.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Procore projects API error:", message);
    
    return NextResponse.json(
      { 
        error: "Failed to fetch Procore projects", 
        details: message 
      },
      { status: 500 }
    );
  }
}
