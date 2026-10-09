import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDirectCosts, directCostMonth } from '../src/lib/qboDirectCosts.ts';

const date = new Date('2026-09-10T00:00:00Z');
const log = (id, quantityUsed, overrides = {}) => ({ id, date, status: 'approved', quantityUsed, lineItemId: '10', lineItemDescription: 'Concrete', lineItemHolderTitle: 'SOG', updatedAt: date, ...overrides });
const item = { procoreId: '10', description: 'Concrete', unitCost: 153.24, uom: 'cy', updatedAt: date };

test('daily-log quantities and evidence round together before line aggregation', () => {
  const logs = [log('1', 1 / 3), log('2', 1 / 3)];
  const result = aggregateDirectCosts(logs, [{ ...item, description: 'Labor', costType: 'Labor', uom: 'hr', unitCost: 70.85 }], new Map());
  assert.deepEqual(result.issues, []);
  assert.equal(result.lines[0].quantity, '0.66666666');
  assert.deepEqual(result.lines[0].sourceLogs.map(log => log.quantity), ['0.33333333', '0.33333333']);
  assert.equal(result.total, '47.23');
  assert.equal(result.laborHours, '0.66666666');
  assert.equal(result.pricedLaborHours, '0.66666666');
  assert.equal(logs[0].quantityUsed, 1 / 3, 'Source daily logs are not modified');
});

test('daily-log evidence retains eight-place decimals and blocks quantities that round to zero', () => {
  const result = aggregateDirectCosts([log('1', 1e-8)], [{ ...item, unitCost: 1000000 }], new Map());
  assert.equal(result.lines[0].quantity, '0.00000001');
  assert.equal(result.lines[0].sourceLogs[0].quantity, '0.00000001');
  assert.equal(result.total, '0.01');
  const tooSmall = aggregateDirectCosts([log('1', 1e-9)], [item], new Map());
  assert.equal(tooSmall.lines.length, 0);
  assert.match(tooSmall.issues[0], /quantity is below the supported billing precision/);
  assert.equal(tooSmall.issueSources[0].message, tooSmall.issues[0]);
});
test('sums used quantities and prices once per line with decimal rounding', () => {
  const result = aggregateDirectCosts([log('1', 4), log('2', 4.5)], [item], new Map());
  assert.equal(result.total, '1302.54');
  assert.equal(result.lines[0].quantity, '8.5');
  assert.equal(result.lines[0].sourceLogs.length, 2);
  assert.deepEqual(result.issues, []);
  assert.equal(aggregateDirectCosts([log('1', 1)], [{ ...item, unitCost: 1.005 }], new Map()).total, '1.01');
});
test('excludes zero usage, unapproved logs and billing-file records', () => {
  const result = aggregateDirectCosts([log('1', 0), log('2', 100, { status: 'pending' }), log('3', 50, { lineItemHolderTitle: 'Billing File - SOG' })], [item], new Map());
  assert.equal(result.total, '0.00');
  assert.deepEqual(result.excluded, { unapproved: 1, billingFile: 1, zeroUsage: 1, concrete: 0, pumpingEquipment: 0, boomLiftRental: 0, shopDrawings: 0 });
});

test('shop drawing vendor charges are omitted before catalog pricing and product mapping', () => {
  for (const overrides of [
    { description: 'Shop Drawings', costCode: '01-300-10-40', costType: 'Subcontractors' },
    { description: 'CO6 - SHOP  DRAWINGS - Pier', costCode: '01-300-10-40', costType: 'Other' },
    { description: 'Rebar Shop Drawings Lump Sum', costCode: '01-300-10-30', costType: 'Labor' },
    { description: 'Renamed drawing charge', costCode: '01-300-10-40.C', costType: 'Subcontractors' },
  ]) {
    const r = aggregateDirectCosts([log('1', 1, { lineItemId: 'old' })], [{ ...item, ...overrides, unitCost: null, pricingIssue: 'multiple Cost Catalog matches' }], new Map([['old', '10']]));
    assert.equal(r.total, '0.00'); assert.equal(r.lines.length, 0); assert.equal(r.excluded.shopDrawings, 1);
    assert.deepEqual(r.issues, []); assert.deepEqual(r.issueSources, []);
  }
  for (const description of ['Shop and Office Time', 'Labor Travel', 'Rebar Fabrication Time']) {
    const r = aggregateDirectCosts([log('1', 1)], [{ ...item, description, costCode: '01-300-10-30', costType: 'Labor' }], new Map());
    assert.equal(r.lines.length, 1); assert.equal(r.excluded.shopDrawings, 0);
  }
});

test('omits concrete material codes including bollard concrete before pricing, but keeps labor and other materials', () => {
  for (const costCode of ['03-300-00-20', '03-300-10-20', '03-300-20-20', '03-300-30-20', '05-100-10-20']) {
    const result = aggregateDirectCosts([log('1', 4, { lineItemId: 'old' })], [{ ...item, costCode, costType: 'Materials', unitCost: null }], new Map([['old', '10']]));
    assert.equal(result.total, '0.00');
    assert.equal(result.lines.length, 0);
    assert.equal(result.excluded.concrete, 1);
    assert.deepEqual(result.issues, []);
    assert.equal(aggregateDirectCosts([log('1', 4)], [{ ...item, costCode, costType: 'Labor' }], new Map()).lines.length, 1);
  }
  assert.equal(aggregateDirectCosts([log('1', 4)], [{ ...item, costCode: '03-300-20-10', costType: 'Labor' }], new Map()).lines.length, 1);
  assert.equal(aggregateDirectCosts([log('1', 4)], [{ ...item, costCode: '03-150-10-85', costType: 'Materials' }], new Map()).lines.length, 1);
  assert.equal(aggregateDirectCosts([log('1', 12)], [{ ...item, description: 'Steel bollard', costCode: '05-100-10-10', costType: 'Materials' }], new Map()).lines.length, 1);
});
test('resolves explicit aliases and blocks ambiguous, missing, duplicate, or negative sources', () => {
  assert.equal(aggregateDirectCosts([log('1', 2, { lineItemId: 'old' })], [item], new Map([['old', '10']])).total, '306.48');
  for (const [logs, items] of [
    [[log('1', 2)], []], [[log('1', 2)], [item, item]], [[log('1', -1)], [item]],
    [[log('1', null)], [item]], [[log('1', 2), log('1', 2)], [item]],
    [[log('1', 2)], [{ ...item, unitCost: null }]], [[log('1', 2)], [{ ...item, uom: null }]],
  ]) assert.ok(aggregateDirectCosts(logs, items, new Map()).issues.length);
});

test('omits the three code-specific pumping items and Telebelts at 03-300-40-30 before price validation', () => {
  for (const description of ['Line Dragon', 'Boom Pump Rental w/Operator', 'Telebelt (4 hr minimum)', ' Trailer Pump (Includes 3 hr)\u00a0', 'LINE  DRAGON']) {
    const result = aggregateDirectCosts([log('1', 2, { lineItemId: 'old' })], [{ ...item, description, costCode: '03-300-40-30', costType: 'Other', unitCost: 0, uom: null }], new Map([['old', '10']]));
    assert.equal(result.lines.length, 0);
    assert.equal(result.total, '0.00');
    assert.equal(result.excluded.pumpingEquipment, 1);
    assert.deepEqual(result.issues, []);
  }
  for (const overrides of [
    { description: 'Different equipment', costCode: '03-300-40-30' },
    { description: 'Line Dragon', costCode: '03-300-20-30' },
    { description: 'Line Dragon', costCode: '03-300-40-30', costType: 'Labor' },
  ]) assert.equal(aggregateDirectCosts([log('1', 2)], [{ ...item, ...overrides }], new Map()).lines.length, 1);
});
test('Telebelts are manual-only across PO codes, cost types, aliases and labels before pricing checks', () => {
  for (const overrides of [
    { description: 'Telebelt', costCode: '31-100-10-50', costType: 'Equipment' },
    { description: 'Telebelt', costCode: '03-300-20-10', costType: 'Labor' },
    { description: 'Telebelt (4 hr minimum)', costCode: '03-300-20-10', costType: 'Labor' },
    { description: 'TB130 telebelt', costCode: '03-300-40-30', costType: 'Commitments' },
    { description: 'CO6 - TELEBELTS', costCode: null, costType: null },
    { description: null, costCode: '03-300-20-30', costType: 'Materials' },
  ]) {
    const result = aggregateDirectCosts([log('1', 2, { lineItemId: 'old', lineItemDescription: 'Telebelt' })],
      [{ ...item, ...overrides, unitCost: null, uom: null, pricingIssue: 'Ambiguous catalog rates' }], new Map([['old', '10']]));
    assert.equal(result.total, '0.00'); assert.equal(result.lines.length, 0);
    assert.equal(result.excluded.pumpingEquipment, 1); assert.deepEqual(result.issues, []);
    assert.deepEqual(result.issueSources, []);
  }
});
test('excludes change-order-prefixed pumping items while preserving other descriptions, codes and labor', () => {
  for (const description of ['CO6 - Trailer Pump (Includes 3 hr)', 'CO12 - Line Dragon', 'co 3 \u2013 Boom Pump Rental w/Operator', 'CO4\u2014Telebelt (4 hr minimum)']) {
    const result = aggregateDirectCosts([log('1', 2)], [{ ...item, description, costCode: '03-300-40-30', costType: 'Other', unitCost: 0, uom: null }], new Map());
    assert.equal(result.lines.length, 0);
    assert.equal(result.total, '0.00');
    assert.equal(result.excluded.pumpingEquipment, 1);
    assert.deepEqual(result.issues, []);
  }
  for (const overrides of [
    { description: 'CO6 - Trailer Pump (Includes 3 hr) additional supplies' },
    { description: 'CO6 - Different equipment' },
    { description: 'CO6 - Trailer Pump (Includes 3 hr)', costCode: '03-300-20-30' },
    { description: 'CO6 - Trailer Pump (Includes 3 hr)', costType: 'Labor' },
  ]) {
    const result = aggregateDirectCosts([log('1', 2)], [{ ...item, costCode: '03-300-40-30', costType: 'Other', ...overrides }], new Map());
    assert.equal(result.lines.length, 1);
    assert.equal(result.excluded.pumpingEquipment, 0);
  }
});
test('boom lift rental is manual-only across cost codes, aliases and change-order labels before pricing checks', () => {
  for (const overrides of [
    { description: 'Boom lift rental', costCode: '03-300-20-30', costType: 'Equipment' },
    { description: ' BOOM  LIFT\u00a0RENTAL ', costCode: '03-300-00-30', costType: 'E' },
    { description: 'CO6 - Boom lift rental', costCode: '03-300-40-30', costType: 'Other' },
    { description: 'co 12 \u2013 Boom lift rental', costCode: null, costType: 'Materials' },
    { description: null, costCode: '03-300-20-30', costType: null },
  ]) {
    const result = aggregateDirectCosts([log('1', 2, { lineItemId: 'old', lineItemDescription: 'Boom lift rental' })],
      [{ ...item, ...overrides, unitCost: null, uom: null, pricingIssue: 'Ambiguous catalog rates' }], new Map([['old', '10']]));
    assert.equal(result.total, '0.00'); assert.equal(result.lines.length, 0);
    assert.equal(result.excluded.boomLiftRental, 1); assert.equal(result.excluded.pumpingEquipment, 0);
    assert.deepEqual(result.issues, []); assert.deepEqual(result.issueSources, []);
  }
});
test('boom lift exclusion preserves employee labor and other equipment', () => {
  for (const overrides of [
    { description: 'Boom lift rental', costType: 'Labor', uom: 'hr' },
    { description: 'Boom lift rental', costType: 'L', uom: 'hr' },
    { description: 'Boom lift operator', costType: 'Labor', uom: 'hr' },
    { description: 'Somero boom screed' }, { description: 'Scissor lift rental' },
    { description: 'Boom lift rental supplies' },
  ]) {
    const result = aggregateDirectCosts([log('1', 2)], [{ ...item, costCode: '03-300-20-30', costType: 'Equipment', ...overrides }], new Map());
    assert.equal(result.lines.length, 1); assert.equal(result.excluded.boomLiftRental, 0);
    if (/^(Labor|L)$/.test(overrides.costType || '')) assert.equal(result.laborHours, '2');
  }
});

test('calendar-month bounds support year rollover and reject malformed input', () => {
  assert.equal(directCostMonth('2026-12').end.toISOString(), '2027-01-01T00:00:00.000Z');
  for (const value of ['2026-13', '2026-1', '', "2026-09' OR TRUE"]) assert.throws(() => directCostMonth(value));
});

test('errors identify items by name and specify only the missing cost or unit', () => {
  const errors = overrides => aggregateDirectCosts([log('598134423749754', 2)], [{ ...item, description: 'Boom Pump', ...overrides }], new Map()).issues;
  assert.deepEqual(errors({ unitCost: 0 }), ['Boom Pump needs a positive unit cost. SOG; daily log 2026-09-10.']);
  assert.deepEqual(errors({ uom: null }), ['Boom Pump needs a unit of measure. SOG; daily log 2026-09-10.']);
  assert.deepEqual(errors({ unitCost: null, uom: ' ' }), ['Boom Pump needs a positive unit cost and a unit of measure. SOG; daily log 2026-09-10.']);
  assert.deepEqual(errors({ description: null, unitCost: 0 }), ['Concrete needs a positive unit cost. SOG; daily log 2026-09-10.']);
  const missing = aggregateDirectCosts([log('598134423749754', 2)], [], new Map()).issues[0];
  assert.match(missing, /^Concrete \(SOG; daily log 2026-09-10\)/);
  assert.ok(!missing.includes('598134423749754'));
});

test('errors retain PO references and each affected daily-log date, including aliased cost sources', () => {
  const entries = [log('1', 2, { lineItemId: 'old', lineItemHolderNumber: 'PO-17', lineItemHolderTitle: 'Pump rental' }), log('2', 3, { lineItemId: 'old', lineItemHolderNumber: 'PO-17', lineItemHolderTitle: 'Pump rental', date: new Date('2026-09-11T00:00:00Z') })];
  const result = aggregateDirectCosts(entries, [{ ...item, description: 'Boom Pump', unitCost: 0, procorePurchaseOrderContractId: '12345', purchaseOrderContract: { number: 'PO-22', title: 'Equipment' } }], new Map([['old', '10']]));
  assert.equal(result.issues.length, 2);
  assert.ok(result.issueSources.every(source => source.target === 'purchaseOrder'));
  for (const issue of result.issues) {
    assert.match(issue, /PO-17 — Pump rental/);
    assert.match(issue, /Cost source: PO-22 — Equipment/);
  }
  assert.match(result.issues[0], /daily log 2026-09-10/);
  assert.match(result.issues[1], /daily log 2026-09-11/);
  assert.deepEqual(result.issueSources.map(s => [s.message, s.date, s.purchaseOrderId]), result.issues.map((message, i) => [message, `2026-09-${10 + i}`, '12345']));
  const unavailable = aggregateDirectCosts([log('3', 1, { lineItemHolderTitle: null })], [{ ...item, unitCost: 0 }], new Map());
  assert.match(unavailable.issues[0], /PO not available; daily log 2026-09-10/);
  assert.equal(unavailable.issueSources[0].purchaseOrderId, null);
  const badQuantity = aggregateDirectCosts([log('4', -1)], [item], new Map());
  assert.equal(badQuantity.issueSources[0].target, 'dailyLog');
});



test('legacy concrete names exclude only actual concrete despite wrong codes', () => {
  for (const description of ['Bollards Concrete', 'Site Concrete - Site', 'CO6 - Concrete Set And Fill Bollards']) {
    const r = aggregateDirectCosts([log('1', 4)], [{ ...item, description, costCode: '05-100-10-10', costType: 'Materials', unitCost: null, pricingIssue: 'No catalog match' }], new Map());
    assert.equal(r.excluded.concrete, 1); assert.deepEqual(r.issues, []); assert.equal(r.lines.length, 0);
    assert.equal(aggregateDirectCosts([log('1', 4)], [{ ...item, description, costCode: '05-100-10-10', costType: 'Labor', uom: 'hr' }], new Map()).lines.length, 1);
    assert.equal(aggregateDirectCosts([log('1', 4)], [{ ...item, description, costCode: '03-300-20-10', costType: 'Labor', uom: 'cy' }], new Map()).excluded.concrete, 1);
  }
  for (const description of ['Concrete Repair Epoxy', 'Concrete Saw Rental', 'Bollard Sch 40', 'Labor Site Concrete']) assert.equal(aggregateDirectCosts([log('1', 4)], [{ ...item, description, costCode: '05-100-10-10', costType: 'Materials' }], new Map()).lines.length, 1);
});

test('priced lines retain PO names for actionable integration errors', () => {
 const purchaseOrderContract={number:'PO-001',title:'Sidewalk'};
 const result=aggregateDirectCosts([log('1',2)],[{...item,purchaseOrderContract}],new Map());
 assert.deepEqual(result.lines[0].purchaseOrder,purchaseOrderContract);
 assert.equal(result.lines[0].sourceLogs[0].date,'2026-09-10');
});
