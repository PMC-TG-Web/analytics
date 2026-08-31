import assert from 'node:assert/strict';
import test from 'node:test';

import { procoreAutomationCadence } from '../src/lib/procoreAutomationCadence.js';
import { shouldParkProjectOnboarding } from '../src/lib/projectOnboardingPolicy.js';

test('the proven five-minute worker owns health and reconciliation cadence', () => {
  assert.deepEqual(procoreAutomationCadence(new Date('2026-08-14T12:00:00.000Z')), {
    runHealthMonitor: true,
    runProjectReconciliation: false,
    runActualsReconciliation: false,
  });
  assert.deepEqual(procoreAutomationCadence(new Date('2026-08-14T12:10:00.000Z')), {
    runHealthMonitor: false,
    runProjectReconciliation: true,
    runActualsReconciliation: false,
  });
  assert.deepEqual(procoreAutomationCadence(new Date('2026-08-14T12:15:00.000Z')), {
    runHealthMonitor: true,
    runProjectReconciliation: false,
    runActualsReconciliation: false,
  });
  assert.deepEqual(procoreAutomationCadence(new Date('2026-08-14T12:40:00.000Z')), {
    runHealthMonitor: false,
    runProjectReconciliation: false,
    runActualsReconciliation: true,
  });
});

test('PMC Operations is parked because it is an internal non-job project', () => {
  assert.equal(shouldParkProjectOnboarding({ projectNumber: 'PMC-OPS', projectName: 'PMC Operations' }), true);
  assert.equal(shouldParkProjectOnboarding({ projectNumber: '2603 - WR', projectName: 'WSCA Ramp' }), false);
});

test('the known Procore sandbox is parked instead of creating a permanent onboarding alert', () => {
  assert.equal(shouldParkProjectOnboarding({
    projectId: '598134326542330',
    projectNumber: '12345',
    projectName: 'Sandbox Test Project',
  }), true);
  assert.equal(shouldParkProjectOnboarding({
    projectId: '598134326649722',
    projectNumber: '2616 - HC',
    projectName: 'Honey Brook Commons',
  }), false);
});
