import { NextRequest, NextResponse } from 'next/server';
import { createAuth0Client } from '@/lib/auth0';
import { APP_SESSION_COOKIE, procoreSignInEnabled } from '@/lib/appSignInPolicy';
import { appSessions } from '@/lib/appSession';
import { localLogoutCookies } from '@/lib/localLogoutCookies';
import { validateCsrfRequest } from '@/lib/csrfProtection';

function resolveCanonicalBaseUrl(request: NextRequest) {
  const explicit = (process.env.APP_BASE_URL || '').trim();
  const fallback = request.nextUrl.origin;
  const base = explicit || fallback;
  return base.replace(/\/$/, '');
}

function buildSanitizedLogoutRequest(request: NextRequest) {
  const baseUrl = resolveCanonicalBaseUrl(request);
  const url = new URL(request.url);
  url.search = '';
  url.searchParams.set('returnTo', `${baseUrl}/auth/logout-complete`);
  return new NextRequest(url, request);
}

export async function GET(request: NextRequest) {
  if (procoreSignInEnabled() && request.cookies.has(APP_SESSION_COOKIE)) {
    return NextResponse.json({ error: 'Use the Sign Out button to end your session.' }, { status: 405, headers: { Allow: 'POST' } });
  }
  const auth0 = createAuth0Client(resolveCanonicalBaseUrl(request));
  return auth0.middleware(buildSanitizedLogoutRequest(request));
}

export async function POST(request: NextRequest) {
  if (procoreSignInEnabled() && request.cookies.has(APP_SESSION_COOKIE)) {
    if (!validateCsrfRequest({ method: request.method, requestUrl: request.url,
      origin: request.headers.get('origin'), referer: request.headers.get('referer') }).allowed) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
    }
    await appSessions.revoke(request.cookies.get(APP_SESSION_COOKIE)?.value);
    const response = NextResponse.redirect(new URL('/auth/logout-complete', request.url), 303);
    for (const cookie of localLogoutCookies(request.cookies.getAll().map((cookie) => cookie.name), request.nextUrl.protocol === 'https:')) response.cookies.set(cookie);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  const auth0 = createAuth0Client(resolveCanonicalBaseUrl(request));
  return auth0.middleware(buildSanitizedLogoutRequest(request));
}
