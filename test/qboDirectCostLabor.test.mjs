import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDirectCostLabor } from '../src/lib/qboDirectCostLabor.ts';
const date = new Date('2026-09-10');
const card = (id, hours, code = '03-300-20-10') => ({ procoreId: id, hours, totalHoursWorked: null, date, updatedAt: date, costCodeFullCode: code, costCodeName: 'SOG Labor' });
const rate = (value = '38') => ({ costCode: '03-300-20-10', rate: value, lineItemId: '101', proposalId: '10', bidBoardId: '20', updatedAt: date.toISOString() });
test('prices timecards by exact cost code with configured hourly costs', () => {
  const r = aggregateDirectCostLabor([card('1', 130), card('2', 4)], [rate(), { ...rate(), lineItemId: '102' }]);
  assert.equal(r.total, '5092.00'); assert.equal(r.totalHours, '134'); assert.equal(r.unpricedHours, '0');
  assert.equal(r.lines[0].lineKey, 'labor:03-300-20-10'); assert.equal(r.lines[0].rateSources.length, 2);
});
test('missing and conflicting rates remain visible and block posting', () => {
  for (const rates of [[], [rate(), rate('40')], [rate(null)]]) {
    const r = aggregateDirectCostLabor([card('1', 3)], rates);
    assert.equal(r.unpricedHours, '3'); assert.equal(r.lines.length, 0); assert.equal(r.rows.length, 1); assert.ok(r.issues.length);
  }
});
test('zero hours stay zero, fallback hours are supported, duplicates and negatives are blocked', () => {
  const r = aggregateDirectCostLabor([{ ...card('1', 0), totalHoursWorked: 5 }, { ...card('2', null), totalHoursWorked: 2 }], [rate()]);
  assert.equal(r.totalHours, '2'); assert.equal(r.total, '76.00');
  assert.ok(aggregateDirectCostLabor([card('1', 1), card('1', 1)], [rate()]).issues.length);
  assert.ok(aggregateDirectCostLabor([card('1', -1)], [rate()]).issues.length);
});

test('multiple travel rates use the lowest rate once for all hours with matching rate evidence', () => {
  const travel = ['72.37', '70.85', '77.37', '70.850'].map((value, i) => ({ ...rate(value), costCode: '01-300-10-30', lineItemId: String(101 + i) }));
  for (const rates of [travel, [...travel].reverse()]) {
    const r = aggregateDirectCostLabor([card('1', 10, '01-300-10-30'), card('2', 14, '01-300-10-30')], [...rates, rate('65')]);
    assert.deepEqual(r.issues, []);
    assert.equal(r.totalHours, '24'); assert.equal(r.lines.length, 1);
    assert.equal(r.total, '1700.40'); assert.equal(r.lines[0].unitCost, '70.85');
    assert.equal(r.lines[0].rateSelection, 'Lowest travel rate');
    assert.equal(r.lines[0].sourceLogs.length, 2);
    assert.deepEqual(r.lines[0].rateSources.map(s => s.lineItemId).sort(), ['102', '104']);
  }
  const fallback = aggregateDirectCostLabor([card('1', 3, '01-300-10-40')], travel);
  assert.equal(fallback.lines[0].unitCost, '70.85');
  assert.equal(fallback.lines[0].rateSelection, 'Travel fallback (lowest rate)');
  assert.equal(fallback.lines[0].lineKey, 'labor:01-300-10-40');
  assert.equal(aggregateDirectCostLabor([card('1', 3)], [rate('70.85'), rate('72.37'), ...travel]).lines.length, 0);
});

test('missing travel still falls back to SOG and invalid travel values are not selected as the lowest rate', () => {
  const cards = [card('1', 24, '01-300-10-30')];
  assert.equal(aggregateDirectCostLabor(cards, [rate('70.85')]).lines[0].rateSelection, 'SOG fallback');
  for (const value of ['0', '-1', 'NaN', null]) {
    const r = aggregateDirectCostLabor(cards, [{ ...rate(value), costCode: '01-300-10-30' }, rate('70.85')]);
    assert.equal(r.total, '1700.40'); assert.equal(r.lines[0].rateSelection, 'SOG fallback');
  }
});
test('uses category then SOG then travel while preserving the original cost category', () => {
  const code = '01-300-10-40', cards = [card('1', 3, code)];
  const travel = { ...rate('40'), costCode: '01-300-10-30' };
  const own = { ...rate('55'), costCode: code };
  const exact = aggregateDirectCostLabor(cards, [own, rate(), travel]);
  assert.equal(exact.total, '165.00'); assert.equal(exact.lines[0].rateSelection, 'category');
  const sog = aggregateDirectCostLabor(cards, [rate(), travel]);
  assert.equal(sog.total, '114.00'); assert.equal(sog.lines[0].rateSelection, 'SOG fallback');
  assert.equal(sog.lines[0].costCode, code); assert.equal(sog.lines[0].lineKey, `labor:${code}`);
  assert.equal(sog.lines[0].rateSources[0].costCode, '03-300-20-10');
  const fallback = aggregateDirectCostLabor(cards, [rate(null), travel]);
  assert.equal(fallback.total, '120.00'); assert.equal(fallback.lines[0].rateSelection, 'Travel fallback');
  assert.equal(aggregateDirectCostLabor(cards, [rate(), rate('42'), travel]).lines.length, 0);
});
