import { NextRequest, NextResponse } from 'next/server';
import { appSessions } from '@/lib/appSession';
import { APP_SESSION_COOKIE, procoreSignInEnabled } from '@/lib/appSignInPolicy';
import { validateCsrfRequest } from '@/lib/csrfProtection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!procoreSignInEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!validateCsrfRequest({ method: request.method, requestUrl: request.url,
    origin: request.headers.get('origin'), referer: request.headers.get('referer') }).allowed) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }
  try {
    const session = await appSessions.resolve(request.cookies.get(APP_SESSION_COOKIE)?.value, true);
    const response = NextResponse.json(session ? { user: session.user, needsReconnect: session.needsReconnect } : { error: 'Not authenticated' },
      { status: session ? 200 : 401, headers: { 'Cache-Control': 'private, no-store' } });
    if (session) {
      const secure = process.env.NODE_ENV === 'production' || request.nextUrl.protocol === 'https:';
      const options = { httpOnly: true, secure,
        sameSite: secure ? 'none' as const : 'lax' as const,
        path: '/', expires: session.accessExpiresAt };
      // Preserve existing Procore tool callers. Refresh credentials themselves stay encrypted on the server.
      if (session.accessToken && request.cookies.get('procore_access_token')?.value !== session.accessToken) {
        response.cookies.set('procore_access_token', session.accessToken, options);
        response.cookies.set('procore_company_id', session.companyId, options);
        if (session.scope) response.cookies.set('procore_scope', session.scope, options);
      }
    }
    return response;
  } catch {
    return NextResponse.json({ error: 'Sign-in is temporarily unavailable. Please retry.' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '5' } });
  }
}
