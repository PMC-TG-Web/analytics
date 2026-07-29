import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeCommitmentVendorName,
  validateCommitmentVendorAssignments,
} from '../src/lib/procore/commitmentVendorValidation.ts';

test('vendor names tolerate normal legal-suffix differences', () => {
  assert.equal(
    normalizeCommitmentVendorName('Paradise Masonry, LLC'),
    normalizeCommitmentVendorName('Paradise Masonry LLC')
  );
});

test('a vendor ID mapped to a different company name is blocked', () => {
  const issues = validateCommitmentVendorAssignments(
    [{
      sourceContractId: 'old-po-1',
      sourceNumber: 'PO #01',
      sourceVendorId: 'old-paradise',
      sourceVendorName: 'Paradise Masonry LLC',
      targetVendorId: 'centurion',
    }],
    [{ id: 'centurion', name: 'Centurion Construction Group LLC' }]
  );

  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, 'vendor_name_mismatch');
});

test('one source vendor cannot fan out across duplicate target vendor records', () => {
  const assignments = [
    {
      sourceContractId: 'old-po-1',
      sourceNumber: 'PO #01',
      sourceVendorId: 'old-paradise',
      sourceVendorName: 'Paradise Masonry LLC',
      targetVendorId: 'new-paradise-a',
    },
    {
      sourceContractId: 'old-po-2',
      sourceNumber: 'PO #02',
      sourceVendorId: 'old-paradise',
      sourceVendorName: 'Paradise Masonry LLC',
      targetVendorId: 'new-paradise-b',
    },
  ];
  const issues = validateCommitmentVendorAssignments(assignments, [
    { id: 'new-paradise-a', name: 'Paradise Masonry LLC' },
    { id: 'new-paradise-b', name: 'Paradise Masonry LLC' },
  ]);

  assert.equal(issues.length, 2);
  assert.ok(issues.every((issue) => issue.type === 'inconsistent_vendor_mapping'));
});

test('consistent same-name mappings pass validation', () => {
  const issues = validateCommitmentVendorAssignments(
    [
      {
        sourceContractId: 'old-po-1',
        sourceVendorName: 'Paradise Masonry LLC',
        targetVendorId: 'new-paradise',
      },
      {
        sourceContractId: 'old-po-2',
        sourceVendorName: 'Paradise Masonry LLC',
        targetVendorId: 'new-paradise',
      },
    ],
    [{ id: 'new-paradise', name: 'Paradise Masonry, LLC' }]
  );

  assert.deepEqual(issues, []);
});
