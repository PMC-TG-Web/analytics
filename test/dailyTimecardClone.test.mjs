import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allocateExistingTimecardRows,
  countTimecardOccurrences,
} from '../src/lib/procore/dailyTimecardClone.ts';

test('existing occurrence counts preserve a missing duplicate timecard', () => {
  const rows = [
    { sourceId: '1', timecardExactKey: 'same', timecardIdentityKey: 'identity' },
    { sourceId: '2', timecardExactKey: 'same', timecardIdentityKey: 'identity' },
  ];
  const allocated = allocateExistingTimecardRows(
    rows,
    countTimecardOccurrences(['same']),
    countTimecardOccurrences(['identity']),
  );

  assert.deepEqual(
    allocated.map((row) => [row.sourceId, row.existingTargetTimecard]),
    [
      ['1', true],
      ['2', false],
    ],
  );
});

test('identity conflicts consume only the available target occurrences', () => {
  const rows = [
    { sourceId: '1', timecardExactKey: 'source-type', timecardIdentityKey: 'identity' },
    { sourceId: '2', timecardExactKey: 'source-type', timecardIdentityKey: 'identity' },
  ];
  const allocated = allocateExistingTimecardRows(
    rows,
    new Map(),
    countTimecardOccurrences(['identity']),
  );

  assert.deepEqual(
    allocated.map((row) => [
      row.sourceId,
      row.existingTargetTimecardIdentityConflict,
      row.existingTargetTimecard,
    ]),
    [
      ['1', true, true],
      ['2', false, false],
    ],
  );
});
