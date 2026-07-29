import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allocateExistingProductivityRows,
  countProductivityFingerprints,
  guardExpectedProductivityQuantities,
  isBillingFileCommitment,
  normalizeProductivityDescription,
  productivityCloneFingerprint,
} from '../src/lib/procore/dailyProductivityClone.ts';

test('billing file commitments are identified by title or number', () => {
  assert.equal(isBillingFileCommitment({ contractTitle: 'Billing File' }), true);
  assert.equal(isBillingFileCommitment({ contractNumber: 'WP - 05 Billing_File' }), true);
  assert.equal(isBillingFileCommitment({ contractNumber: 'PO #05', contractTitle: 'Concrete' }), false);
});

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

test('forms repair rows are blocked when they would exceed the expected quantity', () => {
  const rows = [
    {
      sourceId: 'field-1',
      existingTargetProductivity: false,
      targetLineItem: {
        id: 117,
        expectedQuantity: 260,
        enforceExpectedQuantityCeiling: true,
      },
      payload: { quantity_used: 55 },
    },
  ];

  const guarded = guardExpectedProductivityQuantities(rows, new Map([['117', 260]]));

  assert.equal(guarded[0].expectedQuantityGuard.blocked, true);
  assert.equal(guarded[0].expectedQuantityGuard.remainingQuantity, 0);
});

test('forms repair rows reserve remaining capacity without exceeding expected quantity', () => {
  const targetLineItem = {
    id: 117,
    expectedQuantity: 260,
    enforceExpectedQuantityCeiling: true,
  };
  const rows = [
    {
      sourceId: 'field-1',
      existingTargetProductivity: false,
      targetLineItem,
      payload: { quantity_used: 55 },
    },
    {
      sourceId: 'field-2',
      existingTargetProductivity: false,
      targetLineItem,
      payload: { quantity_used: 45 },
    },
    {
      sourceId: 'field-3',
      existingTargetProductivity: false,
      targetLineItem,
      payload: { quantity_used: 1 },
    },
  ];

  const guarded = guardExpectedProductivityQuantities(rows, new Map([['117', 160]]));

  assert.deepEqual(
    guarded.map((row) => row.expectedQuantityGuard.blocked),
    [false, false, true]
  );
  assert.equal(guarded[2].expectedQuantityGuard.usedBefore, 260);
  assert.equal(guarded[2].expectedQuantityGuard.remainingQuantity, 0);
});

test('non-forms productivity is not subject to the forms expected-quantity ceiling', () => {
  const rows = [
    {
      sourceId: 'concrete-1',
      existingTargetProductivity: false,
      targetLineItem: {
        id: 116,
        expectedQuantity: 30.5,
        enforceExpectedQuantityCeiling: false,
      },
      payload: { quantity_used: 40 },
    },
  ];

  const guarded = guardExpectedProductivityQuantities(rows, new Map([['116', 30.5]]));

  assert.equal(guarded[0].expectedQuantityGuard, null);
});
