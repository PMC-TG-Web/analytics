import { NextRequest, NextResponse } from 'next/server';

/**
 * Auth0 Login Endpoint
 * Redirects user to Auth0 Universal Login page
 */
export async function GET(request: NextRequest) {
  const returnTo = request.nextUrl.searchParams.get('returnTo') || '/dashboard';
  const auth0Domain = process.env.AUTH0_DOMAIN;
  const clientId = process.env.AUTH0_CLIENT_ID;
  
  // Use REQUEST URL for base to ensure it works on Vercel even if env is set to localhost
  const origin = request.nextUrl.origin;
  const baseUrl = origin.includes('localhost') ? (process.env.AUTH0_BASE_URL || origin) : origin;

  if (!auth0Domain || !clientId) {
    console.error('Auth0 Configuration Missing:', {
      auth0Domain: auth0Domain ? '✓ Present' : '✗ MISSING',
      clientId: clientId ? '✓ Present' : '✗ MISSING',
      nodeEnv: process.env.NODE_ENV,
    });
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent('Auth0 not configured. Contact admin.')}`, request.url)
    );
  }

  try {
    // Build Auth0 login URL
    const loginUrl = new URL(`https://${auth0Domain}/authorize`);
    loginUrl.searchParams.set('client_id', clientId);
    loginUrl.searchParams.set('redirect_uri', `${baseUrl}/api/auth/callback`);
    loginUrl.searchParams.set('response_type', 'code');
    loginUrl.searchParams.set('scope', 'openid profile email');
    loginUrl.searchParams.set('state', encodeURIComponent(returnTo));

    console.log('Redirecting to Auth0:', { domain: auth0Domain, redirectUri: `${baseUrl}/api/auth/callback` });
    return NextResponse.redirect(loginUrl.toString());
  } catch (error) {
    console.error('Auth0 login error:', error);
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent('Login error. Try again.')}`, request.url)
    );
  }
}
