import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real Home weather effect without mounting unrelated scheduling UI.
const file = ts.createSourceFile('page.tsx', readFileSync('src/app/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let weatherEffect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect'
    && node.arguments[0]?.getText(file).includes('async function fetchWeather()')) weatherEffect = node;
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(weatherEffect, 'Home must register its weather effect');
const code = ts.transpileModule(`const effect = ${weatherEffect.arguments[0].getText(file)}; effect();`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup({ loading = false, user = { email: 'pm@example.test' }, fetcher = async () => Response.json({ temp: 70, condition: 'Clear' }) } = {}) {
  const requests = [], updates = [], errors = [], warnings = [];
  const cleanup = vm.runInNewContext(code, {
    authLoading: loading, user, AbortController,
    setWeather: value => updates.push(value),
    fetch: (url, options) => { requests.push({ url, options }); return fetcher(url, options); },
    console: { error: (...args) => errors.push(args), warn: (...args) => warnings.push(args) },
  });
  return { requests, updates, errors, warnings, cleanup };
}

test('Home waits for authentication and reruns weather when identity resolves or changes', () => {
  for (const options of [{ loading: true }, { user: null }]) {
    const fixture = setup(options);
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.updates.at(-1), null);
  }
  assert.equal(weatherEffect.arguments[1].getText(file), '[authLoading, user?.email]');
});

test('authenticated weather reads keep credentials and display the returned forecast', async () => {
  const fixture = setup();
  await flush();
  assert.equal(fixture.requests[0].url, '/api/weather');
  assert.equal(fixture.requests[0].options.credentials, 'include');
  assert.equal(fixture.requests[0].options.cache, 'no-store');
  assert.equal(fixture.updates.at(-1).temp, 70);
  assert.equal(fixture.errors.length, 0);
});

test('an expired or denied session leaves weather unavailable without a console error', async () => {
  for (const status of [401, 403]) {
    const fixture = setup({ fetcher: async () => new Response(null, { status }) });
    await flush();
    assert.equal(fixture.updates.at(-1).unavailable, true);
    assert.equal(fixture.updates.at(-1).condition, 'Sign in to view weather');
    assert.equal(fixture.errors.length, 0);
    assert.equal(fixture.warnings.length, 0);
  }
});

test('forecast failures are recoverable widget warnings', async () => {
  const fixture = setup({ fetcher: async () => new Response(null, { status: 503 }) });
  await flush();
  assert.equal(fixture.updates.at(-1).unavailable, true);
  assert.equal(fixture.errors.length, 0);
  assert.equal(fixture.warnings.length, 1);
});

test('unmount or identity change cancels the request and ignores late results', async () => {
  let finish;
  const fixture = setup({ fetcher: () => new Promise(resolve => { finish = resolve; }) });
  fixture.cleanup();
  assert.equal(fixture.requests[0].options.signal.aborted, true);
  finish(Response.json({ temp: 99 }));
  await flush();
  assert.equal(fixture.updates.length, 0);
  assert.equal(fixture.errors.length, 0);
  assert.equal(fixture.warnings.length, 0);
});
