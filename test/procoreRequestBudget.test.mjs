import assert from 'node:assert/strict';
import test from 'node:test';
import { reserveProcoreRequest, observeProcoreBudget, procoreUsageEndpoint } from '../src/lib/procoreRequestBudget.ts';

const now = Date.parse('2026-09-17T13:00:00Z');
const state = (extra = {}) => ({ leaseId: null, leaseUntil: 0, interactiveUntil: 0, blockedUntil: 0, windows: [], ...extra });
const hourly = remaining => ({ limit: 600, remaining, resetAt: now + 3_600_000 });

test('background work yields the last quarter of quota to interactive requests', () => {
  const current = state({ windows: [hourly(150)] });
  assert.equal(reserveProcoreRequest(current, 'background', now, 200).retryAt, now + 3_600_000);
  const interactive = reserveProcoreRequest(current, 'interactive', now, 200);
  assert.equal(interactive.retryAt, 0);
  assert.equal(interactive.windows[0].remaining, 149);
  assert.ok(interactive.interactiveUntil > now);
});

test('all known windows are debited and a spike response cannot erase an hourly limit', () => {
  const merged = observeProcoreBudget([hourly(2)], {
    limit: 25, remaining: 20, resetAt: new Date(now + 10_000), cooldownUntil: null, rateLimited: false,
  }, now);
  const reservation = reserveProcoreRequest(state({ windows: merged }), 'interactive', now, 200);
  assert.deepEqual(reservation.windows.map(window => window.remaining), [1, 19]);
  const exhausted = reserveProcoreRequest(state({ windows: [hourly(0), merged[1]] }), 'interactive', now, 200);
  assert.equal(exhausted.retryAt, now + 3_600_000);
});

test('a busy worker allows an interactive waiter to establish priority before the next background request', () => {
  const busy = state({ leaseId: 'worker', leaseUntil: now + 30_000 });
  const interactive = reserveProcoreRequest(busy, 'interactive', now, 200);
  assert.equal(interactive.retryAt, now + 250);
  const released = state({ interactiveUntil: interactive.interactiveUntil });
  assert.ok(reserveProcoreRequest(released, 'background', now + 500, 200).retryAt > now + 500);
  assert.equal(reserveProcoreRequest(released, 'interactive', now + 500, 200).retryAt, 0);
});

test('expired leases and windows recover while actual provider cooldowns apply to both lanes', () => {
  const expired = state({ leaseId: 'crashed', leaseUntil: now - 1, windows: [{ ...hourly(0), resetAt: now - 1 }] });
  assert.equal(reserveProcoreRequest(expired, 'background', now, 200).retryAt, 0);
  for (const lane of ['background', 'interactive']) {
    assert.equal(reserveProcoreRequest(state({ blockedUntil: now + 60_000 }), lane, now, 200).retryAt, now + 60_000);
  }
});

test('usage aggregates omit identifiers and query parameters', () => {
  assert.equal(procoreUsageEndpoint('get', '/rest/v1.0/projects/598134326714493/vendors?token=secret'),
    'GET /rest/v1.0/projects/:id/vendors');
});
