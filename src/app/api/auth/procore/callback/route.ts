// OAuth callback handler for Procore
import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/procore";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // Check for errors from Procore
  if (error) {
    console.error("Procore OAuth error:", error);
    return NextResponse.redirect(
      new URL(`/procore/test?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  // Verify we have an authorization code
  if (!code) {
    return NextResponse.redirect(
      new URL("/procore/test?error=missing_code", request.url)
    );
  }

  try {
    console.log("Exchanging authorization code for access token...");
    
    // Exchange the authorization code for an access token
    const tokenResponse = await getAccessToken(code);

    // Store the tokens in cookies (session storage)
    const cookieStore = await cookies();
    
    // Store access token (expires in 2 hours by default)
    cookieStore.set("procore_access_token", tokenResponse.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: tokenResponse.expires_in || 7200, // 2 hours default
    });

    // Store refresh token if provided (expires in 30 days typically)
    if (tokenResponse.refresh_token) {
      cookieStore.set("procore_refresh_token", tokenResponse.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60, // 30 days
      });
    }

    console.log("OK Successfully authenticated with Procore");

    // Redirect back to test page with success
    return NextResponse.redirect(
      new URL("/procore/test?status=authenticated", request.url)
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("OAuth callback error:", message);
    
    return NextResponse.redirect(
      new URL(
        `/procore/test?error=${encodeURIComponent(message)}`,
        request.url
      )
    );
  }
}
