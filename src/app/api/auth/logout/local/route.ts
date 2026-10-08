import { NextRequest, NextResponse } from 'next/server';
import { localLogoutCookies } from '@/lib/localLogoutCookies';
import { getDeveloperEmail } from '@/lib/developerIdentity';
import { appSessions } from '@/lib/appSession';
import { APP_SESSION_COOKIE, procoreSignInEnabled } from '@/lib/appSignInPolicy';
import { validateCsrfRequest } from '@/lib/csrfProtection';

function buildLogoutCookieResponse(request: NextRequest) {
  const response = NextResponse.json({ success: true, developerSession: Boolean(getDeveloperEmail(request)),
    procoreSession: procoreSignInEnabled() && request.cookies.has(APP_SESSION_COOKIE) });
  const secure = process.env.NODE_ENV === 'production' || request.nextUrl.protocol === 'https:';
  for (const cookie of localLogoutCookies(request.cookies.getAll().map(cookie => cookie.name), secure)) {
    response.cookies.set(cookie);
  }
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function POST(request: NextRequest) {
  if (procoreSignInEnabled()) {
    if (!validateCsrfRequest({ method: request.method, requestUrl: request.url,
      origin: request.headers.get('origin'), referer: request.headers.get('referer') }).allowed) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
    }
    await appSessions.revoke(request.cookies.get(APP_SESSION_COOKIE)?.value);
  }
  return buildLogoutCookieResponse(request);
}

export async function GET(request: NextRequest) {
  if (procoreSignInEnabled()) return NextResponse.json({ error: 'Use POST to sign out.' }, { status: 405, headers: { Allow: 'POST' } });
  return buildLogoutCookieResponse(request);
}
