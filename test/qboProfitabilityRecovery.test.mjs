import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { withQboProcoreStatusFile } from '../src/lib/qboProfitabilityRefresh.ts';
import { isIncompleteQboSnapshot } from '../src/lib/qboProfitabilitySnapshot.ts';

test('customer-only refresh with Procore projects is skipped, while real project snapshots remain usable', () => {
  const snapshots = [
    { id: 'broken', sourceCounts: { procoreProjects: 71 }, projectRows: 0 },
    { id: 'previous', sourceCounts: { procoreProjects: 71 }, projectRows: 66 },
  ];
  const usable = snapshots.filter((s) => !isIncompleteQboSnapshot(s.sourceCounts, s.projectRows));
  assert.equal(usable[0].id, 'previous');
  assert.equal(snapshots.length, 2, 'immutable snapshots are retained');
  assert.equal(isIncompleteQboSnapshot(null, 0), false);
  assert.equal(isIncompleteQboSnapshot({ procoreProjects: 0 }, 0), false);
});

test('local refresh hands the report current canonical statuses and removes its temporary file', async () => {
  let file;
  const result = await withQboProcoreStatusFile([
    { procoreProjectId: '101', bidBoardStatus: 'In Progress', status: 'Course of Construction' },
    { procoreProjectId: '102', bidBoardStatus: null, status: 'Complete' },
    { procoreProjectId: '103', bidBoardStatus: 'Accepted', status: 'In Progress' },
  ], async (environment) => {
    file = environment.PROJECT_PROFITABILITY_PROCORE_STATUS_FILE;
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
      byProjectId: { 101: 'In Progress', 102: 'Complete', 103: 'Accepted' },
    });
    return 'report complete';
  });
  assert.equal(result, 'report complete');
  await assert.rejects(access(file), { code: 'ENOENT' });
});

test('failed refresh cleans up and missing statuses prevent report execution', async () => {
  let file;
  await assert.rejects(withQboProcoreStatusFile([
    { procoreProjectId: '101', bidBoardStatus: 'Complete', status: null },
  ], async (environment) => {
    file = environment.PROJECT_PROFITABILITY_PROCORE_STATUS_FILE;
    throw new Error('report failed');
  }), /report failed/);
  await assert.rejects(access(file), { code: 'ENOENT' });
  await assert.rejects(withQboProcoreStatusFile([], async () => assert.fail('must not run')), /statuses are unavailable/);
});
