import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addEstimateLineAmounts,
  aggregateApprovedChangeOrders,
  canonicalBidBoardId,
  classifyConcreteGroup,
  classifyLaborGroup,
  concreteYardQuantity,
  potentialChangeOrderHolderId,
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

test('PCCO lines expose their originating Potential Change Order ID', () => {
  assert.equal(
    potentialChangeOrderHolderId({ holder: { id: 598134327315816, holder_type: 'PotentialChangeOrder' } }),
    '598134327315816',
  );
  assert.equal(
    potentialChangeOrderHolderId({ holder: { id: 123, holder_type: 'PrimeContractChangeOrder' } }),
    null,
  );
});

test('approved PCOs represented by a PCCO are excluded from sales and hours', () => {
  const totals = aggregateApprovedChangeOrders({
    primeChangeOrders: [{ projectId: 'project-1', amount: 150 }],
    primeChangeOrderLines: [
      {
        projectId: 'project-1',
        laborHours: 5,
        payload: { holder: { id: 'pco-1', holder_type: 'PotentialChangeOrder' } },
      },
    ],
    potentialChangeOrders: [
      { projectId: 'project-1', changeOrderId: 'pco-1', amount: 100 },
      { projectId: 'project-1', changeOrderId: 'pco-2', amount: 25 },
    ],
    potentialChangeOrderLines: [
      { projectId: 'project-1', changeOrderId: 'pco-1', laborHours: 5 },
      { projectId: 'project-1', changeOrderId: 'pco-2', laborHours: 2 },
    ],
  }).get('project-1');

  assert.deepEqual(totals, {
    potentialAmount: 25,
    potentialHours: 2,
    potentialCount: 1,
    primeAmount: 150,
    primeHours: 5,
    primeCount: 1,
  });
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

test('a populated estimate wins over an empty auto-created baseline', () => {
  const selected = selectEstimateProposal([
    {
      proposalId: '3',
      isBaselineCandidate: false,
      normalizedLineCount: 5,
      sourceUpdatedAt: '2026-07-20T00:00:00Z',
      payload: { type: 'CHANGE_ORDER' },
    },
    {
      proposalId: '2',
      isBaselineCandidate: false,
      normalizedLineCount: 71,
      sourceUpdatedAt: '2026-07-19T00:00:00Z',
      payload: { type: 'ESTIMATE' },
    },
    {
      proposalId: '1',
      isBaselineCandidate: true,
      normalizedLineCount: 0,
      sourceUpdatedAt: '2026-06-01T00:00:00Z',
      payload: { type: 'ESTIMATE' },
    },
  ]);

  assert.equal(selected?.proposalId, '2');
});

test('a populated baseline still wins over a newer populated revision', () => {
  const selected = selectEstimateProposal([
    {
      proposalId: '2',
      isBaselineCandidate: false,
      normalizedLineCount: 71,
      sourceUpdatedAt: '2026-07-19T00:00:00Z',
      payload: { type: 'ESTIMATE' },
    },
    {
      proposalId: '1',
      isBaselineCandidate: true,
      normalizedLineCount: 42,
      sourceUpdatedAt: '2026-06-01T00:00:00Z',
      payload: { type: 'ESTIMATE' },
    },
  ]);

  assert.equal(selected?.proposalId, '1');
});

test('the Procore primary estimate wins over baseline-name and recency fallbacks', () => {
  const selected = selectEstimateProposal([
    {
      proposalId: '2',
      isPrimaryEstimate: true,
      isBaselineCandidate: false,
      normalizedLineCount: 71,
      sourceUpdatedAt: '2026-07-19T00:00:00Z',
      payload: { type: 'ESTIMATE' },
    },
    {
      proposalId: '1',
      isPrimaryEstimate: false,
      isBaselineCandidate: true,
      normalizedLineCount: 72,
      sourceUpdatedAt: '2026-07-20T00:00:00Z',
      payload: { type: 'ESTIMATE' },
    },
  ]);

  assert.equal(selected?.proposalId, '2');
});

test('requiring the primary estimate does not fall back to a stale proposal', () => {
  const selected = selectEstimateProposal([
    {
      proposalId: '1',
      isPrimaryEstimate: false,
      isBaselineCandidate: true,
      normalizedLineCount: 72,
      payload: { type: 'ESTIMATE' },
    },
  ], { requirePrimary: true });

  assert.equal(selected, null);
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
