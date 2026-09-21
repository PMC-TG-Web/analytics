import assert from 'node:assert/strict';
import test from 'node:test';
import { primaryEstimateCreationStatus } from '../src/lib/commitmentMakerCreationStatus.ts';
const state = { fingerprint: 'exact', status: 'completed', targets: [{ id: 'po', name: 'Slab', number: '002' }] };
const audit = { entityId: 'po', changes: { success: true, status: 'Approved', group: 'Slab', createdContract: true, createdLineItems: 34 } };
test('only exact completed imports with all target audits produce success', () => {
  const result = primaryEstimateCreationStatus(state, 'exact', [audit]);
  assert.equal(result.success, true);
  assert.equal(result.created, 1);
  assert.equal(result.results[0].createdLineItems, 34);
  for (const status of ['running', 'retryable', 'uncertain']) {
    assert.notEqual(primaryEstimateCreationStatus({ ...state, status }, 'exact', [audit]).success, true);
  }
  assert.notEqual(primaryEstimateCreationStatus(state, 'different', [audit]).success, true);
  assert.notEqual(primaryEstimateCreationStatus(null, 'exact', [audit]).success, true);
  assert.notEqual(primaryEstimateCreationStatus(state, 'exact', []).success, true);
  assert.notEqual(primaryEstimateCreationStatus(state, 'exact', [{ ...audit, entityId: 'another-po' }]).success, true);
  assert.notEqual(primaryEstimateCreationStatus(state, 'exact', [{ ...audit, changes: { ...audit.changes, sourceChangeOrder: { id: 'co' } } }]).success, true);
  assert.notEqual(primaryEstimateCreationStatus({ ...state, targets: [...state.targets, { id: 'po2', name: 'Wall', number: '003' }] }, 'exact', [audit]).success, true);
});
