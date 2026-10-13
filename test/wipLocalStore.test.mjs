import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wipLocalStorePath, readWipLocalStore, saveWipLocalPlan } from '../src/lib/wipLocalStore.ts';
test('local storage requires an absolute path and development mode', () => {
  const path = join(tmpdir(), 'wip.json');
  assert.equal(wipLocalStorePath({ NODE_ENV: 'production', WIP_LOCAL_STORE_PATH: path }), null);
  assert.equal(wipLocalStorePath({ NODE_ENV: 'development' }), null);
  assert.equal(wipLocalStorePath({ NODE_ENV: 'development', WIP_LOCAL_STORE_PATH: path }), path);
  assert.throws(() => wipLocalStorePath({ NODE_ENV: 'development', WIP_LOCAL_STORE_PATH: 'relative.json' }), /absolute/);
});
test('local saves persist revision history, clear imported drafts and reject stale revisions or wrong companies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wip-store-test-'));
  try {
    const path = join(dir, 'plans.json');
    await writeFile(path, JSON.stringify({ version: 1, companyId: 'company', plans: {}, history: {}, drafts: { '101': { allocations: [{ month: '2026-10', percent: 25 }] } } }));
    const data = { source: { bidBoardId: '1', proposalId: '2', estimatedHours: 120, projectManagementHours: 20, allocatableHours: 100 }, allocations: [{ month: '2026-10', percent: 100 }], notes: 'Reviewed' };
    assert.equal((await saveWipLocalPlan(path, 'company', '101', 0, data, 'pm')).revision, 1);
    assert.equal(await saveWipLocalPlan(path, 'company', '101', 0, data, 'pm'), null);
    await assert.rejects(readWipLocalStore(path, 'other'), /company/);
    await assert.rejects(saveWipLocalPlan(path, 'other', '101', 1, data, 'pm'), /company/);
    assert.equal((await saveWipLocalPlan(path, 'company', '101', 1, { ...data, notes: 'Second' }, 'pm')).revision, 2);
    const saved = await readWipLocalStore(path, 'company');
    assert.equal(saved.history['101'].length, 2);
    assert.equal(saved.history['101'][0].notes, 'Reviewed');
    assert.equal(saved.drafts['101'], undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
