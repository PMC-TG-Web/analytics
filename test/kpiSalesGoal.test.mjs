import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSignedPercent, previousKpiMonth, salesPercentOfGoal } from '../src/lib/kpiSalesGoal.ts';

const goals = Array(12).fill('1,000,000');

test('the saved September figures reproduce the owner’s manual +21%', () => {
  const saved = [2016, 1601513, 944052, 2576721, 349919, 930766, 2966937, 31173, 1506639];
  const sales = Object.fromEntries(saved.map((value, index) => [`2026-0${index + 1}`, value]));
  assert.equal(formatSignedPercent(salesPercentOfGoal(sales, goals, '2026-09')), '+21%');
});

test('the percentage is year to date through the month, within that year only', () => {
  const sales = { '2025-12': 9_000_000, '2026-01': 500_000, '2026-02': 2_000_000, '2026-03': 4_000_000 };
  assert.equal(salesPercentOfGoal(sales, goals, '2026-01'), -50);
  assert.equal(salesPercentOfGoal(sales, goals, '2026-02'), 25);
  assert.equal(salesPercentOfGoal({}, goals, '2026-02'), -100);
});

test('a missing or invalid goal leaves the result unavailable instead of overstating it', () => {
  const sales = { '2026-01': 500_000, '2026-02': 2_000_000 };
  assert.equal(salesPercentOfGoal(sales, ['1,000,000', '', '1,000,000'], '2026-02'), null);
  assert.equal(salesPercentOfGoal(sales, ['1,000,000', 'TBD'], '2026-02'), null);
  assert.equal(salesPercentOfGoal(sales, ['0', '0'], '2026-02'), null);
  assert.equal(salesPercentOfGoal(sales, [], '2026-01'), null);
  assert.throws(() => salesPercentOfGoal(sales, goals, '2026-13'), /Invalid KPI month/);
});

test('the calculation month is the last completed month, including across a new year', () => {
  assert.equal(previousKpiMonth('2026-11'), '2026-10');
  assert.equal(previousKpiMonth('2027-01'), '2026-12');
  assert.throws(() => previousKpiMonth('2026-1'), /Invalid KPI month/);
});

test('percentages round to whole numbers with an explicit sign', () => {
  assert.equal(formatSignedPercent(41.79), '+42%');
  assert.equal(formatSignedPercent(-9.1), '-9%');
  assert.equal(formatSignedPercent(-0.2), '0%');
  assert.equal(formatSignedPercent(0), '0%');
});
