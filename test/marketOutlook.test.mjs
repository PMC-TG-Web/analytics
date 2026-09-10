import test from 'node:test';
import assert from 'node:assert/strict';
import { marketIndicators, sectorOutlook } from '../src/lib/marketOutlook.ts';

test('market outlook includes every agreed indicator with decision context and sources', () => {
  assert.equal(marketIndicators.length, 18);
  assert.equal(new Set(marketIndicators.map((row) => row.name)).size, 18);
  for (const row of marketIndicators) {
    assert.ok(row.value);
    assert.ok(row.leadTime);
    assert.ok(row.why);
    assert.ok(row.geography);
    assert.match(row.sourceUrl, /^https:\/\//);
  }
});

test('market outlook keeps local geography explicit and sector forecasts visible', () => {
  assert.ok(marketIndicators.some((row) => /Lancaster/.test(row.geography)));
  assert.deepEqual(sectorOutlook.map((row) => row.name), [
    'Institutional', 'Overall nonresidential', 'Manufacturing',
  ]);
});
