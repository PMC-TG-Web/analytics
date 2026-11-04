import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateDashboardWinRate } from '../src/lib/dashboardWinRate.ts';

const project = (id, status, dateCreated, contractDate) => ({ id, status, dateCreated, contractDate });
const period = rows => calculateDashboardWinRate(rows, '2026-10-01', '2026-10-31');

test('wins and bids use independent dates, never the project activity filter', () => {
  const rows = [
    project('old-bid-new-win', 'Accepted', '2026-09-01', '2026-10-01'),
    project('new-bid-future-win', 'In Progress', '2026-10-01', '2026-11-01'),
    project('new-lost', 'Lost', '2026-10-15', null),
    project('new-complete', 'Complete', '2026-10-10', '2026-10-31'),
    project('old-win', 'In Progress', '2026-06-01', '2026-09-01'),
    project('draft', 'Estimating', '2026-10-10', null),
  ].map(row => ({ ...row, dateUpdated: '2026-11-04T13:00:00Z' }));
  const result = period(rows);
  assert.deepEqual(result.wonIds, ['old-bid-new-win', 'new-complete']);
  assert.deepEqual(result.bidIds, ['new-bid-future-win', 'new-lost', 'new-complete']);
  assert.equal(result.rate, 2 / 3);
  assert.equal(calculateDashboardWinRate(rows).rate, 4 / 5);
});

test('winning or completing a submitted job never removes it from bids in its Created Date period', () => {
  for (const status of ['Bid Submitted', 'Accepted', 'IN_PROGRESS', 'Complete']) {
    const result = period([project('job', status, '2026-10-01', '2026-10-10')]);
    assert.equal(result.bid, 1);
    assert.equal(result.won, status === 'Bid Submitted' ? 0 : 1);
  }
});

test('date boundaries are inclusive Eastern days, with open-ended and empty ranges', () => {
  const rows = [
    project('before', 'Complete', '2026-10-01T03:59:59Z', '2026-09-30'),
    project('start', 'Complete', '2026-10-01T04:00:00Z', '2026-10-01'),
    project('end', 'Complete', '2026-11-01T03:59:59Z', '2026-10-31'),
    project('after', 'Complete', '2026-11-01T04:00:00Z', '2026-11-01'),
  ];
  assert.deepEqual(period(rows).bidIds, ['start', 'end']);
  assert.deepEqual(period(rows).wonIds, ['start', 'end']);
  assert.equal(calculateDashboardWinRate(rows, '2026-10-01').bid, 3);
  assert.equal(calculateDashboardWinRate(rows, '', '2026-10-31').won, 3);
  assert.equal(calculateDashboardWinRate(rows).won, 4);
  assert.throws(() => calculateDashboardWinRate(rows, '2026-11-01', '2026-10-01'));
});

test('unknown dates cannot produce a misleading partial period percentage', () => {
  const rows = [
    project('missing-contract', 'Accepted', '2026-10-01', null),
    project('missing-created', 'Lost', null, null),
    project('dated', 'Complete', '2026-10-01', '2026-10-02'),
  ];
  const result = period(rows);
  assert.equal(result.rate, null);
  assert.deepEqual(result.missingWonDateIds, ['missing-contract']);
  assert.deepEqual(result.missingBidDateIds, ['missing-created']);
  assert.equal(result.won, 1);
  assert.equal(result.bid, 2);
  assert.equal(calculateDashboardWinRate(rows).rate, 2 / 3, 'all-date counts do not need a period assignment');
});

test('no bids is unavailable, no wins is zero, and separate-period ratios may exceed 100 percent', () => {
  assert.equal(period([project('win', 'Accepted', '2026-09-01', '2026-10-01')]).rate, null);
  assert.equal(period([project('bid', 'Bid Submitted', '2026-10-01', null)]).rate, 0);
  assert.equal(period([
    project('win1', 'Complete', '2026-09-01', '2026-10-01'),
    project('win2', 'In Progress', '2026-09-01', '2026-10-01'),
    project('bid', 'Bid Submitted', '2026-10-01', null),
  ]).rate, 2);
});

test('count Bid Board identities, not names, and exclude drafts, invitations and archived records', () => {
  const one = { ...project('one', 'Lost', '2026-10-01', null), projectName: 'Same name' };
  const two = { ...one, id: 'two' };
  const result = period([one, one, two,
    project('draft', 'Estimating', '2026-10-01'),
    project('invite', 'Invitations', '2026-10-01'),
    project('delayed', 'Delayed', '2026-10-01'),
    { ...project('archived', 'Complete', '2026-10-01', '2026-10-01'), projectArchived: true },
  ]);
  assert.deepEqual(result.bidIds, ['one', 'two']);
});

test('summary and detail share the calculation and the loader resolves Contract Date by explicit project ID', () => {
  const loader = readFileSync(new URL('../src/lib/estimatingDashboard.ts', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../src/app/dashboard/page.tsx', import.meta.url), 'utf8');
  assert.match(loader, /loadFinancialWipSoldDates\(COMPANY_ID\)/);
  assert.match(loader, /contractDate: procoreProjectId \? soldDates\.get\(procoreProjectId\)\?\.contractDate \?\? null : null/);
  assert.match(loader, /winRate: calculateDashboardWinRate\(projects\)/);
  assert.match(page, /calculateDashboardWinRate\(projects\.filter/);
  assert.doesNotMatch(page, /calculateDashboardWinRate\(aggregatedProjects|const totalBids = getUniqueProjectCount/);
});
