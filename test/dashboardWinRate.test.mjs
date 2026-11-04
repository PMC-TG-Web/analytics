import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { calculateDashboardWinRate, buildDashboardWinRateHistory } from '../src/lib/dashboardWinRate.ts';
import {
  createWinRateBaseline, KPI_CURRENT_COMPANY, KPI_OLD_COMPANY,
  KPI_WIN_RATE_BASELINE_KEY, KPI_WIN_RATE_POLICY_KEY, parseWinRateBaseline,
} from '../src/lib/kpiWinRate.ts';

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
  assert.match(loader, /calculateDashboardWinRate\(winRateHistory\.projects\)/);
  assert.match(page, /calculateDashboardWinRate\(summary\.winRateHistory\.projects/);
  assert.doesNotMatch(page, /calculateDashboardWinRate\(aggregatedProjects|const totalBids = getUniqueProjectCount/);
  const route = readFileSync(new URL('../src/app/api/dashboard-summary/route.ts', import.meta.url), 'utf8');
  assert.match(route, /loadDashboardWinRateHistory\(projects\)/);
});

const oldBid = (id, name, status, created = '2026-05-10T15:00:00Z') => ({
  companyId: KPI_OLD_COMPANY, bidBoardId: id, projectName: name, status,
  payload: { created_on: created, status },
});
const noPolicy = { groups: [], excludedSources: [] };

test('May includes saved-only bids and migrated bids once, using the retained original date', () => {
  const baseline = createWinRateBaseline([
    oldBid('old', 'Original job', 'BID_SUBMITTED'),
    oldBid('saved-only', 'Historical bid', 'BID_SUBMITTED'),
    oldBid('todo', 'Unsubmitted', 'TO_DO'),
  ]);
  const policy = { groups: [{ key: 'reviewed', names: ['Original job'], preferredSource: `${KPI_OLD_COMPANY}:old`,
    sourceIds: [`${KPI_CURRENT_COMPANY}:new`], createdDate: '2026-05-10T15:00:00Z' }], excludedSources: [] };
  const current = [{ ...project('bid:new', 'In Progress', '2026-10-01', '2026-10-15'), bidBoardId: 'new', projectName: 'Renamed after migration' }];
  const history = buildDashboardWinRateHistory(current, baseline, policy);
  const may = calculateDashboardWinRate(history.projects, '2026-05-01', '2026-05-31');
  assert.equal(may.bid, 2);
  assert.equal(may.won, 0);
  const october = period(history.projects);
  assert.equal(october.won, 1);
  assert.equal(october.bid, 0, 'migration is not a new October bid');
  assert.equal(history.projects.find(p => p.id === 'reviewed').hasSavedHistory, true);
  const savedOnly = history.projects.find(p => p.projectName === 'Historical bid');
  assert.equal(savedOnly.hasCurrentRecord, false);
  assert.equal(savedOnly.dateCreated, '2026-05-10T15:00:00Z');
  assert.equal(Object.hasOwn(savedOnly, 'sales'), false, 'historical bid rows must not invent financial totals');
  assert.equal(calculateDashboardWinRate(history.projects).bid, 2);
});

test('approved reporting groups collapse contractor and migration copies without changing source records', () => {
  const baseline = createWinRateBaseline([oldBid('old', 'Same Job', 'BID_SUBMITTED')]);
  const current = [
    { ...project('one', 'Accepted', '2026-07-01', '2026-08-01'), bidBoardId: 'one', projectName: 'Same Job' },
    { ...project('two', 'Complete', '2026-07-02', '2026-08-01'), bidBoardId: 'two', projectName: 'Same Job' },
  ];
  const before = structuredClone({ current, baseline });
  const history = buildDashboardWinRateHistory(current, baseline, noPolicy);
  assert.equal(history.projects.length, 1);
  assert.equal(calculateDashboardWinRate(history.projects).won, 1);
  assert.equal(calculateDashboardWinRate(history.projects).bid, 1);
  assert.deepEqual({ current, baseline }, before);
  current[1].contractDate = '2026-09-01';
  const conflict = buildDashboardWinRateHistory(current, baseline, noPolicy);
  assert.match(conflict.projects[0].contractDateIssue, /Conflicting/);
  assert.equal(calculateDashboardWinRate(conflict.projects, '2026-08-01', '2026-08-31').rate, null);
});

test('pre-2026 originals remain historical, and frozen status alone cannot invent a Contract Date or win', () => {
  const baseline = createWinRateBaseline([oldBid('old', 'Prior job', 'COMPLETE', '2025-05-10')]);
  const history = buildDashboardWinRateHistory([], baseline, noPolicy);
  assert.equal(calculateDashboardWinRate(history.projects, '2025-05-01', '2025-05-31').bid, 1);
  assert.equal(calculateDashboardWinRate(history.projects).won, 0);
  assert.equal(history.projects[0].contractDate, null);
  const migrated = buildDashboardWinRateHistory([
    { ...project('new', 'Complete', '2026-07-01', '2025-06-01'), projectName: 'Prior job', bidBoardId: 'new' },
  ], baseline, noPolicy);
  assert.equal(calculateDashboardWinRate(migrated.projects, '2026-01-01', '2026-12-31').bid, 0);
  assert.equal(calculateDashboardWinRate(migrated.projects, '2025-06-01', '2025-06-30').won, 1);
});

test('history honors approved exclusions and rejects unassignable dates instead of reporting zero', () => {
  const baseline = createWinRateBaseline([oldBid('old', 'Excluded test', 'COMPLETE')]);
  const excluded = buildDashboardWinRateHistory([], baseline, { groups: [], excludedSources: [`${KPI_OLD_COMPANY}:old`] });
  assert.equal(excluded.projects.length, 0);
  assert.throws(() => buildDashboardWinRateHistory([
    { ...project('new', 'Bid Submitted', null, null), bidBoardId: 'new', projectName: 'Missing original date' },
  ], baseline, noPolicy), /missing or invalid Created Dates/);
});

test('missing project names keep explicit source identities instead of merging a display placeholder', () => {
  const baseline = createWinRateBaseline([oldBid('old', 'Saved job', 'BID_SUBMITTED')]);
  const history = buildDashboardWinRateHistory([
    { ...project('one', 'Bid Submitted', '2026-10-01', null), bidBoardId: 'one' },
    { ...project('two', 'Bid Submitted', '2026-10-01', null), bidBoardId: 'two' },
  ], baseline, noPolicy);
  assert.equal(period(history.projects).bid, 2);
  assert.equal(new Set(history.projects.map(project => project.id)).size, 3);
});

test('history loader reads only saved settings and fails explicitly for missing or inaccessible history', async () => {
  const baseline = createWinRateBaseline([oldBid('old', 'Saved job', 'BID_SUBMITTED')]);
  let rows = [{ name: KPI_WIN_RATE_BASELINE_KEY, value: JSON.stringify(baseline) },
    { name: KPI_WIN_RATE_POLICY_KEY, value: JSON.stringify(noPolicy) }];
  let fail = false;
  const compiled = ts.transpileModule(readFileSync(new URL('../src/lib/loadDashboardWinRateHistory.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mocks = {
    '@/lib/prisma': { prisma: { estimatingConstant: { findMany: async query => {
      assert.deepEqual(query, { where: { name: { in: [KPI_WIN_RATE_BASELINE_KEY, KPI_WIN_RATE_POLICY_KEY] } }, select: { name: true, value: true } });
      if (fail) throw new Error('Database unavailable');
      return rows;
    } } } },
    '@/lib/dashboardWinRate': { buildDashboardWinRateHistory },
    '@/lib/kpiWinRate': { KPI_CURRENT_COMPANY, KPI_WIN_RATE_BASELINE_KEY, KPI_WIN_RATE_POLICY_KEY, parseWinRateBaseline },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => { assert.ok(id in mocks, id); return mocks[id]; }, module, module.exports);
  const previous = process.env.PROCORE_COMPANY_ID;
  process.env.PROCORE_COMPANY_ID = KPI_CURRENT_COMPANY;
  try {
    assert.equal((await module.exports.loadDashboardWinRateHistory([])).projects.length, 1);
    rows = []; await assert.rejects(module.exports.loadDashboardWinRateHistory([]), /Saved bid history/);
    fail = true; await assert.rejects(module.exports.loadDashboardWinRateHistory([]), /Database unavailable/);
    process.env.PROCORE_COMPANY_ID = KPI_OLD_COMPANY;
    await assert.rejects(module.exports.loadDashboardWinRateHistory([]), /not configured for this company/);
  } finally {
    if (previous === undefined) delete process.env.PROCORE_COMPANY_ID;
    else process.env.PROCORE_COMPANY_ID = previous;
  }
});
