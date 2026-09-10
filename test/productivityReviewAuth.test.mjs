import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server.js';
import * as permissionRoutes from '../src/lib/permissionRoutes.js';
import * as csrf from '../src/lib/csrfProtection.ts';
import * as cooldown from '../src/lib/productivityReviewCooldown.ts';

const reviewPath = '/api/analytics/commitment-productivity/reviews';
const env = {
  NODE_ENV: 'production', AUTH0_DOMAIN: 'example.auth0.com',
  AUTH0_CLIENT_ID: 'test-client', AUTH0_SECRET: 'test-only-secret',
};

function load(path, imports = {}, globals = {}) {
  const output = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}})(require,module,module.exports)`, {
    module, Date, URL, console, crypto, btoa, atob, TextEncoder, TextDecoder,
    process: { env }, ...globals,
    require: (id) => { if (!(id in imports)) throw Error(id); return imports[id]; },
  });
  return module.exports;
}

const sessions = load('src/lib/procoreUserSession.ts');
const permissions = load('src/lib/permissionCookie.ts');

function harness({ auth0Email = null, databaseAllowed = true } = {}) {
  const permissionChecks = [];
  const auth0 = { getSession: async () => auth0Email ? { user: { email: auth0Email } } : null };
  const imports = {
    'next/server': { NextRequest, NextResponse },
    '@/lib/auth0': { auth0 },
    '@/lib/permissionRoutes': permissionRoutes,
    '@/lib/permissionCookie': permissions,
    '@/lib/procoreUserSession': sessions,
    '@/lib/csrfProtection': csrf,
    '@/lib/rateLimit': {
      getClientIdentifier: () => 'test',
      checkRateLimit: () => ({ limited: false, limit: 300, remaining: 299, resetAt: Date.now() + 60000 }),
    },
    '@/lib/diagnosticsGate': {
      matchesDiagnosticsOrTestRoute: () => false, shouldBlockDiagnosticsInProduction: () => true,
    },
    '@/lib/procoreLiveApiRoutes': { isProcoreLiveApiRoutePath: () => false },
    '@/lib/commitmentMakerAccess': {},
  };
  const { middleware } = load('middleware.ts', imports, {
    fetch: async (url, options) => {
      assert.equal(url.pathname, '/api/internal/permission-check');
      permissionChecks.push(JSON.parse(options.body).permissions);
      assert.ok(options.headers.Cookie);
      return NextResponse.json({ allowed: databaseAllowed });
    },
  });
  const requestUser = load('src/lib/requestUser.ts', imports);
  return { middleware, requestUser, permissionChecks };
}

function request({ method = 'POST', path = reviewPath, cookie = '', origin = 'https://example.com', body } = {}) {
  return new NextRequest(`https://example.com${path}`, {
    method, headers: { cookie, origin, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function userCookie(email = 'abner@example.com') {
  return `${sessions.PROCORE_USER_SESSION_COOKIE}=${await sessions.createProcoreUserSessionCookieValue(email)}`;
}

test('Procore-only reviewers can complete and undo reviews with analytics permission', async () => {
  const cookie = await userCookie();
  for (const method of ['POST', 'DELETE']) {
    const app = harness();
    const req = request({ method, cookie });
    const response = await app.middleware(req);
    assert.equal(response.headers.get('x-middleware-next'), '1');
    assert.equal(response.headers.get('X-RateLimit-Limit'), '300');
    assert.deepEqual(app.permissionChecks, [['analytics']]);
    assert.equal(await app.requestUser.getRequestUserEmail(req), 'abner@example.com');
  }
});

test('review writes reject link-only, token-only, missing, tampered, and expired identities', async () => {
  const expiredSessions = load('src/lib/procoreUserSession.ts', {}, {
    Date: class extends Date { static now() { return Date.now() - 3600000; } },
  });
  const expired = await expiredSessions.createProcoreUserSessionCookieValue('abner@example.com', 1);
  for (const cookie of [
    '', 'analytics_procore_link_access=1', 'procore_access_token=unverified',
    `${sessions.PROCORE_USER_SESSION_COOKIE}=tampered.signature`,
    `${sessions.PROCORE_USER_SESSION_COOKIE}=${expired}`,
  ]) {
    for (const method of ['POST', 'DELETE']) {
      const app = harness();
      assert.equal((await app.middleware(request({ method, cookie }))).status, 401);
      assert.equal(app.permissionChecks.length, 0);
    }
  }
});

test('review writes still enforce permissions and reject cross-origin requests', async () => {
  const cookie = await userCookie();
  const denied = harness({ databaseAllowed: false });
  assert.equal((await denied.middleware(request({ cookie }))).status, 403);
  assert.deepEqual(denied.permissionChecks, [['analytics']]);
  const app = harness();
  const response = await app.middleware(request({ cookie, origin: 'https://other.example' }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'Invalid request origin');
  assert.equal(app.permissionChecks.length, 0);
});

test('permission cache is bound to the verified reviewer and Auth0 retains precedence', async () => {
  const signedUser = await userCookie();
  const cached = await permissions.createPermissionCookieValue('abner@example.com', ['analytics']);
  const otherUser = await permissions.createPermissionCookieValue('other@example.com', ['analytics']);
  const app = harness({ databaseAllowed: false });
  assert.equal((await app.middleware(request({
    cookie: `${signedUser}; ${permissions.PERMISSION_COOKIE_NAME}=${cached}`,
  }))).headers.get('x-middleware-next'), '1');
  assert.equal(app.permissionChecks.length, 0);
  assert.equal((await app.middleware(request({
    cookie: `${signedUser}; ${permissions.PERMISSION_COOKIE_NAME}=${otherUser}`,
  }))).status, 403);
  const auth0App = harness({ auth0Email: 'auth0@example.com' });
  const req = request({ cookie: signedUser });
  assert.equal((await auth0App.middleware(req)).headers.get('x-middleware-next'), '1');
  assert.equal(await auth0App.requestUser.getRequestUserEmail(req), 'auth0@example.com');
});

test('Procore identity exception does not grant unrelated writes; PM dashboard GET still works', async () => {
  const cookie = await userCookie();
  const app = harness();
  for (const path of ['/api/analytics/commitment-productivity', '/api/pm-dashboard', `${reviewPath}/other`]) {
    assert.equal((await app.middleware(request({ path, cookie }))).status, 401);
  }
  assert.equal((await app.middleware(request({ method: 'PATCH', cookie }))).status, 401);
  assert.equal((await app.middleware(request({ path: '/api/pm-dashboard', method: 'GET', cookie })))
    .headers.get('x-middleware-next'), '1');
  assert.deepEqual(app.permissionChecks, [['pm-dashboard']]);
});

test('completed review stores the verified reviewer instead of a client-supplied email', async () => {
  const app = harness();
  const date = new Date('2026-01-01T00:00:00Z');
  let saved;
  const existing = {
    id: 'review', projectId: 'project', status: 'open', bidBoardStatus: 'Complete',
    reviewEligibleAt: date, updatedAt: date, notificationStatus: 'not_sent',
    weightedCompletion: null,
  };
  const { POST } = load('src/app/api/analytics/commitment-productivity/reviews/route.ts', {
    'next/server': { NextRequest, NextResponse },
    '@prisma/client': { Prisma: { JsonNull: null } },
    '@/lib/requestUser': app.requestUser,
    '@/lib/productivityReviewCooldown': cooldown,
    '@/lib/prisma': { prisma: {
      pmcProject: { findUnique: async () => ({ projectName: 'Project', projectNumber: '1' }) },
      productivityProjectReview: {
        findUnique: async () => existing,
        updateMany: async ({ data }) => { saved = data; return { count: 1 }; },
        findUniqueOrThrow: async () => ({ ...existing, ...saved }),
      },
    } },
  });
  const req = request({ cookie: await userCookie(), body: {
    companyId: 'company', projectId: 'project', reviewedByEmail: 'spoofed@example.com',
  } });
  assert.equal((await app.middleware(req)).headers.get('x-middleware-next'), '1');
  const response = await POST(req);
  assert.equal(response.status, 200);
  assert.equal(saved.reviewedByEmail, 'abner@example.com');
  assert.equal(saved.notificationStatus, 'queued');
});
