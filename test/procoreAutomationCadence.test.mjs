import assert from 'node:assert/strict';
import test from 'node:test';

import { procoreAutomationCadence } from '../src/lib/procoreAutomationCadence.js';
import { shouldParkProjectOnboarding } from '../src/lib/projectOnboardingPolicy.js';

test('the proven five-minute worker owns health and reconciliation cadence', () => {
  assert.deepEqual(procoreAutomationCadence(new Date('2026-08-14T12:00:00.000Z')), {
    runHealthMonitor: true,
    runProjectReconciliation: false,
  });
  assert.deepEqual(procoreAutomationCadence(new Date('2026-08-14T12:10:00.000Z')), {
    runHealthMonitor: false,
    runProjectReconciliation: true,
  });
  assert.deepEqual(procoreAutomationCadence(new Date('2026-08-14T12:15:00.000Z')), {
    runHealthMonitor: true,
    runProjectReconciliation: false,
  });
});

test('PMC Operations is parked because it is an internal non-job project', () => {
  assert.equal(shouldParkProjectOnboarding({ projectNumber: 'PMC-OPS', projectName: 'PMC Operations' }), true);
  assert.equal(shouldParkProjectOnboarding({ projectNumber: '2603 - WR', projectName: 'WSCA Ramp' }), false);
});
