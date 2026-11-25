import test from 'node:test';
import assert from 'node:assert/strict';
import { hasProjectTimecards } from '../src/lib/productivityLaborCard.ts';

test('the labor card requires a saved timecard entry', () => {
  assert.equal(hasProjectTimecards(0), false);
  assert.equal(hasProjectTimecards(1), true);
  assert.equal(hasProjectTimecards(92), true);
});
