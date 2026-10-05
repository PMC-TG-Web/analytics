import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import * as progressModule from '../src/lib/procoreStructureProgress.ts';
import * as responseModule from '../src/lib/procoreSyncResponse.ts';
const { STRUCTURE_STAGES, structureProgress } = progressModule;

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

function routeHarness(stageFetch, previous) {
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
      claimDueProject: async options => { calls.claims.push(options); return project; },
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
  const run = async () => {
    const request = new Request('https://example.test/api/cron/nightly-structure', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-secret': 'test-secret' },
      body: JSON.stringify({ projectId: 'project' }),
    });
    request.nextUrl = new URL(request.url);
    return (await module.exports.POST(request)).json();
  };
  return { run, calls };
}

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
    else assert.equal(h.calls.finished[0].result.structureProgress, undefined);
  }
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
          if (url.includes('/potential_change_orders?')) { fetched.push('potential'); return [{ id: 'pco' }]; }
          if (url.includes('/potential_change_orders/')) return [];
          if (url.includes('/change_order_packages?')) { fetched.push('packages'); return [{ id: 'pcco' }]; }
          return { id: 'pcco', line_items: [] };
        },
      },
      '@/lib/prisma': { prisma: {
        procorePotentialChangeOrder: { findUnique: async () => null },
        procoreChangeOrderPackage: { findUnique: async () => null },
      } },
      '@/lib/procoreChangeOrderPackages': {
        ensureChangeOrderPackagesTable: async () => {},
        upsertChangeOrderPackage: async () => {},
        reconcileChangeOrderPackageLines: async () => {},
      },
      '@/lib/procorePotentialChangeOrders': {
        ensurePotentialChangeOrderTables: async () => {},
        upsertPotentialChangeOrder: async () => 'pco',
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
  }
});
