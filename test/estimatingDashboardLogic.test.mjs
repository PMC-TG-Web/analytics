import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addEstimateLineAmounts,
  canonicalBidBoardId,
  classifyLaborGroup,
  selectEstimateProposal,
} from '../src/lib/estimatingDashboardLogic.ts';

test('legacy company-prefixed and current bid-board IDs resolve to one identity', () => {
  assert.equal(canonicalBidBoardId('598134325805519:562949955854696'), '562949955854696');
  assert.equal(canonicalBidBoardId('562949955854696'), '562949955854696');
});

test('baseline estimate wins over a newer revision or change order', () => {
  const selected = selectEstimateProposal([
    {
      proposalId: '3',
      isBaselineCandidate: false,
      sourceUpdatedAt: '2026-07-20T00:00:00Z',
      payload: { type: 'CHANGE_ORDER' },
    },
    {
      proposalId: '2',
      isBaselineCandidate: false,
      sourceUpdatedAt: '2026-07-19T00:00:00Z',
      payload: { type: 'ESTIMATE' },
    },
    {
      proposalId: '1',
      isBaselineCandidate: true,
      sourceUpdatedAt: '2026-06-01T00:00:00Z',
      payload: { type: 'ESTIMATE' },
    },
  ]);

  assert.equal(selected?.proposalId, '1');
});

test('project totals add item and labor amounts once', () => {
  const totals = addEstimateLineAmounts(
    { sales: 0, cost: 0, hours: 0, laborSales: 0, laborCost: 0 },
    {
      itemSales: '100',
      itemCost: '80',
      laborSales: '25',
      laborCost: '20',
      laborHours: '2.5',
    },
  );

  assert.deepEqual(totals, {
    sales: 125,
    cost: 100,
    hours: 2.5,
    laborSales: 25,
    laborCost: 20,
  });
});

test('estimating labor names roll up into dashboard categories', () => {
  assert.equal(classifyLaborGroup({ name: 'Labor Slab On Grade' }), 'Slab On Grade Labor');
  assert.equal(classifyLaborGroup({ name: 'Labor Site Concrete' }), 'Site Concrete Labor');
  assert.equal(classifyLaborGroup({ name: 'Continuous Footing Labor' }), 'Foundation Labor');
  assert.equal(classifyLaborGroup({ name: 'Wall Forms Labor' }), 'Wall Labor');
  assert.equal(classifyLaborGroup({ name: 'Management' }), 'PM');
  assert.equal(classifyLaborGroup({ name: 'Labor Travel' }), 'Travel Labor');
});
