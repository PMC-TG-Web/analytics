import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canRunLiveBudgetCodePatch,
  fixedBudgetCodeMappingForDescription,
  procoreFlatCostType,
  uniqueByIdentity,
} from '../src/lib/budgetCodePatchMatching.ts';
import { PROCORE_PERMANENT_COST_TYPE_BY_CODE } from '../src/lib/procorePermanentCostTypeLookup.ts';

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

test('Overhead & Profit always maps to O even when its source cost type is wrong', () => {
  for (const description of ['Overhead & Profit.Other', 'Overhead & Profit.Materials',
    'Overhead & Profit.M', 'Overhead & Profit.Labor', 'Overhead & Profit',
    '  OVERHEAD  &  PROFIT.Materials  ']) {
    const row = fixedBudgetCodeMappingForDescription(description);
    assert.equal(row?.['Cost Code'], '90-100-10-10', description);
    assert.equal(row?.['Cost code type'], 'O', description);
    assert.equal(row?.Description, 'Overhead & Profit.Other', description);
  }
  assert.equal(PROCORE_PERMANENT_COST_TYPE_BY_CODE['90-100-10-10'], 'O');
});

test('the overhead rule does not change unrelated materials or partial name matches', () => {
  for (const description of ['Foundation Rebar Material.Materials', 'Overhead Insurance.Other',
    'Other Overhead & Profit.Materials', 'Overhead & Profit Reserve.Materials', '', null]) {
    assert.equal(fixedBudgetCodeMappingForDescription(description), null);
  }
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
