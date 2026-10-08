import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server.js';
import * as policy from '../src/lib/appSignInPolicy.ts';
import * as logout from '../src/lib/localLogoutCookies.ts';

function fixture({ denied = false } = {}) {
  const calls = { exchanges: 0, created: 0, revoked: [] };
  const imports = {
    'node:crypto': crypto, 'next/server': { NextRequest, NextResponse },
    '@/lib/appSignInPolicy': policy, '@/lib/localLogoutCookies': logout,
    '@/lib/appSession': { appSessions: {
      create: async () => {
        if (denied) throw new Error('PROCORE_APP_ACCESS_DENIED');
        calls.created++;
        return { token: 'new-opaque-session', session: { absoluteExpiresAt: new Date(Date.now() + 86400_000),
          accessExpiresAt: new Date(Date.now() + 5400_000), companyId: 'company-1' } };
      },
      revoke: async (token) => calls.revoked.push(token),
    } },
    '@/lib/procore': {
      getProcoreRedirectUri: (origin) => `${origin}/api/auth/procore/callback`,
      getAuthorizationUrl: (state, redirectUri) => `https://login.procore.com/oauth/authorize?${new URLSearchParams({ state, redirect_uri: redirectUri })}`,
      getProcoreSignInToken: async () => { calls.exchanges++; return { access_token: 'private-provider-token', refresh_token: 'private-refresh', expires_in: 5400 }; },
      getProcoreSignInIdentity: async () => ({ id: '123', email: 'operator@example.test', name: 'Operator', companyIds: ['company-1'] }),
    },
  };
  const code = ts.transpileModule(fs.readFileSync('src/lib/procoreAppOAuth.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${code}})(require,module,module.exports)`, {
    module, Date, URL, Buffer, Error, console,
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
});

test('an unapproved account returns a useful error without establishing a session', async () => {
  const f = fixture({ denied: true }); const { transaction } = start(f);
  const response = await f.finishProcoreAppLogin(new NextRequest(`https://app.example.test/api/auth/procore/callback?code=test&state=${transaction.state}`, {
    headers: { cookie: `analytics_procore_oauth=${encodeURIComponent(JSON.stringify(transaction))}` },
  }));
  assert.match(new URL(response.headers.get('location')).searchParams.get('error'), /does not have access/);
  assert.equal(response.cookies.get('analytics_app_session'), undefined);
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
