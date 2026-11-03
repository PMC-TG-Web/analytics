import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEstimateRevisions, estimateRevisionDate } from '../src/lib/kpiEstimateRevisions.ts';

const original = { proposalId: 'old', name: 'Original', isBaselineCandidate: true, primary: false, order: 1, updatedAt: '2026-01-03T12:00:00Z', hours: 1000, sales: 100000 };
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

test('original remains the baseline with intermediate versions, reordered copies, and later original edits', () => {
  const result = run([{ ...original, order: 3, updatedAt: '2026-11-01T12:00:00Z' },
    { ...primary, proposalId: 'intermediate', primary: false, order: 2, hours: 1200, sales: 120000, updatedAt: '2026-09-01T12:00:00Z' },
    { ...primary, order: 1 }]);
  assert.equal(result.events[1].previous.proposalId, 'old');
  assert.equal(result.events[1].basis, 'original-estimate');
  assert.equal(result.events[1].hours, 300);
  assert.equal(result.events[1].sales, 25000);
  assert.deepEqual(result.issues, []);
});

test('a rebid still requires a usable primary update date on or after project creation', () => {
  for (const changed of [{ updatedAt: '2025-12-05T12:00:00Z' }, { updatedAt: null }]) {
    const result = run([original, { ...primary, ...changed }]);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].hours, null);
    assert.match(result.issues.join(' '), /valid source update date/);
  }
});

test('ambiguous originals or primary flags remain unavailable', () => {
  for (const versions of [[original, primary, { ...original, proposalId: 'option', order: 3 }], [original, { ...primary, primary: false }], [{ ...original, primary: true }, primary]]) {
    const result = run(versions);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].sales, null);
    assert.ok(result.issues.length);
  }
});

test('without an original, use the first source-created estimate regardless of list order or later edits', () => {
  const first = { ...original, isBaselineCandidate: false, name: 'Takeoff A', sourceCreatedAt: '2026-01-02T12:00:00Z', updatedAt: '2026-11-02T12:00:00Z' };
  const result = run([{ ...primary, sourceCreatedAt: '2026-10-04T12:00:00Z' },
    { ...first, proposalId: 'middle', sourceCreatedAt: '2026-02-02T12:00:00Z', hours: 1200, sales: 120000 }, first]);
  assert.equal(result.events[1].basis, 'first-created-estimate');
  assert.equal(result.events[1].previous.proposalId, 'old');
  assert.equal(result.events[1].hours, 300);
  assert.equal(result.events[1].sales, 25000);
  assert.deepEqual(result.issues, []);
});

test('an identified original takes precedence over earlier source creation dates', () => {
  const result = run([{ ...original, sourceCreatedAt: '2026-02-01T12:00:00Z' },
    { ...primary, sourceCreatedAt: '2026-01-02T12:00:00Z' }]);
  assert.equal(result.events[1].basis, 'original-estimate');
  assert.equal(result.events[1].hours, 300);
});

test('missing, invalid or tied source creation dates cannot be replaced with order, IDs or ingestion time', () => {
  for (const sourceCreatedAt of [null, 'invalid', '2026-01-02T12:00:00Z']) {
    const result = run([{ ...original, isBaselineCandidate: false, sourceCreatedAt, createdAt: '2026-01-01T12:00:00Z' },
      { ...primary, sourceCreatedAt: '2026-01-02T12:00:00Z' }]);
    assert.equal(result.events[0].hours, null);
    assert.match(result.issues.join(' '), /unique first estimate/);
  }
});

test('when the primary is the original or first-created estimate, other versions do not create a rebid', () => {
  for (const isBaselineCandidate of [true, false]) {
    const result = run([{ ...original, primary: true, isBaselineCandidate, sourceCreatedAt: '2026-01-02T12:00:00Z' },
      { ...primary, primary: false, sourceCreatedAt: '2026-10-04T12:00:00Z' }]);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].kind, 'initial');
    assert.equal(result.events[0].hours, 1000);
    assert.deepEqual(result.issues, []);
  }
});

test('a confirmed original overrides names and missing creation dates while preserving its initial month', () => {
  const confirmed = { ...original, isBaselineCandidate: false, name: 'Renamed takeoff', sourceCreatedAt: null };
  const result = calculateEstimateRevisions('2026-01-02', [confirmed, primary,
    { ...original, proposalId: 'misnamed', hours: 1200, sales: 120000 }], confirmed.proposalId);
  assert.equal(result.events[0].date, '2026-01-02');
  assert.equal(result.events[1].basis, 'confirmed-original');
  assert.equal(result.events[1].previous.proposalId, 'old');
  assert.equal(result.events[1].hours, 300);
  assert.equal(result.events[1].sales, 25000);
  assert.deepEqual(result.issues, []);
});

test('missing or alternate confirmed originals cannot silently fall back to another baseline', () => {
  for (const versions of [[original, primary], [{ ...original, alternate: true }, primary], [primary]]) {
    const confirmedId = versions.length === 2 && !versions[0].alternate ? 'missing' : original.proposalId;
    const result = calculateEstimateRevisions('2026-01-02', versions, confirmedId);
    assert.equal(result.events[0].hours, null);
    assert.match(result.issues.join(' '), /confirmed original estimate is missing/);
  }
});

test('explicit alternates do not supply the previous estimate', () => {
  const result = run([primary, { ...original, alternate: true }]);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].sales, 125000);
});

test('later same-month edits keep the original in its Created Date month and contribute only the delta', () => {
  const versions = [
    { ...original, order: 2, updatedAt: '2026-10-15T15:51:26Z', hours: 780, sales: 88056.71 },
    { ...original, proposalId: 'revision-1', isBaselineCandidate: false, order: 1, updatedAt: '2026-10-15T16:06:31Z', hours: 399.5, sales: 57489.63 },
    { ...primary, order: 3, updatedAt: '2026-10-15T19:02:37Z', hours: 391.5, sales: 63822.39 },
  ];
  const result = run(versions, '2025-08-12');
  assert.equal(result.events.length, 2);
  assert.deepEqual(result.events.map(e => [e.date, e.hours, e.sales, e.basis]), [['2025-08-12', 780, 88056.71, 'original-estimate'], ['2026-10-15', -388.5, -24234.32, 'original-estimate']]);
  assert.equal(result.events[0].previous, null);
  assert.equal(result.events[1].previous.proposalId, original.proposalId);
  assert.deepEqual(result.issues, []);
});

test('initial-month rule needs a unique primary and valid months, not values or ordering of unused copies', () => {
  const same = { ...original, order: 99, hours: null, sales: null, updatedAt: primary.updatedAt };
  assert.equal(run([same, primary], '2026-10-02').events[0].hours, 1300);
  assert.deepEqual(run([same, primary], '2026-10-02').issues, []);
  assert.equal(run([{ ...same, primary: true }, primary], '2026-10-02').events[0].hours, null);
  assert.equal(run([{ ...same, updatedAt: null }, primary], '2026-10-02').events[1].hours, null);
  assert.equal(run([same, { ...primary, hours: null }], '2026-10-02').events[0].hours, null);
});

test('same-month membership uses Eastern dates and never places activity before project creation', () => {
  const same = { ...original, updatedAt: '2026-10-01T04:00:00Z' };
  const result = run([same, { ...primary, updatedAt: '2026-11-01T03:59:59Z' }], '2026-10-01');
  assert.equal(result.events[0].basis, 'same-month-primary');
  assert.equal(result.events[0].date, '2026-10-01');
  assert.equal(run([same, { ...primary, updatedAt: '2026-11-01T04:00:00Z' }]).events[1].hours, 300);
  assert.equal(run([same, primary], '2026-11-01').events[0].hours, null);
});

test('original remains in May even when all three versions were updated in November', () => {
  const versions = [
    { ...original, order: 2, updatedAt: '2026-11-02T16:55:17Z', hours: 300, sales: 20000 },
    { ...primary, proposalId: 'intermediate', primary: false, order: 1, updatedAt: '2026-11-02T17:21:20Z', hours: 550, sales: 75000 },
    { ...primary, order: 3, updatedAt: '2026-11-02T17:49:12Z', hours: 250, sales: 80000 },
  ];
  const result = run(versions, '2026-05-22');
  assert.deepEqual(result.events.map(e => [e.date, e.kind, e.hours, e.sales]), [
    ['2026-05-22', 'initial', 300, 20000], ['2026-11-02', 'rebid', -50, 60000],
  ]);
  assert.deepEqual(result.issues, []);
});

test('later same-month edits without an identifiable original cannot count the full primary as a new bid', () => {
  const result = run([{ ...original, isBaselineCandidate: false, updatedAt: primary.updatedAt }, primary], '2026-05-22');
  assert.equal(result.events[0].date, '2026-05-22');
  assert.equal(result.events[0].hours, null);
  assert.equal(result.events.some(event => event.basis === 'same-month-primary'), false);
  assert.match(result.issues.join(' '), /unique first estimate/);
});

test('missing prior hours does not turn into zero while independently valid dollars can calculate', () => {
  const result = run([{ ...original, hours: null }, primary]);
  assert.equal(result.events[0].hours, null);
  assert.equal(result.events[1].hours, null);
  assert.equal(result.events[1].sales, 25000);
  assert.ok(result.issues.some(issue => issue.includes('Baseline estimate hours')));
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
