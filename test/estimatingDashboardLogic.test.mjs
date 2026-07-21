import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addEstimateLineAmounts,
  canonicalBidBoardId,
  classifyConcreteGroup,
  classifyLaborGroup,
  concreteYardQuantity,
  selectEstimateProposal,
} from '../src/lib/estimatingDashboardLogic.ts';

test('legacy company-prefixed and current bid-board IDs resolve to one identity', () => {
  assert.equal(canonicalBidBoardId('598134325805519:562949955854696'), '562949955854696');
  assert.equal(canonicalBidBoardId('562949955854696'), '562949955854696');
});

test('ready-mix counts in both CU_YD and legacy EA units are treated as yards', () => {
  assert.equal(concreteYardQuantity({ name: '4000 PSI Concrete', uom: 'CU_YD', quantity: '30.5' }), 30.5);
  assert.equal(concreteYardQuantity({ name: '3000 PSI Rohrers Concrete', uom: 'EA', quantity: '545' }), 545);
  assert.equal(concreteYardQuantity({ name: 'Concrete Wash Out Fee', uom: 'CU_YD', quantity: '2' }), 0);
  assert.equal(concreteYardQuantity({ name: 'Concrete Repair Epoxy', uom: 'EA', quantity: '12' }), 0);
});

test('generic concrete inherits the placement category from labor in its estimate group', () => {
  assert.equal(classifyConcreteGroup({ name: '4000 PSI Heritage Concrete' }, 'Site Concrete Labor'), 'Site');
  assert.equal(classifyConcreteGroup({ name: '3500 PSI Concrete' }, 'Foundation Labor'), 'Foundation');
  assert.equal(classifyConcreteGroup({ name: 'Wall Concrete' }, 'Site Concrete Labor'), 'Wall');
  assert.equal(classifyConcreteGroup({ name: 'Slab On Grade Concrete' }, 'Site Concrete Labor'), 'Slab On Grade');
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
