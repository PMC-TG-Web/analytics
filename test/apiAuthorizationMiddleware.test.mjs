import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server.js';
import * as permissionRoutes from '../src/lib/permissionRoutes.js';
import * as csrf from '../src/lib/csrfProtection.ts';
import * as billingAccess from '../src/lib/billingAnalyticsAccess.ts';
import * as subcontractAccess from '../src/lib/subcontractAllocationAccess.ts';
import { safeAppReturnTo } from '../src/lib/appSignInPolicy.ts';

const origin = 'https://authorization.example.test';
const middlewareCode = ts.transpileModule(fs.readFileSync('middleware.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness({
  identity = 'auth0',
  databaseAllowed = false,
  cachedPermissions = [],
  environment = 'production',
  authConfigured = true,
  rateLimited = false,
  signedMaker = false,
} = {}) {
  const calls = { authReads: 0, rolls: 0, appSessions: 0, permissionChecks: [], rates: 0 };
  const procoreEnabled = identity === 'procore';
  const auth0 = {
    getSession: async () => {
      calls.authReads++;
      return identity === 'auth0' ? { user: { email: 'limited@example.test' } } : null;
    },
    middleware: async () => { calls.rolls++; return NextResponse.next(); },
  };
  const imports = {
    'next/server': { NextRequest, NextResponse },
    '@/lib/auth0': { auth0 },
    '@/lib/appSignInPolicy': {
      APP_SESSION_COOKIE: 'analytics_app_session',
      procoreSignInEnabled: () => procoreEnabled,
      emailSignInEnabled: () => true,
      safeAppReturnTo,
    },
    '@/lib/developerIdentity': { getDeveloperEmail: () => null, isLocalDeveloperRequest: () => false },
    '@/lib/permissionRoutes': permissionRoutes,
    '@/lib/permissionCookie': {
      PERMISSION_COOKIE_NAME: 'analytics_permissions',
      verifyPermissionCookieValue: async () => ({ permissions: cachedPermissions }),
      getPermissionCookieOptions: () => ({ httpOnly: true, path: '/' }),
    },
    '@/lib/procoreUserSession': { verifyProcoreUserSessionCookieValue: async () => null },
    '@/lib/csrfProtection': csrf,
    '@/lib/rateLimit': {
      getClientIdentifier: () => 'authorization-test',
      checkRateLimit: () => {
        calls.rates++;
        return { limited: rateLimited, limit: 300, remaining: rateLimited ? 0 : 299,
          resetAt: Date.now() + 60000, retryAfter: 60 };
      },
    },
    '@/lib/diagnosticsGate': {
      matchesDiagnosticsOrTestRoute: () => false,
      shouldBlockDiagnosticsInProduction: () => true,
    },
    '@/lib/procoreLiveApiRoutes': { isProcoreLiveApiRoutePath: () => false },
    '@/lib/commitmentMakerAccess': {
      COMMITMENT_MAKER_ACCESS_HEADER: 'x-commitment-maker-access',
      COMMITMENT_MAKER_PROJECT_HEADER: 'x-commitment-maker-project',
      verifyCommitmentMakerAccessToken: async (project, token) =>
        signedMaker && project === 'test-project' && token === 'signed-test-token',
    },
    '@/lib/billingAnalyticsAccess': billingAccess,
    '@/lib/subcontractAllocationAccess': subcontractAccess,
  };
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${middlewareCode}})(require,module,module.exports)`, {
    module, Date, URL, console, AbortSignal,
    process: { env: {
      NODE_ENV: environment,
      ...(authConfigured ? { AUTH0_DOMAIN: 'example.auth0.com', AUTH0_CLIENT_ID: 'test-client', AUTH0_SECRET: 'test-secret' } : {}),
      PROCORE_SYNC_SECRET: 'test-worker-secret',
    } },
    require: id => { assert.ok(id in imports, `Unexpected middleware import: ${id}`); return imports[id]; },
    fetch: async (url, options) => {
      if (url.pathname === '/api/auth/session') {
        calls.appSessions++;
        assert.equal(options.headers.Origin, origin);
        const response = NextResponse.json({ user: { email: 'limited@example.test' } });
        response.cookies.set('procore_access_token', 'renewed-test-token', { httpOnly: true });
        return response;
      }
      assert.equal(url.pathname, '/api/internal/permission-check');
      calls.permissionChecks.push(JSON.parse(options.body).permissions);
      return NextResponse.json({ allowed: databaseAllowed });
    },
  });
  return {
    calls,
    run(path, { method = 'GET', headers = {} } = {}) {
      return module.exports.middleware(new NextRequest(`${origin}${path}`, {
        method,
        headers: {
          origin,
          cookie: procoreEnabled ? 'analytics_app_session=test-session' : 'session=test-session',
          ...headers,
        },
      }));
    },
  };
}

function assertPassed(response, label) {
  assert.equal(response.headers.get('x-middleware-next'), '1', label);
}

test('page-specific lookups work without granting full employee or project access', async () => {
  for (const [permission, allowed, denied] of [
    ['crew-management', '/api/crew-management/employees', '/api/employees'],
    ['estimating-tools', '/api/estimating-tools/projects', '/api/projects'],
    ['certifications', '/api/certifications/employees', '/api/employees'],
    ['certifications', '/api/certifications/expiration-review', '/api/employees'],
  ]) {
    const app = harness({ identity: 'procore', cachedPermissions: [permission] });
    assertPassed(await app.run(allowed), allowed);
    assert.equal((await app.run(denied)).status, 403, denied);
    assert.equal((await harness({ identity: 'procore', cachedPermissions: ['analytics'] }).run(allowed)).status, 403);
    assert.equal((await harness({ identity: 'anonymous' }).run(allowed)).status, 401);
  }
});

test('unmapped APIs fail closed before identity, cached permissions, or local development bypasses', async () => {
  for (const options of [
    { identity: 'auth0' }, { identity: 'procore' }, { identity: 'anonymous' },
    { identity: 'anonymous', environment: 'development', authConfigured: false },
  ]) {
    const app = harness({ ...options, databaseAllowed: true, cachedPermissions: ['admin', 'analytics'] });
    for (const path of ['/api/new-finance-tool', '/api/permissions/me/child', '/api/auth/not-configured',
      '/api/cron/new-worker', '/api/internal/new-repair', '/api/background/new-worker']) {
      const response = await app.run(path, { headers: { 'x-sync-secret': 'test-worker-secret' } });
      assert.equal(response.status, 403, `${JSON.stringify(options)} ${path}`);
      assert.equal(response.headers.get('x-middleware-next'), null);
    }
    assert.equal(app.calls.authReads, 0);
    assert.equal(app.calls.appSessions, 0);
    assert.equal(app.calls.rolls, 0);
    assert.deepEqual(app.calls.permissionChecks, []);
  }
});

test('newly mapped data APIs require their feature permission for either application identity', async () => {
  const routes = [
    ['/api/analytics/monthly-hours', 'analytics'],
    ['/api/analytics/cost-code-sales', 'analytics-cost-code-sales'],
    ['/api/projects-v1-live', 'projects'], ['/api/bid-board-live', 'projects'],
    ['/api/pmc/projects', 'projects'], ['/api/estimating-dashboard', 'dashboard'],
    ['/api/labor-report', 'reporting'], ['/api/cron/sync/logs', 'admin'],
  ];
  for (const identity of ['auth0', 'procore']) {
    for (const [path, permission] of routes) {
      const denied = harness({ identity });
      assert.equal((await denied.run(path)).status, 403, `${identity} ${path}`);
      assert.ok(denied.calls.permissionChecks.some(grants => grants.includes(permission)), path);
      const allowed = harness({ identity, cachedPermissions: [permission] });
      assertPassed(await allowed.run(path), `${identity} ${path}`);
      assert.deepEqual(allowed.calls.permissionChecks, []);
    }
  }
});

test('known protected APIs still reject requests without an authenticated identity', async () => {
  const app = harness({ identity: 'anonymous', databaseAllowed: true });
  for (const path of ['/api/analytics/monthly-hours', '/api/projects-v1-live', '/api/labor-report', '/api/cron/sync/logs']) {
    assert.equal((await app.run(path)).status, 401, path);
  }
  assert.deepEqual(app.calls.permissionChecks, []);
});

test('explicit session APIs need identity but no feature grant and continue renewing Procore sessions', async () => {
  for (const [path, method] of [
    ['/api/permissions/me', 'GET'], ['/api/weather', 'GET'],
    ['/api/time-off', 'GET'], ['/api/time-off', 'POST'],
  ]) {
    for (const identity of ['auth0', 'procore']) {
      const app = harness({ identity });
      const response = await app.run(path, { method });
      assertPassed(response, `${identity} ${method} ${path}`);
      assert.equal(response.headers.get('x-ratelimit-limit'), '300');
      assert.deepEqual(app.calls.permissionChecks, []);
      if (identity === 'procore') {
        assert.equal(app.calls.appSessions, 1);
        assert.equal(app.calls.authReads, 0);
        assert.match(response.headers.get('set-cookie'), /procore_access_token=renewed-test-token/);
      } else {
        assert.equal(app.calls.rolls, 1);
      }
    }
    assert.equal((await harness({ identity: 'anonymous' }).run(path, { method })).status, 401, path);
  }
});

test('session exceptions cannot authorize adjacent endpoints or administrative methods', async () => {
  const app = harness();
  for (const [path, method] of [
    ['/api/permissions/me', 'POST'], ['/api/permissions/me-other', 'GET'],
    ['/api/permissions/me/child', 'GET'], ['/api/weather', 'POST'],
    ['/api/weather/child', 'GET'], ['/api/weather-other', 'GET'],
    ['/api/time-off', 'DELETE'], ['/api/time-off', 'PUT'],
    ['/api/time-off/child', 'POST'], ['/api/time-off-other', 'POST'],
  ]) assert.equal((await app.run(path, { method })).status, 403, `${method} ${path}`);
  const manager = harness({ cachedPermissions: ['employees'] });
  assertPassed(await manager.run('/api/time-off', { method: 'DELETE' }));
});

test('session-only browser writes retain CSRF and API rate limits', async () => {
  for (const badOrigin of ['', 'https://other.example.test']) {
    const app = harness();
    assert.equal((await app.run('/api/time-off', { method: 'POST', headers: { origin: badOrigin } })).status, 403);
    assert.equal(app.calls.authReads, 0);
  }
  const limited = harness({ rateLimited: true });
  const response = await limited.run('/api/permissions/me');
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
});

test('public and authentication exceptions accept only their declared paths and methods', async () => {
  const app = harness({ identity: 'anonymous' });
  for (const [path, method] of [
    ['/api/public/version', 'GET'], ['/api/auth/login', 'GET'],
    ['/api/auth/callback', 'GET'], ['/api/auth/procore/login', 'GET'],
    ['/api/auth/procore/callback', 'GET'], ['/api/auth/me', 'GET'],
    ['/api/auth/session', 'POST'], ['/api/auth/logout', 'POST'],
  ]) assertPassed(await app.run(path, { method }), `${method} ${path}`);
  for (const [path, method] of [
    ['/api/public/version', 'POST'], ['/api/public/version/child', 'GET'],
    ['/api/auth/login', 'POST'], ['/api/auth/callback', 'DELETE'],
    ['/api/auth/procore/callback/child', 'GET'], ['/api/auth/me-other', 'GET'],
    ['/api/auth/session', 'GET'], ['/api/auth/logout/child', 'POST'],
  ]) assert.equal((await app.run(path, { method })).status, 403, `${method} ${path}`);
});

test('route-authenticated cron, webhook, and internal handlers retain only exact middleware exceptions', async () => {
  const app = harness({ identity: 'anonymous' });
  for (const [path, method] of [
    ['/api/cron/sync', 'POST'], ['/api/cron/sync/health', 'GET'],
    ['/api/cron/calendar-sync', 'POST'], ['/api/webhooks/procore', 'POST'],
    ['/api/internal/permission-check', 'POST'], ['/api/internal/scope-diagnostics', 'GET'],
  ]) assertPassed(await app.run(path, { method }), `${method} ${path}`);
  for (const [path, method] of [
    ['/api/cron/sync', 'GET'], ['/api/cron/sync/new-child', 'POST'],
    ['/api/cron/calendar-sync/child', 'POST'], ['/api/webhooks/procore', 'GET'],
    ['/api/webhooks/procore/child', 'POST'], ['/api/internal/permission-check', 'GET'],
    ['/api/internal/scope-diagnostics/child', 'GET'],
  ]) assert.equal((await app.run(path, { method })).status, 403, `${method} ${path}`);
});

test('known server workers still require their sync secret before bypassing a browser session', async () => {
  for (const path of ['/api/background/project-reconciliation', '/api/webhooks/procore/process',
    '/api/procore/daily-activity/clone', '/api/procore/sync/all-projects']) {
    const worker = harness({ identity: 'anonymous' });
    assertPassed(await worker.run(path, { method: 'POST', headers: { 'x-sync-secret': 'test-worker-secret' } }), path);
    for (const secret of ['', 'wrong-test-secret']) {
      const response = await worker.run(path, { method: 'POST', headers: { 'x-sync-secret': secret } });
      assert.equal(response.status, 401, path);
    }
  }
  const unknown = harness({ identity: 'anonymous' });
  assert.equal((await unknown.run('/api/background/project-reconciliation/child', {
    method: 'POST', headers: { 'x-sync-secret': 'test-worker-secret' },
  })).status, 403);
});

test('signed Commitment Maker access remains limited to its exact project endpoint', async () => {
  const app = harness({ identity: 'anonymous', signedMaker: true });
  const headers = { 'x-commitment-maker-project': 'test-project', 'x-commitment-maker-access': 'signed-test-token' };
  assertPassed(await app.run('/api/procore/commitments-live/maker', { headers }));
  assert.equal((await app.run('/api/procore/commitments-live/maker/child', { headers })).status, 401);
  assert.equal((await app.run('/api/procore/commitments-live/maker', {
    headers: { ...headers, 'x-commitment-maker-project': 'other-project' },
  })).status, 401);
});

test('legacy Procore read links cannot authorize new productivity descendants or writes', async () => {
  const app = harness({ identity: 'anonymous' });
  const headers = { cookie: 'analytics_procore_link_access=1' };
  for (const path of ['/api/analytics/commitment-productivity',
    '/api/analytics/commitment-productivity/logs', '/api/analytics/commitment-productivity/readiness',
    '/api/analytics/commitment-productivity/timecards']) {
    assertPassed(await app.run(path, { headers }), path);
  }
  for (const path of ['/api/analytics/commitment-productivity/new-private-report',
    '/api/analytics/commitment-productivity/logs/private', '/api/analytics/commitment-productivity/reviews']) {
    assert.equal((await app.run(path, { headers })).status, 401, path);
  }
  assert.equal((await app.run('/api/analytics/commitment-productivity', { method: 'POST', headers })).status, 401);
  assert.equal((await harness({ identity: 'procore' }).run('/api/analytics/commitment-productivity', { headers })).status, 401);
});

test('a worker policy declaration alone never grants browser access without its secret', async () => {
  for (const identity of ['auth0', 'procore']) {
    const app = harness({ identity, databaseAllowed: true, cachedPermissions: ['admin'] });
    const response = await app.run('/api/background/project-reconciliation', { method: 'POST' });
    assert.equal(response.status, 403, identity);
    assert.deepEqual(app.calls.permissionChecks, []);
  }
});
