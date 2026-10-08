import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server.js';
import * as csrf from '../src/lib/csrfProtection.ts';
import * as routes from '../src/lib/permissionRoutes.js';
import * as logout from '../src/lib/localLogoutCookies.ts';

function load(file, imports, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${code}})(require,module,module.exports)`, {
    module, Date, URL, console, AbortSignal, process: { env: { NODE_ENV: 'production',
      AUTH0_DOMAIN: 'test.auth0.com', AUTH0_CLIENT_ID: 'test', AUTH0_SECRET: 'test-secret' } }, ...globals,
    require: (id) => { assert.ok(id in imports, `unexpected import ${id}`); return imports[id]; },
  });
  return module.exports;
}

function harness({ enabled = true, emailEnabled = true, auth0Email = null, sessionStatus = 200, allowed = true } = {}) {
  const calls = { auth0Reads: 0, rolls: 0, sessions: 0, permissionCookies: [], revoked: [] };
  const auth0 = {
    getSession: async () => { calls.auth0Reads++; return auth0Email ? { user: { email: auth0Email } } : null; },
    middleware: async () => { calls.rolls++; return NextResponse.next(); },
  };
  const policy = { APP_SESSION_COOKIE: 'analytics_app_session', procoreSignInEnabled: () => enabled, emailSignInEnabled: () => emailEnabled };
  const appSessions = {
    resolve: async () => sessionStatus === 200 ? { user: { email: 'procore@example.test', sub: 'procore|123' } } : null,
    revoke: async (token) => { calls.revoked.push(token); },
  };
  const imports = {
    'next/server': { NextRequest, NextResponse }, 'next/headers': { cookies: async () => ({ has: () => false }) },
    '@/lib/auth0': { auth0 }, '@/lib/appSignInPolicy': policy, '@/lib/appSession': { appSessions },
    '@/lib/developerIdentity': { getDeveloperEmail: () => null, isLocalDeveloperRequest: () => false },
    '@/lib/permissionRoutes': routes,
    '@/lib/permissionCookie': { PERMISSION_COOKIE_NAME: 'analytics_permissions', verifyPermissionCookieValue: async () => null },
    '@/lib/procoreUserSession': { verifyProcoreUserSessionCookieValue: async () => null },
    '@/lib/csrfProtection': csrf, '@/lib/localLogoutCookies': logout,
    '@/lib/rateLimit': { getClientIdentifier: () => 'test', checkRateLimit: () => ({ limited: false, limit: 300, remaining: 299, resetAt: Date.now() + 60000 }) },
    '@/lib/diagnosticsGate': { matchesDiagnosticsOrTestRoute: () => false, shouldBlockDiagnosticsInProduction: () => true },
    '@/lib/procoreLiveApiRoutes': { isProcoreLiveApiRoutePath: () => false },
    '@/lib/commitmentMakerAccess': {},
  };
  const middleware = load('middleware.ts', imports, {
    fetch: async (url, options) => {
      if (url.pathname === '/api/auth/session') {
        calls.sessions++;
        assert.equal(options.headers.Origin, 'https://app.example.test');
        const response = NextResponse.json({ user: { email: 'procore@example.test' } }, { status: sessionStatus });
        response.cookies.set('procore_access_token', 'renewed-access', { httpOnly: true, secure: true, sameSite: 'none' });
        return response;
      }
      assert.equal(url.pathname, '/api/internal/permission-check');
      calls.permissionCookies.push(options.headers.Cookie);
      return NextResponse.json({ allowed });
    },
  }).middleware;
  return { middleware, calls, imports, auth0 };
}

function request(path = '/kpi', { cookie = 'analytics_app_session=opaque-test-session', method = 'GET', origin = 'https://app.example.test' } = {}) {
  return new NextRequest(`https://app.example.test${path}`, { method, headers: { cookie, origin } });
}

test('Procore identity reaches every protected page and API, renewing credentials without reading Auth0', async () => {
  for (const path of ['/', '/help', '/kpi', '/accounting/project-profitability', '/api/permissions/me', '/api/accounting/project-profitability']) {
    const f = harness(); const response = await f.middleware(request(path));
    assert.equal(response.headers.get('x-middleware-next'), '1', path);
    assert.equal(f.calls.auth0Reads, 0);
    assert.equal(f.calls.rolls, 0);
    assert.equal(f.calls.sessions, 1);
    assert.match(response.headers.get('set-cookie'), /procore_access_token=renewed-access/);
    assert.match(response.headers.get('x-middleware-request-cookie'), /procore_access_token=renewed-access/);
    assert.ok(f.calls.permissionCookies.every((cookie) => cookie.includes('procore_access_token=renewed-access')));
  }
});

test('expired app identity cannot fall back to another account still signed into Auth0', async () => {
  const f = harness({ sessionStatus: 401, auth0Email: 'different@example.test' });
  assert.equal((await f.middleware(request('/api/permissions/me'))).status, 401);
  const page = await f.middleware(request('/kpi'));
  assert.match(page.headers.get('location'), /\/login\?returnTo=%2Fkpi/);
  assert.equal(f.calls.auth0Reads, 0);
});

test('session-service outages give a retryable error instead of a login loop', async () => {
  const f = harness({ sessionStatus: 503 });
  const response = await f.middleware(request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('retry-after'), '5');
});

test('Procore users still need page permissions and same-origin writes', async () => {
  const denied = harness({ allowed: false });
  assert.equal((await denied.middleware(request('/api/accounting/project-profitability'))).status, 403);
  const crossSite = harness();
  assert.equal((await crossSite.middleware(request('/api/kpi-cards', { method: 'POST', origin: 'https://evil.test' }))).status, 403);
  assert.equal(crossSite.calls.sessions, 0);
});

test('Procore URL parameters, old link cookies and access tokens alone no longer authenticate in the new mode', async () => {
  const f = harness();
  for (const cookie of ['', 'analytics_procore_link_access=1', 'procore_access_token=not-proof-of-identity']) {
    const response = await f.middleware(request('/analytics?source=procore', { cookie }));
    assert.match(response.headers.get('location'), /\/login\?/);
  }
});

test('Auth0 fallback sessions roll during normal browsing and can be disabled explicitly', async () => {
  const f = harness({ auth0Email: 'email@example.test' });
  assert.equal((await f.middleware(request('/', { cookie: '' }))).headers.get('x-middleware-next'), '1');
  assert.equal(f.calls.rolls, 1);
  const disabled = harness({ emailEnabled: false, auth0Email: 'email@example.test' });
  assert.equal((await disabled.middleware(request('/api/permissions/me', { cookie: '' }))).status, 401);
  assert.equal((await disabled.middleware(request('/api/auth/login', { cookie: '' }))).status, 404);
});

test('server request identity and browser user endpoint agree on the Procore user', async () => {
  const f = harness({ auth0Email: 'other@example.test' });
  const identity = load('src/lib/requestUser.ts', f.imports);
  assert.equal(await identity.getRequestUserEmail(request()), 'procore@example.test');
  const endpoint = load('src/app/api/auth/me/route.ts', f.imports);
  const response = await endpoint.GET(request('/api/auth/me'));
  assert.equal((await response.json()).email, 'procore@example.test');
  assert.equal(f.calls.auth0Reads, 0);
});

test('Procore logout revokes the server session, clears all identity cookies and rejects cross-site logout', async () => {
  const f = harness(); const route = load('src/app/api/auth/logout/local/route.ts', f.imports);
  const response = await route.POST(request('/api/auth/logout/local', { method: 'POST' }));
  assert.deepEqual(f.calls.revoked, ['opaque-test-session']);
  assert.equal((await response.json()).procoreSession, true);
  for (const name of ['analytics_app_session', 'analytics_permissions', 'analytics_procore_user', '__session', 'procore_refresh_token']) {
    assert.equal(response.cookies.get(name).maxAge, 0, name);
  }
  assert.equal((await route.POST(request('/api/auth/logout/local', { method: 'POST', origin: 'https://evil.test' }))).status, 403);
  assert.equal((await route.GET(request('/api/auth/logout/local'))).status, 405);
});
