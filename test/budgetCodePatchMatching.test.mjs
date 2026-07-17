import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canRunLiveBudgetCodePatch,
  fixedBudgetCodeMappingForDescription,
  procoreFlatCostType,
  uniqueByIdentity,
} from '../src/lib/budgetCodePatchMatching.ts';

test('identical WBS records from multiple Procore endpoints are deduplicated', () => {
  const records = uniqueByIdentity([
    { wbsCodeId: '598136794584874', source: 'budget' },
    { wbsCodeId: '598136794584874', source: 'wbs' },
    { wbsCodeId: '598136794584878', source: 'budget' },
  ], (row) => row.wbsCodeId);

  assert.deepEqual(records, [
    { wbsCodeId: '598136794584874', source: 'budget' },
    { wbsCodeId: '598136794584878', source: 'budget' },
  ]);
});

test('Overhead & Profit.Other always maps to the O budget code', () => {
  const row = fixedBudgetCodeMappingForDescription('Overhead & Profit.Other');

  assert.equal(row?.['Cost Code'], '90-100-10-10');
  assert.equal(row?.['Cost code type'], 'O');
});

test('fixed budget mapping does not apply to Materials', () => {
  assert.equal(fixedBudgetCodeMappingForDescription('Overhead & Profit.Materials'), null);
});

test('workbook subcontractor type S remains S in Procore flat codes', () => {
  assert.equal(procoreFlatCostType('S'), 'S');
  assert.equal(procoreFlatCostType('Subcontractors'), 'S');
  assert.equal(procoreFlatCostType('C'), 'C');
});

test('live patch is enabled when missing WBS codes will be created first', () => {
  assert.equal(canRunLiveBudgetCodePatch({ patchable: 0, missingWbsCodes: 1 }, true), true);
  assert.equal(canRunLiveBudgetCodePatch({ patchable: 0, missingWbsCodes: 1 }, false), false);
  assert.equal(canRunLiveBudgetCodePatch({ patchable: 1, missingWbsCodes: 0 }, false), true);
});
