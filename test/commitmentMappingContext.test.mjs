import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveCommitmentMappingContext } from '../src/lib/commitmentMappingContext.ts';

test('explicit Wall line-item suffix takes precedence over Exterior in the contract title', () => {
  const result = resolveCommitmentMappingContext('Wall', 'Exterior Steps & Walls');

  assert.equal(result.source, 'line_item_suffix');
  assert.equal(result.context, 'wall');
  assert.equal(result.wantsWall, true);
  assert.equal(result.wantsSite, false);
});

test('explicit Site line-item suffix remains a site mapping', () => {
  const result = resolveCommitmentMappingContext('Site', 'Exterior Steps & Walls');

  assert.equal(result.source, 'line_item_suffix');
  assert.equal(result.wantsWall, false);
  assert.equal(result.wantsSite, true);
});

test('contract context remains available when the line-item suffix has no category', () => {
  const result = resolveCommitmentMappingContext('Material', 'Foundation Package');

  assert.equal(result.source, 'line_item_and_contract');
  assert.equal(result.wantsFoundation, true);
});
