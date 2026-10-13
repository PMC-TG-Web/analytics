import * as subcontractAccess from '../src/lib/subcontractAllocationAccess.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server.js';
import * as access from '../src/lib/billingAnalyticsAccess.ts';
import * as domain from '../src/lib/billingAnalytics.ts';
import * as routes from '../src/lib/permissionRoutes.js';
import * as developer from '../src/lib/developerIdentity.ts';

function load(path, imports, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${code}})(require,module,module.exports)`, {
    module, Date, URL, console, AbortSignal, process: { env: { NODE_ENV: 'production', PROCORE_COMPANY_ID: 'company', AUTH0_DOMAIN: 'example.auth0.com', AUTH0_CLIENT_ID: 'test', AUTH0_SECRET: 'test' } }, ...globals,
    require: id => { assert.ok(id in imports, id); return imports[id]; },
  });
  return module.exports;
}
const request = (path, cookie = '') => new NextRequest(`https://example.com${path}`, { headers: { cookie } });

test('API enforces identity and active database permission before reading report; dates validate and responses are no-store', async () => {
  for (const [email, allowed, expected] of [[null, true, 401], ['other@pmcdecor.com', true, 403], ['todd@pmcdecor.com', false, 403], ['todd@pmcdecor.com', true, 200], ['shelly@pmcdecor.com', true, 200], ['david@pmcdecor.com', true, 200]]) {
    let reads = 0;
    const { GET } = load('src/app/api/accounting/billing-analytics/route.ts', {
      'next/server': { NextRequest, NextResponse }, '@/lib/requestUser': { getRequestUserEmail: async () => email },
      '@/lib/subcontractAllocationAccess': subcontractAccess,
      '@/lib/billingAnalyticsAccess': access, '@/lib/permissions': { hasDatabasePageAccess: async () => allowed }, '@/lib/prisma': { prisma: {} },
      '@/lib/billingAnalytics': domain, '@/lib/loadBillingAnalytics': { loadBillingAnalytics: async company => { assert.equal(company, 'company'); reads++; return { rows: [] }; } },
    });
    const response = await GET(request('/api/accounting/billing-analytics?from=2026-01&through=2026-10&companyId=untrusted'));
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(reads, expected === 200 ? 1 : 0);
    if (expected === 200) assert.equal((await GET(request('/api/accounting/billing-analytics?from=invalid'))).status, 400);
  }
});

test('middleware blocks broad-role and link-cookie bypasses and admits only permitted pilot accounts', async () => {
  for (const procoreMode of [false, true]) {
  for (const [email, allowed, apiStatus, pageStatus] of [[null, true, 401, 307], ['other@pmcdecor.com', true, 403, 307], ['todd@pmcdecor.com', false, 403, 307], ['todd@pmcdecor.com', true, 200, 200], ['shelly@pmcdecor.com', true, 200, 200], ['david@pmcdecor.com', true, 200, 200]]) {
    const { middleware } = load('middleware.ts', {
      'next/server': { NextRequest, NextResponse }, '@/lib/auth0': { auth0: { getSession: async () => email ? { user: { email } } : null, middleware: async () => NextResponse.next() } },
      '@/lib/appSignInPolicy': { APP_SESSION_COOKIE: 'app_session', procoreSignInEnabled: () => procoreMode, emailSignInEnabled: () => !procoreMode },
      '@/lib/procoreUserSession': {},
      '@/lib/subcontractAllocationAccess': subcontractAccess,
      '@/lib/billingAnalyticsAccess': access, '@/lib/developerIdentity': developer, '@/lib/permissionRoutes': routes,
      '@/lib/permissionCookie': { PERMISSION_COOKIE_NAME: 'analytics_permissions', verifyPermissionCookieValue: async () => null },
      '@/lib/rateLimit': { getClientIdentifier: () => 'test', checkRateLimit: () => ({ limited: false, limit: 300, remaining: 299, resetAt: Date.now() + 60000 }) },
      '@/lib/csrfProtection': { validateCsrfRequest: () => ({ allowed: true }) }, '@/lib/procoreLiveApiRoutes': { isProcoreLiveApiRoutePath: () => false }, '@/lib/commitmentMakerAccess': {},
      '@/lib/diagnosticsGate': { shouldBlockDiagnosticsInProduction: () => false, matchesDiagnosticsOrTestRoute: () => false },
    }, { fetch: async url => url.pathname === '/api/auth/session'
      ? NextResponse.json(email ? { user: { email } } : { error: 'Unauthenticated' }, { status: email ? 200 : 401 })
      : NextResponse.json({ allowed }) });
    for (const [path, status] of [['/api/accounting/billing-analytics', apiStatus], ['/accounting/billing-analytics', pageStatus]]) {
      assert.equal((await middleware(request(`${path}?source=procore`, `analytics_procore_link_access=1; dev_user_email=todd@pmcdecor.com${procoreMode ? '; app_session=test' : ''}`))).status, status);
    }
  }
  }
});
