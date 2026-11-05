import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server.js';
import scheduled, { config } from '../netlify/functions/qbo-open-ar-hourly.mts';
import { isRouteAuthorizedApiRequest } from '../src/lib/permissionRoutes.js';
import { AR_STALE_AFTER_MS, isOpenArStale, parseOpenArHealth } from '../src/lib/qboOpenAr.ts';
import { saveQboOpenArSnapshot } from '../src/lib/saveQboOpenArSnapshot.ts';
import { arFixture } from './fixtures/qboOpenAr.mjs';

test('scheduled dispatch is exactly hourly, authenticated, bounded, and rejects configuration/HTTP failures', async t => {
  assert.equal(config.schedule, '0 * * * *');
  const previous = { PROCORE_SYNC_SECRET: process.env.PROCORE_SYNC_SECRET, SYNC_SECRET: process.env.SYNC_SECRET, APP_BASE_URL: process.env.APP_BASE_URL };
  process.env.PROCORE_SYNC_SECRET = 'fixture-secret'; process.env.APP_BASE_URL = 'https://example.test';
  const calls = []; let status = 202;
  t.mock.method(console, 'log', () => {}); t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json({ refresh: { id: 'job', state: status === 200 ? 'succeeded' : 'queued' } }, { status });
  });
  try {
    for (status of [202, 200]) assert.equal((await scheduled()).status, 200);
    assert.equal(calls[0].url, 'https://example.test/api/cron/qbo-open-ar');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers['x-sync-secret'], 'fixture-secret');
    assert.equal(calls[0].options.redirect, 'error'); assert.ok(calls[0].options.signal instanceof AbortSignal);
    for (status of [401, 403, 404, 500, 503]) assert.equal((await scheduled()).status, 503);
    const before = calls.length;
    process.env.APP_BASE_URL = 'http://example.test';
    assert.equal((await scheduled()).status, 503); assert.equal(calls.length, before);
    delete process.env.PROCORE_SYNC_SECRET; delete process.env.SYNC_SECRET;
    assert.equal((await scheduled()).status, 503); assert.equal(calls.length, before);
  } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
test('the exact cron POST verifies its secret and configured company before queueing', async () => {
  const calls = []; let fail = false;
  const code = ts.transpileModule(fs.readFileSync('src/app/api/cron/qbo-open-ar/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const imports = {
    'next/server': { NextRequest, NextResponse },
    '@/lib/loadQboOpenAr': { queueQboOpenAr: async (...args) => { calls.push(args); if (fail) throw new Error('host offline'); return { id: 'job', state: 'queued' }; } },
  };
  vm.runInNewContext(`(function(require,module,exports){${code}})(require,module,module.exports)`, {
    module, Error, console: { error() {} }, process: { env: { PROCORE_SYNC_SECRET: 'fixture-secret', PROCORE_COMPANY_ID: '123' } },
    require: id => { assert.ok(id in imports, id); return imports[id]; },
  });
  for (const secret of ['', 'wrong']) {
    const response = await module.exports.POST(new NextRequest('https://example.test/api/cron/qbo-open-ar', { method: 'POST', headers: { 'x-sync-secret': secret } }));
    assert.equal(response.status, 401);
  }
  assert.equal(calls.length, 0);
  const request = () => new NextRequest('https://example.test/api/cron/qbo-open-ar?companyId=untrusted', { method: 'POST', headers: { 'x-sync-secret': 'fixture-secret' } });
  assert.equal((await module.exports.POST(request())).status, 202);
  assert.deepEqual(calls, [['123', true]]);
  fail = true;
  const response = await module.exports.POST(request()); assert.equal(response.status, 503); assert.match((await response.json()).error, /last saved report was retained/);
  assert.equal(isRouteAuthorizedApiRequest('/api/cron/qbo-open-ar', 'POST'), true);
  assert.equal(isRouteAuthorizedApiRequest('/api/cron/qbo-open-ar', 'GET'), false);
  assert.equal(isRouteAuthorizedApiRequest('/api/cron/qbo-open-ar/other', 'POST'), false);
});
test('host persistence is validated and immutable without any browser completion request', async () => {
  const writes = [];
  const database = { qboOpenArSnapshot: { upsert: async value => { writes.push(value); } } };
  const report = await saveQboOpenArSnapshot(database, '123', arFixture());
  assert.equal(report.invoices.length, 5);
  await saveQboOpenArSnapshot(database, '123', arFixture());
  assert.equal(writes[0].where.sourceHash, writes[1].where.sourceHash);
  assert.deepEqual(writes[0].update, {});
  await assert.rejects(saveQboOpenArSnapshot(database, 'other', arFixture()), /different company/);
  await assert.rejects(saveQboOpenArSnapshot(database, '123', {}), /Unsupported/);
  assert.equal(writes.length, 2);
});
test('stale-data threshold is strictly over 75 minutes and health responses are validated', () => {
  const generatedAt = '2026-11-05T15:00:00Z';
  assert.equal(AR_STALE_AFTER_MS, 75 * 60000);
  assert.equal(isOpenArStale(generatedAt, Date.parse(generatedAt) + AR_STALE_AFTER_MS), false);
  assert.equal(isOpenArStale(generatedAt, Date.parse(generatedAt) + AR_STALE_AFTER_MS + 1), true);
  assert.deepEqual(parseOpenArHealth({ hostOnline: false, latestRefresh: null }), { hostOnline: false, latestRefresh: null });
  assert.throws(() => parseOpenArHealth({ hostOnline: 'true' }), /unavailable/);
  assert.throws(() => parseOpenArHealth({ hostOnline: true, latestRefresh: { state: 'invented', requestedAt: generatedAt } }), /invalid/);
});
