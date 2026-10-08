import { NextRequest } from 'next/server';
import { createAuth0Client } from '@/lib/auth0';
import { APP_SESSION_COOKIE, procoreSignInEnabled, safeAppReturnTo } from '@/lib/appSignInPolicy';
import { appSessions } from '@/lib/appSession';
import { localLogoutCookies } from '@/lib/localLogoutCookies';

function isSafeReturnToPath(value: string | null): value is string {
  if (!value) return false;
  if (safeAppReturnTo(value, '') !== value) return false;
  if (!value.startsWith('/')) return false;
  if (value.startsWith('/api/auth')) return false;
  if (value === '/login' || value.startsWith('/login?')) return false;
  if (value === '/auth/start' || value.startsWith('/auth/start?')) return false;
  // /auth/complete is intentionally allowed — it is the post-auth signal page for
  // Procore framed logins. Guard against double-nesting (/auth/complete returning
  // to another /auth/complete) which would create a redirect cycle.
  if (value === '/auth/complete') return false; // no returnTo provided — pointless
  if (value.startsWith('/auth/complete?')) {
    try {
      const nested = new URLSearchParams(value.slice(value.indexOf('?'))).get('returnTo');
      if (!nested || nested.startsWith('/auth/complete')) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function normalizeAuthRequest(request: NextRequest): NextRequest {
  const url = new URL(request.url);

  // Preserve explicit returnTo path for deep-link refresh/login flows.
  if (url.pathname.endsWith('/api/auth/login')) {
    const requestedReturnTo = url.searchParams.get('returnTo');

    if (isSafeReturnToPath(requestedReturnTo)) {
      url.searchParams.set('returnTo', requestedReturnTo);
      return new NextRequest(url, request);
    }

    const referer = request.headers.get('referer');
    if (referer) {
      try {
        const refererUrl = new URL(referer);
        if (refererUrl.origin === url.origin) {
          const fallbackReturnTo = `${refererUrl.pathname}${refererUrl.search}`;
          if (isSafeReturnToPath(fallbackReturnTo)) {
            url.searchParams.set('returnTo', fallbackReturnTo);
            return new NextRequest(url, request);
          }
        }
      } catch {
        // Ignore invalid referer values.
      }
    }

    url.searchParams.set('returnTo', '/');
    return new NextRequest(url, request);
  }

  return request;
}

async function handleAuth0Request(request: NextRequest) {
  const switchingToEmail = procoreSignInEnabled() && request.nextUrl.pathname === '/api/auth/login';
  if (switchingToEmail) await appSessions.revoke(request.cookies.get(APP_SESSION_COOKIE)?.value);
  const auth0 = createAuth0Client(request.nextUrl.origin);
  const response = await auth0.middleware(normalizeAuthRequest(request));
  if (switchingToEmail) {
    for (const cookie of localLogoutCookies(request.cookies.getAll().map((cookie) => cookie.name), request.nextUrl.protocol === 'https:')) response.cookies.set(cookie);
  }
  return response;
}

export async function GET(request: NextRequest) { return handleAuth0Request(request); }
export async function POST(request: NextRequest) {
  return handleAuth0Request(request);
}
