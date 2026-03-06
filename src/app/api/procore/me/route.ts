// Get current user info from Procore (requires authentication)
import { NextResponse } from "next/server";
import { makeRequest } from "@/lib/procore";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("procore_access_token")?.value;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Not authenticated with Procore" },
        { status: 401 }
      );
    }

    // Fetch current user info
    const user = await makeRequest("/rest/v1.0/me", accessToken);

    return NextResponse.json({
      success: true,
      user,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Procore /me error:", message);
    
    return NextResponse.json(
      { error: "Failed to fetch user info", details: message },
      { status: 500 }
    );
  }
}
