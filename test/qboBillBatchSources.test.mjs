import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { BatchWait } from '../src/lib/qboBillBatch.ts';
import * as responseHelpers from '../src/lib/procoreSyncResponse.ts';
import { procoreMonthWindow } from '../src/lib/procoreDateWindow.ts';
import { withProcoreConnection, currentProcoreConnection } from '../src/lib/procoreConnection.ts';

function sources({ acquired = true, reply = { success: true }, status = 200, catalog = { lastSuccessAt: new Date(), lastError: null } } = {}) {
  const calls = []; let released = 0;
  const handler = name => async request => { assert.equal(currentProcoreConnection(), 'billing'); calls.push({ name, headers: Object.fromEntries(request.headers), body: await request.json() }); return Response.json(reply, { status }); };
  const imports = {
    'next/server': { NextRequest: Request }, './prisma': { prisma: { procoreSyncProjectState: { findUnique: async () => catalog } } },
    './qboBillBatch': { BatchWait },
    './procoreDateWindow': { procoreMonthWindow: month => procoreMonthWindow(month, new Date('2026-09-29T14:00:00Z')) },
    './procoreConnection': { withBillingProcoreConnection: work => withProcoreConnection('billing', work) },
    './procoreSyncQueue': { acquireProcoreWorker: async () => { assert.equal(currentProcoreConnection(), 'billing'); return { acquired, leaseId: 'test' }; }, releaseProcoreWorker: async () => { assert.equal(currentProcoreConnection(), 'billing'); released++; } },
    './procore': { withProcoreLiveApiBypassForSyncSecret: async (request, work) => { assert.equal(request.headers.get('x-procore-connection'), 'billing'); return work(); } },
    './qboCostCatalogSync': { refreshQboCostCatalog: async () => ({ synced: false }) }, './procoreSyncResponse': responseHelpers,
    '@/app/api/procore/sync/purchase-order-line-item-details/route': { POST: handler('po') },
    '@/app/api/procore/sync/productivity-projects/route': { POST: handler('logs') },
    '@/app/api/procore/sync/timecard-entries/route': { POST: handler('timecards') },
  };
  const js = ts.transpileModule(fs.readFileSync('src/lib/qboBillBatchSources.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} }; vm.runInNewContext(js, { exports: m.exports, Date, Error, process: { env: { PROCORE_SYNC_SECRET: 'local-test-secret' } }, require: id => { if (!(id in imports)) throw new Error('Unmocked dependency'); return imports[id]; } });
  return { ...m.exports, calls, released: () => released };
}
test('source refresh targets only the selected project and exact month on the Billing worker connection', async () => {
  const h = sources();
  for (const stage of ['purchase_orders', 'daily_logs', 'timecards']) await h.refreshBillBatchSources('1', '2', '2026-02', stage);
  assert.deepEqual(h.calls.map(c => c.name), ['po', 'logs', 'timecards']);
  for (const call of h.calls) { assert.deepEqual(call.body.projectIds, ['2']); assert.equal(call.body.companyId, '1'); assert.equal(call.body.startDate, '2026-02-01'); assert.equal(call.body.endDate, '2026-02-28'); assert.equal(call.body.persist, true); }
  assert.equal(h.released(), 3);
});
test('quota and worker contention wait without advancing from incomplete data', async () => {
  const occupied = sources({ acquired: false }); await assert.rejects(occupied.refreshBillBatchSources('1', '2', '2026-09', 'daily_logs'), BatchWait); assert.equal(occupied.calls.length, 0); assert.equal(occupied.released(), 0);
  const quota = sources({ reply: { success: false, errors: ['429 rate limit'] } }); await assert.rejects(quota.refreshBillBatchSources('1', '2', '2026-09', 'daily_logs'), BatchWait); assert.equal(quota.released(), 1);
});

test('current-month source refresh stops at today for logs and timecards', async () => {
  const h = sources();
  for (const stage of ['daily_logs', 'timecards']) await h.refreshBillBatchSources('1', '2', '2026-09', stage);
  for (const call of h.calls) {
    assert.equal(call.body.startDate, '2026-09-01');
    assert.equal(call.body.endDate, '2026-09-29');
  }
  const future = sources();
  await assert.rejects(future.refreshBillBatchSources('1', '2', '2026-10', 'daily_logs'), /Future months/);
  assert.equal(future.calls.length, 0);
  assert.equal(future.released(), 0);
});
test('successful HTTP with partial ingestion errors cannot authorize bill processing', async () => {
  for (const reply of [{ success: true, errors: ['one project failed'] }, { success: true, summary: { errors: ['partial sync'] } }, { success: true, activeProjects: [{ status: 'unavailable' }] }]) {
    const h = sources({ reply }); await assert.rejects(h.refreshBillBatchSources('1', '2', '2026-09', 'purchase_orders'), /did not complete/); assert.equal(h.released(), 1);
  }
});
test('cached stale or failed catalog does not count as a successful refresh', async () => {
  for (const catalog of [null, { lastSuccessAt: new Date(0), lastError: null }, { lastSuccessAt: new Date(), lastError: 'refresh failed' }]) {
    const h = sources({ catalog }); await assert.rejects(h.refreshBillBatchSources('1', '2', '2026-09', 'catalog'), BatchWait); assert.equal(h.released(), 1);
  }
  const fresh = sources(); await fresh.refreshBillBatchSources('1', '2', '2026-09', 'catalog'); assert.equal(fresh.calls.length, 0);
});
