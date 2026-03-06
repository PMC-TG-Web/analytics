// API endpoint to test Procore connection
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig, makeRequest } from "@/lib/procore";

export async function GET(request: Request) {
  try {
    // Check configuration
    const config = {
      clientId: procoreConfig.clientId ? "✓ Configured" : "✗ Missing",
      clientSecret: procoreConfig.clientSecret ? "✓ Configured" : "✗ Missing",
      companyId: procoreConfig.companyId,
      apiUrl: procoreConfig.apiUrl,
      authUrl: procoreConfig.authUrl,
      tokenUrl: procoreConfig.tokenUrl,
      redirectUri: procoreConfig.redirectUri,
    };

    // Check if we have the minimum required config
    const isConfigured = 
      procoreConfig.clientId && 
      procoreConfig.clientSecret && 
      procoreConfig.companyId;

    return NextResponse.json({
      status: isConfigured ? "configured" : "incomplete",
      config,
      message: isConfigured 
        ? "Procore API is configured. You need an access token to make API calls."
        : "Missing required Procore configuration. Check your .env.local file.",
      instructions: {
        step1: "Get an access token by authenticating",
        step2: "Use POST /api/procore/test with { accessToken: 'your_token' }",
        step3: "Or visit /procore page to authenticate via OAuth",
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Configuration check failed", details: message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { accessToken: bodyToken, endpoint } = body;

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

    // Default to /rest/v1.0/me endpoint to verify token
    const testEndpoint = endpoint || "/rest/v1.0/me";

    console.log(`Testing Procore API call to ${testEndpoint}`);

    const result = await makeRequest(testEndpoint, accessToken);

    return NextResponse.json({
      success: true,
      endpoint: testEndpoint,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Procore test API error:", message);
    
    return NextResponse.json(
      { 
        error: "Procore API call failed", 
        details: message,
        suggestion: "Verify your access token is valid and not expired"
      },
      { status: 500 }
    );
  }
}
