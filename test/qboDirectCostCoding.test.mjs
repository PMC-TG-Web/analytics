import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDirectCostCoding } from '../src/lib/qboDirectCostCoding.ts';
test('Food uses the fixed material code while preserving source identity, unit and description', () => {
 for (const description of ['Food', ' food ', 'Food Cost', 'CO6 - Food']) {
  const original = { procoreId: '123', description, costCode: '03-150-10-85', costType: 'Other', uom: 'ls' };
  const result = applyDirectCostCoding(original);
  assert.equal(result.costCode, '01-300-10-80'); assert.equal(result.costType, 'Materials');
  assert.equal(result.description, description); assert.equal(result.procoreId, '123'); assert.equal(result.uom, 'ls');
  assert.equal(original.costCode, '03-150-10-85');
 }
 assert.equal(applyDirectCostCoding({ description: 'Food', costCode: null, costType: 'Materials' }).costCode, '01-300-10-80');
});
test('Food override leaves other purchases and labor unchanged', () => {
 for (const original of [{ description: 'Food delivery equipment', costCode: '03-150-10-85', costType: 'Materials' }, { description: 'Food', costCode: '01-300-10-30', costType: 'Labor' }]) assert.equal(applyDirectCostCoding(original), original);
});

test('approved Somero per-each charges use Direct Costs while retaining the source code', () => {
 for (const name of ['Somero Power Rake (8 hr minimum)', 'Somero S-840 (8 hr minimum)']) {
  const original = { description: name + ' - SOG', costCode: '03-300-00-12', costType: 'Labor', uom: 'ea' };
  const result = applyDirectCostCoding(original);
  assert.equal(result.costType, 'Materials'); assert.equal(result.costCode, original.costCode); assert.equal(original.costType, 'Labor');
  for (const uom of ['hr', 'day', '']) { const labor = {...original,uom}; assert.equal(applyDirectCostCoding(labor),labor); }
 }
 for (const description of ['Somero operator labor', 'Somero S-840 (4 hr minimum)', 'Somero SRS4 (8 hr minimum)']) {
  const original = { description, costType: 'Labor', uom: 'ea' }; assert.equal(applyDirectCostCoding(original), original);
 }
});