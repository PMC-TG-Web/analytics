import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as catalog from '../src/lib/qboCostCatalog.ts';
const js = ts.transpileModule(fs.readFileSync('src/lib/loadQboDirectCostLaborRates.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function loader(snapshot) {
  const imports = { './loadQboCostCatalog': { loadQboCostCatalog: async company => { assert.equal(company, '1'); return snapshot; } }, './qboCostCatalog': catalog };
  const module = { exports: {} };
  vm.runInNewContext(js, { exports: module.exports, require: id => { assert.ok(imports[id], `Unexpected dependency ${id}`); return imports[id]; } });
  return module.exports.loadQboDirectCostLaborRates;
}
const snapshot = () => ({ version: 1, companyId: '1', fetchedAt: new Date().toISOString(), items: [
  { itemId: '12', catalogId: '45', type: 'LABOR', costCode: '03-300-20-10', uom: 'hr', laborRate: '70.85', unitCost: '0' },
  { itemId: '13', catalogId: '45', type: 'CUSTOM', costCode: '03-300-20-10', uom: 'hr', laborRate: '10' },
] });
test('labor uses only current company catalog hourly costs without bid-board or estimate queries', async () => {
  const r = await loader(snapshot())('1', '2');
  assert.equal(r.issue, null); assert.equal(r.rates.length, 1);
  assert.equal(r.rates[0].rate, '70.85'); assert.equal(r.rates[0].catalogItemId, '12');
  assert.equal(r.rates[0].proposalId, undefined); assert.equal(r.proposalId, null);
});
test('missing and stale catalog prices block labor instead of using bid rates', async () => {
  for (const s of [null, { ...snapshot(), fetchedAt: '2020-01-01' }]) {
    const r = await loader(s)('1', '2'); assert.ok(r.issue); assert.equal(r.rates.length, 0);
  }
});
