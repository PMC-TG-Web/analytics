// Initiate Procore OAuth login
import { NextResponse } from "next/server";
import { getAuthorizationUrl } from "@/lib/procore";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawReturnTo = String(searchParams.get("returnTo") || "").trim();
    const returnTo = rawReturnTo.startsWith("/") ? rawReturnTo : "/procore";

    // Generate a random state for CSRF protection
    const state = Math.random().toString(36).substring(7);

    const cookieStore = await cookies();
    cookieStore.set("procore_oauth_return_to", returnTo, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
      maxAge: 10 * 60,
    });
    
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
