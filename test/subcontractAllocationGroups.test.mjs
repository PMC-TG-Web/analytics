import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allocationGroupNames, resolveAllocationGroup, sameAllocationSourceExceptGroupNames } from '../src/lib/subcontractAllocationGroups.ts';

const snapshot = { bidBoardProjectId: 'board', proposal: { id: 'primary' }, groups: [{ id: '1', name: 'Sidewalk' }, { id: '2', name: 'Stairs' }] };
test('group IDs resolve the actual names from the exact primary estimate snapshot', () => {
  const names = allocationGroupNames(snapshot, 'board', 'primary');
  assert.deepEqual(resolveAllocationGroup({ groupId: '1', groupName: null, payload: { group_id: '1' } }, names), { groupId: '1', groupName: 'Sidewalk', missingName: false });
  assert.equal(resolveAllocationGroup({ groupId: '2' }, names).groupName, 'Stairs');
});
test('never borrow group labels from another board or estimate', () => {
  assert.equal(allocationGroupNames(snapshot, 'other', 'primary').size, 0);
  assert.equal(allocationGroupNames(snapshot, 'board', 'copy').size, 0);
});
test('named groups missing metadata remain distinct and are not called Ungrouped', () => {
  assert.deepEqual(resolveAllocationGroup({ groupId: '77' }, new Map()), { groupId: '77', groupName: 'Group 77', missingName: true });
  assert.deepEqual(resolveAllocationGroup({}, new Map()), { groupId: '', groupName: 'Ungrouped', missingName: false });
  assert.equal(resolveAllocationGroup({ payload: { group: { id: '3', name: 'Slab 1' } } }, new Map()).groupName, 'Slab 1');
});
test('group name enrichment retains saved draft edits but changed quantities and identities do not', () => {
  const previous = { projectId: 'p', bidBoardProjectId: 'board', proposalId: 'primary', lines: [{ id: 'a', groupId: '1', groupName: 'Ungrouped', quantity: 10 }], budgets: [], poLines: [] };
  const current = JSON.parse(JSON.stringify(previous)); current.lines[0].groupName = 'Sidewalk'; current.syncedAt = 'new';
  assert.equal(sameAllocationSourceExceptGroupNames(previous, current), true);
  current.lines[0].quantity = 9;
  assert.equal(sameAllocationSourceExceptGroupNames(previous, current), false);
  current.lines[0].quantity = 10; current.lines[0].groupId = '2';
  assert.equal(sameAllocationSourceExceptGroupNames(previous, current), false);
});
test('group sync requires private access, CSRF and uses read-only Procore calls', () => {
  const route = readFileSync(new URL('../src/app/api/procore/commitments-live/allocation/groups/route.ts', import.meta.url), 'utf8');
  assert.match(route, /canAccessSubcontractAllocation\(actor\)/);
  assert.match(route, /validateCsrfRequest/);
  const service = readFileSync(new URL('../src/lib/syncSubcontractAllocationGroups.ts', import.meta.url), 'utf8');
  assert.match(service, /acquireProcoreWorker/);
  assert.match(service, /finally \{ await releaseProcoreWorker/);
  assert.doesNotMatch(service, /method: ['"](?:POST|PATCH|PUT|DELETE)['"]/);
});
