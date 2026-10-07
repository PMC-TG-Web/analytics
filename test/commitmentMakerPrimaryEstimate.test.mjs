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

test('exact catalog item assignments supply codes and types without replacing estimate prices', () => {
  const original = line({ cost_code: null, cost_code_type: null,
    cost_item: { id: 100, catalog_id: 20, unit: 'EA', unit_cost: 3.33333 } });
  const enriched = logic.enrichPrimaryEstimateBudgetCodes([original], [
    { id: 100, catalog_id: 20, cost_code: '03-300-00-20', cost_type_code: 'CON', unit_cost: 999 },
  ]);
  const parsed = logic.parsePrimaryCommitmentEstimate(enriched, [group]).groups[0].lineItems[0];
  assert.equal(parsed.costCode, '03-300-00-20');
  assert.equal(parsed.costType, 'CON');
  assert.equal(parsed.unitCost, 3.3333);
  assert.equal(maker.commitmentMakerLineAmount(parsed), 10);
  assert.equal(original.cost_item.cost_code, undefined);
  assert.equal(logic.enrichPrimaryEstimateBudgetCodes([original], [{ id: 101, name: original.name, cost_code: 'wrong' }])[0], original);
  assert.equal(logic.primaryEstimateCostAssignment(logic.enrichPrimaryEstimateBudgetCodes([original],
    [{ id: 100, catalog_id: 21, cost_code: '03-300-00-20' }])[0]).code, '03-300-00-20');
  assert.throws(() => logic.enrichPrimaryEstimateBudgetCodes([original], [{ id: 100 }, { id: 100 }]), /conflicting/);
});

test('estimate-specific codes and cost types take priority over catalog defaults', () => {
  const catalog = [{ id: 100, cost_code: '03-300-00-20', cost_type_code: 'CON' }];
  for (const coding of [{ cost_code: '03-200-10-20' }, { budget_code: { flat_code: '03-200-10-20.L' } }, { wbs_code: '03-200-10-20.L' }]) {
    const original = line({ cost_code: null, cost_code_type: null, cost_item: { id: 100, unit: 'EA', cost_code: '03-300-00-20', cost_type_code: 'CON' }, ...coding });
    const [enriched] = logic.enrichPrimaryEstimateBudgetCodes([original], catalog);
    assert.equal(enriched, original);
    const parsed = logic.parsePrimaryCommitmentEstimate([enriched], [group]).groups[0].lineItems[0];
    assert.equal(parsed.costCode, '03-200-10-20');
    assert.equal(parsed.costType, coding.cost_code ? 'M' : 'L');
  }
  const [enriched] = logic.enrichPrimaryEstimateBudgetCodes([line({ cost_code: null, cost_code_type: 'E', cost_item: { id: 100, unit: 'EA' } })], catalog);
  assert.equal(logic.primaryEstimateCostAssignment(enriched).type, 'E');
});

const component = (name, code, overrides = {}) => ({ name, description: `Original ${name}`, type: 'CUSTOM',
  unit: 'EA', unit_cost: 999, cost_code: code, cost_type_code: 'M', ...overrides });
const detached = (name, overrides = {}) => line({ cost_code: null, cost_code_type: null,
  cost_item: { ...component(name, undefined), id: '0', catalog_id: '20', unit_cost: 3.33333 }, ...overrides });
const assembly = (id, ...items) => ({ id, sub_items: items });

test('detached assembly children resolve original metadata and source group, preserving overrides', () => {
  const rebar = component('#4 Rebar', '03-200-10-20');
  const wallRebar = { ...rebar, cost_code: '03-200-20-20' };
  const footingLabor = component('Footing Labor', '03-300-00-12', { type: 'LABOR', cost_type_code: 'L', unit: 'HOURS' });
  const wallLabor = component('Wall Labor', '03-300-20-10', { type: 'LABOR', cost_type_code: 'L', unit: 'HOURS' });
  const catalogs = new Map([['20', [assembly('a', rebar, footingLabor), assembly('b', wallRebar, wallLabor)]]]);
  const originals = [detached('#4 Rebar', { name: 'Edited field description' }),
    detached('Footing Labor', { id: '2', cost_item: { ...footingLabor, id: 0, catalog_id: 20, cost_code: null, unit_cost: 0 } }),
    detached('#4 Rebar', { id: '3', group_id: 'g2' }),
    detached('Wall Labor', { id: '4', group_id: 'g2', cost_item: { ...wallLabor, id: '0', catalog_id: '20', cost_code: null, unit_cost: 0 } })];
  const enriched = logic.enrichPrimaryEstimateBudgetCodes(originals, [], catalogs);
  assert.deepEqual(enriched.map(l => logic.primaryEstimateCostAssignment(l).code),
    ['03-200-10-20', '03-300-00-12', '03-200-20-20', '03-300-20-10']);
  const parsed = logic.parsePrimaryCommitmentEstimate(enriched, [group, { id: 'g2', name: 'Other scope' }]);
  assert.equal(parsed.groups[0].lineItems[0].description, 'Edited field description');
  assert.equal(parsed.groups[0].lineItems[0].unitCost, 3.3333);
  assert.equal(maker.commitmentMakerLineAmount(parsed.groups[0].lineItems[0]), 10);
  assert.equal(parsed.groups[0].lineItems[1].costType, 'L');
  assert.equal(parsed.groups[0].lineItems[1].unitCost, 0);
  assert.equal(originals[0].cost_item.cost_code, undefined);
  // Units are an estimate override, not a substitute catalog assignment.
  const forms = detached('Forms');
  const [codedForms] = logic.enrichPrimaryEstimateBudgetCodes([forms], [], new Map([['20',
    [assembly('a', component('Forms', '03-100-10-20', { unit: 'SQ_FT' }))]]]));
  assert.equal(codedForms.cost_item.unit, 'EA');
  assert.equal(logic.primaryEstimateCostAssignment(codedForms).code, '03-100-10-20');
});

test('detached coding never guesses across catalogs, conflicting assemblies, or original identities', () => {
  const rebar = component('#4 Rebar', '03-200-10-20');
  const roots = [assembly('a', rebar, component('Footing Labor', '03-300-00-12')),
    assembly('b', { ...rebar, cost_code: '03-200-20-20' }, component('Wall Labor', '03-300-20-10'))];
  const catalogs = new Map([['20', roots]]);
  const ambiguous = detached('#4 Rebar');
  assert.equal(logic.enrichPrimaryEstimateBudgetCodes([ambiguous], [], catalogs)[0], ambiguous);
  const conflicting = [ambiguous, detached('Footing Labor', { id: '2' }), detached('Wall Labor', { id: '3' })];
  assert.equal(logic.enrichPrimaryEstimateBudgetCodes(conflicting, [], catalogs)[0], ambiguous);
  for (const override of [{ catalog_id: '21' }, { id: '123' }, { description: 'Different item' },
    { manufacturer: 'Different manufacturer' }, { name: '#5 Rebar' }, { description: '' }]) {
    const original = detached('#4 Rebar');
    original.cost_item = { ...original.cost_item, ...override };
    assert.equal(logic.enrichPrimaryEstimateBudgetCodes([original], [], new Map([['20', [roots[0]]]]))[0], original);
  }
  const ungrouped = [detached('#4 Rebar', { group_id: null }), detached('Footing Labor', { id: '2', group_id: null })];
  assert.equal(logic.enrichPrimaryEstimateBudgetCodes(ungrouped, [], catalogs)[0], ungrouped[0]);
  const explicit = detached('#4 Rebar', { cost_code: '03-200-40-20', cost_code_type: 'E' });
  assert.equal(logic.enrichPrimaryEstimateBudgetCodes([explicit], [], catalogs)[0], explicit);
});

test('repeated assembly components may resolve only when all matching codes and types agree', () => {
  const original = detached('Forms', { cost_code_type: 'E' });
  const forms = component('Forms', '03-100-10-20');
  const catalogs = new Map([['20', [assembly('a', forms), assembly('b', forms)]]]);
  const [enriched] = logic.enrichPrimaryEstimateBudgetCodes([original], [], catalogs);
  assert.equal(logic.primaryEstimateCostAssignment(enriched).code, '03-100-10-20');
  assert.equal(logic.primaryEstimateCostAssignment(enriched).type, 'E');
  for (const changed of [{ ...forms, cost_code: null }, { ...forms, cost_type_code: 'L' }]) {
    assert.equal(logic.enrichPrimaryEstimateBudgetCodes([original], [], new Map([['20',
      [assembly('a', forms), assembly('b', changed)]]]))[0], original);
  }
});

test('custom and subcontractor categories are equivalent without losing LS coding or assembly ambiguity checks', () => {
  const screed = component('Boom screed', '03-300-20-30', { cost_type_code: 'LS' });
  const slabLabor = component('Slab labor', '03-300-20-10', { type: 'LABOR', cost_type_code: 'L' });
  const siteLabor = component('Site labor', '03-300-30-10', { type: 'LABOR', cost_type_code: 'L' });
  const catalogs = new Map([['20', [assembly('slab', screed, slabLabor),
    assembly('site', { ...screed, cost_code: '03-300-30-30' }, siteLabor)]]]);
  const original = detached('Boom screed');
  original.cost_item.type = 'SUBCONTRACTOR';
  const sibling = detached('Slab labor', { id: '2', cost_item: { ...slabLabor, id: '0', catalog_id: '20' } });
  const [enriched] = logic.enrichPrimaryEstimateBudgetCodes([original, sibling], [], catalogs);
  assert.deepEqual(logic.primaryEstimateCostAssignment(enriched), { code: '03-300-20-30', type: 'LS' });
  assert.equal(enriched.cost_item.type, 'SUBCONTRACTOR');
  assert.equal(enriched.cost_item.unit_cost, original.cost_item.unit_cost);
  assert.equal(original.cost_item.cost_code, undefined);
  const parsed = logic.parsePrimaryCommitmentEstimate([enriched], [group]).groups[0].lineItems[0];
  assert.equal(parsed.costType, 'LS');
  assert.equal(maker.commitmentMakerLineAmount(parsed), 10);
  // The equivalence works in either direction; a unique assignment needs no
  // group hint, while conflicting Site/SOG assignments still require siblings.
  const custom = detached('Boom screed');
  const subcontractorCatalog = new Map([['20', [assembly('slab', { ...screed, type: 'SUBCONTRACTOR' })]]]);
  assert.deepEqual(logic.primaryEstimateCostAssignment(logic.enrichPrimaryEstimateBudgetCodes([custom], [], subcontractorCatalog)[0]),
    { code: '03-300-20-30', type: 'LS' });
  assert.deepEqual(logic.primaryEstimateCostAssignment(logic.enrichPrimaryEstimateBudgetCodes([original], [],
    new Map([['20', [assembly('slab', screed)]]]))[0]), { code: '03-300-20-30', type: 'LS' });
  for (const lines of [[original], [original, { ...sibling, group_id: 'g2' }],
    [original, sibling, detached('Site labor', { id: '3', cost_item: { ...siteLabor, id: '0', catalog_id: '20' } })]]) {
    assert.equal(logic.enrichPrimaryEstimateBudgetCodes(lines, [], catalogs)[0], original);
  }
  for (const changes of [{ type: 'LABOR' }, { type: 'EQUIPMENT' }, { catalog_id: '21' },
    { description: 'Different' }, { manufacturer: 'Different' }, { catalog_number: 'Different' }, { name: 'Different' }]) {
    const changed = { ...original, cost_item: { ...original.cost_item, ...changes } };
    assert.equal(logic.enrichPrimaryEstimateBudgetCodes([changed, sibling], [], catalogs)[0], changed);
  }
  const duplicate = new Map([['20', [assembly('slab', screed, { ...screed, cost_type_code: 'E' }, slabLabor)]]]);
  assert.equal(logic.enrichPrimaryEstimateBudgetCodes([original, sibling], [], duplicate)[0], original);
  const explicit = { ...original, cost_code: '03-300-40-30', cost_code_type: 'LS' };
  assert.equal(logic.enrichPrimaryEstimateBudgetCodes([explicit, sibling], [], catalogs)[0], explicit);
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

function sourceFixture({ cached = null, prepared = null, failPath = '', malformed = false, lines = [line()], catalogDetail = null, assemblyPages = null } = {}) {
  const calls = [];
  const writes = [];
  const prisma = {
    pmcProject: { findUnique: async () => ({ bidBoardId: '123' }) },
    pmcBidBoardProject: { findMany: async () => [{ bidBoardId: '123' }] },
    procoreEstimateProposal: { findMany: async () => [] },
    $queryRaw: async () => cached ? [cached] : [],
    $executeRaw: async (...args) => { writes.push(args); return 1; },
  };
  const api = async ({ path, companyId }) => {
    assert.equal(companyId, 'co');
    calls.push(path);
    if (path.includes(failPath) && failPath) throw new Error('Rate limited');
    const payload = path.includes('/catalogs/items/') ? (typeof catalogDetail === 'function' ? catalogDetail(path.split('/').at(-1)) : catalogDetail)
      : path.includes('/catalogs/') ? (typeof assemblyPages === 'function' ? assemblyPages(path) : assemblyPages)
      : path.includes('/line_items?') ? (malformed ? { unexpected: [] } : lines)
      : path.includes('/line_item_groups?') ? [group] : [primary];
    return { ok: true, status: 200, payload };
  };
  const source = load('src/lib/procoreCommitmentMakerEstimateSource.ts', {
    '@/lib/procoreCommitmentEstimateRead': { openCommitmentEstimateRead: async () => ({ snapshot: prepared, read: (_key, fn) => fn(), complete: async snapshot => snapshot }) },
    '@/lib/prisma': { prisma }, '@/lib/procoreCommitmentMakerClient': { commitmentMakerProcoreJson: api },
    '@/lib/procore/commitmentMakerEstimate': logic,
  });
  return { source, calls, writes };
}

test('warm preview skips live reads; create rereads the primary and all detail', async () => {
  const snapshot = { bidBoardProjectId: '123', proposal: primary, lines: [line()], groups: [group], fetchedAt: new Date().toISOString(), budgetCodesVersion: 3 };
  const fixture = sourceFixture({ cached: { snapshot, fetched_at: new Date() } });
  const options = { companyId: 'co', projectId: 'project', forceLive: false, getToken: async () => 'test' };
  assert.deepEqual(await fixture.source.readPrimaryCommitmentEstimate(options), snapshot);
  assert.equal(fixture.calls.length, 0);
  await fixture.source.readPrimaryCommitmentEstimate({ ...options, forceLive: true });
  assert.equal(fixture.calls.length, 4);
  assert.equal(fixture.writes.length, 1);
});

test('prepared source rechecks the live primary before planning and rejects a changed selection', async () => {
  const prepared = { bidBoardProjectId: '123', proposal: primary, lines: [line()], groups: [group], budgetCodesVersion: 3 };
  const options = { companyId: 'co', projectId: 'project', mode: 'create', forceLive: true, preparationId: 'prepared', getToken: async () => 'test' };
  const fixture = sourceFixture({ prepared });
  assert.deepEqual(await fixture.source.readPrimaryCommitmentEstimate(options), prepared);
  assert.equal(fixture.calls.length, 1);
  assert.match(fixture.calls[0], /\/proposals\?/);
  const changed = sourceFixture({ prepared: { ...prepared, proposal: { ...primary, id: 'other' } } });
  await assert.rejects(changed.source.readPrimaryCommitmentEstimate(options), /changed while it was loading/);
  const old = sourceFixture({ prepared: { ...prepared, budgetCodesVersion: 2 } });
  await assert.rejects(old.source.readPrimaryCommitmentEstimate(options), /Refresh and preview again/);
  assert.equal(old.writes.length, 0);
});

test('catalog reads use exact company/item IDs despite moved catalogs; old snapshots are refreshed', async () => {
  const lines = [1, 2, 3].map(id => line({ id, cost_code: null, cost_code_type: null, cost_item: { id: id === 3 ? '101' : '100', catalog_id: '20', unit: 'EA' } }));
  const fixture = sourceFixture({ lines, cached: { snapshot: { bidBoardProjectId: '123', lines }, fetched_at: new Date() },
    catalogDetail: id => ({ id, catalog_id: '30', cost_code: '03-300-00-20', cost_type_code: 'CON' }) });
  const result = await fixture.source.readPrimaryCommitmentEstimate({ companyId: 'co', projectId: 'project', forceLive: false, getToken: async () => 'test' });
  assert.equal(result.budgetCodesVersion, 3);
  assert.equal(result.lines.length, 3);
  assert.ok(result.lines.every(line => logic.primaryEstimateCostAssignment(line).code === '03-300-00-20'));
  assert.deepEqual(fixture.calls.filter(path => path.includes('/catalogs/')), [
    '/rest/v2.0/companies/co/estimating/catalogs/items/100',
    '/rest/v2.0/companies/co/estimating/catalogs/items/101',
  ]);
});

test('detached children read their full assembly catalog once; previous coding snapshots cannot skip it', async () => {
  const lines = [detached('Forms'), detached('Forms', { id: '2', cost_item: { ...detached('Forms').cost_item, id: 0 } })];
  const fixture = sourceFixture({ lines, cached: { snapshot: { bidBoardProjectId: '123', budgetCodesVersion: 1 }, fetched_at: new Date() },
    assemblyPages: path => new URL(path, 'https://example.test').searchParams.get('page') === '1'
      ? { data: Array.from({ length: 100 }, (_, i) => assembly(String(i + 1), component('Forms', '03-100-10-20'))) }
      : { data: [assembly('101', component('Forms', '03-100-10-20'))] } });
  const result = await fixture.source.readPrimaryCommitmentEstimate({ companyId: 'co', projectId: 'project', forceLive: false, getToken: async () => 'test' });
  assert.equal(result.budgetCodesVersion, 3);
  assert.ok(result.lines.every(l => logic.primaryEstimateCostAssignment(l).code === '03-100-10-20'));
  assert.deepEqual(fixture.calls.filter(path => path.includes('/catalogs/')), [
    '/rest/v2.0/companies/co/estimating/catalogs/20/items?page=1&per_page=100',
    '/rest/v2.0/companies/co/estimating/catalogs/20/items?page=2&per_page=100',
  ]);
  assert.equal(fixture.writes.length, 1);
});

test('failed, partial or repeated assembly catalog pages never publish a complete snapshot', async () => {
  const lines = [detached('Forms')];
  for (const config of [{ failPath: '/catalogs/' }, { assemblyPages: { unexpected: [] } }, {
    assemblyPages: Array.from({ length: 100 }, () => assembly('duplicate', component('Forms', '03-100-10-20'))),
  }, { failPath: 'page=2', assemblyPages: Array.from({ length: 100 }, (_, i) => assembly(String(i + 1))) }]) {
    const fixture = sourceFixture({ lines, ...config });
    await assert.rejects(fixture.source.readPrimaryCommitmentEstimate({ companyId: 'co', projectId: 'project', forceLive: true, getToken: async () => 'test' }));
    assert.equal(fixture.writes.length, 0);
  }
});

test('unlisted custom catalog items use one exact detail lookup; failed coding reads do not cache', async () => {
  const lines = [1, 2].map(id => line({ id, cost_code: null, cost_item: { id: '100', unit: 'EA' } }));
  const options = { companyId: 'co', projectId: 'project', forceLive: true, getToken: async () => 'test' };
  const fixture = sourceFixture({ lines, catalogDetail: { id: '100', cost_code: '03-200-10-20' } });
  await fixture.source.readPrimaryCommitmentEstimate(options);
  assert.equal(fixture.calls.filter(path => path.includes('/catalogs/items/')).length, 1);
  for (const config of [{ failPath: '/catalogs/' }, { catalogDetail: { id: 'wrong', cost_code: '03-200-10-20' } }]) {
    const failed = sourceFixture({ lines, ...config });
    await assert.rejects(failed.source.readPrimaryCommitmentEstimate(options));
    assert.equal(failed.writes.length, 0);
  }
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

test('placeholder catalog IDs without an assembly catalog cannot cause a lookup or invented coding', async () => {
  for (const id of ['0', 0, '', null, '-1']) {
    const input = line({ cost_code: null, cost_code_type: null, cost_item: { id, unit: 'HOURS' } });
    const fixture = sourceFixture({ lines: [input], failPath: '/catalogs/' });
    const result = await fixture.source.readPrimaryCommitmentEstimate({ companyId: 'co', projectId: 'project', forceLive: true, getToken: async () => 'test' });
    assert.equal(fixture.calls.some(path => path.includes('/catalogs/')), false);
    assert.equal(logic.primaryEstimateCostAssignment(result.lines[0]).code, '');
    assert.equal(result.lines.length, 1);
  }
});
