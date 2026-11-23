import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import * as progressModule from '../src/lib/procoreStructureProgress.ts';
import * as responseModule from '../src/lib/procoreSyncResponse.ts';
import * as changeOrderSnapshots from '../src/lib/procoreChangeOrderSnapshot.ts';
const { STRUCTURE_STAGES, structureProgress, nextStructureRunMinutes } = progressModule;

test('daily structure requeues into the next Eastern nightly window after daytime recovery', () => {
  for (const [finished, expected] of [
    ['2026-10-05T10:39:40.853Z', '2026-10-06T06:00:00.000Z'],
    ['2026-10-05T11:57:47.100Z', '2026-10-06T06:00:00.000Z'],
    ['2026-10-06T17:00:00.000Z', '2026-10-07T06:00:00.000Z'],
    ['2026-10-06T06:00:00.000Z', '2026-10-07T06:00:00.000Z'],
    ['2026-10-06T05:59:59.000Z', '2026-10-06T06:00:00.000Z'],
    ['2026-12-31T23:00:00.000Z', '2027-01-01T07:00:00.000Z'],
    ['2026-03-07T12:00:00.000Z', '2026-03-08T07:00:00.000Z'],
    ['2026-11-01T05:30:00.000Z', '2026-11-01T07:00:00.000Z'],
    ['2026-11-01T06:30:00.000Z', '2026-11-01T07:00:00.000Z'],
  ]) {
    const now = new Date(finished);
    const delay = nextStructureRunMinutes(now);
    assert.ok(delay > 0 && delay <= 25 * 60);
    assert.equal(new Date(now.getTime() + delay * 60_000).toISOString(), expected);
  }
});

const now = new Date('2026-10-05T10:00:00Z');
const steps = STRUCTURE_STAGES.map(({ step }) => ({ step, status: 'ok' }));
const saved = (completed, cycleStartedAt = '2026-10-05T09:00:00Z') => ({
  structureProgress: { cycleStartedAt, steps: completed },
});

test('each unfinished structure stage resumes without repeating successful reads', () => {
  for (let count = 0; count < STRUCTURE_STAGES.length; count++) {
    const progress = structureProgress(saved(steps.slice(0, count)), now);
    assert.deepEqual(progress.steps, steps.slice(0, count));
    assert.equal(STRUCTURE_STAGES[progress.steps.length].step, steps[count].step);
  }
});

test('completed, legacy, expired, and malformed cycles start a fresh daily read', () => {
  for (const prior of [
    null, { steps }, saved(steps), saved(steps.slice(0, 2), '2026-10-04T10:00:00Z'),
    saved(steps.slice(0, 1), '2026-10-06T10:00:00Z'),
    saved([steps[1]]), saved([{ ...steps[0], status: 'error' }]), saved([null]),
  ]) {
    assert.deepEqual(structureProgress(prior, now), { cycleStartedAt: now.toISOString(), steps: [] });
  }
});

test('resuming and appending a stage does not mutate stored evidence', () => {
  const prior = saved(steps.slice(0, 1));
  const progress = structureProgress(prior, now);
  progress.steps.push(steps[1]);
  assert.equal(prior.structureProgress.steps.length, 1);
});

function routeHarness(stageFetch, previous, noProject = false) {
  const calls = { finished: [], checkpoints: [], released: 0, claims: [] };
  const project = { companyId: 'company', projectId: 'project', dataset: 'nightly_structure', leaseId: 'lease', lastResult: previous };
  const imports = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/procoreSyncStream': { streamSyncResponse: operation => operation() },
    '@/lib/procoreConnection': { withAnalyticsSyncProcoreConnection: operation => operation() },
    '@/lib/cronSync': { getRequiredSyncSecret: () => 'test-secret' },
    '@/lib/procoreStructureProgress': progressModule,
    '@/lib/procoreSyncResponse': responseModule,
    '@/lib/procoreSyncQueue': {
      acquireProcoreWorker: async () => ({ acquired: true, leaseId: 'lease' }),
      releaseProcoreWorker: async () => { calls.released++; },
      seedProjectSyncQueue: async () => {},
      claimDueProject: async options => { calls.claims.push(options); return noProject ? null : project; },
      seedEstimatingSyncQueue: async () => { throw new Error('Structure-only work must not fall back to estimates'); },
      finishProjectSync: async options => { calls.finished.push(options); },
    },
    '@/lib/prisma': { prisma: {
      syncLog: { create: async () => ({ id: 1n }), update: async () => {} },
      $executeRawUnsafe: async (sql, ...values) => {
        if (sql.includes('last_result = $5')) calls.checkpoints.push(JSON.parse(values[4]));
        return 1;
      },
    } },
  };
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync('src/app/api/cron/nightly-structure/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', 'fetch', js)(id => imports[id] || {}, module, module.exports, stageFetch);
  const run = async (body = { projectId: 'project' }) => {
    const request = new Request('https://example.test/api/cron/nightly-structure', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-secret': 'test-secret' },
      body: JSON.stringify(body),
    });
    request.nextUrl = new URL(request.url);
    return (await module.exports.POST(request)).json();
  };
  return { run, calls };
}

test('structure-only catch-up skips unrelated datasets and leaves future work alone', async () => {
  const h = routeHarness(async () => { throw new Error('No due project must not trigger a sync'); }, null, true);
  const result = await h.run({ mode: 'structure' });
  assert.equal(result.reason, 'no_structure_project_due');
  assert.equal(result.success, true);
  assert.equal(h.calls.claims.length, 1);
  assert.equal(h.calls.claims[0].dataset, 'nightly_structure');
  assert.equal(h.calls.claims[0].projectId, undefined, 'catch-up must honor queue due times');
  assert.equal(h.calls.released, 1);
});

test('daytime catch-up is bounded, follows Actuals and estimates, and yields to quota or contention', async t => {
  const oldSecret = process.env.PROCORE_SYNC_SECRET;
  const oldBase = process.env.APP_BASE_URL;
  process.env.PROCORE_SYNC_SECRET = 'test-secret';
  process.env.APP_BASE_URL = 'https://example.test';
  t.mock.method(console, 'log', () => {});
  try {
    const { default: worker } = await import('../netlify/functions/actuals-sync-background.mts');
    for (const outcome of [
      { success: true, pending: true },
      { success: true, completed: true },
      { success: true, skipped: true, reason: 'worker_busy' },
      { success: true, skipped: true, reason: 'no_structure_project_due' },
      { success: true, deferred: true, rateLimitUntil: new Date(Date.now() + 3600_000).toISOString() },
      { success: false },
    ]) {
      const calls = [];
      const mock = t.mock.method(globalThis, 'fetch', async (url, init) => {
        const mode = JSON.parse(init.body).mode;
        const step = mode || new URL(url).pathname;
        calls.push(step);
        if (mode === 'structure') return Response.json(outcome);
        return Response.json({ success: true, skipped: true, reason: 'no_project_due' });
      });
      const request = mode => new Request('https://example.test', {
        method: 'POST', headers: { 'x-sync-secret': 'test-secret' }, body: JSON.stringify({ mode }),
      });
      const result = await (await worker(request(''))).json();
      assert.equal(result.structureCatchUp.length, outcome.pending || outcome.completed ? 5 : 1);
      assert.ok(calls.indexOf('/api/cron/actuals') < calls.indexOf('structure'));
      assert.ok(calls.indexOf('estimates') < calls.indexOf('structure'));
      if (outcome.deferred) assert.ok(!calls.includes('/api/cron/project-onboarding'));
      calls.length = 0;
      await worker(request('reconcile'));
      assert.ok(!calls.includes('structure'), 'historical Actuals reconciliation must stay separate');
      mock.mock.restore();
    }
  } finally {
    if (oldSecret === undefined) delete process.env.PROCORE_SYNC_SECRET; else process.env.PROCORE_SYNC_SECRET = oldSecret;
    if (oldBase === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = oldBase;
  }
});

test('route checkpoints exactly one stage and only completes after the final stage', async () => {
  let previous;
  for (let index = 0; index < STRUCTURE_STAGES.length; index++) {
    const requested = [];
    const h = routeHarness(async (url, init) => {
      requested.push(new URL(url).pathname);
      assert.ok(init.signal instanceof AbortSignal);
      return Response.json({ success: true });
    }, previous);
    const result = await h.run();
    assert.deepEqual(requested, [STRUCTURE_STAGES[index].path]);
    const last = index === STRUCTURE_STAGES.length - 1;
    assert.equal(result.completed, last);
    assert.equal(result.pending, !last);
    assert.equal(h.calls.finished.length, last ? 1 : 0);
    assert.equal(h.calls.released, 1);
    assert.equal(h.calls.claims[0].retryAfterInterruptedClaim, true);
    if (!last) previous = h.calls.checkpoints[0];
    else {
      assert.equal(h.calls.finished[0].result.structureProgress, undefined);
      assert.ok(Math.abs(h.calls.finished[0].nextRunMinutes - nextStructureRunMinutes()) < 0.1);
    }
  }
});

test('nightly budget refresh explicitly requests the complete project collection', async () => {
  const previous = saved(steps.slice(0, 1), new Date().toISOString());
  let requestBody;
  const h = routeHarness(async (url, init) => {
    assert.equal(new URL(url).pathname, '/api/procore/sync/budget-line-items');
    requestBody = JSON.parse(init.body);
    return Response.json({ success: true });
  }, previous);
  const result = await h.run();
  assert.equal(requestBody.fetchAll, true, 'a page-limited budget response cannot complete the nightly stage');
  assert.deepEqual(requestBody.projectIds, ['project']);
  assert.equal(requestBody.perPage, 100);
  assert.equal(requestBody.persist, true);
  assert.equal(result.pending, true);
  assert.equal(h.calls.checkpoints[0].steps.at(-1).step, 'budget-line-items');
});

test('body timeout records a retryable failure while retaining prior stage progress', async () => {
  const previous = saved(steps.slice(0, 1), new Date().toISOString());
  const h = routeHarness(async () => ({
    text: async () => { throw new DOMException('Stage deadline exceeded', 'TimeoutError'); },
  }), previous);
  const result = await h.run();
  assert.equal(result.success, false);
  assert.equal(result.completed, false);
  assert.equal(h.calls.released, 1);
  assert.equal(h.calls.finished[0].success, false);
  assert.equal(h.calls.finished[0].nextRunMinutes, 30);
  assert.deepEqual(h.calls.finished[0].result.structureProgress.steps, steps.slice(0, 1));
});

test('a partial potential order group resumes at its cursor, including after a retry', async () => {
  const prior = saved(steps.slice(0, 2), new Date().toISOString());
  const cursor = 'a'.repeat(64) + ':4';
  const h = routeHarness(async (_url, init) => {
    assert.equal(JSON.parse(init.body).chunkPotential, true);
    return Response.json({ success: true, nextPotentialCursor: cursor });
  }, prior);
  assert.equal((await h.run()).pending, true);
  const partial = h.calls.checkpoints[0];
  assert.deepEqual(partial.structureProgress.steps, prior.structureProgress.steps);
  const retry = routeHarness(async (_url, init) => {
    assert.equal(JSON.parse(init.body).potentialCursor, cursor);
    throw new Error('connection lost');
  }, partial);
  assert.equal((await retry.run()).success, false);
  const failed = retry.calls.finished[0].result;
  assert.equal(failed.structureProgress.potentialCursor, cursor);
  const finish = routeHarness(async () => Response.json({ success: true, nextPotentialCursor: null }), failed);
  assert.equal((await finish.run()).pending, true);
  assert.equal(finish.calls.checkpoints[0].structureProgress.steps.at(-1).step, 'potential-change-orders');
  assert.equal(finish.calls.checkpoints[0].structureProgress.potentialCursor, undefined);
});

test('potential order cursors tolerate reordered source pages and restart on a changed roster', () => {
  const records = ['5', '3', '2', '1', '4'].map(id => ({ id }));
  const first = changeOrderSnapshots.potentialOrderChunk(records, undefined);
  assert.deepEqual(first.records.map(r => r.id), ['1', '2', '3', '4']);
  const last = changeOrderSnapshots.potentialOrderChunk([...records].reverse(), first.next);
  assert.deepEqual(last.records, [{ id: '5' }]);
  assert.equal(last.next, null);
  assert.deepEqual(last.ids, ['1', '2', '3', '4', '5']);
  const restarted = changeOrderSnapshots.potentialOrderChunk([...records, { id: '0' }], first.next);
  assert.deepEqual(restarted.records.map(r => r.id), ['0', '1', '2', '3']);
});

test('background worker gives pending stages their bounded continuation budget', async t => {
  const oldSecret = process.env.PROCORE_SYNC_SECRET;
  const oldBase = process.env.APP_BASE_URL;
  const oldCap = process.env.PROCORE_STRUCTURE_MAX_PROJECTS_PER_TICK;
  process.env.PROCORE_SYNC_SECRET = 'test-secret';
  process.env.APP_BASE_URL = 'https://example.test';
  process.env.PROCORE_STRUCTURE_MAX_PROJECTS_PER_TICK = '1';
  t.mock.method(console, 'log', () => {});
  try {
    for (const neverCompletes of [false, true]) {
      let calls = 0;
      const mock = t.mock.method(globalThis, 'fetch', async (url, init) => {
        const body = JSON.parse(init.body);
        if (body.mode || url.endsWith('/project-link-sync')) {
          return Response.json({ success: true, skipped: true, reason: 'no_project_due' });
        }
        calls++;
        return Response.json({ success: true, pending: neverCompletes || calls < STRUCTURE_STAGES.length, completed: !neverCompletes && calls === STRUCTURE_STAGES.length });
      });
      const { default: worker } = await import('../netlify/functions/nightly-structure-sync-background.mts');
      await worker(new Request('https://example.test', { headers: { 'x-sync-secret': 'test-secret' } }));
      assert.equal(calls, STRUCTURE_STAGES.length, 'continuations neither consume project cap nor run without a bound');
      mock.mock.restore();
    }
  } finally {
    for (const [key, value] of Object.entries({ PROCORE_SYNC_SECRET: oldSecret, APP_BASE_URL: oldBase, PROCORE_STRUCTURE_MAX_PROJECTS_PER_TICK: oldCap })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('change-order worker scopes preserve full-list reconciliation and interactive behavior', async () => {
  for (const [scope, authenticated, expected] of [
    ['potential', true, ['potential']], ['packages', true, ['packages']],
    ['packages', false, ['potential', 'packages']], ['', true, ['potential', 'packages']],
  ]) {
    const reconciled = [];
    const fetched = [];
    let potentialRoster = [{ id: 'pco' }];
    const imports = {
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      'next/headers': { cookies: async () => ({ get: () => undefined }) },
      '@/lib/procoreSyncStream': { streamSyncResponse: operation => operation() },
      '@/lib/procore': {
        hasValidProcoreSyncSecret: () => authenticated,
        withProcoreLiveApiBypassForSyncSecret: (_request, operation) => operation(),
        getClientCredentialsToken: async () => 'test-token',
        makeRequest: async url => {
          if (url.includes('/prime_contracts?')) return [{ id: 'prime' }];
          if (url.includes('/potential_change_orders?')) { fetched.push('potential'); return potentialRoster; }
          if (url.includes('/potential_change_orders/')) return [];
          if (url.includes('/change_order_packages?')) { fetched.push('packages'); return [{ id: 'pcco' }]; }
          return { id: 'pcco', line_items: [] };
        },
      },
      '@/lib/prisma': { prisma: {
        procorePotentialChangeOrder: { findUnique: async () => null },
        procoreChangeOrderPackage: { findUnique: async () => null, updateMany: async () => ({ count: 0 }) },
      } },
      '@/lib/procoreChangeOrderSnapshot': changeOrderSnapshots,
      '@/lib/procoreChangeOrderPackages': {
        ensureChangeOrderPackagesTable: async () => {},
        upsertChangeOrderPackage: async () => {},
        reconcileChangeOrderPackageLines: async () => {},
      },
      '@/lib/procorePotentialChangeOrders': {
        ensurePotentialChangeOrderTables: async () => {},
        upsertPotentialChangeOrder: async ({ record }) => record.id,
        upsertPotentialChangeOrderLines: async () => [],
        reconcilePotentialChangeOrderLines: async () => {},
        reconcilePotentialChangeOrders: async args => { reconciled.push(args.changeOrderIds); },
      },
    };
    const module = { exports: {} };
    const js = ts.transpileModule(fs.readFileSync('src/app/api/procore/sync/change-order-packages/route.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'module', 'exports', js)(id => imports[id] || {}, module, module.exports);
    const response = await module.exports.POST(new Request('https://example.test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyId: 'company', projectIds: ['project'], syncScope: scope }),
    }));
    const result = await response.json();
    assert.deepEqual(result.errors, []);
    assert.deepEqual(fetched, expected);
    assert.deepEqual(reconciled, expected.includes('potential') ? [['pco']] : [], 'package-only work must not reconcile away untouched PCOs');
    if (authenticated && scope === 'potential') {
      potentialRoster = Array.from({ length: 6 }, (_, i) => ({ id: String(i + 1) }));
      const runChunk = async potentialCursor => (await module.exports.POST(new Request('https://example.test', {
        method: 'POST', body: JSON.stringify({ companyId: 'company', projectIds: ['project'], syncScope: scope, chunkPotential: true, potentialCursor }),
      }))).json();
      const part = await runChunk(null);
      assert.equal(part.totalPotentialChangeOrdersUpserted, 4);
      assert.equal(reconciled.length, 1, 'a partial group cannot remove other orders');
      const end = await runChunk(part.nextPotentialCursor);
      assert.equal(end.totalPotentialChangeOrdersUpserted, 2);
      assert.equal(end.nextPotentialCursor, null);
      assert.deepEqual(reconciled[1], potentialRoster.map(row => row.id));
    }
  }
});
