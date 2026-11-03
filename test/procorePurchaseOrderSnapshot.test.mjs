import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as snapshot from '../src/lib/procorePurchaseOrderSnapshot.ts';

test('PO snapshots retain distinct source IDs even when the replacement reuses a number', async () => {
  const pages = [[{ id: 'new-1', number: 'PO-001' }, { id: 'new-2', number: 'PO-001' }], [{ id: 'other' }]];
  const records = await snapshot.fetchCompletePurchaseOrderSnapshot(async page => ({ data: pages[page - 1] }), 2);
  assert.deepEqual(records.map(row => row.id), ['new-1', 'new-2', 'other']);
  assert.deepEqual(await snapshot.fetchCompletePurchaseOrderSnapshot(async () => [], 100), []);
});

test('failed, malformed, repeating and truncated PO rosters cannot retire saved POs', async () => {
  for (const fetchPage of [
    async () => ({ error: 'unavailable' }), async () => [{ number: 'PO-001' }],
    async () => [{ id: 'same' }], async page => [{ id: String(page) }],
    async page => { if (page > 1) throw new Error('page failed'); return [{ id: 'first' }]; },
  ]) await assert.rejects(snapshot.fetchCompletePurchaseOrderSnapshot(fetchPage, 1, 2));
});

const compiled = ts.transpileModule(readFileSync('src/app/api/procore/sync/purchase-order-line-item-details/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup({ roster = [{ id: 'current-po' }], detailError, skipped = 0, persist = true } = {}) {
  const retired = [], saved = [];
  let refreshes = 0;
  const mocks = {
    '@/lib/procoreSyncStream': { streamSyncResponse: run => run() },
    '@/lib/procore': {
      hasValidProcoreSyncSecret: () => true,
      withProcoreLiveApiBypassForSyncSecret: (_request, run) => run(),
      getClientCredentialsToken: async () => 'fixture-token', procoreConfig: { companyId: 'company' },
      makeRequest: async endpoint => {
        if (endpoint.includes('/purchase_order_contracts?')) {
          if (roster instanceof Error) throw roster;
          return roster;
        }
        if (detailError) throw detailError;
        return [{ id: 'current-line' }];
      },
    },
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    'next/headers': { cookies: () => { throw new Error('Worker must not read cookies'); } },
    '@/lib/procoreConnection': { currentProcoreConnection: () => 'analytics-sync' },
    '@/lib/prisma': { prisma: { purchaseOrderContract: { updateMany: async options => { retired.push(options); return { count: 5 }; } } } },
    '@/lib/procorePurchaseOrderLineItemDetails': { persistPurchaseOrderLineItemDetails: async (...args) => {
      saved.push(args); return { saved: 1, skipped, projectCreated: false };
    } },
    '@/lib/commitmentsAggMv': { refreshCommitmentsAggMaterializedView: async () => { refreshes++; } },
    '@/lib/procoreSyncRequestCookies': { readProcoreSyncCookieValues: async () => ({}) },
    '@/lib/procorePurchaseOrderSnapshot': snapshot,
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => { assert.ok(id in mocks, id); return mocks[id]; }, module, module.exports);
  return {
    retired, saved, refreshes: () => refreshes,
    run: async () => {
      const response = await module.exports.POST(new Request('http://localhost/api/procore/sync/purchase-order-line-item-details', {
        method: 'POST', body: JSON.stringify({ companyId: 'company', projectIds: ['project'], persist, persistUnpackedFields: false }),
      }));
      return response.json();
    },
  };
}

test('successful project sync retires only missing POs in that company and project after persistence', async () => {
  const route = setup();
  const result = await route.run();
  assert.equal(route.saved.length, 1);
  assert.equal(result.retiredPurchaseOrderContracts, 5);
  assert.equal(route.retired.length, 1);
  const { where, data } = route.retired[0];
  assert.equal(where.procoreCompanyId, 'company');
  assert.equal(where.procoreProjectId, 'project');
  assert.deepEqual(where.procoreId, { not: null, notIn: ['current-po'] });
  assert.equal(where.procoreDeletedAt, null);
  assert.equal(where.updatedAt.lte, data.procoreDeletedAt);
  assert.ok(data.procoreDeletedAt instanceof Date);
});

test('a successful empty roster retires removed POs and refreshes summaries', async () => {
  const route = setup({ roster: [] });
  const result = await route.run();
  assert.equal(result.retiredPurchaseOrderContracts, 5);
  assert.deepEqual(route.retired[0].where.procoreId.notIn, []);
  assert.equal(route.saved.length, 0);
  assert.equal(route.refreshes(), 1);
});

test('preview, unavailable endpoints, malformed rosters, failed details and skipped saves never retire POs', async () => {
  const unavailable = Object.assign(new Error('Unavailable'), { status: 404 });
  for (const options of [
    { persist: false }, { roster: unavailable }, { roster: { error: 'invalid response' } },
    { roster: [{ id: 'a' }, { id: 'a' }] }, { detailError: unavailable },
    { detailError: new Error('Failed details') }, { skipped: 1 },
  ]) {
    const route = setup(options);
    await route.run();
    assert.deepEqual(route.retired, [], JSON.stringify(options));
  }
});

test('snapshot retirement requires explicit valid company and project scope', async () => {
  const db = { purchaseOrderContract: { updateMany: () => { throw new Error('must not write'); } } };
  for (const overrides of [{ companyId: '' }, { projectId: '' }, { startedAt: new Date('invalid') }, { contracts: [{ id: '' }] }]) {
    await assert.rejects(snapshot.retireMissingPurchaseOrders(db, {
      companyId: 'company', projectId: 'project', contracts: [], startedAt: new Date(), ...overrides,
    }), /snapshot/);
  }
});
