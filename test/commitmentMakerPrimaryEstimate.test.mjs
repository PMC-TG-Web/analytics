import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';
import * as maker from '../src/lib/procore/commitmentMaker.ts';

function load(file, dependencies) {
  const module = { exports: {} };
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', js)(id => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`);
    return dependencies[id];
  }, module, module.exports);
  return module.exports;
}
const logic = load('src/lib/procore/commitmentMakerEstimate.ts', { './commitmentMaker': maker });
const primary = { id: '10', name: 'Revised estimate', type: 'ESTIMATE', is_primary: true };
const group = { id: 'g1', name: 'Slabs' };
const line = (overrides = {}) => ({ id: '1', group_id: 'g1', name: 'Curing compound', quantity: 3,
  cost_code: { code: '03-300-40-30' }, cost_code_type: 'M', item_cost: 10,
  cost_item: { unit: 'EA', unit_cost: 3.33333 }, ...overrides });

test('only the explicit primary ESTIMATE is selected, never totals, name, recency or alternate inclusion', () => {
  assert.equal(logic.selectPrimaryCommitmentEstimate([{ ...primary, id: 'old', is_primary: false, total: 100 }, primary]), primary);
  for (const flag of [false, undefined, 'true', 1]) assert.throws(() => logic.selectPrimaryCommitmentEstimate([
    { ...primary, is_primary: flag, include_in_primary_estimate: true, name: 'Primary Estimate', total: 100 },
  ]), /No primary estimate/);
  assert.throws(() => logic.selectPrimaryCommitmentEstimate([primary, { ...primary, id: '11' }]), /More than one/);
  assert.throws(() => logic.selectPrimaryCommitmentEstimate([{ ...primary, type: 'ALTERNATE' }]), /No primary/);
});

test('Bid Board identity requires one explicit linked ID', () => {
  assert.equal(logic.selectCommitmentEstimateBoard(['123', null, '123']), '123');
  assert.throws(() => logic.selectCommitmentEstimateBoard([]), /no linked/);
  assert.throws(() => logic.selectCommitmentEstimateBoard(['123', '456']), /conflicting/);
  assert.throws(() => logic.selectCommitmentEstimateBoard(['Project name']), /conflicting/);
});

test('primary detail preserves source groups, exact extended cost and free hourly labor', () => {
  const parsed = logic.parsePrimaryCommitmentEstimate([
    line(), line({ id: '2', name: 'Labor', quantity: 12, item_cost: 0, labor_cost: 900, cost_item: { unit: 'HOURS', unit_cost: 0 } }),
    line({ id: '3', name: 'Concrete', quantity: 2, item_cost: 250, cost_item: { unit: 'CU_YD', unit_cost: 125 } }),
  ], [group]);
  assert.equal(parsed.groups[0].name, 'Slabs');
  const [material, labor, concrete] = parsed.groups[0].lineItems;
  assert.equal(material.unitCost, 3.3333);
  assert.equal(maker.commitmentMakerLineAmount(material), 10);
  assert.equal(labor.quantity, 12);
  assert.equal(labor.unitCost, 0);
  assert.equal(maker.commitmentMakerLineAmount(labor), 0);
  assert.equal(concrete.uom, 'cy');
});

test('credits keep their sign and exclusions match the workbook', () => {
  const parsed = logic.parsePrimaryCommitmentEstimate([
    line({ id: '1', quantity: -2, item_cost: -20, cost_item: { unit: 'EA', unit_cost: 10 } }),
    line({ id: '2', name: 'Shop Drawings' }), line({ id: '3', name: 'Overhead and Profit' }),
    line({ id: '4', name: 'Management labor', cost_item: { unit: 'HOURS' } }),
    line({ id: '5', quantity: 0 }), line({ id: '6', cost_code: '90-100-10-10' }),
  ], [group]);
  assert.equal(parsed.skippedRows, 5);
  assert.equal(maker.commitmentMakerLineAmount(parsed.groups[0].lineItems[0]), -20);
});

test('missing budget codes remain visible for validation; missing groups or prices cannot silently omit scope', () => {
  const parsed = logic.parsePrimaryCommitmentEstimate([line({ cost_code: null })], [group]);
  assert.equal(parsed.groups[0].lineItems[0].costCode, '');
  assert.throws(() => logic.parsePrimaryCommitmentEstimate([line()], []), /group.*could not be read/);
  assert.throws(() => logic.parsePrimaryCommitmentEstimate([line({ item_cost: null, cost_item: { unit: 'EA' } })], [group]), /missing quantity, cost/);
});

test('combine commands rebuild only authoritative groups and reject invented scope', () => {
  const a = logic.parsePrimaryCommitmentEstimate([line()], [group]).groups;
  const groups = [...a, { ...a[0], name: 'Walls', lineItems: [{ ...a[0].lineItems[0], unitCost: 5, subtotalOverride: 15 }] }];
  const result = logic.applyPrimaryEstimateCombinations(groups, [{ selectedNames: ['Slabs', 'Walls'], name: 'Slabs | Walls' }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].lineItems[0].quantity, 6);
  assert.equal(maker.commitmentMakerLineAmount(result[0].lineItems[0]), 25);
  assert.throws(() => logic.applyPrimaryEstimateCombinations(groups, [{ selectedNames: ['Slabs', 'Made up'], name: 'PO' }]), /at least two|no longer/);
});

test('only known rate-limit failures with unchanged source can resume an estimate import', () => {
  const imports = load('src/lib/procoreCommitmentMakerEstimateImport.ts', {
    'node:crypto': { randomUUID }, '@/lib/prisma': { prisma: {} }, '@/lib/procore/commitmentMakerEstimate': logic,
  });
  const state = { fingerprint: 'same', status: 'retryable', targets: [{ name: 'Slabs', id: '12', number: '001' }] };
  assert.equal(imports.primaryEstimateImportBlock(null, 'same'), null);
  assert.equal(imports.primaryEstimateImportBlock(state, 'same'), null);
  assert.match(imports.primaryEstimateImportBlock(state, 'changed'), /changed after a partial/);
  for (const status of ['running', 'uncertain']) assert.match(imports.primaryEstimateImportBlock({ ...state, status }, 'same'), /blocked/);
  assert.match(imports.primaryEstimateImportBlock({ ...state, status: 'completed' }, 'same'), /already imported into PO 001/);
});

function sourceFixture({ cached = null, failPath = '', malformed = false } = {}) {
  const calls = [];
  const writes = [];
  const prisma = {
    pmcProject: { findUnique: async () => ({ bidBoardId: '123' }) },
    pmcBidBoardProject: { findMany: async () => [{ bidBoardId: '123' }] },
    procoreEstimateProposal: { findMany: async () => [] },
    $queryRaw: async () => cached ? [cached] : [],
    $executeRaw: async (...args) => { writes.push(args); return 1; },
  };
  const api = async ({ path }) => {
    calls.push(path);
    if (path.includes(failPath) && failPath) throw new Error('Rate limited');
    const payload = path.includes('/line_items?') ? (malformed ? { unexpected: [] } : [line()])
      : path.includes('/line_item_groups?') ? [group] : [primary];
    return { ok: true, status: 200, payload };
  };
  const source = load('src/lib/procoreCommitmentMakerEstimateSource.ts', {
    '@/lib/prisma': { prisma }, '@/lib/procoreCommitmentMakerClient': { commitmentMakerProcoreJson: api },
    '@/lib/procore/commitmentMakerEstimate': logic,
  });
  return { source, calls, writes };
}

test('warm preview skips live reads; create rereads the primary and all detail', async () => {
  const snapshot = { bidBoardProjectId: '123', proposal: primary, lines: [line()], groups: [group], fetchedAt: new Date().toISOString() };
  const fixture = sourceFixture({ cached: { snapshot, fetched_at: new Date() } });
  const options = { companyId: 'co', projectId: 'project', forceLive: false, getToken: async () => 'test' };
  assert.deepEqual(await fixture.source.readPrimaryCommitmentEstimate(options), snapshot);
  assert.equal(fixture.calls.length, 0);
  await fixture.source.readPrimaryCommitmentEstimate({ ...options, forceLive: true });
  assert.equal(fixture.calls.length, 4);
  assert.equal(fixture.writes.length, 1);
});

test('partial or malformed detail reads never publish a cache or fall back during create', async () => {
  for (const config of [{ failPath: '/line_items?' }, { malformed: true }]) {
    const fixture = sourceFixture(config);
    await assert.rejects(fixture.source.readPrimaryCommitmentEstimate({ companyId: 'co', projectId: 'project', forceLive: true, getToken: async () => 'test' }));
    assert.equal(fixture.writes.length, 0);
  }
});

test('primary estimate route uses server detail and fingerprints the proposal identity', () => {
  const route = readFileSync('src/app/api/procore/commitments-live/maker/route.ts', 'utf8');
  assert.match(route, /primaryParsed \? applyPrimaryEstimateCombinations\(primaryParsed.groups, estimateCombinations\)/);
  assert.match(route, /estimateIdentity: \[companyId, sourceEstimate.bidBoardProjectId, sourceEstimate.proposalId\]/);
  assert.match(route, /forceLive: mode === "create" \|\| body.refreshEstimate === true/);
  assert.match(route, /savePrimaryEstimateImport\(estimateClaim, estimateTargets\)/);
});
