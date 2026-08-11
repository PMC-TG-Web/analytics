import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateCostCodeSales,
  aggregateQboProjectActuals,
  analyticsPeriod,
  calculateActualProfitComparison,
  normalizeAnalyticsCostCode,
} from '../src/lib/costCodeSalesAnalytics.ts';
import {
  loadEstimatingCostCodeCatalog,
  loadEstimatingCostCodeAliasCatalog,
  loadEstimatingCostCodeNameCatalog,
  normalizeEstimatingItemName,
  resolveEstimatingCostCodeAliases,
} from '../src/lib/estimatingCostCodeCrosswalk.ts';

test('cost-code analytics groups item and labor values by UTC month', () => {
  const rows = aggregateCostCodeSales([
    {
      periodDate: '2026-02-28T23:00:00-05:00',
      status: 'Bid Submitted',
      costCode: ' 03-300-10-10 ',
      costCodeName: 'Labor Foundation Forms',
      reportingGroup: 'Foundation Labor',
      topLevelGroup: 'Foundations',
      itemSales: 100,
      laborSales: 50,
      itemCost: 60,
      laborCost: 30,
      projectId: 'project-1',
    },
    {
      periodDate: '2026-03-15T12:00:00Z',
      status: 'Bid Submitted',
      costCode: '03-300-10-10',
      reportingGroup: 'Foundation Labor',
      topLevelGroup: 'Foundations',
      itemSales: '40',
      laborSales: '10',
      itemCost: '20',
      laborCost: '5',
      projectId: 'project-2',
    },
  ]);

  assert.deepEqual(rows, [{
    period: '2026-03',
    year: 2026,
    month: 3,
    status: 'Bid Submitted',
    costCode: '03-300-10-10',
    costCodeName: 'Labor Foundation Forms',
    reportingGroup: 'Foundation Labor',
    topLevelGroup: 'Foundations',
    sales: 200,
    cost: 115,
    profit: 85,
    marginPercent: 42.5,
    projectCount: 2,
    lineCount: 2,
  }]);
});

test('cost-code analytics retains unassigned lines and rejects invalid dates', () => {
  assert.equal(normalizeAnalyticsCostCode(''), 'UNASSIGNED');
  assert.equal(analyticsPeriod('not-a-date'), null);
  assert.equal(aggregateCostCodeSales([
    { periodDate: '2025-01-03', costCode: null, itemSales: 25, itemCost: 10 },
    { periodDate: null, costCode: 'ignored', itemSales: 100 },
  ])[0].costCode, 'UNASSIGNED');
});

test('cost-code analytics keeps Procore statuses independently filterable', () => {
  const rows = aggregateCostCodeSales([
    { periodDate: '2026-03-01', status: 'Complete', costCode: '03-300', itemSales: 100 },
    { periodDate: '2026-03-01', status: 'In Progress', costCode: '03-300', itemSales: 50 },
  ]);

  assert.deepEqual(rows.map((row) => [row.status, row.sales]), [
    ['Complete', 100],
    ['In Progress', 50],
  ]);
});

test('QBO actual costs aggregate once per matched Procore project', () => {
  assert.deepEqual(aggregateQboProjectActuals([
    { procoreProjectId: ' project-1 ', qboProjectName: 'QBO Job', matchMethod: 'exact-name', actualCost: '125.50' },
    { procoreProjectId: 'project-1', qboProjectName: 'QBO Job Phase', matchMethod: 'exact-name', actualCost: 24.5 },
    { procoreProjectId: null, qboProjectName: 'Unmatched', actualCost: 900 },
  ]), [{
    procoreProjectId: 'project-1',
    qboProjectName: 'QBO Job',
    matchMethod: 'exact-name',
    actualCost: 150,
    rowCount: 2,
  }]);
});

test('actual profit comparison keeps estimated sales as the shared revenue basis', () => {
  const comparison = calculateActualProfitComparison(9208.51, 6996.56);
  assert.equal(Number(comparison.profit.toFixed(2)), 2211.95);
  assert.equal(Number(comparison.marginPercent.toFixed(2)), 24.02);
  assert.equal(calculateActualProfitComparison(9208.51, null), null);
});

test('estimating catalog resolves ItemId to actual code and reporting hierarchy', () => {
  const catalog = loadEstimatingCostCodeCatalog();
  assert.deepEqual(catalog.get('36741786'), {
    itemName: "ADA Plate 2'x3'",
    costCode: '03-150-10-85',
    costName: "ADA Plate 2'x3'",
    description: 'Accessories Material',
    reportingGroup: 'Accessories Material',
    topLevelGroup: 'Job cost',
  });
  assert.equal(catalog.size, 548);
});

test('estimating catalog resolves unique names but rejects ambiguous hierarchy mappings', () => {
  const catalog = loadEstimatingCostCodeNameCatalog();
  assert.equal(catalog.get(normalizeEstimatingItemName("ADA Plate 2'x3'"))?.costCode, '03-150-10-85');
  assert.equal(catalog.has(normalizeEstimatingItemName("#8 Rebar - 20' Pc")), false);
});

test('estimating aliases use payload name and description to map renamed items', () => {
  const aliases = loadEstimatingCostCodeAliasCatalog();
  const concrete = resolveEstimatingCostCodeAliases([
    '4000 Psi Rohrers Concrete',
    'Slab On Grade Concrete',
    'Ready Mix Concrete For Slabs On Grade',
  ], aliases);
  assert.equal(concrete?.costCode, '03-300-20-20');
  assert.equal(concrete?.reportingGroup, 'SOG Concrete Material');

  const subcontractor = resolveEstimatingCostCodeAliases([
    'Poured Wall Subcontractor / Weiler Walls',
    'Poured Wall Subcontractor',
  ], aliases);
  assert.equal(subcontractor?.costCode, '03-300-10-50');
});

test('estimating aliases require a category hint for repeated catalog names', () => {
  const aliases = loadEstimatingCostCodeAliasCatalog();
  assert.equal(resolveEstimatingCostCodeAliases(["#8 Rebar - 20' Pc"], aliases), null);
  assert.equal(
    resolveEstimatingCostCodeAliases(["#8 Rebar - 20' Pc"], aliases, 'SOG')?.costCode,
    '03-200-30-20',
  );
});