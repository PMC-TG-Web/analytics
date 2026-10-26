import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server.js';
import * as policy from '../src/lib/appSignInPolicy.ts';
import * as logout from '../src/lib/localLogoutCookies.ts';

function fixture({ denied = false, failures = {} } = {}) {
  const calls = { exchanges: 0, identities: 0, created: 0, revoked: [], diagnostics: [] };
  const imports = {
    'node:crypto': crypto, 'next/server': { NextRequest, NextResponse },
    '@/lib/appSignInPolicy': policy, '@/lib/localLogoutCookies': logout,
    '@/lib/appSession': { appSessions: {
      create: async () => {
        if (denied) throw new Error('PROCORE_APP_ACCESS_DENIED');
        if (failures.session) throw failures.session;
        calls.created++;
        return { token: 'new-opaque-session', session: { absoluteExpiresAt: new Date(Date.now() + 86400_000),
          accessExpiresAt: new Date(Date.now() + 5400_000), companyId: 'company-1' } };
      },
      revoke: async (token) => { calls.revoked.push(token); if (failures.revoke) throw failures.revoke; },
    } },
    '@/lib/procore': {
      getProcoreRedirectUri: (origin) => `${origin}/api/auth/procore/callback`,
      getAuthorizationUrl: (state, redirectUri) => `https://login.procore.com/oauth/authorize?${new URLSearchParams({ state, redirect_uri: redirectUri })}`,
      getProcoreSignInToken: async () => {
        calls.exchanges++;
        if (failures.token) throw failures.token;
        return { access_token: 'private-provider-token', refresh_token: 'private-refresh', expires_in: 5400 };
      },
      getProcoreSignInIdentity: async () => {
        calls.identities++;
        if (failures.identity) throw failures.identity;
        return { id: '123', email: 'operator@example.test', name: 'Operator', companyIds: ['company-1'] };
      },
    },
  };
  const code = ts.transpileModule(fs.readFileSync('src/lib/procoreAppOAuth.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${code}})(require,module,module.exports)`, {
    module, Date, URL, Buffer, Error,
    console: { warn: (...args) => calls.diagnostics.push(args) },
    process: { env: { PROCORE_APP_SESSION_SECRET: 'test-secret-at-least-32-bytes-long-only',
      PROCORE_CLIENT_ID: 'test', PROCORE_CLIENT_SECRET: 'test-only', PROCORE_COMPANY_ID: 'company-1' } },
    require: (id) => { assert.ok(id in imports, id); return imports[id]; },
  });
  return { ...module.exports, calls };
}

function start(f, returnTo = '/kpi?year=2026') {
  const response = f.startProcoreAppLogin(new NextRequest(`https://app.example.test/api/auth/procore/login?returnTo=${encodeURIComponent(returnTo)}`));
  const cookie = response.cookies.get('analytics_procore_oauth');
  const transaction = JSON.parse(cookie.value);
  return { response, transaction, cookie };
}

function diagnostic(f, response, expected) {
  assert.equal(f.calls.diagnostics.length, 1);
  assert.equal(f.calls.diagnostics[0].length, 1, 'only a safe structured object is logged');
  const logged = JSON.parse(JSON.stringify(f.calls.diagnostics[0][0]));
  assert.match(logged.reference, /^[a-f0-9]{16}$/);
  assert.deepEqual(logged, { event: 'procore_sign_in_failed', reference: logged.reference, ...expected });
  const redirect = new URL(response.headers.get('location'));
  assert.equal(redirect.pathname, '/login');
  assert.ok(redirect.searchParams.get('error').endsWith(`Reference: ${logged.reference}.`));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.cookies.get('analytics_procore_oauth').value, '');
  assert.equal(response.cookies.get('analytics_app_session'), undefined);
  return logged;
}

async function complete(f, query = 'code=private-code', returnTo = '/kpi?year=2026') {
  const { transaction } = start(f, returnTo);
  const response = await f.finishProcoreAppLogin(new NextRequest(`https://app.example.test/api/auth/procore/callback?state=${transaction.state}&${query}`, {
    headers: { cookie: `analytics_procore_oauth=${encodeURIComponent(JSON.stringify(transaction))}; analytics_app_session=private-old-session` },
  }));
  return { response, transaction };
}

test('Procore launch uses a random, short-lived state and preserves safe deep links', () => {
  const f = fixture(); const a = start(f); const b = start(f);
  assert.match(a.response.headers.get('location'), /^https:\/\/login.procore.com\/oauth\/authorize/);
  assert.notEqual(a.transaction.state, b.transaction.state);
  assert.equal(a.transaction.returnTo, '/kpi?year=2026');
  assert.equal(a.cookie.httpOnly, true); assert.equal(a.cookie.secure, true); assert.equal(a.cookie.sameSite, 'lax');
  assert.equal(a.cookie.maxAge, 600);
  assert.equal(start(f, '//evil.test').transaction.returnTo, '/');
});

test('callback rejects missing, mismatched, expired or wrong-origin state before any exchange', async () => {
  for (const failure of ['missing', 'mismatch', 'expired', 'origin', 'state-type', 'expiry-type', 'missing-expiry']) {
    const f = fixture(); const { transaction } = start(f);
    if (failure === 'expired') transaction.expiresAt = Date.now() - 1;
    if (failure === 'origin') transaction.redirectUri = 'https://evil.test/callback';
    const state = failure === 'mismatch' ? 'x'.repeat(43) : transaction.state;
    if (failure === 'state-type') transaction.state = { length: 43 };
    if (failure === 'expiry-type') transaction.expiresAt = 'never';
    if (failure === 'missing-expiry') delete transaction.expiresAt;
    const response = await f.finishProcoreAppLogin(new NextRequest(`https://app.example.test/api/auth/procore/callback?code=test&state=${state}`, {
      headers: { cookie: failure === 'missing' ? '' : `analytics_procore_oauth=${encodeURIComponent(JSON.stringify(transaction))}` },
    }));
    assert.match(response.headers.get('location'), /\/login\?error=/);
    assert.equal(f.calls.exchanges, 0); assert.equal(f.calls.created, 0);
    diagnostic(f, response, { stage: 'state', reason: 'state_invalid' });
  }
});

test('callback establishes one app identity, replaces old account cookies, and keeps refresh credentials off the browser', async () => {
  const f = fixture(); const { transaction } = start(f);
  const response = await f.finishProcoreAppLogin(new NextRequest(`https://app.example.test/api/auth/procore/callback?code=test&state=${transaction.state}`, {
    headers: { cookie: `analytics_procore_oauth=${encodeURIComponent(JSON.stringify(transaction))}; analytics_app_session=old-session; __session__0=old-auth0; analytics_permissions=old-grants` },
  }));
  assert.equal(response.headers.get('location'), 'https://app.example.test/kpi?year=2026');
  assert.equal(f.calls.exchanges, 1); assert.equal(f.calls.created, 1);
  assert.deepEqual(f.calls.revoked, ['old-session']);
  assert.equal(response.cookies.get('analytics_app_session').value, 'new-opaque-session');
  assert.equal(response.cookies.get('analytics_app_session').httpOnly, true);
  assert.equal(response.cookies.get('__session__0').maxAge, 0);
  assert.equal(response.cookies.get('analytics_permissions').maxAge, 0);
  assert.ok(!response.headers.get('set-cookie').includes('private-refresh'));
  assert.ok(!response.headers.get('location').includes('private-provider-token'));
  assert.deepEqual(f.calls.diagnostics, []);
});

test('an unapproved account returns a useful error without establishing a session', async () => {
  const f = fixture({ denied: true }); const { transaction } = start(f);
  const response = await f.finishProcoreAppLogin(new NextRequest(`https://app.example.test/api/auth/procore/callback?code=test&state=${transaction.state}`, {
    headers: { cookie: `analytics_procore_oauth=${encodeURIComponent(JSON.stringify(transaction))}` },
  }));
  assert.match(new URL(response.headers.get('location')).searchParams.get('error'), /does not have access/);
  assert.equal(response.cookies.get('analytics_app_session'), undefined);
  diagnostic(f, response, { stage: 'session', reason: 'app_access_denied' });
});

for (const [stage, status] of [['token', 401], ['identity', 403], ['session', 500], ['revoke', 503]]) {
  test(`callback reports the ${stage} stage without logging error details or credentials`, async () => {
    const canary = 'CANARY-secret-person@example.test-provider-payload';
    const failure = Object.assign(new Error(canary, { cause: { token: canary } }), {
      status, payload: { authorization: canary }, email: canary, rateLimitUntil: canary,
    });
    const f = fixture({ failures: { [stage]: failure } });
    const { response, transaction } = await complete(f);
    diagnostic(f, response, { stage, reason: `${stage}_failed`, status });
    assert.equal(new URL(response.headers.get('location')).searchParams.get('returnTo'), '/kpi?year=2026');
    assert.match(new URL(response.headers.get('location')).searchParams.get('error'), /^Unable to complete Procore sign-in\. Please try again\./);
    const exposed = JSON.stringify([f.calls.diagnostics, [...response.headers]]);
    for (const secret of [canary, transaction.state, 'private-code', 'private-old-session', 'private-provider-token', 'private-refresh', 'operator@example.test']) {
      assert.equal(exposed.includes(secret), false, secret);
    }
    if (stage === 'token') assert.equal(f.calls.identities, 0);
    if (stage !== 'revoke') assert.equal(f.calls.created, 0);
  });
}

test('callback reports capacity failures with only a validated future retry time', async () => {
  const until = new Date('2099-01-01T12:30:00.000Z');
  const expectedUntil = until.toISOString();
  until.toISOString = () => 'CANARY-secret';
  until.getTime = () => { throw new Error('Untrusted date method must not run'); };
  for (const stage of ['token', 'identity']) {
    const f = fixture({ failures: { [stage]: Object.assign(new Error('private provider details'), { status: 429, rateLimitUntil: until }) } });
    const { response } = await complete(f);
    diagnostic(f, response, { stage, reason: 'rate_limited', status: 429, rateLimitUntil: expectedUntil });
    const message = new URL(response.headers.get('location')).searchParams.get('error');
    assert.match(message, /^Procore sign-in is temporarily busy\./);
    assert.ok(message.includes('Please try again after 7:30 AM EST.'));
    assert.equal(message.includes(expectedUntil), false, 'ISO diagnostics stay out of the user message');
    assert.equal(JSON.stringify([f.calls.diagnostics, [...response.headers]]).includes('CANARY-secret'), false);
    assert.equal(f.calls.created, 0);
  }
});

test('callback ignores malformed, non-Date and expired retry metadata', async () => {
  for (const rateLimitUntil of [new Date('invalid'), new Date('2000-01-01'), 'CANARY-secret', '2099-01-01T12:30:00.000Z', { toISOString: () => 'CANARY-secret' }]) {
    const f = fixture({ failures: { identity: Object.assign(new Error('CANARY-secret'), { status: 429, rateLimitUntil }) } });
    const { response } = await complete(f);
    diagnostic(f, response, { stage: 'identity', reason: 'rate_limited', status: 429 });
    assert.match(new URL(response.headers.get('location')).searchParams.get('error'), /Please try again shortly\./);
    assert.equal(JSON.stringify([f.calls.diagnostics, [...response.headers]]).includes('CANARY-secret'), false);
  }
});

test('callback ignores status metadata that is not an integer HTTP error', async () => {
  for (const status of ['429', 'CANARY-secret', NaN, Infinity, 429.5, 200, 600]) {
    const f = fixture({ failures: { identity: { status, message: 'CANARY-secret', cause: 'CANARY-secret' } } });
    const { response } = await complete(f);
    diagnostic(f, response, { stage: 'identity', reason: 'identity_failed' });
  }
});

test('missing authorization and provider denial get safe state diagnostics before any exchange', async () => {
  const references = new Set();
  for (const [query, reason] of [['', 'authorization_missing'], ['code=private-code&error=CANARY-secret&error_description=CANARY-secret', 'authorization_denied']]) {
    const f = fixture();
    const { response, transaction } = await complete(f, query);
    references.add(diagnostic(f, response, { stage: 'state', reason }).reference);
    assert.equal(f.calls.exchanges, 0);
    assert.equal(f.calls.identities, 0);
    assert.equal(f.calls.created, 0);
    assert.match(new URL(response.headers.get('location')).searchParams.get('error'), /^Procore sign-in was not completed\./);
    const exposed = JSON.stringify([f.calls.diagnostics, [...response.headers]]);
    assert.equal(exposed.includes('CANARY-secret'), false);
    assert.equal(exposed.includes(transaction.state), false);
  }
  assert.equal(references.size, 2);
});

test('the Procore button navigates to Procore OAuth, with a separate-tab handoff only when embedded', () => {
  const source = ts.createSourceFile('ProcoreLogin.tsx', fs.readFileSync('src/app/login/ProcoreLogin.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'signIn') handler = node; ts.forEachChild(node, visit); }
  visit(source); assert.ok(handler);
  const code = ts.transpileModule(`(${handler.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const framed of [false, true]) {
    const calls = [];
    const signIn = vm.runInNewContext(code, {
      framed, returnTo: '/kpi?year=2026', encodeURIComponent, timer: { current: null },
      sessionStorage: { removeItem() {} }, Date,
      setBusy() {}, setMessage() {}, setOpenInTab() {}, setInterval: () => 1,
      window: { location: { assign: (url) => calls.push(['navigate', url]) }, open: (url) => { calls.push(['tab', url]); return {}; } },
    });
    signIn('procore');
    assert.equal(calls[0][0], framed ? 'tab' : 'navigate');
    assert.match(calls[0][1], /^\/api\/auth\/procore\/login\?/);
    const returnTo = new URL(calls[0][1], 'https://app.example.test').searchParams.get('returnTo');
    assert.equal(returnTo, framed ? '/auth/complete?returnTo=%2Fkpi%3Fyear%3D2026' : '/kpi?year=2026');
  }
});
