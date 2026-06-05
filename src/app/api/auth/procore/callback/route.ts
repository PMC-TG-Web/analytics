// OAuth callback handler for Procore
import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/procore";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestUrl = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const cookieStore = await cookies();
  const returnToCookie = cookieStore.get("procore_oauth_return_to")?.value;
  const expectedState = cookieStore.get("procore_oauth_state")?.value;
  const redirectUriCookie = cookieStore.get("procore_oauth_redirect_uri")?.value;
  const redirectUri =
    redirectUriCookie && redirectUriCookie.startsWith("http")
      ? redirectUriCookie
      : `${requestUrl.origin}/api/auth/procore/callback`;
  const returnToPath = returnToCookie && returnToCookie.startsWith("/") ? returnToCookie : "/procore";

  // Check for errors from Procore
  if (error) {
    console.error("Procore OAuth error:", error);
    cookieStore.delete("procore_oauth_state");
    return NextResponse.redirect(
      new URL(`${returnToPath}?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!state || !expectedState || state !== expectedState) {
    cookieStore.delete("procore_oauth_state");
    return NextResponse.redirect(
      new URL(`${returnToPath}?error=invalid_state`, request.url)
    );
  }

  // Verify we have an authorization code
  if (!code) {
    cookieStore.delete("procore_oauth_state");
    return NextResponse.redirect(
      new URL(`${returnToPath}?error=missing_code`, request.url)
    );
  }

  try {
    console.log("Exchanging authorization code for access token...");
    
    // Exchange the authorization code for an access token
    const tokenResponse = await getAccessToken(code, redirectUri);

    // Store the tokens in cookies (session storage)
    // Store access token (expires in 2 hours by default)
    cookieStore.set("procore_access_token", tokenResponse.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
      maxAge: tokenResponse.expires_in || 7200, // 2 hours default
    });

    // Store refresh token if provided (expires in 30 days typically)
    if (tokenResponse.refresh_token) {
      cookieStore.set("procore_refresh_token", tokenResponse.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        path: "/",
        maxAge: 30 * 24 * 60 * 60, // 30 days
      });
    }

    cookieStore.set("procore_company_id", "598134325805519", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
      maxAge: tokenResponse.expires_in || 7200,
    });

    const grantedScope = String(tokenResponse.scope || "").trim();
    if (grantedScope) {
      cookieStore.set("procore_scope", grantedScope, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        path: "/",
        maxAge: tokenResponse.expires_in || 7200,
      });
    } else {
      cookieStore.delete("procore_scope");
    }

    console.log("OK Successfully authenticated with Procore");

    cookieStore.delete("procore_oauth_return_to");
    cookieStore.delete("procore_oauth_redirect_uri");
    cookieStore.delete("procore_oauth_state");

    const redirectUrl = new URL(returnToPath, request.url);
    redirectUrl.searchParams.set("status", "authenticated");

    // Redirect back to the originating Procore page with success.
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("OAuth callback error:", message);
    cookieStore.delete("procore_oauth_state");
    
    return NextResponse.redirect(
      new URL(`${returnToPath}?error=${encodeURIComponent(message)}`, request.url)
    );
  }
}
