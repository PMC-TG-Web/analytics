import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMITMENT_MAKER_COST_TYPE,
  COMMITMENT_MAKER_VENDOR_NAME,
  combineCommitmentMakerGroups,
  commitmentMakerLineCreatePayload,
  commitmentMakerOwnedLineItemsFromAudit,
  commitmentMakerProjectIdFromSearch,
  commitmentMakerSourceWbsCandidate,
  commitmentMakerVendorIsAssignedToProject,
  isCommitmentMakerExcludedLine,
  isCommitmentMakerEstimateMatchingLine,
  parseCommitmentMakerRows,
  planNextPurchaseOrderNumbers,
  selectCommitmentMakerWbsCandidate,
} from '../src/lib/procore/commitmentMaker.ts';

test('blocks a commitment line when its required Procore Budget Code is missing', () => {
  assert.throws(() => commitmentMakerLineCreatePayload({
    costCode: '05-100-10-10',
    costType: 'O',
    description: 'Bollards',
    quantity: 2,
    uom: 'EA',
    unitCost: 10,
    subtotalOverride: null,
    wbsCodeId: null,
  }), /missing its required Procore Budget Code/);
});

test('keeps a resolved project WBS ID on the commitment line request', () => {
  const payload = commitmentMakerLineCreatePayload({
    costCode: '03-300-30-10',
    costType: 'O',
    description: 'Concrete',
    quantity: 3,
    uom: 'CY',
    unitCost: 125.55,
    subtotalOverride: null,
    wbsCodeId: '12345',
  });

  assert.equal(payload.wbs_code_id, '12345');
  assert.equal(payload.amount, 376.65);
});

test('reads exact PO line ownership and replay payloads from a successful audit', () => {
  const owned = commitmentMakerOwnedLineItemsFromAudit({
    ownedLineItems: [{
      id: '598134422367524',
      payload: {
        description: 'CO2 - Foundation Wood Forms',
        quantity: 52,
        unit_cost: 1.42,
        amount: 73.84,
        uom: 'sf',
        wbs_code_id: '598136733263448',
      },
    }],
  }, 1);

  assert.equal(owned?.[0].id, '598134422367524');
  assert.equal(owned?.[0].payload.wbs_code_id, '598136733263448');
  assert.equal(commitmentMakerOwnedLineItemsFromAudit({ createdLineItems: 1 }, 1), null);
});

test('rejects incomplete or duplicate saved PO line ownership', () => {
  const line = {
    id: '598134422367524',
    payload: {
      description: 'CO2 - Foundation Wood Forms',
      quantity: 52,
      unit_cost: 1.42,
      amount: 73.84,
      uom: 'sf',
      wbs_code_id: '598136733263448',
    },
  };
  assert.throws(
    () => commitmentMakerOwnedLineItemsFromAudit({ ownedLineItems: [line] }, 2),
    /ownership is incomplete/,
  );
  assert.throws(
    () => commitmentMakerOwnedLineItemsFromAudit({ ownedLineItems: [line, line] }, 2),
    /duplicate Procore line IDs/,
  );
});

test('uses the fixed Paradise Masonry vendor', () => {
  assert.equal(COMMITMENT_MAKER_VENDOR_NAME, 'Paradise Masonry, LLC');
});

test('recognizes company-vendor project membership from Procore project IDs', () => {
  assert.equal(commitmentMakerVendorIsAssignedToProject({
    project_ids: [598134326663255, '598134326664157'],
  }, '598134326663255'), true);
  assert.equal(commitmentMakerVendorIsAssignedToProject({
    projectIds: ['598134326663255'],
  }, '598134326663255'), true);
  assert.equal(commitmentMakerVendorIsAssignedToProject({
    project_ids: [598134326664157],
  }, '598134326663255'), false);
  assert.equal(commitmentMakerVendorIsAssignedToProject({}, '598134326663255'), false);
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

test('always excludes overhead and shop drawing lines from commitments', () => {
  assert.equal(isCommitmentMakerExcludedLine('90-100-10-10', 'Quickbooks adjustment'), true);
  assert.equal(isCommitmentMakerExcludedLine('01-300-10-40', 'Overhead & Profit - Pier'), true);
  assert.equal(isCommitmentMakerExcludedLine('01-300-10-40', 'Shop Drawing'), true);
  assert.equal(isCommitmentMakerExcludedLine('01-300-10-40', 'Shop Drawings - Pier'), true);
  assert.equal(isCommitmentMakerExcludedLine('03-200-10-20', '#4 Rebar - Pier'), false);
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
        costType: 'M',
        description: '#4 Rebar - Foundation',
        quantity: 5,
        uom: 'ea',
        unitCost: 7.18,
        subtotalOverride: null,
      },
      {
        costCode: '03-300-00-10',
        costType: 'M',
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

test('defaults unassigned commitment lines to Materials', () => {
  assert.equal(COMMITMENT_MAKER_COST_TYPE, 'M');
  assert.equal(parseCommitmentMakerRows([
    ['Budget Code', 'Description', 'Quantity', 'UOM', 'Unit Price'],
    ['03-200-10-20', '#4 Rebar', 8, 'ea', 8.15],
  ]).groups[0].lineItems[0].costType, 'M');
});

test('keeps an approved change-order WBS ID even when it has no budget line', () => {
  assert.deepEqual(commitmentMakerSourceWbsCandidate({
    costCode: '03-200-10-20',
    costType: '',
    sourceWbsCodeId: '598136734324413',
    description: 'CO4 - #4 Rebar',
    quantity: 8,
    uom: 'ea',
    unitCost: 8.15,
    subtotalOverride: null,
  }), {
    id: '598136734324413',
    flatCode: '03-200-10-20.M',
    costCode: '03-200-10-20',
    costType: 'M',
  });
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

test('combines selected purchase orders and aggregates matching line quantities', () => {
  const concrete = {
    costCode: '03-300-30-20',
    costType: 'O',
    description: 'Ready Mix Concrete - Site',
    quantity: 2,
    uom: 'cy',
    unitCost: 140.45,
    subtotalOverride: null,
  };
  const groups = [
    { name: 'Sidewalk', lineItems: [concrete] },
    {
      name: 'Island Infill',
      lineItems: [
        { ...concrete, quantity: 3 },
        { ...concrete, costCode: '03-200-10-20', description: '#4 Rebar - Site', quantity: 10, uom: 'ea', unitCost: 7.18 },
      ],
    },
    { name: 'Dumpster Pad', lineItems: [{ ...concrete, quantity: 4 }] },
  ];

  const result = combineCommitmentMakerGroups(groups, ['Sidewalk', 'Island Infill'], 'Site Extras');

  assert.deepEqual(result.map((group) => group.name), ['Site Extras', 'Dumpster Pad']);
  assert.equal(result[0].lineItems.length, 2);
  assert.equal(result[0].lineItems[0].quantity, 5);
  assert.equal(result[1].lineItems[0].quantity, 4);
});

test('combined purchase orders keep differently priced lines separate', () => {
  const base = {
    costCode: '03-300-30-20',
    costType: 'O',
    description: 'Ready Mix Concrete',
    quantity: 2,
    uom: 'cy',
    unitCost: 140,
    subtotalOverride: null,
  };
  const result = combineCommitmentMakerGroups([
    { name: 'A', lineItems: [base] },
    { name: 'B', lineItems: [{ ...base, quantity: 3, unitCost: 145 }] },
  ], ['A', 'B'], 'Combined Concrete');

  assert.equal(result[0].lineItems.length, 2);
  assert.deepEqual(result[0].lineItems.map((line) => line.quantity), [2, 3]);
});

test('combining purchase orders requires two selections and a unique title', () => {
  const line = {
    costCode: '03-300-30-20', costType: 'O', description: 'Concrete', quantity: 1,
    uom: 'cy', unitCost: 100, subtotalOverride: null,
  };
  const groups = [
    { name: 'A', lineItems: [line] },
    { name: 'B', lineItems: [line] },
    { name: 'C', lineItems: [line] },
  ];
  assert.throws(() => combineCommitmentMakerGroups(groups, ['A'], 'Combined'), /at least two/);
  assert.throws(() => combineCommitmentMakerGroups(groups, ['A', 'B'], 'C'), /already uses that title/);
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

test('uses the approved change-order source WBS ID when multiple types share a cost code', () => {
  const candidates = [
    { id: 'equipment', flatCode: '03-300-20-30.E', costCode: '03-300-20-30', costType: 'E' },
    { id: 'subcontract', flatCode: '03-300-20-30.S', costCode: '03-300-20-30', costType: 'S' },
  ];

  assert.equal(selectCommitmentMakerWbsCandidate(candidates, 'O', 'subcontract')?.id, 'subcontract');
});
