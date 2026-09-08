import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEstimateActualHours } from '../src/lib/kpiEstimateHours.ts';
import { getKpiCardValue } from '../src/lib/kpiCardMonths.ts';

test('August card-editor hours fill an empty KPI entry, including decimal formatting', () => {
  const values = Array(24).fill('');
  values[7] = '30,565.70';
  assert.deepEqual(resolveEstimateActualHours(null, getKpiCardValue(values, 2026, 8), 0), {
    hours: 30565.7, isManual: true,
  });
  assert.deepEqual(resolveEstimateActualHours(null, getKpiCardValue(values, 2027, 8), 120), {
    hours: 120, isManual: false,
  });
});

test('inline overrides, including zero, retain precedence over card and calculated values', () => {
  assert.deepEqual(resolveEstimateActualHours(29347, '30,565.70', 40000), { hours: 29347, isManual: true });
  assert.deepEqual(resolveEstimateActualHours(0, '30,565.70', 40000), { hours: 0, isManual: true });
});

test('blank or invalid saved values fall back without treating a saved zero as missing', () => {
  assert.deepEqual(resolveEstimateActualHours(null, '0', 120), { hours: 0, isManual: true });
  for (const value of ['', '   ', undefined, null, 'invalid', Infinity]) {
    assert.deepEqual(resolveEstimateActualHours(null, value, 120), { hours: 120, isManual: false });
  }
});
