import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { resolvePermissionForPath } from '@/lib/permissions';
import {
  getPermissionCookieOptions,
  PERMISSION_COOKIE_NAME,
  verifyPermissionCookieValue,
} from '@/lib/permissionCookie';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimit';
import {
  DIAGNOSTICS_OR_TEST_API_ROUTES,
  DIAGNOSTICS_OR_TEST_PAGE_ROUTES,
  matchesDiagnosticsOrTestRoute,
  shouldBlockDiagnosticsInProduction,
} from '@/lib/diagnosticsGate';

const API_RATE_LIMIT = 300;
const API_RATE_WINDOW_MS = 60 * 1000;
const HEAVY_API_RATE_LIMIT = 6;
const HEAVY_API_RATE_WINDOW_MS = 10 * 60 * 1000;
const INTERNAL_PERMISSION_CHECK_ROUTE = '/api/internal/permission-check';

const HEAVY_API_ROUTE_PREFIXES = [
  '/api/procore/sync',
  '/api/procore/estimating/bid-board-projects',
  '/api/procore/estimating/proposals-bulk',
  '/api/procore/estimating/proposal-line-items-bulk',
  '/api/procore/sync/project-commercial-data',
];

const PROCORE_LIVE_API_ROUTE_PREFIXES = [
  '/api/procore/sync',
  '/api/procore/projects',
  '/api/procore/vendors',
  '/api/procore/prime-contracts',
  '/api/procore/change-order-packages',
  '/api/procore/company-users',
  '/api/procore/configurable-field-sets',
  '/api/procore/custom-fields',
  '/api/procore/project-stages',
  '/api/procore/estimating/bid-board-projects',
  '/api/procore/estimating/bid-board-project-by-id',
  '/api/procore/estimating/catalogs',
  '/api/procore/estimating/catalog-items',
  '/api/procore/estimating/estimating-project',
  '/api/procore/estimating/proposals',
  '/api/procore/estimating/proposals-bulk',
  '/api/procore/estimating/proposal-line-items',
  '/api/procore/estimating/proposal-line-items-bulk',
  '/api/procore/estimating/proposal-line-item-groups',
];

type PermissionCheckResult = {
  allowed: boolean;
  permissionsCookie?: string | null;
};

function resolvePermissionsForRequest(request: NextRequest): string[] {
  const { pathname, searchParams } = request.nextUrl;
  const method = request.method.toUpperCase();
  const permissions = new Set<string>();

  if (pathname === '/') {
    return [];
  }

  const defaultPermission = resolvePermissionForPath(pathname);

  if (defaultPermission) {
    permissions.add(defaultPermission);
  }

  if (method === 'GET') {
    if (pathname === '/api/projects' && searchParams.get('mode') === 'dashboard') {
      permissions.add('kpi');
    }

    if (pathname === '/api/scheduling' || pathname === '/api/scheduling/projects-with-budget') {
      permissions.add('kpi');
    }

    if (pathname === '/api/short-term-schedule' && searchParams.get('action') === 'active-schedule') {
      permissions.add('kpi');
    }

    if (pathname === '/api/schedule-allocations') {
      permissions.add('long-term-schedule');
    }
  }

  if (pathname === '/api/concrete-orders' || pathname.startsWith('/api/concrete-orders/')) {
    permissions.add('concrete-orders-schedule');
  }

  return Array.from(permissions);
}

function applyPermissionCookie(response: NextResponse, cookieValue: string | null) {
  if (cookieValue) {
    response.cookies.set(PERMISSION_COOKIE_NAME, cookieValue, getPermissionCookieOptions());
  }

  return response;
}

function isHeavyApiRoutePath(pathname: string) {
  return HEAVY_API_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function isProcoreLiveApiRoutePath(pathname: string) {
  return PROCORE_LIVE_API_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function isProcoreLiveApiEnabled(): boolean {
  const value = String(process.env.PROCORE_LIVE_API_ENABLED || '').trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

function getApiRatePolicy(pathname: string) {
  const isHeavyRoute = isHeavyApiRoutePath(pathname);

  if (isHeavyRoute) {
    return {
      keyPrefix: 'heavy',
      limit: HEAVY_API_RATE_LIMIT,
      windowMs: HEAVY_API_RATE_WINDOW_MS,
    };
  }

  return {
    keyPrefix: 'api',
    limit: API_RATE_LIMIT,
    windowMs: API_RATE_WINDOW_MS,
  };
}

function getRequestSyncSecret(request: NextRequest): string {
  const headerSecret = request.headers.get('x-sync-secret')?.trim();
  if (headerSecret) return headerSecret;

  const authorization = request.headers.get('authorization')?.trim() || '';
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  return bearerMatch?.[1]?.trim() || '';
}

function hasValidSyncSecret(request: NextRequest): boolean {
  const expectedSecret = (process.env.PROCORE_SYNC_SECRET || process.env.SYNC_SECRET || '').trim();
  if (!expectedSecret) return false;

  return getRequestSyncSecret(request) === expectedSecret;
}

async function checkDatabasePermission(request: NextRequest, permissions: string[]): Promise<PermissionCheckResult> {
  try {
    const cookie = request.headers.get('cookie');
    const response = await fetch(new URL(INTERNAL_PERMISSION_CHECK_ROUTE, request.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({ permissions }),
      cache: 'no-store',
    });

    if (!response.ok) return { allowed: false };
    const data = await response.json().catch(() => null) as {
      allowed?: unknown;
      permissionsCookie?: unknown;
    } | null;

    return {
      allowed: data?.allowed === true,
      permissionsCookie: typeof data?.permissionsCookie === 'string' ? data.permissionsCookie : null,
    };
  } catch (error) {
    console.error('Failed to check route permission:', error);
    return { allowed: false };
  }
}

export async function middleware(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== 'production';
  const shouldBlockDiagnostics = shouldBlockDiagnosticsInProduction();
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
  const isInternalPermissionCheckRoute = pathname === INTERNAL_PERMISSION_CHECK_ROUTE;
  const isPublicVersionRoute = pathname === '/api/public/version';
  const isProcoreWebhookReceiverRoute = pathname === '/api/webhooks/procore';
  const isProcoreWebhookProcessRoute = pathname === '/api/webhooks/procore/process';
  const isDiagnosticsOrTestApiRoute = matchesDiagnosticsOrTestRoute(
    pathname,
    DIAGNOSTICS_OR_TEST_API_ROUTES
  );
  const isDiagnosticsOrTestPageRoute = matchesDiagnosticsOrTestRoute(
    pathname,
    DIAGNOSTICS_OR_TEST_PAGE_ROUTES
  );

  if (shouldBlockDiagnostics && isDiagnosticsOrTestApiRoute) {
    return NextResponse.json(
      { success: false, error: 'Not found' },
      { status: 404 }
    );
  }

  if (shouldBlockDiagnostics && isDiagnosticsOrTestPageRoute) {
    return new NextResponse('Not found', { status: 404 });
  }

  // In dev mode without Auth0 config, bypass all middleware
  if (isDev && auth0Misconfigured) {
    return NextResponse.next();
  }

  // In production or if Auth0 is configured, enforce auth
  if (isPublicVersionRoute) {
    return NextResponse.next();
  }

  if (isInternalPermissionCheckRoute) {
    return NextResponse.next();
  }

  // Allow auth routes
  if (isAuthApiRoute) {
    const response = await auth0.middleware(request);
    return response;
  }

  let apiRateLimit:
    | ReturnType<typeof checkRateLimit>
    | null = null;

  if (isApiRoute) {
    if (isProcoreLiveApiRoutePath(pathname) && !isProcoreLiveApiEnabled()) {
      return NextResponse.json(
        {
          success: false,
          error: 'Procore live API access is disabled',
          details: 'Set PROCORE_LIVE_API_ENABLED=true only for controlled maintenance windows.',
        },
        { status: 503 }
      );
    }

    const clientId = getClientIdentifier(request.headers);
    const ratePolicy = getApiRatePolicy(pathname);
    apiRateLimit = checkRateLimit({
      key: `${ratePolicy.keyPrefix}:${clientId}:${pathname}`,
      limit: ratePolicy.limit,
      windowMs: ratePolicy.windowMs,
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

  if (pathname === '/api/procore/sync' || pathname.startsWith('/api/procore/sync/')) {
    if (request.method.toUpperCase() === 'GET') {
      return NextResponse.json(
        { success: false, error: 'Sync endpoints require POST.' },
        { status: 405, headers: { Allow: 'POST' } }
      );
    }
  }

  if (isApiRoute && isHeavyApiRoutePath(pathname) && request.method.toUpperCase() === 'POST' && hasValidSyncSecret(request)) {
    const response = NextResponse.next();
    if (apiRateLimit) {
      response.headers.set('X-RateLimit-Limit', String(apiRateLimit.limit));
      response.headers.set('X-RateLimit-Remaining', String(apiRateLimit.remaining));
      response.headers.set('X-RateLimit-Reset', String(Math.floor(apiRateLimit.resetAt / 1000)));
    }
    return response;
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

  // Allow external Procore webhook deliveries without Auth0 session checks.
  if (isProcoreWebhookReceiverRoute) {
    return NextResponse.next();
  }

  // Allow worker trigger calls from server-to-server callers with sync secret.
  if (isProcoreWebhookProcessRoute && hasValidSyncSecret(request)) {
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
    const returnTo = `${pathname}${request.nextUrl.search}`;
    loginUrl.searchParams.set('returnTo', returnTo);
    return NextResponse.redirect(loginUrl);
  }

  let permissionCookieToSet: string | null = null;
  const requiredPermissions = resolvePermissionsForRequest(request);
  if (requiredPermissions.length > 0) {
    const sessionEmail = session.user?.email?.trim().toLowerCase() || null;
    const cachedPermissions = await verifyPermissionCookieValue(
      request.cookies.get(PERMISSION_COOKIE_NAME)?.value,
      sessionEmail
    );
    const cachedAllowed = cachedPermissions?.permissions.some(
      (permission) => requiredPermissions.some((requiredPermission) => permission.toLowerCase() === requiredPermission.toLowerCase())
    ) === true;
    const permissionCheck = cachedAllowed
      ? { allowed: true, permissionsCookie: null }
      : await checkDatabasePermission(request, requiredPermissions);
    const allowed = permissionCheck.allowed;
    permissionCookieToSet = permissionCheck.permissionsCookie || null;

    if (!allowed) {
      if (isApiRoute) {
        return NextResponse.json(
          {
            success: false,
            error: 'Forbidden',
            path: pathname,
            requiredPermissions,
          },
          {
            status: 403,
            headers: {
              'X-Analytics-Required-Permissions': requiredPermissions.join(','),
              'X-Analytics-Blocked-Path': pathname,
            },
          }
        );
      }

      const forbiddenUrl = new URL('/forbidden', request.url);
      forbiddenUrl.searchParams.set('from', `${pathname}${request.nextUrl.search}`);
      forbiddenUrl.searchParams.set('permission', requiredPermissions.join(','));
      return NextResponse.redirect(forbiddenUrl);
    }
  }

  if (isApiRoute && apiRateLimit) {
    const response = NextResponse.next();
    response.headers.set('X-RateLimit-Limit', String(apiRateLimit.limit));
    response.headers.set('X-RateLimit-Remaining', String(apiRateLimit.remaining));
    response.headers.set('X-RateLimit-Reset', String(Math.floor(apiRateLimit.resetAt / 1000)));
    return applyPermissionCookie(response, permissionCookieToSet);
  }

  return applyPermissionCookie(await auth0.middleware(request), permissionCookieToSet);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
