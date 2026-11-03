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
import * as permissions from '../src/lib/permissions.ts';
import { canAccessNavigationLink } from '../src/lib/navigationPermissions.ts';
import { canAccessHelpGuide, getHelpGuideSummaryForPath } from '../src/lib/helpGuides/catalog.ts';

function load(path, imports, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${code}})(require,module,module.exports)`, {
    module, Date, URL, console, AbortSignal, process: { env: { NODE_ENV: 'production', PROCORE_COMPANY_ID: 'company', AUTH0_DOMAIN: 'example.auth0.com', AUTH0_CLIENT_ID: 'test', AUTH0_SECRET: 'test' } }, ...globals,
    require: id => { assert.ok(id in imports, id); return imports[id]; },
  });
  return module.exports;
}
const request = (path, cookie = '') => new NextRequest(`https://example.com${path}`, { headers: { cookie } });
const cases = [
  [null, ['billing-analytics'], false],
  ['other@pmcdecor.com', ['billing-analytics'], true],
  ['other@pmcdecor.com', ['analytics'], false],
  ['other@pmcdecor.com', ['ADMIN'], false],
  ['other@pmcdecor.com', ['OWNER'], false],
  ['todd@pmcdecor.com', ['analytics'], false],
  ['todd@pmcdecor.com', ['OWNER', 'billing-analytics'], true],
  ['shelly@pmcdecor.com', ['billing-analytics'], true],
  ['david@pmcdecor.com', ['billing-analytics'], true],
  ['other@pmcdecor.com', [], false],
];

function databaseFor(email, assigned, active = true) {
  return { $queryRaw: async (query, requestedEmail) => {
    assert.match(query.join('?'), /"isActive" = true/);
    assert.equal(requestedEmail, email?.toLowerCase());
    return active ? [{ email, permissions: assigned }] : [];
  } };
}

test('API enforces identity and active database permission before reading report; dates validate and responses are no-store', async () => {
  for (const [email, assigned, allowed] of cases) {
  for (const active of [false, true]) {
    const expected = !email ? 401 : allowed && active ? 200 : 403;
    let reads = 0;
    const { GET } = load('src/app/api/accounting/billing-analytics/route.ts', {
      'next/server': { NextRequest, NextResponse }, '@/lib/requestUser': { getRequestUserEmail: async () => email },
      '@/lib/subcontractAllocationAccess': subcontractAccess,
      '@/lib/permissions': permissions, '@/lib/prisma': { prisma: databaseFor(email, assigned, active) },
      '@/lib/billingAnalytics': domain, '@/lib/loadBillingAnalytics': { loadBillingAnalytics: async company => { assert.equal(company, 'company'); reads++; return { rows: [] }; } },
    });
    const response = await GET(request('/api/accounting/billing-analytics?from=2026-01&through=2026-10&companyId=untrusted'));
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(reads, expected === 200 ? 1 : 0);
    if (expected === 200) assert.equal((await GET(request('/api/accounting/billing-analytics?from=invalid'))).status, 400);
  }
  }
});

test('middleware requires the separate grant for any account and blocks Analytics/link-cookie bypasses', async () => {
  for (const procoreMode of [false, true]) {
  for (const [email, assigned, allowed] of cases) {
    const apiStatus = !email ? 401 : allowed ? 200 : 403;
    const pageStatus = allowed ? 200 : 307;
    const { middleware } = load('middleware.ts', {
      'next/server': { NextRequest, NextResponse }, '@/lib/auth0': { auth0: { getSession: async () => email ? { user: { email } } : null, middleware: async () => NextResponse.next() } },
      '@/lib/appSignInPolicy': { APP_SESSION_COOKIE: 'app_session', procoreSignInEnabled: () => procoreMode, emailSignInEnabled: () => !procoreMode },
      '@/lib/procoreUserSession': {},
      '@/lib/subcontractAllocationAccess': subcontractAccess,
      '@/lib/billingAnalyticsAccess': access, '@/lib/developerIdentity': developer, '@/lib/permissionRoutes': routes,
      '@/lib/permissionCookie': { PERMISSION_COOKIE_NAME: 'analytics_permissions', verifyPermissionCookieValue: async () => ({ permissions: ['analytics'] }) },
      '@/lib/rateLimit': { getClientIdentifier: () => 'test', checkRateLimit: () => ({ limited: false, limit: 300, remaining: 299, resetAt: Date.now() + 60000 }) },
      '@/lib/csrfProtection': { validateCsrfRequest: () => ({ allowed: true }) }, '@/lib/procoreLiveApiRoutes': { isProcoreLiveApiRoutePath: () => false }, '@/lib/commitmentMakerAccess': {},
      '@/lib/diagnosticsGate': { shouldBlockDiagnosticsInProduction: () => false, matchesDiagnosticsOrTestRoute: () => false },
    }, { fetch: async (url, options) => {
      if (url.pathname === '/api/auth/session') return NextResponse.json(email ? { user: { email } } : { error: 'Unauthenticated' }, { status: email ? 200 : 401 });
      const required = JSON.parse(options.body).permissions;
      assert.deepEqual(required, ['billing-analytics']);
      return NextResponse.json({ allowed: required.some(permission => permissions.expandAssignedPermissions(assigned).includes(permission)) });
    } });
    for (const [path, status] of [['/api/accounting/billing-analytics', apiStatus], ['/accounting/billing-analytics', pageStatus], ['/help/billing-analytics', pageStatus]]) {
      assert.equal((await middleware(request(`${path}?source=procore`, `analytics_procore_link_access=1; dev_user_email=todd@pmcdecor.com${procoreMode ? '; app_session=test' : ''}`))).status, status);
    }
  }
  }
});

test('server page rechecks active database grants independently of middleware', async () => {
  for (const [email, assigned, allowed] of cases) {
    const notFound = new Error('not found');
    const { default: Page } = load('src/app/accounting/billing-analytics/page.tsx', {
      'react/jsx-runtime': { jsx: (component, props) => ({ component, props }) },
      'next/navigation': { notFound: () => { throw notFound; } },
      '@/lib/billingAnalyticsSession': { getBillingAnalyticsEmail: async () => email },
      '@/lib/permissions': permissions, '@/lib/prisma': { prisma: databaseFor(email, assigned) },
      './BillingAnalytics': { default: 'BillingAnalytics' },
    });
    if (allowed) assert.ok((await Page()).props.initialMonth);
    else await assert.rejects(Page(), error => error === notFound);
  }
});

test('navigation, help and employee access choices use Billing Analytics without an Analytics fallback', () => {
  const source = fs.readFileSync('src/components/Navigation.tsx', 'utf8');
  const entry = source.match(/\{ href: "\/accounting\/billing-analytics"[^\n]+/)[0];
  assert.doesNotMatch(entry, /fallbackPage/);
  assert.match(entry, /page: "billing-analytics"/);
  assert.ok(permissions.NAVIGATION_PERMISSION_OPTIONS.includes('billing-analytics'));
  assert.match(fs.readFileSync('src/app/employees/page.tsx', 'utf8'), /'billing-analytics': 'Billing Analytics'/);
  const guide = getHelpGuideSummaryForPath('/accounting/billing-analytics');
  for (const [email, assigned, allowed] of cases.filter(([email]) => email)) {
    const expanded = permissions.expandAssignedPermissions(assigned);
    assert.equal(canAccessNavigationLink({ href: '/accounting/billing-analytics', page: 'billing-analytics' }, {
      email, permissions: expanded, loaded: true, failed: false,
    }), allowed);
    assert.equal(canAccessHelpGuide(expanded, guide), allowed);
  }
});
