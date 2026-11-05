import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as snapshots from '../src/lib/procoreChangeOrderSnapshot.ts';

test('change-order snapshots preserve separate current records with the same number or title', async () => {
  const pages = [[{ id: 'draft', title: 'Footer work' }, { id: 'approved', title: 'Footer work' }], [{ id: 'other' }]];
  const rows = await snapshots.fetchCompleteChangeOrderSnapshot(async page => ({ data: pages[page - 1] }), 2);
  assert.deepEqual(rows.map(row => row.id), ['draft', 'approved', 'other']);
  assert.deepEqual(await snapshots.fetchCompleteChangeOrderSnapshot(async () => [], 100), []);
});

test('invalid, duplicate, failed and truncated snapshot pages cannot establish source absence', async () => {
  for (const read of [
    async () => ({ error: 'failed' }), async () => [{ title: 'missing ID' }], async () => [{ id: {} }],
    async () => [{ id: 'repeated' }], async page => [{ id: String(page) }],
    async page => { if (page > 1) throw new Error('page failed'); return [{ id: 'first' }]; },
  ]) await assert.rejects(snapshots.fetchCompleteChangeOrderSnapshot(read, 1, 2));
});

const compiled = ts.transpileModule(readFileSync('src/app/api/procore/sync/change-order-packages/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function setup({ roster = [{ id: 'current', status: 'draft' }], failPersist = false, failLines = false } = {}) {
  const retired = [], saved = [];
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    'next/headers': { cookies: async () => ({ get: () => undefined }) },
    '@/lib/procoreSyncStream': { streamSyncResponse: run => run() },
    '@/lib/procore': {
      hasValidProcoreSyncSecret: () => true,
      withProcoreLiveApiBypassForSyncSecret: (_request, run) => run(),
      getClientCredentialsToken: async () => 'fixture-token', procoreConfig: { companyId: 'company' },
      makeRequest: async endpoint => {
        if (endpoint.includes('/prime_contracts?')) return [{ id: 'prime' }];
        if (endpoint.includes('/change_order_packages?')) {
          if (roster instanceof Error) throw roster;
          return roster;
        }
        return { id: 'current', status: 'draft', line_items: [{ id: 'line' }] };
      },
    },
    '@/lib/prisma': { prisma: { procoreChangeOrderPackage: {
      findUnique: async () => null,
      updateMany: async options => { retired.push(options); return { count: 2 }; },
    } } },
    '@/lib/procoreChangeOrderPackages': {
      ensureChangeOrderPackagesTable: async () => {},
      upsertChangeOrderPackage: async args => { if (failPersist) throw new Error('Failed header'); saved.push(args); },
      upsertChangeOrderPackageLine: async () => { if (failLines) throw new Error('Failed line'); return 'line'; },
      reconcileChangeOrderPackageLines: async () => {},
    },
    '@/lib/procorePotentialChangeOrders': { ensurePotentialChangeOrderTables: async () => {} },
    '@/lib/procoreCanonicalProjectIds': {}, '@/lib/procoreSyncResponse': {},
    '@/lib/procoreCommitmentMakerTasks': {}, '@/lib/procoreCommitmentMakerTaskQueue': {},
    '@/lib/procoreChangeOrderSnapshot': snapshots,
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => { assert.ok(id in mocks, id); return mocks[id]; }, module, module.exports);
  return { saved, retired, run: async () => (await module.exports.POST(new Request('http://localhost/api/procore/sync/change-order-packages', {
    method: 'POST', body: JSON.stringify({ companyId: 'company', projectIds: ['project'], syncScope: 'packages' }),
  }))).json() };
}

test('completed sync flags missing packages by company/project/prime-contract without changing source history', async () => {
  const route = setup(); const result = await route.run();
  assert.deepEqual(result.errors, []);
  assert.equal(result.totalPackagesRetired, 2);
  assert.equal(route.saved.length, 1);
  assert.equal(route.retired.length, 1);
  const { where, data } = route.retired[0];
  assert.deepEqual({ ...where, syncedAt: undefined }, {
    companyId: 'company', projectId: 'project', contractId: 'prime', packageId: { notIn: ['current'] },
    missingFromSourceAt: null, syncedAt: undefined,
  });
  assert.deepEqual(Object.keys(data), ['missingFromSourceAt']);
  assert.equal(data.missingFromSourceAt, where.syncedAt.lte, 'newer overlapping sync observations are preserved');
});

test('complete empty snapshots retire removed packages; unavailable or failed snapshots preserve them', async () => {
  const empty = setup({ roster: [] });
  assert.equal((await empty.run()).totalPackagesRetired, 2);
  assert.deepEqual(empty.retired[0].where.packageId.notIn, []);
  for (const options of [
    { roster: new Error('Error 404 not found') }, { roster: new Error('Error 403 forbidden') },
    { roster: { error: 'invalid' } }, { roster: [{ id: 'a' }, { id: 'a' }] },
    { failPersist: true }, { failLines: true },
  ]) {
    const route = setup(options); await route.run();
    assert.deepEqual(route.retired, [], JSON.stringify(options));
  }
});

test('upserting a source package clears absence while preserving ordinary source fields', async () => {
  const code = ts.transpileModule(readFileSync('src/lib/procoreChangeOrderPackages.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const queries = [], module = { exports: {} };
  new Function('require', 'module', 'exports', code)(() => ({ prisma: { $executeRawUnsafe: async (...args) => { queries.push(args); } } }), module, module.exports);
  await module.exports.upsertChangeOrderPackage({ companyId: 'company', projectId: 'project', contractId: 'prime', record: { id: 'restored', title: 'Original work', status: 'draft', grand_total: 123 } });
  assert.equal(queries.length, 1);
  assert.match(queries[0][0], /missing_from_source_at\s*=\s*NULL/);
  assert.equal(queries[0][4], 'restored');
  assert.equal(JSON.parse(queries[0].at(-1)).grand_total, 123);
});

test('Open Changes excludes missing packages but keeps current same-title records', async () => {
  const code = ts.transpileModule(readFileSync('src/app/api/pm-dashboard/changes/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const { isOpenPmChange, buildProcoreChangeUrl } = await import('../src/lib/pmDashboardChanges.ts');
  const now = new Date();
  let scopedCompanyId;
  const packages = [null, null, now].map((missingFromSourceAt, index) => ({
    projectId: 'project', contractId: 'prime', packageId: String(index), title: 'Same work',
    status: 'pending', payload: {}, syncedAt: now, missingFromSourceAt,
  }));
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/requestUser': { getRequestUserEmail: async () => 'pm@example.test' },
    '@/lib/pmDashboardChanges': { isOpenPmChange, buildProcoreChangeUrl },
    '@/lib/prisma': { prisma: {
      employee: { findFirst: async () => null }, pmcActionItem: { findMany: async () => [] },
      pmcProject: { findMany: async () => [{ procoreProjectId: 'project', projectName: 'Project' }] },
      procorePotentialChangeOrder: { findMany: async () => [{
        projectId: 'project', contractId: 'prime', changeOrderId: 'potential', title: 'Same work',
        status: 'pending', payload: {}, syncedAt: now,
      }] },
      procoreChangeOrderPackage: { findMany: async ({ where }) => {
        scopedCompanyId = where.companyId;
        assert.equal(where.missingFromSourceAt, null);
        assert.deepEqual(where.projectId.in, ['project']);
        return packages.filter(row => row.missingFromSourceAt === where.missingFromSourceAt);
      } },
    } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => { assert.ok(id in mocks, id); return mocks[id]; }, module, module.exports);
  const response = await module.exports.GET({});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const { items } = await response.json();
  assert.deepEqual(items.map(item => item.sourceId), ['0', '1', 'potential']);
  const base = `https://us02.procore.com/webclients/host/companies/${scopedCompanyId}/projects/project/tools/contracts/prime_contracts/prime/change_orders`;
  assert.deepEqual(items.map(item => item.sourceUrl), [
    `${base}/prime-change-order-batches/0`, `${base}/prime-change-order-batches/1`, `${base}/prime-change-orders/potential`,
  ]);
});
