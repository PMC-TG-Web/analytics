import { NextRequest, NextResponse } from 'next/server';

/**
 * Auth0 Logout Endpoint
 * Clears session and redirects to Auth0 logout
 */
export async function GET(request: NextRequest) {
  const auth0Domain = process.env.AUTH0_DOMAIN;
  const clientId = process.env.AUTH0_CLIENT_ID;
  
  // Use REQUEST URL for base to ensure it works on Vercel
  const origin = request.nextUrl.origin;
  const baseUrl = origin.includes('localhost') ? (process.env.AUTH0_BASE_URL || origin) : origin;

  // Clear session cookies
  const response = NextResponse.redirect(new URL('/', request.url));
  
  // Delete both manual session and the backup procore session
  response.cookies.set({
    name: 'auth_session',
    value: '',
    expires: new Date(0),
    path: '/',
  });
  
  response.cookies.set({
    name: 'procore_session',
    value: '',
    expires: new Date(0),
    path: '/',
  });

  // Redirect to Auth0 logout if configured
  if (auth0Domain && clientId) {
    const logoutUrl = new URL(`https://${auth0Domain}/v2/logout`);
    logoutUrl.searchParams.set('client_id', clientId);
    logoutUrl.searchParams.set('returnTo', `${baseUrl}/`);
    return NextResponse.redirect(logoutUrl.toString());
  }

  return response;
}
