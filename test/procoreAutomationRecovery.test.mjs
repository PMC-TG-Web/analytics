import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWebhookPotentialChangeOrder } from '../src/lib/procoreWebhookChangeOrder.ts';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { procoreSyncRateLimitUntil, procoreSyncResponseIsRateLimited } from '../src/lib/procoreSyncResponse.ts';
import { procoreWorkerRetryPlan } from '../src/lib/procoreWorkerBackoff.js';

function loadWorker(runProjectReconciliation) {
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync('netlify/functions/project-reconciliation-background.mts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', source)(id => {
    if (id.endsWith('procoreProjectReconciliation.ts')) return { runProjectReconciliation };
    if (id.endsWith('procoreWorkerBackoff.js')) return { procoreWorkerRetryPlan };
    if (id.endsWith('procoreSyncResponse.ts')) return { procoreSyncRateLimitUntil, procoreSyncResponseIsRateLimited };
    throw Error('Unexpected import: ' + id);
  }, module, module.exports);
  return module.exports.default;
}

test('PCO webhook uses the exact ID and returns the current record', async () => {
  const record = { id: 123, status: 'approved' };
  const result = await resolveWebhookPotentialChangeOrder('project-1', '123', async path => {
    const url = new URL(path, 'https://example.test');
    assert.equal(url.searchParams.get('project_id'), 'project-1');
    assert.equal(url.searchParams.get('filters[id][]'), '123');
    assert.equal(url.searchParams.has('filters[include_deleted]'), false);
    return { data: [{ id: 456 }, record] };
  });
  assert.equal(result, record);
});

test('an update received after confirmed deletion completes without resurrecting the PCO', async () => {
  const paths = [];
  const result = await resolveWebhookPotentialChangeOrder('project-1', '123', async path => {
    paths.push(path);
    return paths.length === 1 ? [] : [{ id: 123, status: 'approved', deleted_at: '2026-10-10T13:05:29Z' }];
  });
  assert.equal(result, null);
  assert.equal(paths.length, 2);
  assert.equal(new URL(paths[1], 'https://example.test').searchParams.get('filters[include_deleted]'), 'only');
});

test('missing or malformed deletion evidence cannot acknowledge an unknown PCO', async () => {
  for (const deleted of [[], [{ id: 456, deleted_at: '2026-10-10T13:05:29Z' }], [{ id: 123 }], [{ id: 123, deleted_at: 'invalid' }]]) {
    let reads = 0;
    await assert.rejects(resolveWebhookPotentialChangeOrder('project-1', '123', async () => ++reads === 1 ? [] : deleted), /returned no record/);
  }
});

test('PCO read errors remain retryable, including errors on deletion verification', async () => {
  for (const failAt of [1, 2]) {
    let reads = 0;
    const error = new Error('provider unavailable');
    await assert.rejects(resolveWebhookPotentialChangeOrder('project-1', '123', async () => {
      if (++reads === failAt) throw error;
      return [];
    }), error);
  }
});

async function runWorker(t, responses) {
  const saved = { secret: process.env.PROCORE_SYNC_SECRET, base: process.env.APP_BASE_URL };
  process.env.PROCORE_SYNC_SECRET = 'test-secret';
  process.env.APP_BASE_URL = 'https://example.test';
  let now = Date.parse('2026-10-12T07:10:15.797Z');
  const waits = [];
  let calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (fn, ms) => { waits.push(ms); now += ms; queueMicrotask(fn); });
  t.mock.method(console, 'log', () => {});
  t.mock.method(globalThis, 'fetch', async () => assert.fail('Reconciliation must not run through an HTTP route'));
  const worker = loadWorker(async ({ origin, secret, signal }) => {
    assert.equal(origin, 'https://example.test');
    assert.equal(secret, 'test-secret');
    assert.ok(signal instanceof AbortSignal);
    const value = responses[Math.min(calls++, responses.length - 1)];
    return typeof value === 'function' ? value(now) : value;
  });
  try {
    const response = await worker(new Request('https://example.test/api/background/project-reconciliation', {
      method: 'POST', headers: { 'x-sync-secret': 'test-secret' },
    }));
    return { status: response.status, body: await response.json(), waits, calls };
  } finally {
    for (const [key, value] of [['PROCORE_SYNC_SECRET', saved.secret], ['APP_BASE_URL', saved.base]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

const cooldown = { success: false, detail: { success: false, httpStatus: 500, detail: {
  error: 'Procore background rate limit cooldown is active until 2026-10-12T07:10:22.500Z.',
} } };

test('daily reconciliation retries the observed seven-second streamed cooldown', async t => {
  const result = await runWorker(t, [cooldown, { success: true }]);
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.calls, 2);
  assert.deepEqual(result.waits, [6953]);
});

test('repeated short cooldowns have a bounded retry count', async t => {
  const result = await runWorker(t, [now => ({ success: false, rateLimited: true, rateLimitUntil: new Date(now + 1000).toISOString() })]);
  assert.equal(result.status, 500);
  assert.equal(result.calls, 7);
  assert.equal(result.waits.length, 6);
});

for (const [name, response] of [
  ['ordinary failure', { success: false, error: 'database unavailable' }],
  ['missing success', {}],
  ['unknown cooldown deadline', { success: false, rateLimited: true }],
  ['long cooldown', { success: false, rateLimited: true, rateLimitUntil: '2026-10-12T08:00:00Z' }],
]) {
  test(`reconciliation does not retry or report completion for ${name}`, async t => {
    const result = await runWorker(t, [response]);
    assert.equal(result.status, 500);
    assert.equal(result.calls, 1);
    assert.deepEqual(result.waits, []);
    assert.equal(result.body.success, false);
  });
}


test('reconciliation waits for an existing company worker before running', async t => {
  const result = await runWorker(t, [{ success: false, skipped: true, reason: 'worker_busy' }, { success: true }]);
  assert.equal(result.body.success, true);
  assert.equal(result.calls, 2);
  assert.deepEqual(result.waits, [1000]);
});

test('reconciliation bounds company-worker contention without claiming completion', async t => {
  const result = await runWorker(t, [{ success: false, skipped: true, reason: 'worker_busy' }]);
  assert.equal(result.body.success, false);
  assert.equal(result.calls, 121);
  assert.equal(result.waits.length, 120);
});

test('unauthorized background requests never invoke the reconciliation runner', async () => {
  const worker = loadWorker(() => assert.fail('Unauthenticated work'));
  const response = await worker(new Request('https://example.test/api/background/project-reconciliation', { method: 'POST' }));
  assert.equal(response.status, 401);
});
