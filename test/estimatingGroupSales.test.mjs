import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateSalesByGroup, reconcileEstimateGroupSales } from '../src/lib/estimatingGroupSales.ts';
import { classifyLaborGroup } from '../src/lib/estimatingDashboardLogic.ts';

test('every item and labor sale follows its own estimate group, including equipment, subcontract and credits', () => {
  const sales = estimateSalesByGroup([
    { groupId: 'sog', name: 'SOG Labor', laborHours: 40, laborSales: 4000 },
    { groupId: 'sog', name: 'Generic concrete', itemSales: 2000 },
    { groupId: 'sog', name: 'Equipment', itemSales: 300 },
    { groupId: 'sog', name: 'Subcontractor', itemSales: 500 },
    { groupId: 'sog', name: 'Credit', itemSales: -100 },
    { groupId: 'site', name: 'Site Concrete Labor', laborHours: 10, laborSales: 1000 },
    { groupId: 'site', name: 'Generic concrete', itemSales: 1200 },
  ]);
  assert.deepEqual(sales, { 'Slab On Grade Labor': 6700, 'Site Concrete Labor': 2200 });
});

test('piers, footers and footings classify as Foundations with and without hours', () => {
  for (const name of ['Piers', 'Footers', 'Footings', 'Spread Footings', 'Foundations']) {
    assert.equal(classifyLaborGroup({ name: `${name} Labor` }), 'Foundation Labor');
    assert.deepEqual(estimateSalesByGroup([{ groupId: '1', groupName: name, itemSales: 500 }]), { 'Foundation Labor': 500 });
  }
});

test('production hours outrank shared PM/travel and group names; largest production scope owns mixed groups', () => {
  assert.deepEqual(estimateSalesByGroup([
    { groupId: '1', groupName: 'Site', name: 'SOG', laborHours: 30, laborSales: 300 },
    { groupId: '1', name: 'Footers', laborHours: 10, laborSales: 100 },
    { groupId: '1', name: 'Project Management', laborHours: 100, laborSales: 1000 },
    { groupId: '1', name: 'Travel', laborHours: 100, laborSales: 1000 },
    { groupId: '1', itemSales: 2000 },
  ]), { 'Slab On Grade Labor': 4400 });
});

test('ties and unknown groups stay visible; missing IDs never pool unrelated lines', () => {
  assert.deepEqual(estimateSalesByGroup([
    { groupId: '1', name: 'SOG', laborHours: 10, laborSales: 100 },
    { groupId: '1', name: 'Footers', laborHours: 10, laborSales: 100 },
    { name: 'SOG', laborHours: 5, laborSales: 50 },
    { itemSales: 75 },
    { groupId: 'unknown', itemSales: -25 },
  ]), { 'Unassigned sales': 250, 'Slab On Grade Labor': 50 });
});

test('group names are a fallback only when unambiguous and scoped to the supplied proposal', () => {
  assert.deepEqual(estimateSalesByGroup([{ groupId: '1', payload: { group: { name: 'Sidewalk' } }, itemSales: 70 }]), { 'Site Concrete Labor': 70 });
  assert.deepEqual(estimateSalesByGroup([{ groupId: '1', groupName: 'SOG and Site', itemSales: 70 }]), { 'Unassigned sales': 70 });
  assert.deepEqual(estimateSalesByGroup([{ groupId: '1', itemSales: 80 }]), { 'Unassigned sales': 80 });
});

test('header differences remain explicit, including missing lines and negative adjustments', () => {
  const groups = { 'Slab On Grade Labor': 100, 'Unassigned sales': 50 };
  assert.deepEqual(reconcileEstimateGroupSales(groups, 175), { ...groups, 'Estimate adjustments': 25 });
  assert.deepEqual(reconcileEstimateGroupSales(groups, 100), { ...groups, 'Estimate adjustments': -50 });
  assert.deepEqual(reconcileEstimateGroupSales({}, 200), { 'Estimate adjustments': 200 });
  assert.deepEqual(reconcileEstimateGroupSales(groups, 150.0000001), groups);
  assert.deepEqual(groups, { 'Slab On Grade Labor': 100, 'Unassigned sales': 50 });
});
