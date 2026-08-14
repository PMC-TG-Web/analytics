import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEstimateCloneLaborRateRepair,
  buildEstimateCloneTakeoffQuantityRepair,
  deriveEstimateCloneMargin,
} from '../src/lib/estimateClonePricing.ts';

test('the source line totals preserve Procore gross-margin percent when cost type changes', () => {
  assert.ok(Math.abs(deriveEstimateCloneMargin(480, 532.8) - 9.9099099099099) < 1e-9);
  assert.ok(Math.abs(deriveEstimateCloneMargin(1432.1, 1546.668) - 7.4074074074074066) < 1e-9);
  assert.equal(deriveEstimateCloneMargin(0, 0), null);
});

test('a dropped labor rate is repaired through the created catalog item', () => {
  const repair = buildEstimateCloneLaborRateRepair(
    { cost_item: { unit_labor_rate: 72.37 } },
    { data: { id: 'line-1', cost_item: { id: 'item-1', unit_labor_rate: null } } }
  );

  assert.deepEqual(repair, {
    lineItemId: 'line-1',
    costItemId: 'item-1',
    unitLaborRate: 72.37,
    body: {
      cost_item: {
        id: 'item-1',
        based_on_item_id: 'item-1',
        unit_labor_rate: 72.37,
      },
    },
  });
});

test('an already preserved labor rate does not produce a repair', () => {
  const repair = buildEstimateCloneLaborRateRepair(
    { cost_item: { unit_labor_rate: 77.37 } },
    { data: { id: 'line-1', cost_item: { id: 'item-1', unit_labor_rate: 77.37 } } }
  );

  assert.equal(repair, null);
});

test('non-labor pricing does not produce a labor-rate repair', () => {
  const repair = buildEstimateCloneLaborRateRepair(
    { cost_item: { unit_labor_rate: null } },
    { data: { id: 'line-1', cost_item: { id: 'item-1', unit_labor_rate: null } } }
  );

  assert.equal(repair, null);
});

test('a priced takeoff quantity dropped during cloning becomes a manual quantity', () => {
  const repair = buildEstimateCloneTakeoffQuantityRepair(
    {
      quantity: 0,
      takeoff_quantity: 8,
      item_cost: 1375.704,
      item_sales: 1492.63884,
      labor_cost: 0,
      labor_sales: 0,
    },
    {
      data: {
        id: 'line-2',
        quantity: 0,
        takeoff_quantity: 0,
        item_cost: 0,
        item_sales: 0,
        labor_cost: 0,
        labor_sales: 0,
      },
    }
  );

  assert.deepEqual(repair, {
    lineItemId: 'line-2',
    quantity: 8,
    body: { quantity: 8 },
  });
});

test('an unpriced takeoff reference does not become a manual quantity', () => {
  const repair = buildEstimateCloneTakeoffQuantityRepair(
    {
      quantity: 0,
      takeoff_quantity: 299.163673,
      item_cost: 0,
      item_sales: 0,
      labor_cost: 0,
      labor_sales: 0,
    },
    {
      data: {
        id: 'line-3',
        quantity: 0,
        takeoff_quantity: 0,
        item_cost: 0,
        item_sales: 0,
        labor_cost: 0,
        labor_sales: 0,
      },
    }
  );

  assert.equal(repair, null);
});
