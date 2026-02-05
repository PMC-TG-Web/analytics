import { NextRequest, NextResponse } from 'next/server';

/**
 * Auth0 Login Endpoint
 * Redirects user to Auth0 Universal Login page
 */
export async function GET(request: NextRequest) {
  try {
    const returnTo = request.nextUrl.searchParams.get('returnTo') || '/dashboard';
    const auth0Domain = process.env.AUTH0_DOMAIN;
    const clientId = process.env.AUTH0_CLIENT_ID;
    const baseUrl = process.env.AUTH0_BASE_URL;

    console.log('DEBUG LOGIN: Env vars check');
    console.log('AUTH0_DOMAIN:', auth0Domain ? '✓' : '✗ MISSING');
    console.log('AUTH0_CLIENT_ID:', clientId ? '✓' : '✗ MISSING');
    console.log('AUTH0_BASE_URL:', baseUrl ? '✓' : '✗ MISSING');

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

    console.log('Redirecting to:', loginUrl.toString());

    return NextResponse.redirect(loginUrl.toString());
  } catch (error) {
    console.error('Login route error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
