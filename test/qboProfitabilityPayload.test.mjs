import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashQboProfitabilitySource,
  normalizeQboProfitabilityPayload,
} from '../scripts/lib/qboProfitabilityPayload.mjs';

function payload(overrides = {}) {
  return {
    generatedAt: '2026-08-03T14:00:00.000Z',
    startDate: '2025-01-01',
    endDate: '2026-08-03',
    accountingMethod: 'Accrual',
    readOnly: true,
    summary: { projectRows: 1 },
    sourceCounts: { qboCustomers: 1 },
    rows: [{
      qboCustomerId: '10',
      recordType: 'project',
      projectName: 'Test Project',
      fullyQualifiedName: 'Customer:Test Project',
      active: true,
      parentCustomerId: '9',
      procoreProjectId: null,
      procoreProjectNumber: null,
      procoreProjectName: null,
      procoreMatchMethod: 'unmatched',
      procoreDirectCost: 31.25,
      procoreDirectCostLineCount: 2,
      procoreDirectCostStatus: 'available',
      qboMinusProcoreDirectCost: 3.75,
      sales: 100,
      costOfGoodsSold: 25,
      operatingExpenses: 10,
      otherIncome: 0,
      otherExpenses: 0,
      actualCost: 35,
      profit: 65,
      marginPercent: 65,
      reportedNetIncome: 65,
      reconciliationDifference: 0,
    }],
    ...overrides,
  };
}

test('normalizes a read-only QBO profitability payload', () => {
  const normalized = normalizeQboProfitabilityPayload(payload());
  assert.equal(normalized.accountingMethod, 'Accrual');
  assert.equal(normalized.rows.length, 1);
  assert.equal(normalized.rows[0].actualCost, 35);
  assert.equal(normalized.rows[0].procoreDirectCost, 31.25);
  assert.equal(normalized.rows[0].qboMinusProcoreDirectCost, 3.75);
});

test('rejects a payload that is not explicitly read-only', () => {
  assert.throws(
    () => normalizeQboProfitabilityPayload(payload({ readOnly: false })),
    /Only read-only profitability exports/,
  );
});

test('rejects duplicate QuickBooks customer identifiers', () => {
  const source = payload();
  source.rows.push({ ...source.rows[0] });
  assert.throws(() => normalizeQboProfitabilityPayload(source), /Duplicate qboCustomerId/);
});

test('source hashes are deterministic and content-sensitive', () => {
  assert.equal(hashQboProfitabilitySource('abc'), hashQboProfitabilitySource('abc'));
  assert.notEqual(hashQboProfitabilitySource('abc'), hashQboProfitabilitySource('abcd'));
});
