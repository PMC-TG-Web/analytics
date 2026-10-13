import test from 'node:test';
import assert from 'node:assert/strict';
import { subcontractBudgetOptions, allocationBudgetPlan, validateAllocationChanges } from '../src/lib/subcontractAllocation.ts';
import { allocationBudgetCode, allocationCachedCoding } from '../src/lib/subcontractAllocationCoding.ts';

const source = {
  lines: [{ id: 'a', name: 'Concrete', budgetCode: '03.CON', quantity: 10, unitCost: 138.84, unitRevenue: 160 }],
  budgets: [{ id: 'from', costCode: '03.CON', amount: 1388.4 }, { id: 'to', name: 'Site Subcontractor', costCode: '03-300-30-50.C', amount: 0 }], poLines: [],
};
const changes = () => ({ allocations: [{ lineId: 'a', quantity: 1 }], budgets: [], purchaseOrders: [], reason: '' });
test('different source codes move both cost and revenue to the selected group destination, with a line override', () => {
  const data = { ...source, lines: [
    { ...source.lines[0], id: 'equipment', budgetCode: '03-300-30-30.E' },
    { ...source.lines[0], id: 'rebar', budgetCode: '03-200-40-20.M' },
    { ...source.lines[0], id: 'labor', budgetCode: '03-300-30-10.L' },
  ] };
  const input = { ...changes(), allocations: data.lines.map(line => ({ lineId: line.id, quantity: 1 })),
    budgetMappings: data.lines.map(line => ({ lineId: line.id, toBudgetId: 'subcontract-code:03-300-30-50.S' })) };
  const groupPlan = allocationBudgetPlan(data, validateAllocationChanges(data, input));
  const credits = groupPlan.adjustments.filter(row => row.id.startsWith('destination:'));
  assert.deepEqual(credits.map(row => row.costCode), Array(3).fill('03-300-30-50.S'));
  assert.ok(credits.every(row => row.change === 138.84 && row.revenueChange === 160));
  input.budgetMappings[1].toBudgetId = 'subcontract-code:03-300-00-50.S';
  const linePlan = allocationBudgetPlan(data, validateAllocationChanges(data, input));
  assert.deepEqual(linePlan.adjustments.filter(row => row.id.startsWith('destination:')).map(row => row.costCode),
    ['03-300-30-50.S', '03-300-00-50.S', '03-300-30-50.S']);
  assert.deepEqual(linePlan.adjustments.filter(row => row.id.startsWith('estimate:')).map(row => row.costCode),
    data.lines.map(line => line.budgetCode));
});
test('quantity creates a visible budget proposal before a destination is chosen', () => {
  const plan = allocationBudgetPlan(source, changes());
  assert.equal(plan.transferAmount, 138.84);
  assert.equal(plan.pending, 1);
  assert.equal(plan.rows[0].fromBudgetId, 'from');
  assert.equal(plan.rows[0].toBudgetId, '');
  assert.deepEqual(plan.adjustments, []);
});
test('mapped partial transfers balance and combine manual changes once after reload', () => {
  const input = { ...changes(), budgetMappings: [{ lineId: 'a', fromBudgetId: 'from', toBudgetId: 'subcontract-code:03-300-30-50.S' }], budgets: [{ lineId: 'to', change: 10 }] };
  const validated = validateAllocationChanges(source, input);
  const plan = allocationBudgetPlan(source, validated);
  assert.equal(plan.pending, 0);
  assert.deepEqual(plan.adjustments.map(row => row.change), [-138.84, 138.84, 10]);
  assert.deepEqual(plan.adjustments.map(row => row.revenueChange), [-160, 160, 0]);
  assert.deepEqual(allocationBudgetPlan(source, JSON.parse(JSON.stringify({ ...validated, budgetPlan: plan }))), plan);
  assert.equal(allocationBudgetPlan(source, { ...validated, allocations: [] }).adjustments.length, 1);
});
test('selected estimate source is preserved despite duplicate budget codes or legacy overrides', () => {
  const duplicate = { ...source, budgets: [...source.budgets, { id: 'old', costCode: '03.CON', amount: 100 }] };
  const input = { ...changes(), budgetMappings: [{ lineId: 'a', fromBudgetId: 'to', toBudgetId: 'subcontract-code:03-300-30-50.S' }] };
  const validated = validateAllocationChanges(duplicate, input);
  assert.equal(validated.budgetMappings[0].fromBudgetId, '');
  const plan = allocationBudgetPlan(duplicate, validated);
  assert.equal(plan.pending, 0);
  assert.equal(plan.rows[0].fromBudgetId, '');
  assert.equal(plan.rows[0].fromBudgetCode, '03.CON');
  assert.equal(plan.rows[0].line, source.lines[0]);
  assert.equal(plan.rows[0].quantity, 1);
  assert.deepEqual(plan.adjustments.map(row => [row.name, row.costCode, row.change]), [
    ['Concrete', '03.CON', -138.84], ['Concrete', '03-300-30-50.S', 138.84],
  ]);
  assert.throws(() => validateAllocationChanges(source, { ...changes(), budgetMappings: [{ lineId: 'a', toBudgetId: 'foreign' }] }));
});
test('zero value scope does not falsely request a transfer', () => {
  for (const line of [{ ...source.lines[0], unitCost: 0, unitRevenue: 0 }]) {
    const plan = allocationBudgetPlan({ ...source, lines: [line] }, changes());
    assert.equal(plan.pending, 0);
    assert.equal(plan.transferAmount, 0);
    assert.equal(plan.rows.length, 1);
  }
});
test('existing commitment cost types can still move to a different subcontractor code', () => {
  const plan = allocationBudgetPlan({ ...source, lines: [{ ...source.lines[0], budgetCode: '03-300-30-50.C' }] }, changes());
  assert.equal(plan.pending, 1);
  assert.equal(plan.rows[0].fromBudgetId, 'to');
});
test('missing revenue is unresolved, while zero cost with positive revenue remains transferable', () => {
  const input = { ...changes(), budgetMappings: [{ lineId: 'a', fromBudgetId: 'from', toBudgetId: 'subcontract-code:03-300-30-50.S' }] };
  const missing = allocationBudgetPlan({ ...source, lines: [{ ...source.lines[0], unitRevenue: null }] }, input);
  assert.equal(missing.pending, 1);
  assert.equal(missing.transferRevenue, null);
  assert.deepEqual(missing.adjustments, []);
  const revenueOnly = allocationBudgetPlan({ ...source, lines: [{ ...source.lines[0], unitCost: 0 }] }, input);
  assert.equal(revenueOnly.pending, 0);
  assert.deepEqual(revenueOnly.adjustments.map(row => row.revenueChange), [-160, 160]);
});
test('cached coding requires exact proposal, board, line and cost item; never defaults unknown types', () => {
  const snapshot = { bidBoardProjectId: 'board', proposal: { id: 'proposal' }, lines: [{ id: 'line', cost_item: { id: 'item', cost_code: '03', cost_type_code: 'CON' } }] };
  assert.equal(allocationCachedCoding(snapshot, 'board', 'proposal', 'line', 'item'), '03.CON');
  for (const args of [['other','proposal','line','item'], ['board','other','line','item'], ['board','proposal','other','item'], ['board','proposal','line','other']]) assert.equal(allocationCachedCoding(snapshot, ...args), '');
  assert.equal(allocationBudgetCode({ cost_item: { cost_code: '03' } }), '');
  assert.equal(allocationBudgetCode({ cost_code: '04.L', cost_item: { cost_code: '03', cost_type_code: 'CON' } }), '04.L');
});
test('Site 2 rounded estimate values yield $422.09 and retain zero-value Fiber', () => {
  const lines = [160,45.8832,77.37,138.84,0].map((unitCost, i) => ({ id: String(i), quantity: 1, unitCost, unitRevenue: unitCost }));
  const plan = allocationBudgetPlan({ lines, budgets: [], poLines: [] }, { ...changes(), allocations: lines.map(line => ({ lineId: line.id, quantity: 1 })) });
  assert.equal(plan.transferAmount, 422.09);
  assert.equal(plan.transferRevenue, 422.09);
  assert.equal(plan.pending, 4);
  assert.equal(plan.rows.length, 5);
});

test('destinations contain subcontractor, not just a commitment cost type', () => {
  const data = { ...source, budgets: [...source.budgets,
    { id: 'equipment', name: 'Equipment commitments', costCode: '04.C', amount: 10 },
    { id: 'upper', name: 'CONCRETE SUBCONTRACTOR', costCode: '05.C', amount: 0 }] };
  assert.equal(subcontractBudgetOptions(data).length, 5);
  assert.ok(subcontractBudgetOptions(data).every(row => row.costCode.endsWith('.S')));
  assert.ok(!subcontractBudgetOptions(data).some(row => row.costCode === '05.S'));
  const input = { ...changes(), budgetMappings: [{ lineId: 'a', toBudgetId: 'equipment' }] };
  assert.throws(() => validateAllocationChanges(data, input));
  assert.equal(allocationBudgetPlan(data, input).pending, 1);
});

test('subcontractor destinations always end in .S and duplicate mirror rows produce one option', () => {
  const data = { ...source, budgets: [...source.budgets, { ...source.budgets[1], id: 'duplicate' }] };
  const options = subcontractBudgetOptions(data);
  assert.equal(options.length, 5);
  assert.equal(options[3].costCode, '03-300-30-50.S');
  assert.equal(options[3].proposed, true);
  const existing = subcontractBudgetOptions({ ...data, budgets: [...data.budgets, { id: 's', name: 'Site Subcontractor', costCode: '03-300-30-50.S', amount: 20 }] });
  assert.equal(existing.length, 5);
  assert.equal(existing[3].proposed, false);
  assert.equal(existing[3].amount, 20);
});

test('saved subcontractor selections carry forward to .S without changing quantities or amounts', () => {
  const input = { ...changes(), budgetMappings: [{ lineId: 'a', fromBudgetId: '', toBudgetId: 'to' }] };
  const validated = validateAllocationChanges(source, input);
  assert.equal(validated.budgetMappings[0].toBudgetId, 'subcontract-code:03-300-30-50.S');
  const plan = allocationBudgetPlan(source, input);
  assert.equal(plan.pending, 0);
  assert.equal(plan.rows[0].quantity, 1);
  assert.equal(plan.rows[0].amount, 138.84);
  assert.equal(plan.rows[0].revenue, 160);
  assert.equal(plan.adjustments[1].costCode, '03-300-30-50.S');
});

test('all five exact catalog destinations are available without project budget rows', () => {
  const options = subcontractBudgetOptions({ ...source, budgets: [] });
  assert.deepEqual(options.map(row => [row.itemId, row.name, row.costCode]), [
    ['51482336', 'Foundation Subcontractor', '03-300-00-50.S'],
    ['51482352', 'Masonry Subcontractor', '04-100-10-20.S'],
    ['51482338', 'Poured Wall Subcontractor', '03-300-10-50.S'],
    ['51482350', 'Site Concrete Subcontractor', '03-300-30-50.S'],
    ['51482344', 'Slab on Grade Subcontractor', '03-300-20-50.S'],
  ]);
  assert.ok(options.every(row => row.proposed));
  for (const option of options) {
    const data = { ...source, budgets: [] };
    const validated = validateAllocationChanges(data, { ...changes(), budgetMappings: [{ lineId: 'a', toBudgetId: option.id }] });
    const plan = allocationBudgetPlan(data, validated);
    assert.equal(plan.pending, 0);
    assert.equal(plan.adjustments[1].costCode, option.costCode);
    assert.equal(plan.adjustments.reduce((sum, row) => sum + row.change, 0), 0);
  }
});
