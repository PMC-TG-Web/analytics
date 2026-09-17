import test from 'node:test';
import assert from 'node:assert/strict';
import { compareMonthlyBill } from '../src/lib/qboBillComparison.ts';

const mapping = { companyId: '2', projectId: '3', environment: 'sandbox', realmId: '1', vendorId: '4', customerId: '5', customerName: 'Project', items: { '10': { itemId: '6', itemName: '2508 - SC-03-300-20-20.CON', uom: 'cy' } }, offsets: { customerAssignment: 'none', material: { accountId: '7', accountName: 'Direct Costs -', classId: '8' } } };
const draft = { projectNumber: '2508 - SC', month: '2026-09', issues: [], lines: [{ lineKey: '10', sourceType: 'productivity', description: 'Concrete', costCode: '03-300-20-20', costType: 'Materials', quantity: '2', unitCost: '150', amount: '300.00', uom: 'cy' }] };
const saved = { VendorRef: { value: '4' }, Line: [
  { DetailType: 'ItemBasedExpenseLineDetail', Description: 'Concrete (cy)', Amount: 300, ItemBasedExpenseLineDetail: { ItemRef: { value: '6' }, Qty: 2, UnitPrice: 150, CustomerRef: { value: '5' }, BillableStatus: 'NotBillable' } },
  { DetailType: 'AccountBasedExpenseLineDetail', Description: '2026-09 Procore material offset', Amount: -300, AccountBasedExpenseLineDetail: { AccountRef: { value: '7', name: 'Direct Costs -' }, ClassRef: { value: '8' }, BillableStatus: 'NotBillable' } },
] };
test('compares actual monthly line values while ignoring timestamps and line order', () => {
  const result = compareMonthlyBill(draft, mapping, saved);
  assert.equal(result.unchanged, true); assert.deepEqual(result.issues, []); assert.equal(result.previousGross, 300);
  const reordered = { ...saved, Line: [...saved.Line].reverse(), TxnDate: '2026-09-01' };
  assert.equal(compareMonthlyBill({ ...draft, generatedAt: 'later' }, mapping, reordered).unchanged, true);
  assert.equal(compareMonthlyBill(draft, mapping).unchanged, false);
});
test('detects quantity/rate changes even when both old and new net bills are zero', () => {
  for (const change of [{ quantity: '3', amount: '450.00' }, { quantity: '3', unitCost: '100', amount: '300.00' }, { description: 'Corrected concrete' }]) {
    assert.equal(compareMonthlyBill({ ...draft, lines: [{ ...draft.lines[0], ...change }] }, mapping, saved).unchanged, false);
  }
  assert.equal(compareMonthlyBill({ ...draft, lines: [] }, mapping, saved).unchanged, false);
});
test('mapping changes trigger updates; missing rates/products/classes block readiness', () => {
  assert.match(compareMonthlyBill({ ...draft, projectNumber: null }, mapping, saved).issues.join(), /project number/);
  assert.match(compareMonthlyBill({ ...draft, projectNumber: '9999 - Other' }, mapping, saved).issues.join(), /Product mapping/);
  assert.equal(compareMonthlyBill(draft, { ...mapping, customerId: '99' }, saved).unchanged, false);
  assert.equal(compareMonthlyBill(draft, { ...mapping, offsets: { ...mapping.offsets, material: { ...mapping.offsets.material, classId: '99' } } }, saved).unchanged, false);
  assert.match(compareMonthlyBill(draft, { ...mapping, items: {} }, saved).issues.join(), /Product mapping/);
  assert.match(compareMonthlyBill({ ...draft, issues: ['Unpriced labor'] }, mapping, saved).issues.join(), /Unpriced labor/);
  assert.match(compareMonthlyBill(draft, { ...mapping, offsets: undefined }, saved).issues.join(), /offset/);
});
