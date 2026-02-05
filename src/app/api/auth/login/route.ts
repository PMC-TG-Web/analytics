import { NextRequest, NextResponse } from 'next/server';

/**
 * Auth0 Login Endpoint
 * Redirects user to Auth0 Universal Login page
 */
export async function GET(request: NextRequest) {
  const returnTo = request.nextUrl.searchParams.get('returnTo') || '/dashboard';
  const auth0Domain = process.env.AUTH0_DOMAIN;
  const clientId = process.env.AUTH0_CLIENT_ID;
  const baseUrl = process.env.AUTH0_BASE_URL;

  if (!auth0Domain || !clientId || !baseUrl) {
    return NextResponse.json(
      { error: 'Auth0 environment variables not configured' },
      { status: 500 }
    );
  }

  // Build Auth0 login URL
  const loginUrl = new URL(`https://${auth0Domain}/authorize`);
  loginUrl.searchParams.set('client_id', clientId);
  loginUrl.searchParams.set('redirect_uri', `${baseUrl}/api/auth/callback`);
  loginUrl.searchParams.set('response_type', 'code');
  loginUrl.searchParams.set('scope', 'openid profile email');
  loginUrl.searchParams.set('state', encodeURIComponent(returnTo));

  return NextResponse.redirect(loginUrl.toString());
}
