import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveProjectContractValue } from '../src/lib/projectProfitabilityContractValue.js';

test('matched projects use the Procore estimate plus approved change orders', () => {
  assert.deepEqual(resolveProjectContractValue({
    procoreProjectId: '598134326628693',
    procoreBaseEstimate: 9208.51,
    procoreApprovedChangeOrders: 3120.76,
    qboEstimateTotal: null,
    netBilled: 12329.27,
  }), {
    contractValue: 12329.27,
    contractValueSource: 'procore',
    procoreBaseEstimate: 9208.51,
    procoreApprovedChangeOrders: 3120.76,
    billingProgressPercent: 100,
    remainingToBill: 0,
  });
});

test('a matched Procore project never falls back to a QBO estimate', () => {
  assert.deepEqual(resolveProjectContractValue({
    procoreProjectId: 'procore-1',
    procoreBaseEstimate: null,
    procoreApprovedChangeOrders: null,
    qboEstimateTotal: 50000,
    netBilled: 10000,
  }), {
    contractValue: null,
    contractValueSource: 'procore-unavailable',
    procoreBaseEstimate: null,
    procoreApprovedChangeOrders: null,
    billingProgressPercent: null,
    remainingToBill: null,
  });
});

test('unmatched projects use QBO estimates and derive billing progress', () => {
  assert.deepEqual(resolveProjectContractValue({
    procoreProjectId: null,
    procoreBaseEstimate: null,
    procoreApprovedChangeOrders: null,
    qboEstimateTotal: 40000,
    netBilled: 10000,
  }), {
    contractValue: 40000,
    contractValueSource: 'qbo-estimates',
    procoreBaseEstimate: null,
    procoreApprovedChangeOrders: null,
    billingProgressPercent: 25,
    remainingToBill: 30000,
  });
});
