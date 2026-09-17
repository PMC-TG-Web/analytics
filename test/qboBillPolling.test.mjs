import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRefreshBillQueue, billSourcePollDelay } from '../src/lib/qboBillPolling.ts';

test('idle/busy sync checks back off and do not constantly rebuild monthly costs', () => {
  for (const status of ['current', 'waiting', 'error']) assert.equal(billSourcePollDelay(status), 60_000);
  assert.equal(shouldRefreshBillQueue(15_000, 0, false), false);
  assert.equal(shouldRefreshBillQueue(60_000, 0, false), false);
  assert.equal(shouldRefreshBillQueue(120_000, 0, false), true);
});
test('successful ingestion is batched while project checks continue', () => {
  assert.equal(billSourcePollDelay('synced'), 15_000);
  assert.equal(shouldRefreshBillQueue(15_000, 0, true), false);
  assert.equal(shouldRefreshBillQueue(59_999, 0, true), false);
  assert.equal(shouldRefreshBillQueue(60_000, 0, true), true);
  assert.equal(shouldRefreshBillQueue(75_000, 60_000, true), false);
});
