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
