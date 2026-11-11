import test from 'node:test';
import assert from 'node:assert/strict';
import { KPI_LEADTIME_HOURS_PER_MONTH, kpiMonthKey, leadtimeYearValues, wipHoursFromMonth } from '../src/lib/kpiLeadtime.ts';

const wipMonths = { '2025-12': 900, '2026-10': 6166.72, '2026-11': 5860.57, '2026-12': 5966.38, '2027-01': 5064.44, '2027-10': 935.6 };

test('leadtime hours are the saved WIP hours from the month forward, across years', () => {
  assert.equal(wipHoursFromMonth(wipMonths, '2026-11'), 17826.99);
  assert.equal(wipHoursFromMonth(wipMonths, '2026-12'), 11966.42);
  assert.equal(wipHoursFromMonth(wipMonths, '2027-11'), 0);
  assert.equal(wipHoursFromMonth({}, '2026-11'), 0);
});

test('invalid months never contribute and an invalid start is rejected', () => {
  assert.equal(wipHoursFromMonth({ '2026-13': 500, total: 900, '2026-11': 100, '2026-12': Number.NaN }, '2026-11'), 100);
  assert.throws(() => wipHoursFromMonth(wipMonths, '2026-1'), /Invalid leadtime month/);
});

test('the calculated value sits in the current month and moves when the month changes', () => {
  const recorded = Array(12).fill(undefined);
  recorded[8] = 39780;
  recorded[10] = 1;
  const november = leadtimeYearValues('2026', '2026-11', recorded, 17826.99);
  assert.equal(november[8], 39780);
  assert.equal(november[9], undefined);
  assert.equal(november[10], 17826.99);
  const december = leadtimeYearValues(2026, '2026-12', recorded, 11966.42);
  assert.equal(december[10], 1);
  assert.equal(december[11], 11966.42);
});

test('other years show only recorded values, and loading states pass through', () => {
  const recorded = Array(12).fill('');
  recorded[0] = '2,135';
  assert.deepEqual(leadtimeYearValues('2027', '2026-11', recorded, '1,101'), recorded);
  assert.equal(leadtimeYearValues('2026', '2026-11', recorded, 'loading')[10], 'loading');
});

test('month keys use the local calendar month and the leadtime divisor is unchanged', () => {
  assert.equal(kpiMonthKey(new Date(2026, 10, 11)), '2026-11');
  assert.equal(kpiMonthKey(new Date(2027, 0, 1)), '2027-01');
  assert.equal(KPI_LEADTIME_HOURS_PER_MONTH, 3938);
});
