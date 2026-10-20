import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import { Prisma } from '@prisma/client';
import * as coding from '../src/lib/qboDirectCostCoding.ts';
import * as catalog from '../src/lib/qboCostCatalog.ts';
import * as costs from '../src/lib/qboDirectCosts.ts';
import * as labor from '../src/lib/qboDirectCostLabor.ts';
import * as food from '../src/lib/qboFoodTotal.ts';
import * as policy from '../src/lib/qboBillProjectPolicy.ts';
import * as pm from '../src/lib/qboProjectManagementRate.js';

function moduleAt(file, imports) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, { exports: m.exports, require: id => { assert.ok(imports[id], id); return imports[id]; } });
  return m.exports;
}
const mapping = moduleAt('src/lib/qboCatalogMapping.ts', { 'node:crypto': crypto, './qboCostCatalog': catalog });
const date = new Date('2026-10-19');
const sources = [
  { procoreId: '11', description: 'Travel Labor', costCode: '01-300-10-30', costType: 'Other', wbsCode: '01-300-10-30.O', uom: 'hours', unitCost: 0, updatedAt: date },
  { procoreId: '12', description: 'Foundation Labor - Foundation', costCode: '03-300-00-10', costType: 'Other', wbsCode: '03-300-00-10.O', uom: 'hours', unitCost: 0, updatedAt: date },
];
const prices = sources.map((s, i) => ({ itemId: String(21 + i), catalogId: '30', costCode: s.costCode, type: 'LABOR', uom: 'hr',
  name: i ? 'Labor General Foundation' : 'Labor Travel', unitCost: null, laborRate: i ? '72.37' : '70.85' }));

test('generic hourly PO types use exact labor catalog codes while retaining original evidence', () => {
  for (const original of sources) {
    for (const [costType, suffix] of [['Other', 'O'], ['O', 'O'], ['Commitments', 'C'], ['C', 'C']]) {
      const source = { ...original, costType, wbsCode: `${original.costCode}.${suffix}` };
      const result = coding.applyCatalogLaborCoding(source, prices);
      assert.equal(result.costType, 'Labor');
      assert.equal(result.sourceCostType, costType);
      assert.equal(result.sourceWbsCode, source.wbsCode);
      assert.equal(result.costCode, source.costCode);
      assert.equal(result.procoreId, source.procoreId);
      assert.equal(source.costType, costType);
    }
  }
});

test('classification requires hours, a generic source type, consistent WBS and an exclusively labor catalog code', () => {
  const source = sources[0];
  for (const changed of [
    ...['ls', 'ea', 'cy', '', null].map(uom => ({ uom })),
    ...['Materials', 'Equipment', 'Subcontractors', 'Labor Laser Screeding', null].map(costType => ({ costType })),
    { costCode: '99-999-99-99' }, { wbsCode: `${source.costCode}.S` },
    { wbsCode: '03-300-00-10.O' }, { directCostCodingIssue: 'Review source assignment' },
  ]) {
    const input = { ...source, ...changed };
    assert.equal(coding.applyCatalogLaborCoding(input, prices), input);
  }
  for (const items of [[], [{ ...prices[0], uom: 'ea' }], [...prices, { ...prices[0], type: 'MATERIAL', unitCost: '10' }]]) {
    assert.equal(coding.applyCatalogLaborCoding(source, items), source);
  }
});

async function fixture({ items = prices, stale = false, mappings = [] } = {}) {
  const snapshot = { version: 1, companyId: '1', fetchedAt: stale ? '2020-01-01T00:00:00Z' : new Date().toISOString(), items };
  const logs = sources.map((s, i) => ({ id: String(40 + i), procoreId: String(40 + i), lineItemId: s.procoreId, lineItemDescription: s.description, date, updatedAt: date, status: 'approved', quantityUsed: i ? 8 : 2 }));
  const prisma = {
    pmcProject: { findUnique: async () => ({ projectName: 'Example', projectNumber: '123' }) },
    productivityLog: { findMany: async () => logs },
    purchaseOrderLineItemContractDetail: { findMany: async ({ where }) => where.procoreId ? sources.filter(s => s.procoreId === where.procoreId) : sources },
    $queryRaw: async () => [], timecardEntry: { findMany: async () => [] },
    qboCostCatalogMapping: { findMany: async () => mappings, findUnique: async () => null },
    qboBillFoodTotal: { findUnique: async () => null }, qboBillFoodEntry: { findMany: async () => [] },
    qboBillLineRule: { findMany: async () => [] }, $transaction: async queries => Promise.all(queries),
  };
  const imports = {
    './prisma': { prisma }, '@prisma/client': { Prisma }, './qboDirectCostCoding': coding,
    './qboCostCatalog': catalog, './qboCatalogMapping': mapping,
    './loadQboCostCatalog': { loadQboCostCatalog: async () => snapshot },
    './qboProjectManagementRate.js': pm, './qboBillProjectPolicy': policy,
    './qboBillLineRules': { projectPrice: () => null }, './qboDirectCosts': costs,
    './qboDirectCostLabor': labor, './qboFoodTotal': food,
    './loadQboDirectCostLaborRates': { loadQboDirectCostLaborRates: async () => ({ rates: [], issue: null }) },
    './estimatingCostCodeCrosswalk': { loadEstimatingCostCodeCatalog: () => new Map() },
  };
  return {
    draft: await moduleAt('src/lib/loadQboDirectCosts.ts', imports).loadQboDirectCosts('1', '2', '2026-10'),
    picker: moduleAt('src/lib/loadQboCatalogMapping.ts', imports),
  };
}

test('monthly draft prices Travel and Foundation hourly labor by code despite differing catalog names', async () => {
  const { draft, picker } = await fixture();
  assert.equal(draft.issues.length, 0);
  assert.equal(draft.total, '720.66');
  assert.equal(draft.labor.combinedHours, '10');
  assert.equal(draft.labor.combinedPricedHours, '10');
  for (const [i, line] of draft.lines.entries()) {
    assert.equal(line.costType, 'Labor');
    assert.equal(line.costCode, sources[i].costCode);
    assert.equal(line.sourceCostType, 'Other');
    assert.equal(line.sourceWbsCode, sources[i].wbsCode);
    assert.equal(line.unitCost, prices[i].laborRate);
    assert.equal(line.catalogPrice.itemId, prices[i].itemId);
    assert.equal(line.sourceLogs[0].quantity, i ? '8' : '2');
  }
  const choices = await picker.loadQboCatalogMapping('1', '2', '11');
  assert.equal(choices.source.costType, 'Labor');
  assert.equal(choices.sourceSignature, mapping.catalogSourceSignature(draft.ruleItems[0]));
  assert.ok(choices.candidates.some(item => item.itemId === '21'));
  assert.equal(sources[0].costType, 'Other');
});

test('legacy labor keeps stale catalog, conflicting rates and unavailable saved mappings blocked', async () => {
  const stale = (await fixture({ stale: true })).draft;
  assert.equal(stale.lines.length, 0);
  assert.ok(stale.issues.some(issue => /refresh/.test(issue)));
  const conflicting = (await fixture({ items: [...prices, { ...prices[0], itemId: '99', laborRate: '80' }] })).draft;
  assert.ok(conflicting.issues.some(issue => /different current prices/.test(issue)));
  assert.equal(conflicting.lines.some(line => line.lineKey === '11'), false);
  const missingRate = (await fixture({ items: [{ ...prices[0], laborRate: null }, prices[1]] })).draft;
  assert.ok(missingRate.issues.some(issue => /missing prices/.test(issue)));
  const saved = (await fixture({ mappings: [{ lineItemId: '11', catalogItemId: '999', revision: 1, sourceSignature: 'old' }] })).draft;
  assert.ok(saved.issues.some(issue => /saved Cost Catalog item is unavailable/.test(issue)));
});
