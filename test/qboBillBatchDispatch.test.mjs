import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { dispatchBillBatch } from '../src/lib/qboBillBatchDispatch.ts';
import { config as workerConfig } from '../netlify/functions/qbo-bill-batch-background.mts';

test('batch worker has an explicit POST route alongside the Next.js catch-all', () => {
  assert.equal(workerConfig.path, '/api/background/qbo-bill-batch');
  assert.equal(workerConfig.method, 'POST');
});

test('dispatch accepts only background acknowledgement and reports failures without secrets', async t => {
  const previous = { ...process.env };
  Object.assign(process.env, { QBO_BILL_BATCH_ENABLED: 'true', APP_BASE_URL: 'https://example.test', PROCORE_SYNC_SECRET: 'private-test-secret' });
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  try {
    for (const status of [202, 200, 404, 503]) {
      const mock = t.mock.method(globalThis, 'fetch', async (url, init) => {
        assert.equal(url.href, 'https://example.test/api/background/qbo-bill-batch');
        assert.equal(init.method, 'POST');
        assert.equal(init.redirect, 'error');
        assert.equal(init.headers['x-sync-secret'], 'private-test-secret');
        return new Response(null, { status });
      });
      assert.equal(await dispatchBillBatch(), status === 202);
      mock.mock.restore();
    }
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('private-test-secret'); });
    assert.equal(await dispatchBillBatch(), false);
    assert.equal(logs.length, 4);
    assert.doesNotMatch(JSON.stringify(logs), /private-test-secret/);
    process.env.QBO_BILL_BATCH_ENABLED = 'false';
    assert.equal(await dispatchBillBatch(), false);
    assert.equal(logs.length, 4);
  } finally {
    for (const key of ['QBO_BILL_BATCH_ENABLED', 'APP_BASE_URL', 'PROCORE_SYNC_SECRET']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});

test('scheduled resume marks failed dispatches as failures and leaves disabled batches idle', async () => {
  for (const [enabled, dispatched, expected, calls] of [[true, false, 503, 1], [true, true, 200, 1], [false, false, 200, 0]]) {
    let count = 0;
    const loaded = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync('netlify/functions/qbo-bill-batch-resume.mts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(source, { exports: loaded.exports, Response, process: { env: { QBO_BILL_BATCH_ENABLED: String(enabled) } }, console: { log() {} }, require: () => ({ dispatchBillBatch: async () => { count++; return dispatched; } }) });
    const result = await loaded.exports.default();
    assert.equal(result.status, expected);
    assert.equal(count, calls);
    assert.deepEqual(await result.json(), enabled ? { dispatched } : { enabled: false });
  }
});
