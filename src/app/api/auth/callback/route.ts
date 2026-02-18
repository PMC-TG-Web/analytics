import { NextRequest, NextResponse } from 'next/server';

/**
 * Auth0 Callback Endpoint
 * Handles the redirect from Auth0 after successful authentication
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const error = request.nextUrl.searchParams.get('error');

  // Handle auth errors from Auth0
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/login?error=no_code', request.url)
    );
  }

  try {
    // Exchange code for token
    const auth0Domain = process.env.AUTH0_DOMAIN;
    const clientId = process.env.AUTH0_CLIENT_ID;
    const clientSecret = process.env.AUTH0_CLIENT_SECRET;
    
    // Use request origin if base URL is missing or set to localhost in prod
    const origin = request.nextUrl.origin;
    const baseUrl = origin.includes('localhost') ? (process.env.AUTH0_BASE_URL || origin) : origin;

    if (!auth0Domain || !clientId || !clientSecret) {
      throw new Error('Auth0 environment variables not configured');
    }

    const tokenResponse = await fetch(`https://${auth0Domain}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        audience: `https://${auth0Domain}/api/v2/`,
        grant_type: 'authorization_code',
        redirect_uri: `${baseUrl}/api/auth/callback`,
        code,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange code for token');
    }

    const { access_token, id_token } = await tokenResponse.json();

    // Get user info from ID token (simplified - decode JWT)
    const userInfoResponse = await fetch(`https://${auth0Domain}/userinfo`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!userInfoResponse.ok) {
      throw new Error('Failed to fetch user info');
    }

    const user = await userInfoResponse.json();

    // Create secure session cookie
    const response = NextResponse.redirect(
      new URL(decodeURIComponent(state || '/dashboard'), request.url)
    );

    // Set secure session cookie
    const isProd = process.env.NODE_ENV === 'production';
    
    // Set httpOnly cookie with user session
    response.cookies.set({
      name: 'auth_session',
      value: JSON.stringify({
        email: user.email,
        name: user.name,
        nickname: user.nickname,
        picture: user.picture,
        sub: user.sub,
      }),
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax', // Use lax on localhost, none for production if in iframe
      maxAge: 60 * 60 * 24 * 180, // 180 days
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Auth callback error:', error);
    return NextResponse.redirect(
      new URL('/login?error=callback_failed', request.url)
    );
  }
}
