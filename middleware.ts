import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { hasPageAccess, resolvePermissionForPath } from '@/lib/permissions';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimit';

const API_RATE_LIMIT = 300;
const API_RATE_WINDOW_MS = 60 * 1000;

export async function middleware(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== 'production';
  const auth0Domain = (process.env.AUTH0_DOMAIN || '').trim().toLowerCase();
  const auth0ClientId = (process.env.AUTH0_CLIENT_ID || '').trim();
  const auth0Secret = (process.env.AUTH0_SECRET || '').trim();
  const auth0Misconfigured =
    !auth0Domain ||
    auth0Domain.includes('your-auth0-domain') ||
    !auth0ClientId ||
    !auth0Secret;

  const { pathname } = request.nextUrl;
  const isApiRoute = pathname.startsWith('/api/');
  const isAuthApiRoute = pathname.startsWith('/api/auth/');

  // In dev mode without Auth0 config, bypass all middleware
  if (isDev && auth0Misconfigured) {
    return NextResponse.next();
  }

  // In production or if Auth0 is configured, enforce auth
  // Allow auth routes
  if (isAuthApiRoute) {
    const response = await auth0.middleware(request);
    return response;
  }

  let apiRateLimit:
    | ReturnType<typeof checkRateLimit>
    | null = null;

  if (isApiRoute) {
    const clientId = getClientIdentifier(request.headers);
    apiRateLimit = checkRateLimit({
      key: `${clientId}:${pathname}`,
      limit: API_RATE_LIMIT,
      windowMs: API_RATE_WINDOW_MS,
    });

    if (apiRateLimit.limited) {
      return NextResponse.json(
        { success: false, error: 'Too many requests' },
        {
          status: 429,
          headers: {
            'Retry-After': String(apiRateLimit.retryAfter),
            'X-RateLimit-Limit': String(apiRateLimit.limit),
            'X-RateLimit-Remaining': String(apiRateLimit.remaining),
            'X-RateLimit-Reset': String(Math.floor(apiRateLimit.resetAt / 1000)),
          },
        }
      );
    }
  }

  // Allow login page
  if (pathname === '/login') {
    return NextResponse.next();
  }

  if (pathname === '/forbidden') {
    return NextResponse.next();
  }

  // Allow login handoff page (used to break out of iframe before Auth0 redirect)
  if (pathname === '/auth/start') {
    return NextResponse.next();
  }

  const session = await auth0.getSession(request);
  if (!session) {
    if (isApiRoute) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('returnTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const userEmail = session.user.email ?? null;
  const requiredPermission = resolvePermissionForPath(pathname);

  if (requiredPermission && !hasPageAccess(userEmail, requiredPermission)) {
    if (isApiRoute) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      );
    }

    const forbiddenUrl = new URL('/forbidden', request.url);
    forbiddenUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(forbiddenUrl);
  }

  if (isApiRoute && apiRateLimit) {
    const response = NextResponse.next();
    response.headers.set('X-RateLimit-Limit', String(apiRateLimit.limit));
    response.headers.set('X-RateLimit-Remaining', String(apiRateLimit.remaining));
    response.headers.set('X-RateLimit-Reset', String(Math.floor(apiRateLimit.resetAt / 1000)));
    return response;
  }

  return await auth0.middleware(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
