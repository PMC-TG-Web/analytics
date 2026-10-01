import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDirectCosts } from '../src/lib/qboDirectCosts.ts';
import { aggregateDirectCostLabor } from '../src/lib/qboDirectCostLabor.ts';
import { projectManagementPrice } from '../src/lib/qboProjectManagementRate.js';

const date = new Date('2026-07-21T00:00:00Z');
const code = '01-300-10-20';
const logs = [{ id: '1', date, status: 'approved', quantityUsed: 8, lineItemId: '10', lineItemDescription: 'Project Management', lineItemHolderTitle: 'Non-Budgeted', updatedAt: date }];
const item = { procoreId: '10', description: 'Project Management', costCode: `${code}.L`, costType: 'Labor', uom: 'hr', unitCost: 55, updatedAt: date };
const card = { procoreId: '1', date, hours: 8, totalHoursWorked: 8, costCodeFullCode: code, costCodeName: 'Project Management', updatedAt: date };
const rate = (costCode, value) => ({ costCode, rate: value, lineItemId: costCode, updatedAt: date.toISOString() });

test('Project Management approved PO usage contributes priced hours and source evidence', () => {
  const result = aggregateDirectCosts(logs, [{ ...item, fixedPrice: projectManagementPrice(item) }], new Map());
  assert.deepEqual(result.issues, []);
  assert.equal(result.total, '440.00');
  assert.equal(result.lines[0].fixedPrice.unitCost, '55');
  assert.equal(result.laborHours, '8');
  assert.equal(result.pricedLaborHours, '8');
  assert.equal(result.lines[0].costCode, `${code}.L`);
  assert.equal(result.lines[0].sourceLogs[0].id, '1');
  assert.equal(logs[0].quantityUsed, 8);
  assert.equal(aggregateDirectCosts([{ ...logs[0], status: 'draft' }], [item], new Map()).lines.length, 0);
});

test('Project Management PO usage requires pricing instead of silently disappearing', () => {
  const result = aggregateDirectCosts(logs, [{ ...item, unitCost: null, pricingIssue: 'No catalog price' }], new Map());
  assert.match(result.issues[0], /No catalog price/);
  assert.equal(result.lines.length, 0);
  assert.equal(result.laborHours, '8');
  assert.equal(result.pricedLaborHours, '0');
});

test('Project Management timecards always use $55 instead of catalog or fallback rates', () => {
  const own = rate(code, '80'), sog = rate('03-300-20-10', '70'), travel = rate('01-300-10-30', '60');
  for (const suffix of ['', '.L']) {
    for (const rates of [[own, sog, travel], [sog, travel], [travel], [], [own, rate(code, '90')]]) {
      const result = aggregateDirectCostLabor([{ ...card, costCodeFullCode: code + suffix }], rates);
      assert.deepEqual(result.issues, []);
      assert.equal(result.total, '440.00');
      assert.equal(result.totalHours, '8');
      assert.equal(result.pricedHours, '8');
      assert.equal(result.lines[0].lineKey, `labor:${code}`);
      assert.equal(result.lines[0].rateSelection, 'Project Management rate');
      assert.equal(result.lines[0].fixedPrice.unitCost, '55');
      assert.deepEqual(result.lines[0].rateSources, []);
      assert.equal(result.lines[0].sourceLogs[0].id, '1');
    }
  }
});

test('the $55 policy only applies to exact Project Management labor hours', () => {
  for (const uom of ['h', 'hr', 'hrs', 'hour', 'hours', 'ea', 'each']) assert.equal(projectManagementPrice({ ...item, uom }).unitCost, '55');
  for (const change of [{ costCode: '01-300-10-30' }, { costType: 'Materials' }, { uom: 'days' }, { uom: null }]) {
    assert.equal(projectManagementPrice({ ...item, ...change }), null);
  }
  const ordinary = aggregateDirectCostLabor([{ ...card, costCodeFullCode: '03-300-20-10' }], []);
  assert.equal(ordinary.unpricedHours, '8');
  assert.equal(ordinary.lines.length, 0);
});
