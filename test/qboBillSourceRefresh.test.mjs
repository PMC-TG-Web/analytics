import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const js = ts.transpileModule(fs.readFileSync('src/lib/qboBillSourceRefresh.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function setup({ busy = false, states = [] } = {}) {
  const writes = [], calls = [];
  const imports = {
    './prisma': { prisma: {
      productivityLog: { findMany: async args => { assert.equal(args.where.procoreCompanyId, '1'); assert.ok(args.where.date); return ['2', '3'].map(procoreProjectId => ({ procoreProjectId })); } },
      procoreSyncProjectState: { findMany: async () => states, upsert: async arg => writes.push(arg), update: async arg => writes.push(arg) },
    } },
    './qboDirectCosts': { directCostMonth: () => ({ start: new Date('2026-09-01'), end: new Date('2026-10-01') }) },
    './procoreSyncQueue': { acquireProcoreWorker: async () => ({ acquired: !busy, leaseId: 'lease', reason: 'worker_busy' }), releaseProcoreWorker: async (...args) => calls.push(args) },
  };
  const module = { exports: {} };
  vm.runInNewContext(js, { exports: module.exports, Date, Map, Error, require: id => imports[id] });
  return { refresh: module.exports.refreshQboBillSources, writes, calls };
}
test('refresh is bounded to one monthly project and releases shared worker', async () => {
  const h = setup(); const synced = [];
  const r = await h.refresh('1', '2026-09', async id => synced.push(id));
  assert.deepEqual(synced, ['2']); assert.equal(r.status, 'synced');
  assert.equal(h.writes[0].create.dataset, 'bill_review_po');
  assert.equal(h.writes[0].create.nextRunAt - h.writes[0].create.lastAttemptAt, 300000);
  assert.equal(h.calls.length, 1);
});
test('shared cooldown skips a recently checked project across tabs', async () => {
  const h = setup({ states: [{ projectId: '2', nextRunAt: new Date(Date.now() + 300000) }] });
  assert.equal((await h.refresh('1', '2026-09', async id => assert.equal(id, '3'))).projectId, '3');
});
test('active worker or quota cooldown performs no ingestion', async () => {
  const h = setup({ busy: true });
  assert.equal((await h.refresh('1', '2026-09', async () => assert.fail())).status, 'waiting');
  assert.equal(h.writes.length, 0);
});

test('company catalog refresh precedes PO identity refresh and releases the shared lease', async () => {
  const h = setup();
  const r = await h.refresh('1', '2026-09', async () => assert.fail('PO sync should wait'), async () => ({ synced: true, checkedAt: 'now' }));
  assert.equal(r.scope, 'catalog'); assert.equal(h.calls.length, 1);
  assert.equal(h.writes.length, 0);
});

test('catalog cooldown allows PO refresh and failed catalog refresh still releases lease', async () => {
  const h = setup(); let po = 0;
  await h.refresh('1', '2026-09', async () => po++, async () => ({ synced: false }));
  assert.equal(po, 1);
  await assert.rejects(h.refresh('1', '2026-09', async () => assert.fail(), async () => { throw Error('catalog unavailable'); }));
  assert.equal(h.calls.length, 2);
});
test('failed sync is recorded and releases lease for automatic retries', async () => {
  const h = setup();
  await assert.rejects(h.refresh('1', '2026-09', async () => { throw Error('private provider response'); }), /Automatic checks will retry/);
  assert.equal(h.writes[1].data.failureCount.increment, 1);
  assert.equal(h.calls.length, 1);
});
