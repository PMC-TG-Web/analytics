import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { resolvePermissionForPath } from '@/lib/permissionRoutes';
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
import { validateCsrfRequest } from '@/lib/csrfProtection';
import { isProcoreLiveApiRoutePath } from '@/lib/procoreLiveApiRoutes';
import {
  COMMITMENT_MAKER_ACCESS_HEADER,
  COMMITMENT_MAKER_PROJECT_HEADER,
  verifyCommitmentMakerAccessToken,
} from '@/lib/commitmentMakerAccess';

const API_RATE_LIMIT = 300;
const API_RATE_WINDOW_MS = 60 * 1000;
const HEAVY_API_RATE_LIMIT = 6;
const HEAVY_API_RATE_WINDOW_MS = 10 * 60 * 1000;
const INTERNAL_PERMISSION_CHECK_ROUTE = '/api/internal/permission-check';
const ANALYTICS_PROCORE_LINK_COOKIE = 'analytics_procore_link_access';
const COMMITMENT_MAKER_PAGE_PATH = '/procore/commitments-live/maker';
const COMMITMENT_MAKER_API_PATH = '/api/procore/commitments-live/maker';

const PERMISSION_FALLBACKS: Record<string, string> = {
  'accounting-project-profitability': 'admin',
  'analytics-cost-code-sales': 'analytics',
  'procore-timecards': 'procore',
  'procore-line-items': 'procore',
  'procore-commitments': 'procore',
  'procore-scope-map': 'procore',
};

const HEAVY_API_ROUTE_PREFIXES = [
  '/api/procore/sync',
  '/api/procore/estimating/bid-board-projects',
  '/api/procore/estimating/proposals-bulk',
  '/api/procore/estimating/proposal-line-items-bulk',
  '/api/procore/sync/project-commercial-data',
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
    const fallbackPermission = PERMISSION_FALLBACKS[defaultPermission];
    if (fallbackPermission) permissions.add(fallbackPermission);
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

function hasProcoreAccessTokenCookie(request: NextRequest): boolean {
  return request.cookies.has('procore_access_token');
}

function hasAnalyticsProcoreLinkCookie(request: NextRequest): boolean {
  return request.cookies.get(ANALYTICS_PROCORE_LINK_COOKIE)?.value === '1';
}

async function hasSignedCommitmentMakerAccess(request: NextRequest): Promise<boolean> {
  const pathname = request.nextUrl.pathname;
  let projectId = '';
  let accessToken = '';

  if (pathname === COMMITMENT_MAKER_PAGE_PATH && request.method.toUpperCase() === 'GET') {
    projectId = String(request.nextUrl.searchParams.get('projectId') || '').trim();
    accessToken = String(request.nextUrl.searchParams.get('access') || '').trim();
  } else if (
    pathname === COMMITMENT_MAKER_API_PATH &&
    ['GET', 'POST'].includes(request.method.toUpperCase())
  ) {
    projectId = String(request.headers.get(COMMITMENT_MAKER_PROJECT_HEADER) || '').trim();
    accessToken = String(request.headers.get(COMMITMENT_MAKER_ACCESS_HEADER) || '').trim();
  } else {
    return false;
  }

  try {
    return await verifyCommitmentMakerAccessToken(projectId, accessToken);
  } catch (error) {
    console.error('Commitment Maker signed-link verification failed:', error);
    return false;
  }
}

function isTrustedProcoreEntryRequest(request: NextRequest): boolean {
  const source = String(request.nextUrl.searchParams.get('source') || '').trim().toLowerCase();
  if (source === 'procore' || source === 'procore-mobile') {
    return true;
  }

  const refererHeader = String(request.headers.get('referer') || '').trim();
  if (!refererHeader) return false;

  try {
    const refererHost = new URL(refererHeader).host.toLowerCase();
    return refererHost === 'procore.com' || refererHost.endsWith('.procore.com');
  } catch {
    return false;
  }
}

function isAnalyticsMobileBypassPath(pathname: string): boolean {
  if (pathname === '/analytics' || pathname.startsWith('/analytics/')) {
    return true;
  }

  return pathname === '/api/analytics/commitment-productivity' || pathname.startsWith('/api/analytics/commitment-productivity/');
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
  const requestHost = (request.nextUrl.host || '').toLowerCase();

  if (requestHost.endsWith('--analyticspmc.netlify.app')) {
    const canonicalUrl = request.nextUrl.clone();
    canonicalUrl.host = 'analyticspmc.netlify.app';
    return NextResponse.redirect(canonicalUrl, 307);
  }

  const isApiRoute = pathname.startsWith('/api/');
  const isAuthApiRoute = pathname.startsWith('/api/auth/');
  const isInternalPermissionCheckRoute = pathname === INTERNAL_PERMISSION_CHECK_ROUTE;
  const isPublicVersionRoute = pathname === '/api/public/version';
  const isProcoreWebhookReceiverRoute = pathname === '/api/webhooks/procore';
  const isProcoreWebhookProcessRoute = pathname === '/api/webhooks/procore/process';
  const isProcoreBackgroundSyncRoute =
    pathname === '/api/background/actuals-sync' ||
    pathname === '/api/background/nightly-structure-sync' ||
    pathname === '/api/background/change-order-approvals' ||
    pathname === '/api/background/commitment-maker-tasks' ||
    pathname === '/api/background/project-reconciliation';
  const isNetlifyScheduledSyncFunctionRoute =
    pathname === '/.netlify/functions/scheduled-sync' ||
    pathname.startsWith('/.netlify/functions/scheduled-sync/');
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
    // Allow cron callers and authenticated Procore sessions to reach the targeted
    // lookup/sync routes without enabling the global live API switch.
    if (
      isProcoreLiveApiRoutePath(pathname) &&
      !isProcoreLiveApiEnabled() &&
      !hasValidSyncSecret(request) &&
      !hasProcoreAccessTokenCookie(request)
    ) {
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

  const allowAnalyticsWithoutAuth0ViaProcoreSession =
    request.method.toUpperCase() === 'GET' &&
    isAnalyticsMobileBypassPath(pathname) &&
    (hasProcoreAccessTokenCookie(request) || hasAnalyticsProcoreLinkCookie(request));

  if (allowAnalyticsWithoutAuth0ViaProcoreSession) {
    if (isApiRoute && apiRateLimit) {
      const response = NextResponse.next();
      response.headers.set('X-RateLimit-Limit', String(apiRateLimit.limit));
      response.headers.set('X-RateLimit-Remaining', String(apiRateLimit.remaining));
      response.headers.set('X-RateLimit-Reset', String(Math.floor(apiRateLimit.resetAt / 1000)));
      return response;
    }

    return NextResponse.next();
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

  // Netlify background workers have explicit routes and validate the same
  // server-to-server secret inside the function.
  if (isProcoreBackgroundSyncRoute && hasValidSyncSecret(request)) {
    return NextResponse.next();
  }

  // Allow trusted server-side clone repairs without requiring an interactive
  // Auth0 browser session. The shared sync secret is validated above.
  if (pathname === '/api/procore/daily-activity/clone' && hasValidSyncSecret(request)) {
    return NextResponse.next();
  }

  // Allow Netlify scheduled function route without Auth0 session redirects.
  if (isNetlifyScheduledSyncFunctionRoute) {
    return NextResponse.next();
  }

  // Allow cron sync routes — each validates CRON_SECRET/PROCORE_SYNC_SECRET
  // internally before it can read from Procore or write synchronized data.
  if (
    pathname === '/api/cron/sync' ||
    pathname.startsWith('/api/cron/sync/') ||
    pathname === '/api/cron/actuals' ||
    pathname.startsWith('/api/cron/actuals/') ||
    pathname === '/api/cron/project-onboarding' ||
    pathname.startsWith('/api/cron/project-onboarding/') ||
    pathname === '/api/cron/project-reconciliation' ||
    pathname.startsWith('/api/cron/project-reconciliation/') ||
    pathname === '/api/cron/project-link-sync' ||
    pathname.startsWith('/api/cron/project-link-sync/') ||
    pathname === '/api/cron/change-order-approvals' ||
    pathname === '/api/cron/commitment-maker-tasks' ||
    pathname === '/api/cron/nightly-structure' ||
    pathname.startsWith('/api/cron/nightly-structure/') ||
    pathname === '/api/cron/productivity-review-reminders' ||
    pathname === '/api/cron/timecard-notifications'
  ) {
    return NextResponse.next();
  }

      // Allow one-time backfills — protected by their own CRON_SECRET header check inside the route.
      if (pathname === '/api/internal/backfill-gantt-scopes' ||
        pathname === '/api/internal/backfill-project-scopes-to-gantt' ||
        pathname === '/api/internal/dedupe-project-scopes' ||
        pathname === '/api/internal/scope-diagnostics' ||
        pathname === '/api/internal/projects-diagnostics' ||
          pathname === '/api/internal/project-lookup' ||
        pathname === '/api/internal/repair-project-identity' ||
        pathname === '/api/internal/debug-scope-project-split' ||
        pathname === '/api/internal/check-duplicate-projects' ||
          pathname === '/api/internal/merge-duplicate-projects' ||
          pathname === '/api/internal/projects-audit' ||
          pathname === '/api/internal/reset-procore-data' ||
          pathname === '/api/internal/export-kpi-entries' ||
          pathname === '/api/internal/import-kpi-entries') {
    return NextResponse.next();
  }

  // All server-to-server and external callback routes have already returned
  // above. Require same-origin browser metadata before a cookie-authenticated
  // API request is allowed to change state.
  if (isApiRoute) {
    const csrfValidation = validateCsrfRequest({
      method: request.method,
      requestUrl: request.url,
      origin: request.headers.get('origin'),
      referer: request.headers.get('referer'),
    });

    if (!csrfValidation.allowed) {
      return NextResponse.json(
        { success: false, error: 'Invalid request origin' },
        { status: 403 }
      );
    }
  }

  // A signed, project-specific Procore Project Home link grants access only to
  // Commitment Maker and its matching project lookup/write endpoint. This avoids an Auth0
  // prompt without exposing general Analytics or unrestricted Procore access.
  if (await hasSignedCommitmentMakerAccess(request)) {
    const response = NextResponse.next();
    response.headers.set('Referrer-Policy', 'no-referrer');
    if (isApiRoute && apiRateLimit) {
      response.headers.set('X-RateLimit-Limit', String(apiRateLimit.limit));
      response.headers.set('X-RateLimit-Remaining', String(apiRateLimit.remaining));
      response.headers.set('X-RateLimit-Reset', String(Math.floor(apiRateLimit.resetAt / 1000)));
    }
    return response;
  }

  const session = await auth0.getSession(request);
  if (!session) {
    if (request.method.toUpperCase() === 'GET' && (pathname === '/analytics' || pathname.startsWith('/analytics/'))) {
      if (isTrustedProcoreEntryRequest(request)) {
        const response = NextResponse.next();
        response.cookies.set(ANALYTICS_PROCORE_LINK_COOKIE, '1', {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 12 * 60 * 60,
        });
        return response;
      }

      const procoreLoginUrl = new URL('/api/auth/procore/login', request.url);
      const returnTo = `${pathname}${request.nextUrl.search}`;
      procoreLoginUrl.searchParams.set('returnTo', returnTo);
      return NextResponse.redirect(procoreLoginUrl);
    }

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

  // Session and permission checks already passed above.
  // Avoid invoking auth middleware a second time on every navigation.
  return applyPermissionCookie(NextResponse.next(), permissionCookieToSet);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
