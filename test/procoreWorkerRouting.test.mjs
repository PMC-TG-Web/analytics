import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { unstable_doesMiddlewareMatch } from 'next/dist/experimental/testing/server/middleware-testing-utils.js';

const workers = [
  ['actuals-sync', 'actuals-sync-background'],
  ['nightly-structure-sync', 'nightly-structure-sync-background'],
  ['change-order-approvals', 'change-order-approvals-background'],
  ['commitment-maker-tasks', 'commitment-maker-tasks-background'],
  ['pm-dashboard-sync', 'pm-dashboard-sync-background'],
  ['calendar-sync', 'calendar-sync-background'],
  ['project-reconciliation', 'project-reconciliation-background'],
  ['analytics-connection-check', 'analytics-connection-check'],
];

test('Netlify worker paths bypass Next routing while application routes remain protected', () => {
  for (const file of ['../middleware.ts', '../src/middleware.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const literal = source.match(/export const config = (\{[\s\S]*?\n\});/)?.[1];
    assert.ok(literal);
    const config = runInNewContext(`(${literal})`);
    const matches = url => unstable_doesMiddlewareMatch({ config, url });
    for (const [path] of workers) {
      assert.equal(matches(`/api/background/${path}`), false, path);
      assert.equal(matches(`/api/background/${path}/`), false, path);
      assert.equal(matches(`/api/background/${path}?test=1`), false, path);
      assert.equal(matches(`/api/background/${path}-other`), true);
      assert.equal(matches(`/api/background/${path}/other`), true);
    }
    for (const path of ['/analytics', '/api/analytics/monthly-hours', '/api/cron/actuals',
      '/api/cron/calendar-sync', '/api/background/unknown', '/api/procore/sync/all-projects']) {
      assert.equal(matches(path), true, path);
    }
  }
});

test('every excluded worker rejects missing and invalid secrets before performing work', async () => {
  const previous = process.env.PROCORE_SYNC_SECRET;
  process.env.PROCORE_SYNC_SECRET = 'routing-test-secret';
  try {
    for (const [path, file] of workers) {
      const worker = await import(`../netlify/functions/${file}.mts`);
      assert.equal(worker.config.path, `/api/background/${path}`);
      for (const headers of [{}, { 'x-sync-secret': 'incorrect-secret' }]) {
        const response = await worker.default(new Request(`https://example.test/api/background/${path}`, {
          method: 'POST', headers,
        }));
        assert.equal(response.status, 401, file);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.PROCORE_SYNC_SECRET;
    else process.env.PROCORE_SYNC_SECRET = previous;
  }
});

test('a rejected reconciliation dispatch cannot suppress the normal worker or report success', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-17T07:10:00Z') });
  const previousSecret = process.env.PROCORE_SYNC_SECRET;
  const previousBase = process.env.APP_BASE_URL;
  process.env.PROCORE_SYNC_SECRET = 'routing-test-secret';
  process.env.APP_BASE_URL = 'https://example.test';
  const { default: scheduler } = await import('../netlify/functions/scheduled-sync.mts');
  t.mock.method(console, 'log', () => {});
  try {
    for (const status of [404, 500, 200, 202]) {
      const calls = [];
      const fetchMock = t.mock.method(globalThis, 'fetch', async url => {
        const path = new URL(url).pathname;
        calls.push(path);
        if (path === '/api/background/project-reconciliation') return new Response(null, { status });
        if (path.startsWith('/api/background/')) return new Response(null, { status: 202 });
        return Response.json({ success: true });
      });
      const result = await scheduler();
      const accepted = status === 202;
      assert.equal(calls.includes('/api/background/nightly-structure-sync'), !accepted);
      assert.equal(result.status, accepted ? 200 : 500);
      assert.equal((await result.json()).ok, accepted);
      fetchMock.mock.restore();
    }
    for (const rejectedPath of ['/api/background/change-order-approvals',
      '/api/background/commitment-maker-tasks', '/api/background/calendar-sync']) {
      const fetchMock = t.mock.method(globalThis, 'fetch', async url => {
        const path = new URL(url).pathname;
        if (path === rejectedPath) return new Response(null, { status: 404 });
        if (path.startsWith('/api/background/')) return new Response(null, { status: 202 });
        return Response.json({ success: true });
      });
      const result = await scheduler();
      assert.equal(result.status, 500, rejectedPath);
      assert.equal((await result.json()).ok, false);
      fetchMock.mock.restore();
    }
  } finally {
    if (previousSecret === undefined) delete process.env.PROCORE_SYNC_SECRET;
    else process.env.PROCORE_SYNC_SECRET = previousSecret;
    if (previousBase === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previousBase;
  }
});
