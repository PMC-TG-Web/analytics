import test from 'node:test';
import assert from 'node:assert/strict';
import { publishWorkspace, validateWorkspace } from '../scripts/publishWipWorkspace.mjs';

const source = { bidBoardId: '11', proposalId: '12', estimatedHours: 110, projectManagementHours: 10, allocatableHours: 100 };
const plan = { source, allocations: [{ month: '2026-10', percent: 100 }], notes: 'Reviewed', revision: 1, updatedBy: 'pm@example.com', updatedAt: '2026-10-13T10:00:00Z' };
const store = () => ({ version: 1, companyId: '1', plans: { '2': structuredClone(plan) }, drafts: {}, history: { '2': [{ source, allocations: plan.allocations, notes: plan.notes, revision: 1, createdBy: plan.updatedBy, createdAt: plan.updatedAt }] } });

test('workspace publication requires exact company, valid saved percentages, and complete matching history', () => {
  assert.deepEqual(validateWorkspace(store(), '1', []), ['2']);
  assert.throws(() => validateWorkspace(store(), '3', []), /company/);
  const incomplete = store(); incomplete.plans['2'].allocations[0].percent = 25;
  assert.throws(() => validateWorkspace(incomplete, '1', []));
  const history = store(); history.history['2'] = [];
  assert.throws(() => validateWorkspace(history, '1', []), /history/);
  const draft = store(); draft.drafts['3'] = { allocations: [{ month: '2026-10', percent: 25 }], notes: '', sourceName: 'Export' };
  assert.deepEqual(validateWorkspace(draft, '1', []), ['2', '3']);
});

test('dry run performs no writes; matching publication is idempotent and conflicting shared plans block publication', async () => {
  const writes = []; let existing = null;
  const tx = {
    pmcProject: { findMany: async () => [{ procoreProjectId: '2' }] },
    wipPlan: { findUnique: async () => existing, create: async ({ data }) => { writes.push(data); existing = data; } },
    wipPlanRevision: { createMany: async ({ data }) => writes.push(data) },
  };
  const db = { $transaction: async (fn, options) => { assert.equal(options.isolationLevel, 'Serializable'); return fn(tx); } };
  assert.equal((await publishWorkspace(db, store(), [], '1')).created, 1);
  assert.equal(writes.length, 0);
  assert.equal((await publishWorkspace(db, store(), [], '1', true)).created, 1);
  assert.equal(writes.length, 2);
  assert.equal((await publishWorkspace(db, store(), [], '1', true)).unchanged, 1);
  assert.equal(writes.length, 2);
  existing.notes = 'Newer shared work';
  await assert.rejects(publishWorkspace(db, store(), [], '1', true), /conflicts/);
});

test('publication refuses unmatched project identities', async () => {
  const db = { $transaction: fn => fn({ pmcProject: { findMany: async () => [] } }) };
  await assert.rejects(publishWorkspace(db, store(), [], '1'), /missing from this company/);
});
