import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDirectCostCoding, isFoodCost } from '../src/lib/qboDirectCostCoding.ts';
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

test('Somero screeds enter the QBO equipment flow only from an exact Procore .LS assignment', () => {
 for (const description of ['Somero Power Rake (8 hr minimum) - SOG', 'Somero S-840 (8 hr minimum)', 'Somero S-15R (boom screed) (8 hr minimum)', 'SRS4']) {
  const original = { description, costCode: '03-300-20-30', costType: 'Labor Laser Screeding', wbsCode: '03-300-20-30.LS', uom: 'ea' };
  const result = applyDirectCostCoding(original);
  assert.equal(result.costType, 'Equipment'); assert.equal(result.costCode, original.costCode);
  assert.equal(result.sourceCostType, 'Labor Laser Screeding'); assert.equal(result.sourceWbsCode, original.wbsCode);
  assert.equal(result.directCostCodingIssue, undefined); assert.equal(original.costType, 'Labor Laser Screeding');
 }
});
test('food code and meal descriptions use the food ledger rather than catalog prices', () => {
 for (const description of ['Breakfast','CO6 - Lunch','Dinner','Meals','Crew refreshments']) {
  assert.equal(isFoodCost({description,costCode:'01-300-10-80.M',costType:'Materials'}),true);
 }
 assert.equal(isFoodCost({description:'Breakfast',costCode:'03-150-10-85',costType:'Other'}),true);
 assert.equal(isFoodCost({description:'Breakfast',costCode:'01-300-10-80',costType:'Labor'}),false);
 assert.equal(isFoodCost({description:'Breakfast room equipment',costCode:'03-150-10-85',costType:'Materials'}),false);
});

test('legacy screed cost types are rejected with an exact Procore correction', () => {
 for (const description of ['Somero S-15R (boom screed) (8 hr minimum) - SOG', 'S-15', 'S15R', 'CO6 - Somero SRS4 (boom screed) - Site', 'Somero S-940 (8 hr minimum)', 'Power Rake', 'S-840', 'SRS']) {
  for (const [costType, suffix] of [['Subcontractors', 'S'], ['Equipment', 'E'], ['Other', 'O'], ['Commitments', 'C'], ['Labor', 'L']]) {
   const original = { procoreId: '123', description, costCode: '03-300-20-30', costType, wbsCode: `03-300-20-30.${suffix}`, uom: 'ea' };
   const result = applyDirectCostCoding(original);
   assert.equal(result.costType, costType, description);
   assert.match(result.directCostCodingIssue, /must use the Labor Laser Screeding \(\.LS\) budget code in Procore/);
   assert.match(result.directCostCodingIssue, new RegExp(`\\.${suffix}\\b`));
   assert.equal(original.costType, costType);
  }
 }
});

test('screeder coding preserves labor, profiler, unrelated subcontractors and ambiguous descriptions', () => {
 for (const description of ['Somero 3D Profiler (with or without screed)', 'Concrete finishing', 'S15 / SRS4', 'Somero S-15R operator labor', 'S-15 repairs', 'S-15 parts', 'Laser screeder']) {
  const original = { description, costType: 'Subcontractors', costCode: '03-300-20-30', uom: 'ea' };
  assert.equal(applyDirectCostCoding(original), original);
 }
});
