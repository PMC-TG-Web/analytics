import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as catalog from '../src/lib/qboCostCatalog.ts';
const js = ts.transpileModule(fs.readFileSync('src/lib/qboCostCatalogSync.ts', 'utf8').replace('import.meta.url', '"file:///test.js"'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const company = '598134325805519';
const row = id => ({ id, catalog_id: 456, name: `Item ${id}`, cost_code: '03-200-30-20', unit: 'EA', type: 'CUSTOM', unit_cost: 12 });
function setup(read, state = null) {
  const writes = [];
  const imports = {
    'node:module': { createRequire: () => () => ({ [company]: { catalogId: '454507', name: 'Paradise Masonry' } }) },
    './prisma': { prisma: { procoreSyncProjectState: { findUnique: async () => state, upsert: async arg => writes.push(arg), update: async arg => writes.push(arg) } } },
    './procore': { getClientCredentialsToken: async () => 'test', makeRequest: read },
    './estimatingCostCodeCrosswalk': { loadEstimatingCostCodeCatalog: () => new Map() },
    './qboCostCatalog': catalog,
  };
  const module = { exports: {} };
  vm.runInNewContext(js, { exports: module.exports, Date, require: id => { assert.ok(imports[id], id); return imports[id]; } });
  return { ...module.exports, writes };
}
const roots = { data: [{ id: 454507, custom: true }] };
test('fetches every 100-item page and publishes one complete normalized catalog', async () => {
  const calls = [];
  const read = async endpoint => { calls.push(endpoint); return endpoint.includes('/items?') ? { data: endpoint.includes('page=1&') ? Array.from({ length: 100 }, (_, i) => row(i + 1)) : [row(101)] } : roots; };
  const h = setup(read);
  const result = await h.refreshQboCostCatalog(company);
  assert.equal(result.synced, true); assert.equal(calls.length, 3);
  assert.equal(h.writes[1].data.lastResult.items.length, 101);
  assert.equal(h.writes[0].create.dataset, 'qbo_cost_catalog');
});
test('a failed later page never replaces a complete prior snapshot', async () => {
  const h = setup(async endpoint => {
    if (!endpoint.includes('/items?')) return roots;
    if (endpoint.includes('page=1&')) return { data: Array.from({ length: 100 }, (_, i) => row(i + 1)) };
    throw Error('private provider failure');
  });
  await assert.rejects(h.refreshQboCostCatalog(company), /Automatic checks will retry/);
  assert.equal(h.writes.some(w => w.data?.lastResult), false);
  assert.equal(h.writes.at(-1).data.failureCount.increment, 1);
});
test('rejects repeated pages, empty snapshots, and unavailable company catalog', async () => {
  const h = setup();
  for (const read of [
    async endpoint => endpoint.includes('/items?') ? { data: Array.from({ length: 100 }, (_, i) => row(i + 1)) } : roots,
    async endpoint => endpoint.includes('/items?') ? { data: [] } : roots,
    async () => ({ data: [{ id: 454507, custom: false }] }),
  ]) await assert.rejects(h.readQboCostCatalog(company, read));
});
test('shared company cooldown avoids fetching repeatedly across machines', async () => {
  const h = setup(async () => assert.fail(), { nextRunAt: new Date(Date.now() + 60000) });
  assert.equal((await h.refreshQboCostCatalog(company)).synced, false); assert.equal(h.writes.length, 0);
});
