import test from 'node:test';
import assert from 'node:assert/strict';
import { isKpiPercentageRow, sumKpiCardValues, weightedKpiPercentage } from '../src/lib/kpiCardTotals.ts';

const gpActual = ['57%', '42%.', '-10.2%', '48.8%', '18.4%', '40.2%', '-10.1%', '21.6%', '47.6%', '13.1%', '', ''];

test('percentage rows have no total without weights, instead of an average or sum of months', () => {
  assert.equal(weightedKpiPercentage(gpActual, null), null);
  assert.equal(weightedKpiPercentage(gpActual, undefined), null);
  assert.equal(weightedKpiPercentage(['', '+21%', ''], null), null);
});

test('percentage rows total only the months that have a percentage and a positive weight', () => {
  assert.equal(weightedKpiPercentage(['50%', '10%', '', '90%'], ['$1,000', '3,000', '5,000', '']), 20);
  assert.equal(weightedKpiPercentage(['50%', '10%'], ['', '0']), null);
  assert.equal(weightedKpiPercentage(['', ''], ['1,000', '3,000']), null);
});

test('percentage rows are recognized by label or by any saved year, including a blank selected year', () => {
  assert.equal(isKpiPercentageRow('GP Goal', [...Array(12).fill('31%'), ...Array(12).fill('')]), true);
  assert.equal(isKpiPercentageRow('YTD Bids Sub goal %', Array(24).fill('')), true);
  assert.equal(isKpiPercentageRow('Goal Hours', Array(24).fill('29,000')), false);
  assert.equal(isKpiPercentageRow(undefined, undefined), false);
});

test('amount rows still add their monthly values', () => {
  assert.equal(sumKpiCardValues(['$1,000', ' 2,135', '', '3562.5', 'n/a']), 6697.5);
  assert.equal(sumKpiCardValues(Array(12).fill('')), 0);
});
