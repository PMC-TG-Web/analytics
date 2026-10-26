import assert from 'node:assert/strict';
import test from 'node:test';
import { actualsBatchSize } from '../src/lib/procoreActualsBatch.ts';

const now = new Date('2026-10-26T10:00:00Z');
const size = (dueProjects, oldestDue, cap = 8) => actualsBatchSize({ dueProjects, oldestDue, cap, now });

test('overnight backlog uses the configured cap instead of tapering to three projects', () => {
  assert.equal(size(43, '2026-10-26T06:00:00Z'), 8);
  assert.equal(size(20, '2026-10-26T07:15:36Z'), 8);
  assert.equal(size(5, '2026-10-26T07:15:36Z'), 5);
  assert.equal(size(20, '2026-10-26T07:15:36Z', 4), 4);
});

test('ordinary polling retains small batches and the cap', () => {
  assert.equal(size(20, '2026-10-26T09:30:00Z'), 3);
  assert.equal(size(20, '2026-10-26T09:29:59Z'), 8);
  assert.equal(size(48, '2026-10-26T09:55:00Z'), 4);
  assert.equal(size(200, '2026-10-26T09:55:00Z'), 8);
  assert.equal(size(0, null), 3);
  assert.equal(size(20, null), 3);
  assert.equal(size(20, 'invalid'), 3);
});

test('worker drains the recommended backlog batch while retaining reconciliation and quota limits', async (t) => {
  const keys = ['PROCORE_SYNC_SECRET', 'APP_BASE_URL', 'PROCORE_ACTUALS_MAX_PROJECTS_PER_TICK', 'PROCORE_RECONCILIATION_MAX_PROJECTS_PER_TICK'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    PROCORE_SYNC_SECRET: 'actuals-batch-test', APP_BASE_URL: 'https://example.test',
    PROCORE_ACTUALS_MAX_PROJECTS_PER_TICK: '8', PROCORE_RECONCILIATION_MAX_PROJECTS_PER_TICK: '3',
  });
  t.mock.method(console, 'log', () => {});
  try {
    const { default: worker } = await import('../netlify/functions/actuals-sync-background.mts');
    for (const scenario of [
      { mode: '', expected: 8 },
      { mode: 'reconcile', expected: 3 },
      { mode: '', limited: true, expected: 1 },
    ]) {
      let calls = 0;
      const fetchMock = t.mock.method(globalThis, 'fetch', async url => {
        if (new URL(url).pathname !== '/api/cron/actuals') {
          return Response.json({ success: true, skipped: true, reason: 'no_project_due' });
        }
        calls += 1;
        if (scenario.limited) return Response.json({ success: true, deferred: true,
          rateLimitUntil: new Date(Date.now() + 120_000).toISOString() });
        return Response.json({ success: true, completed: true,
          queue: { recommendedBatchSize: size(20 - calls, '2026-10-26T07:15:36Z') } });
      });
      await worker(new Request('https://example.test/api/background/actuals-sync', {
        method: 'POST', headers: { 'x-sync-secret': 'actuals-batch-test' },
        body: JSON.stringify({ mode: scenario.mode }),
      }));
      assert.equal(calls, scenario.expected);
      fetchMock.mock.restore();
    }
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
