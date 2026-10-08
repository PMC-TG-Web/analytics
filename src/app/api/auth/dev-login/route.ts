import { isLocalDeveloperRequest } from '@/lib/developerIdentity';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const isDev = isLocalDeveloperRequest(request);

  if (!isDev) {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const email = (searchParams.get('email') || '').trim().toLowerCase();
  const returnTo = (searchParams.get('returnTo') || '/').trim();

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }

  const safeReturnTo = returnTo.startsWith('/') && !returnTo.startsWith('//') && !returnTo.includes('\\') ? returnTo : '/';
  const redirectUrl = new URL(safeReturnTo, request.url);
  const response = NextResponse.redirect(redirectUrl);

  response.cookies.set('dev_user_email', email, {
    httpOnly: false,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 60 * 60 * 12,
  });

  // Refresh permissions for the newly selected identity.
  response.cookies.set('analytics_permissions', '', { path: '/', maxAge: 0 });
  return response;
}
