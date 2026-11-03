import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEstimateRevisions, estimateRevisionDate } from '../src/lib/kpiEstimateRevisions.ts';

const original = { proposalId: 'old', name: 'Original', primary: false, order: 1, updatedAt: '2026-01-03T12:00:00Z', hours: 1000, sales: 100000 };
const primary = { proposalId: 'new', name: 'New Primary', primary: true, order: 2, updatedAt: '2026-10-05T12:00:00Z', hours: 1300, sales: 125000 };
const run = (versions, created = '2026-01-02') => calculateEstimateRevisions(created, versions);

test('one primary estimate supplies full initial hours and dollars; its update does not duplicate it', () => {
  const result = run([primary]);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].date, '2026-01-02');
  assert.equal(result.events[0].hours, 1300);
  assert.equal(result.events[0].sales, 125000);
});

test('newer primary keeps initial values in Created Date month and adds only change in rebid month', () => {
  const result = run([primary, original]);
  assert.deepEqual(result.events.map(e => [e.date, e.kind, e.hours, e.sales]), [['2026-01-02', 'initial', 1000, 100000], ['2026-10-05', 'rebid', 300, 25000]]);
  assert.equal(result.events[1].previous.proposalId, 'old');
  assert.equal(result.events[1].revised.proposalId, 'new');
  assert.deepEqual(result.issues, []);
});

test('reductions and no-change revisions retain signed values and explicit zero', () => {
  assert.deepEqual(run([original, { ...primary, hours: 800, sales: 90000 }]).events.map(e => [e.hours, e.sales]), [[1000, 100000], [-200, -10000]]);
  assert.deepEqual(run([original, { ...primary, hours: 1000, sales: 100000 }]).events.map(e => [e.hours, e.sales]), [[1000, 100000], [0, 0]]);
});

test('version order and timestamp must both advance; editing an older primary is not a new version', () => {
  for (const changed of [{ order: 1 }, { order: null }, { updatedAt: original.updatedAt }, { updatedAt: '2025-12-05T12:00:00Z' }, { updatedAt: null }]) {
    const result = run([original, { ...primary, ...changed }]);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].hours, null);
    assert.match(result.issues.join(' '), /not clearly newer/);
  }
});

test('multiple prior versions or primary flags require review, not a guessed historical chain', () => {
  for (const versions of [[original, primary, { ...original, proposalId: 'option', order: 3 }], [original, { ...primary, primary: false }], [{ ...original, primary: true }, primary]]) {
    const result = run(versions);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].sales, null);
    assert.ok(result.issues.length);
  }
});

test('explicit alternates do not supply the previous estimate', () => {
  const result = run([primary, { ...original, alternate: true }]);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].sales, 125000);
});

test('missing prior hours does not turn into zero while independently valid dollars can calculate', () => {
  const result = run([{ ...original, hours: null }, primary]);
  assert.equal(result.events[0].hours, null);
  assert.equal(result.events[1].hours, null);
  assert.equal(result.events[1].sales, 25000);
  assert.ok(result.issues.some(issue => issue.includes('Previous estimate hours')));
});

test('rebid month follows Eastern calendar date at UTC month boundaries', () => {
  assert.equal(estimateRevisionDate('2026-11-01T01:00:00Z'), '2026-10-31');
  assert.equal(estimateRevisionDate('2026-11-01T06:30:00Z'), '2026-11-01');
  assert.equal(estimateRevisionDate('invalid'), null);
  assert.equal(run([original, { ...primary, updatedAt: '2026-11-01T01:00:00Z' }]).events[1].date, '2026-10-31');
});

test('decimal deltas round hours to four places and money to cents', () => {
  const result = run([{ ...original, hours: 0.1, sales: 0.1 }, { ...primary, hours: 0.3, sales: 0.3 }]);
  assert.equal(result.events[1].hours, 0.2);
  assert.equal(result.events[1].sales, 0.2);
});
