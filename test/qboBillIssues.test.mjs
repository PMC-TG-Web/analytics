import test from 'node:test';
import assert from 'node:assert/strict';
import { actionableBillIssues } from '../src/lib/qboBillIssues.ts';

test('shows the actionable Food issue once instead of the generic host error', () => {
  const food = 'Add Food expenses for this project/month (or add $0 if none).';
  assert.deepEqual(actionableBillIssues([food], ['Resolve draft issues before creating a bill.', food]), [food]);
});

test('retains other blockers and never hides a generic failure without a specific reason', () => {
  const generic = 'Resolve draft issues before creating a bill.';
  assert.deepEqual(actionableBillIssues([], [generic]), [generic]);
  assert.deepEqual(actionableBillIssues(['Missing price'], [generic, 'Bill changed in QBO']), ['Missing price', 'Bill changed in QBO']);
  assert.deepEqual(actionableBillIssues([], []), []);
});
