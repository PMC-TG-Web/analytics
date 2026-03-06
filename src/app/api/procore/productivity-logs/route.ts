// API endpoint to fetch Procore productivity logs
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest } from "@/lib/procore";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      projectId = "598134326278124", 
      startDate = "2025-08-01",
      endDate = new Date().toISOString().split('T')[0], // Today's date in YYYY-MM-DD format
      page = 1, 
      perPage = 100 
    } = body;

    // Try to get token from cookies (OAuth flow) first, then request body
    const cookieStore = await cookies();
    const cookieToken = cookieStore.get("procore_access_token")?.value;
    const { accessToken: bodyToken } = body;
    const accessToken = cookieToken || bodyToken;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token. Please authenticate via OAuth first or provide accessToken in request body." },
        { status: 401 }
      );
    }

    if (!projectId) {
      return NextResponse.json(
        { error: "Missing projectId" },
        { status: 400 }
      );
    }

    console.log(`Fetching Procore productivity logs for project ${projectId} (${startDate} to ${endDate})`);

    // Fetch productivity logs using Procore API v1.0
    const endpoint = `/rest/v1.0/projects/${projectId}/productivity_logs?start_date=${startDate}&end_date=${endDate}&page=${page}&per_page=${perPage}`;
    const logs = await makeRequest(endpoint, accessToken);

    return NextResponse.json({
      success: true,
      projectId,
      startDate,
      endDate,
      count: Array.isArray(logs) ? logs.length : 0,
      logs,
      page,
      perPage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Procore productivity logs API error:", message);
    
    return NextResponse.json(
      { 
        error: "Failed to fetch Procore productivity logs", 
        details: message 
      },
      { status: 500 }
    );
  }
}
