import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import * as catalog from '../src/lib/qboCostCatalog.ts';

function moduleAt(file, imports) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { exports: module.exports, require: id => { assert.ok(imports[id], id); return imports[id]; } });
  return module.exports;
}
const logic = moduleAt('src/lib/qboCatalogMapping.ts', { 'node:crypto': crypto, './qboCostCatalog': catalog });
const source = { description: 'Custom rebar description', costCode: '03-200-30-20', costType: 'Materials', uom: 'Each' };
const price = { itemId: '123', catalogId: '456', name: '#4 Rebar', costCode: '03-200-30-21', uom: 'ea', type: 'CUSTOM', unitCost: '8.25', laborRate: null };
const saved = () => ({ catalogItemId: '123', sourceSignature: logic.catalogSourceSignature(source), revision: 1 });
test('explicit choice resolves a renamed item and legacy code while retaining the source assignment', () => {
  const result = logic.mappedCatalogPrice(source, [price], new Map(), saved());
  assert.equal(result.unitCost, 8.25); assert.equal(result.issue, null);
  assert.equal(source.costCode, '03-200-30-20');
  assert.equal(logic.mappedCatalogPrice(source, [{ ...price, unitCost: '9' }], new Map(), saved()).unitCost, 9);
});
test('saved mappings block changed source identities and unavailable or incompatible catalog prices', () => {
  assert.match(logic.mappedCatalogPrice({ ...source, description: '#5 Rebar' }, [price], new Map(), saved()).issue, /source item changed/);
  for (const items of [[], [{ ...price, uom: 'lf' }], [{ ...price, unitCost: null }], [{ ...price, type: 'LABOR', laborRate: '70' }]]) {
    assert.match(logic.mappedCatalogPrice(source, items, new Map(), saved()).issue, /unavailable/);
  }
});
test('picker offers compatible positive rates and clearing restores automatic matching', () => {
  const choices = logic.catalogMappingCandidates(source, [price, { ...price, itemId: '124', uom: 'sf' }, { ...price, itemId: '125', unitCost: '0' }]);
  assert.equal(choices.length, 1); assert.equal(choices[0].sameCostCode, false);
  assert.match(logic.mappedCatalogPrice(source, [price], new Map(), { ...saved(), catalogItemId: null }).issue, /no matching/);
});
function service({ existing = null, changedDuringSave = false } = {}) {
  const writes = [];
  const prisma = {
    purchaseOrderLineItemContractDetail: { findMany: async ({ where }) => { assert.equal(where.procoreCompanyId, '1'); assert.equal(where.procoreProjectId, '2'); assert.equal(where.procoreId, '3'); return [source]; } },
    qboCostCatalogMapping: {
      findUnique: async () => existing,
      create: async ({ data }) => { if (changedDuringSave) throw Object.assign(Error('unique'), { code: 'P2002' }); writes.push(data); },
      updateMany: async ({ where, data }) => { assert.equal(where.revision, existing.revision); if (changedDuringSave) return { count: 0 }; writes.push(data); return { count: 1 }; },
    },
  };
  const snapshot = { version: 1, companyId: '1', fetchedAt: new Date().toISOString(), items: [price] };
  return { ...moduleAt('src/lib/loadQboCatalogMapping.ts', { './prisma': { prisma }, './loadQboCostCatalog': { loadQboCostCatalog: async () => snapshot }, './qboCostCatalog': catalog, './qboCatalogMapping': logic }), writes };
}
const input = () => ({ companyId: '1', projectId: '2', lineItemId: '3', catalogItemId: '123', sourceSignature: logic.catalogSourceSignature(source), revision: 0 });
test('save validates server-side choices and records operator without accepting a browser price', async () => {
  const h = service(); await h.saveQboCatalogMapping({ ...input(), unitCost: '0.01' }, 'operator@example.test');
  assert.equal(h.writes[0].catalogItemId, '123'); assert.equal(h.writes[0].updatedBy, 'operator@example.test'); assert.equal(h.writes[0].unitCost, undefined);
  await assert.rejects(h.saveQboCatalogMapping({ ...input(), catalogItemId: '999' }, 'operator'), /matching unit/);
  await assert.rejects(h.saveQboCatalogMapping({ ...input(), sourceSignature: 'old' }, 'operator'), /changed/);
});
test('concurrent creates and updates require reopening instead of overwriting another choice', async () => {
  for (const existing of [null, saved()]) {
    const h = service({ existing, changedDuringSave: true });
    await assert.rejects(h.saveQboCatalogMapping({ ...input(), revision: existing?.revision || 0 }, 'operator'), /Another operator/);
    assert.equal(h.writes.length, 0);
  }
});
