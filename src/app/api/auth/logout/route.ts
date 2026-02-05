import { NextRequest, NextResponse } from 'next/server';

/**
 * Auth0 Logout Endpoint
 * Clears session and redirects to Auth0 logout
 */
export async function GET(request: NextRequest) {
  const auth0Domain = process.env.AUTH0_DOMAIN;
  const clientId = process.env.AUTH0_CLIENT_ID;
  const baseUrl = process.env.AUTH0_BASE_URL;

  // Clear session cookie
  const response = NextResponse.redirect(new URL('/', request.url));
  response.cookies.delete('auth_session');

  // Redirect to Auth0 logout if configured
  if (auth0Domain && clientId && baseUrl) {
    const logoutUrl = new URL(`https://${auth0Domain}/v2/logout`);
    logoutUrl.searchParams.set('client_id', clientId);
    logoutUrl.searchParams.set('returnTo', `${baseUrl}/`);
    return NextResponse.redirect(logoutUrl.toString());
  }

  return response;
}
