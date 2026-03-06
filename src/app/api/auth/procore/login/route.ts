// Initiate Procore OAuth login
import { NextResponse } from "next/server";
import { getAuthorizationUrl } from "@/lib/procore";

export async function GET(request: Request) {
  try {
    // Generate a random state for CSRF protection
    const state = Math.random().toString(36).substring(7);
    
    // Get the OAuth authorization URL
    const authUrl = getAuthorizationUrl(state);
    
    console.log("Redirecting to Procore OAuth:", authUrl);
    
    // Redirect user to Procore login
    return NextResponse.redirect(authUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("OAuth login error:", message);
    
    return NextResponse.json(
      { error: "Failed to initiate OAuth login", details: message },
      { status: 500 }
    );
  }
}
