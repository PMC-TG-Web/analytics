// Initiate Procore OAuth login
import { NextResponse } from "next/server";
import { getAuthorizationUrl, procoreConfig } from "@/lib/procore";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const redirectUri =
      procoreConfig.redirectUri || `${requestUrl.origin}/api/auth/procore/callback`;
    const { searchParams } = new URL(request.url);
    let rawReturnTo = String(searchParams.get("returnTo") || "").trim();
    
    // If no explicit returnTo, try to get it from referrer or default to /procore
    if (!rawReturnTo) {
      const referer = request.headers.get("referer") || "";
      try {
        const refererUrl = new URL(referer);
        const refererPath = refererUrl.pathname + refererUrl.search;
        // Only use referer if it's a Procore page
        if (refererPath.startsWith("/procore/")) {
          rawReturnTo = refererPath;
        }
      } catch {
        // Ignore invalid referer
      }
    }
    
    const returnTo = rawReturnTo.startsWith("/") ? rawReturnTo : "/procore";

    // Generate a strong random state for CSRF protection.
    const state = randomBytes(24).toString("hex");

    const cookieStore = await cookies();
    cookieStore.set("procore_oauth_return_to", returnTo, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
      maxAge: 10 * 60,
    });
    cookieStore.set("procore_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
      maxAge: 10 * 60,
    });
    cookieStore.set("procore_oauth_redirect_uri", redirectUri, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
      maxAge: 10 * 60,
    });
    
    // Get the OAuth authorization URL
    const authUrl = getAuthorizationUrl(state, redirectUri);
    
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
