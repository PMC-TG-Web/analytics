// API endpoint to fetch Procore vendors
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig } from "@/lib/procore";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { accessToken: bodyToken, page = 1, perPage = 100 } = body;

    // Try to get token from cookies (OAuth flow) first, then request body
    const cookieStore = await cookies();
    const cookieToken = cookieStore.get("procore_access_token")?.value;
    const accessToken = cookieToken || bodyToken;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token. Please authenticate via OAuth first or provide accessToken in request body." },
        { status: 401 }
      );
    }

    const companyId = procoreConfig.companyId;
    console.log(`Fetching Procore vendors for company ${companyId}`);

    // Try multiple endpoints if one fails - some companies use /vendors without the /companies prefix
    let vendors;
    try {
      const endpoint = `/rest/v1.0/vendors?company_id=${companyId}&page=${page}&per_page=${perPage}`;
      vendors = await makeRequest(endpoint, accessToken);
    } catch (e) {
      console.log("Failed first vendor attempt, trying company-prefixed endpoint...");
      const endpoint = `/rest/v1.0/companies/${companyId}/vendors?page=${page}&per_page=${perPage}`;
      vendors = await makeRequest(endpoint, accessToken);
    }

    return NextResponse.json({
      success: true,
      count: Array.isArray(vendors) ? vendors.length : 0,
      vendors,
      page,
      perPage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Procore vendors API error:", message);
    
    return NextResponse.json(
      { 
        error: "Failed to fetch Procore vendors", 
        details: message 
      },
      { status: 500 }
    );
  }
}
