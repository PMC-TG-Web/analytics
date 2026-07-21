import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allocateExistingProductivityRows,
  countProductivityFingerprints,
  normalizeProductivityDescription,
  productivityCloneFingerprint,
} from '../src/lib/procore/dailyProductivityClone.ts';

test('source and target productivity descriptions normalize to the same material', () => {
  assert.equal(
    normalizeProductivityDescription('#19 - Boom lift rental  - 0.0 days'),
    normalizeProductivityDescription('Boom lift rental')
  );
  assert.equal(
    normalizeProductivityDescription('#21 - Support posts rental (8) - 0.0 months'),
    normalizeProductivityDescription('Support posts rental (8)')
  );
});

test('productivity fingerprints ignore Procore line formatting and numeric string formatting', () => {
  const source = productivityCloneFingerprint({
    date: '2026-06-12',
    contractNumber: 'SFM-007',
    lineItemDescription: '#20 - TK Cure n Seal  - 0.0 ea',
    quantityDelivered: '1.50',
    quantityUsed: '1.5',
    notes: '',
  });
  const target = productivityCloneFingerprint({
    date: '2026-06-12T16:00:00Z',
    contractNumber: 'sfm-007',
    lineItemDescription: 'TK Cure n Seal',
    quantityDelivered: 1.5,
    quantityUsed: 1.5,
    notes: null,
  });

  assert.equal(source, target);
});

test('existing occurrence counts skip only the number of rows already present', () => {
  const key = 'same-row';
  const rows = [
    { sourceId: '1', productivityFingerprint: key },
    { sourceId: '2', productivityFingerprint: key },
  ];
  const allocated = allocateExistingProductivityRows(rows, countProductivityFingerprints([key]));

  assert.deepEqual(allocated.map((row) => row.existingTargetProductivity), [true, false]);
});

test('repair IDs are preserved as the missing occurrence when an equivalent non-repair row exists', () => {
  const key = 'same-row';
  const rows = [
    { sourceId: 'repair-me', productivityFingerprint: key },
    { sourceId: 'already-there', productivityFingerprint: key },
  ];
  const allocated = allocateExistingProductivityRows(
    rows,
    countProductivityFingerprints([key]),
    new Set(['repair-me'])
  );

  assert.deepEqual(
    allocated.map((row) => [row.sourceId, row.existingTargetProductivity]),
    [
      ['repair-me', false],
      ['already-there', true],
    ]
  );
});
