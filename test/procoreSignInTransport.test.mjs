import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { AsyncLocalStorage } from 'node:async_hooks';
import ts from 'typescript';

function transport(fetcher) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync('src/lib/procore.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${code}})(require,module,module.exports)`, {
    module, URLSearchParams, URL, AbortSignal, Response, fetch: fetcher,
    process: { env: { PROCORE_CLIENT_ID: 'test-client', PROCORE_CLIENT_SECRET: 'test-only-secret',
      PROCORE_COMPANY_ID: 'company', APP_BASE_URL: 'https://app.example.test' } },
    require: id => id === 'node:async_hooks' ? { AsyncLocalStorage } : {},
  });
  return module.exports;
}

test('code exchange and rotating refresh send the configured callback, client credentials and a timeout', async () => {
  const requests = [];
  const api = transport(async (url, options) => {
    requests.push({ url, options, form: new URLSearchParams(options.body) });
    return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 5400 });
  });
  await api.getProcoreSignInToken('code', 'https://app.example.test/api/auth/procore/callback');
  await api.refreshProcoreSignInToken('rotating-refresh');
  assert.equal(requests.length, 2);
  for (const { url, options, form } of requests) {
    assert.equal(url, 'https://login.procore.com/oauth/token');
    assert.equal(options.method, 'POST');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(form.get('client_id'), 'test-client');
    assert.equal(form.get('client_secret'), 'test-only-secret');
    assert.equal(form.get('redirect_uri'), 'https://app.example.test/api/auth/procore/callback');
  }
  assert.equal(requests[0].form.get('grant_type'), 'authorization_code');
  assert.equal(requests[1].form.get('grant_type'), 'refresh_token');
  assert.equal(requests[1].form.get('refresh_token'), 'rotating-refresh');
});

test('failed or uncertain refresh is attempted once and does not expose provider response bodies', async () => {
  for (const status of [400, 401, 429, 500, 'network']) {
    let calls = 0;
    const api = transport(async () => {
      calls++;
      if (status === 'network') throw new Error('connection interrupted');
      return Response.json({ error: 'sensitive-provider-response' }, { status });
    });
    await assert.rejects(api.refreshProcoreSignInToken('rotating-refresh'), error => {
      assert.ok(!error.message.includes('sensitive-provider-response'));
      if (status !== 'network') assert.equal(error.status, status);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('browser storage denial does not crash sign-in or navigation effects', () => {
  for (const file of ['src/app/login/ProcoreLogin.tsx', 'src/components/Navigation.tsx']) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let effect;
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect'
        && node.arguments[0]?.getText(source).includes('new BroadcastChannel')) effect = node.arguments[0];
      ts.forEachChild(node, visit);
    }
    visit(source); assert.ok(effect, file);
    const listeners = new Set();
    const window = { location: { search: '', origin: 'https://app.example.test' },
      addEventListener: name => listeners.add(name), removeEventListener: name => listeners.delete(name), BroadcastChannel: true };
    window.self = window.top = window;
    const code = ts.transpileModule(`(${effect.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const run = vm.runInNewContext(code, { window, URLSearchParams, AbortSignal,
      setReturnTo() {}, setFramed() {}, setMessage() {}, safeAppReturnTo: () => '/',
      BroadcastChannel: class { constructor() { throw new Error('Storage denied'); } },
      fetch: async () => ({ ok: false }), timer: { current: null },
      AUTH_LOGOUT_SIGNAL_CHANNEL: 'logout', AUTH_LOGOUT_SIGNAL_KEY: 'logout',
    });
    const cleanup = run();
    assert.ok(listeners.has('storage'), file);
    cleanup();
    assert.equal(listeners.size, 0);
  }
});

test('an active report session needing Procore reconnection leaves the sign-in button reachable', async () => {
  const file = 'src/app/login/ProcoreLogin.tsx';
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect') effect = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source);
  const messages = [];
  const window = { location: { search: '?returnTo=%2Fkpi', origin: 'https://app.example.test', replace: () => assert.fail('Reconnection must remain reachable') },
    addEventListener() {}, removeEventListener() {} };
  window.self = window.top = window;
  const code = ts.transpileModule(`(${effect.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const cleanup = vm.runInNewContext(code, { window, URLSearchParams, AbortSignal,
    setReturnTo() {}, setFramed() {}, setMessage: message => messages.push(message), safeAppReturnTo: () => '/kpi',
    fetch: async () => ({ ok: true, json: async () => ({ email: 'operator@example.test', needsReconnect: true }) }),
    timer: { current: null },
  })();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(messages.some(message => message.includes('reconnect live Procore tools')));
  cleanup();
});

test('protected-page sign-in preserves the deep link without trying to navigate the Procore parent frame', () => {
  const source = ts.createSourceFile('ProtectedPage.tsx', fs.readFileSync('src/components/ProtectedPage.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'navigateToLogin') handler = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  const window = { location: { pathname: '/kpi', search: '?year=2026' }, get top() { assert.fail('Do not change the parent frame'); } };
  vm.runInNewContext(`(${handler.getText(source)})`, { window, encodeURIComponent })();
  assert.equal(window.location.href, '/login?returnTo=%2Fkpi%3Fyear%3D2026');
});
