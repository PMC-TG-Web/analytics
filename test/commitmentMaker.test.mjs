import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMITMENT_MAKER_VENDOR_NAME,
  commitmentMakerProjectIdFromSearch,
  isCommitmentMakerEstimateMatchingLine,
  parseCommitmentMakerRows,
  planNextPurchaseOrderNumbers,
  selectCommitmentMakerWbsCandidate,
} from '../src/lib/procore/commitmentMaker.ts';

test('uses the fixed Paradise Masonry vendor', () => {
  assert.equal(COMMITMENT_MAKER_VENDOR_NAME, 'Paradise Masonry, LLC');
});

test('excludes estimate-to-contract balancing rows from commitment lines', () => {
  const rows = [
    ['Budget Code', 'Cost Catalog Item', 'Quantity', 'UoM (Quantity)', 'Unit Cost'],
    ['SIDEWALK', '', '', 'Mixed', ''],
    ['03-300-30-20 - SITE', 'Ready Mix Concrete', '83', 'cu yd', '$140.45'],
    ['90-100-10-10', 'Item used to match estimate with contract line.', '1', 'ea', '$0.01'],
  ];

  const result = parseCommitmentMakerRows(rows);

  assert.equal(result.groups[0].lineItems.length, 1);
  assert.equal(result.groups[0].lineItems[0].description, 'Ready Mix Concrete - Site');
  assert.equal(result.groups[0].lineItems[0].quantity, 83);
  assert.equal(result.skippedRows, 1);
  assert.equal(isCommitmentMakerEstimateMatchingLine('90-100-10-10', 'Created to match estimate'), true);
  assert.equal(isCommitmentMakerEstimateMatchingLine('03-300-30-20', 'Ready Mix Concrete'), false);
});

test('ports the production split-with-labor transformation', () => {
  const rows = [
    ['Estimate export'],
    ['Budget Code', 'Cost Catalog Item', 'Quantity', 'UoM (Quantity)', 'Unit Cost'],
    ['FOUNDATION', '', '', 'Mixed', ''],
    ['03-200-10-20 - FOUNDATION', '#4 Rebar', '2', 'ea', '$7.18'],
    ['03-200-10-20 - FOUNDATION', '#4 Rebar', '3', 'ea', '$7.18'],
    ['03-300-00-10 - FOUNDATION', 'Foundation Labor', '8', 'hr', '$38'],
    ['01-500-10-10 - FOUNDATION', 'Project Management', '2', 'hr', '$38'],
    ['01-500-10-10 - FOUNDATION', 'Shop Drawing', '1', 'ea', '$10'],
    ['WALLS', '', '', 'Mixed', ''],
    ['03-100-20-20 - WALL', 'Wood Forms', '10', 'sq ft', '$1.45'],
    ['03-100-20-20 - WALL', 'Invalid Price', '2', 'ea', '$0'],
  ];

  const result = parseCommitmentMakerRows(rows, { fallbackGroupName: 'Estimate' });

  assert.equal(result.headerRowIndex, 1);
  assert.equal(result.groups.length, 2);
  assert.equal(result.skippedRows, 3);
  assert.deepEqual(result.groups[0], {
    name: 'FOUNDATION',
    lineItems: [
      {
        costCode: '03-200-10-20',
        costType: 'O',
        description: '#4 Rebar - Foundation',
        quantity: 5,
        uom: 'ea',
        unitCost: 7.18,
        subtotalOverride: null,
      },
      {
        costCode: '03-300-00-10',
        costType: 'O',
        description: 'Foundation Labor - Foundation',
        quantity: 8,
        uom: 'hours',
        unitCost: 0,
        subtotalOverride: null,
      },
    ],
  });
  assert.equal(result.groups[1].lineItems[0].uom, 'sf');
});

test('merges repeated group names into one purchase order', () => {
  const rows = [
    ['Cost Code', 'Description', 'Quantity', 'UOM', 'Unit Price'],
    ['SITE', '', '', 'Mixed', ''],
    ['03-300-30-20 - SITE', 'Concrete', 1, 'cy', 100],
    ['SITE', '', '', 'Mixed', ''],
    ['03-300-30-20 - SITE', 'Concrete', 2, 'cy', 100],
  ];
  const result = parseCommitmentMakerRows(rows);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].lineItems[0].quantity, 3);
});

test('plans padded PO numbers after the largest existing numeric number', () => {
  assert.deepEqual(planNextPurchaseOrderNumbers(['001', '009', 'A-12'], 3), ['010', '011', '012']);
  assert.deepEqual(planNextPurchaseOrderNumbers([], 2), ['001', '002']);
  assert.deepEqual(planNextPurchaseOrderNumbers(['0999'], 1), ['1000']);
  assert.deepEqual(planNextPurchaseOrderNumbers(['PO-008', 'PO-009'], 2), ['PO-010', 'PO-011']);
});

test('reads only a numeric project ID from the Project Home link', () => {
  assert.equal(
    commitmentMakerProjectIdFromSearch('?projectId=598134326626273&source=procore-project-home'),
    '598134326626273',
  );
  assert.equal(commitmentMakerProjectIdFromSearch('?project_id=12345'), '12345');
  assert.equal(commitmentMakerProjectIdFromSearch('?projectId=wrong-project'), '');
});

test('prefers the requested WBS cost type when it exists', () => {
  const candidates = [
    { id: 'material', flatCode: '03-300-30-20.M', costCode: '03-300-30-20', costType: 'Materials' },
    { id: 'other', flatCode: '03-300-30-20.O', costCode: '03-300-30-20', costType: 'Other' },
  ];

  assert.equal(selectCommitmentMakerWbsCandidate(candidates, 'O')?.id, 'other');
});

test('uses one unambiguous project WBS code when the old O type is absent', () => {
  const candidates = [
    { id: 'material', flatCode: '03-150-10-85.M', costCode: '03-150-10-85', costType: 'M' },
  ];

  assert.equal(selectCommitmentMakerWbsCandidate(candidates, 'O')?.id, 'material');
});

test('does not guess when multiple project WBS types exist and O is absent', () => {
  const candidates = [
    { id: 'labor', flatCode: '03-300-30-10.L', costCode: '03-300-30-10', costType: 'L' },
    { id: 'material', flatCode: '03-300-30-10.M', costCode: '03-300-30-10', costType: 'M' },
  ];

  assert.equal(selectCommitmentMakerWbsCandidate(candidates, 'O'), null);
});
