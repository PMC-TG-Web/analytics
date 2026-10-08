import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server.js';
import * as permissionRoutes from '../src/lib/permissionRoutes.js';
import * as csrf from '../src/lib/csrfProtection.ts';
import * as developerIdentity from '../src/lib/developerIdentity.ts';

function harness({ signedIn = true, environment = 'production', host = 'localhost:3000' } = {}) {
  const checks = [];
  const imports = {
    'next/server': { NextRequest, NextResponse },
    '@/lib/auth0': { auth0: { getSession: async () => signedIn ? { user: { email: 'limited@example.test' } } : null,
      middleware: async () => NextResponse.next() } },
    '@/lib/appSignInPolicy': { procoreSignInEnabled: () => false, emailSignInEnabled: () => true },
    '@/lib/permissionRoutes': permissionRoutes,
    '@/lib/developerIdentity': {
      getDeveloperEmail: request => developerIdentity.getDeveloperEmail(request, environment),
      isLocalDeveloperRequest: request => developerIdentity.isLocalDeveloperRequest(request, environment),
    },
    '@/lib/permissionCookie': { PERMISSION_COOKIE_NAME: 'analytics_permissions', verifyPermissionCookieValue: async () => null },
    '@/lib/procoreUserSession': {},
    '@/lib/csrfProtection': csrf,
    '@/lib/rateLimit': {
      getClientIdentifier: () => 'weather-test',
      checkRateLimit: () => ({ limited: false, limit: 300, remaining: 299, resetAt: Date.now() + 60000 }),
    },
    '@/lib/diagnosticsGate': {
      matchesDiagnosticsOrTestRoute: () => false, shouldBlockDiagnosticsInProduction: () => true,
    },
    '@/lib/procoreLiveApiRoutes': { isProcoreLiveApiRoutePath: () => false },
    '@/lib/commitmentMakerAccess': {},
  };
  const code = ts.transpileModule(fs.readFileSync('middleware.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${code}})(require,module,module.exports)`, {
    module, Date, URL, console,
    process: { env: { NODE_ENV: environment, AUTH0_DOMAIN: 'example.auth0.com', AUTH0_CLIENT_ID: 'test-client', AUTH0_SECRET: 'test-secret' } },
    require: id => { assert.ok(id in imports, id); return imports[id]; },
    fetch: async (_url, options) => {
      checks.push(JSON.parse(options.body).permissions);
      return NextResponse.json({ allowed: false });
    },
  });
  return {
    checks,
    run: (path, options = {}) => module.exports.middleware(new NextRequest(`http://${host}${path}`, options)),
  };
}

test('signed-in users without Home permission can load the landing page and its forecast', async () => {
  for (const environment of ['production', 'development']) {
    const app = harness({ environment });
    for (const path of ['/', '/api/weather', '/api/weather?lat=40&lon=-76']) {
      const response = await app.run(path);
      assert.equal(response.headers.get('x-middleware-next'), '1', path);
      if (path.startsWith('/api/')) assert.equal(response.headers.get('X-RateLimit-Limit'), '300');
    }
    assert.equal(app.checks.length, 0);
  }
});

test('unverified developer cookies cannot authenticate production or non-loopback hosts', async () => {
  for (const options of [{ environment: 'production' }, { environment: 'development', host: 'example.com' }]) {
    const app = harness({ signedIn: false, ...options });
    for (const cookie of ['', 'dev_user_email=limited@example.test']) {
      assert.equal((await app.run('/api/weather', { headers: { cookie } })).status, 401);
    }
    assert.equal(app.checks.length, 0);
  }
});

test('local developer picker works without Auth0 but selected users still need page permissions', async () => {
  const app = harness({ signedIn: false, environment: 'development' });
  assert.equal((await app.run('/dev-login')).headers.get('x-middleware-next'), '1');
  assert.equal((await app.run('/api/weather')).status, 401);
  const headers = { cookie: 'dev_user_email=limited@example.test' };
  assert.equal((await app.run('/api/weather', { headers })).headers.get('x-middleware-next'), '1');
  assert.equal((await app.run('/api/kpi', { headers })).status, 403);
  assert.deepEqual(app.checks, [['kpi']]);
  assert.equal((await app.run('/dev-login/admin', { headers })).status, 307);
});

test('forecast exception cannot authorize home data, adjacent paths, or writes', async () => {
  const app = harness();
  for (const path of ['/api/home-snapshot', '/api/weather/admin']) {
    assert.equal((await app.run(path)).status, 403);
  }
  assert.equal((await app.run('/api/weather', {
    method: 'POST', headers: { origin: 'http://localhost:3000' },
  })).status, 403);
  assert.deepEqual(app.checks, [['home'], ['home'], ['home']]);
});
