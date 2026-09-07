import assert from 'node:assert/strict';
import test from 'node:test';

import {
  procoreWorkerResultRateLimitUntil,
  procoreWorkerRetryPlan,
} from '../src/lib/procoreWorkerBackoff.js';

const now = Date.parse('2026-09-07T22:35:15.000Z');

test('a busy shared lease waits briefly instead of ending the tick', () => {
  assert.deepEqual(
    procoreWorkerRetryPlan({ success: true, skipped: true, reason: 'worker_busy' }, { nowMs: now }),
    { action: 'wait', waitMs: 1_000, reason: 'worker_busy' },
  );
  assert.deepEqual(
    procoreWorkerRetryPlan(
      { success: true, skipped: true, reason: 'worker_busy' },
      { nowMs: now, deadlineMs: now + 500 },
    ),
    { action: 'stop', reason: 'deadline' },
  );
});

test('a short quota cooldown is waited out with padding', () => {
  const plan = procoreWorkerRetryPlan({
    success: true,
    skipped: true,
    reason: 'rate_limit_cooldown',
    rateLimitUntil: '2026-09-07T22:35:18.500Z',
  }, { nowMs: now });
  assert.deepEqual(plan, { action: 'wait', waitMs: 3_750, reason: 'rate_limit_cooldown' });
});

test('a long cooldown or one without a reset time stops the loop', () => {
  assert.deepEqual(
    procoreWorkerRetryPlan({
      success: true,
      skipped: true,
      reason: 'rate_limit_cooldown',
      rateLimitUntil: '2026-09-07T22:50:15.000Z',
    }, { nowMs: now }),
    { action: 'stop', reason: 'rate_limit_cooldown' },
  );
  assert.deepEqual(
    procoreWorkerRetryPlan({ success: true, skipped: true, reason: 'rate_limit_cooldown' }, { nowMs: now }),
    { action: 'stop', reason: 'rate_limit_cooldown' },
  );
});

test('a project deferred mid-sync by a brief cooldown is retried after the reset', () => {
  const result = {
    success: true,
    completed: false,
    deferred: true,
    projectId: '598134326649722',
    steps: [
      { step: 'timecard-entries', status: 'ok', rateLimited: false },
      {
        step: 'productivity-logs',
        status: 'error',
        rateLimited: true,
        rateLimitUntil: '2026-09-07T22:35:17.000Z',
      },
    ],
  };
  assert.equal(
    procoreWorkerResultRateLimitUntil(result)?.toISOString(),
    '2026-09-07T22:35:17.000Z',
  );
  assert.deepEqual(
    procoreWorkerRetryPlan(result, { nowMs: now }),
    { action: 'wait', waitMs: 2_250, reason: 'rate_limit_cooldown' },
  );
});

test('other skips stop and normal results proceed', () => {
  assert.deepEqual(
    procoreWorkerRetryPlan({ success: true, skipped: true, reason: 'no_project_due' }, { nowMs: now }),
    { action: 'stop', reason: 'no_project_due' },
  );
  assert.deepEqual(
    procoreWorkerRetryPlan({ success: true, completed: true, projectId: '1', steps: [] }, { nowMs: now }),
    { action: 'proceed' },
  );
  assert.deepEqual(procoreWorkerRetryPlan(null, { nowMs: now }), { action: 'proceed' });
});
