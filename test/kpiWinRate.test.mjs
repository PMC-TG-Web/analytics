import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateWinRate, createWinRateBaseline, parseWinRateBaseline, combineWinRateSources } from '../src/lib/kpiWinRate.ts';
import { resolvePermissionForPath } from '../src/lib/permissions.ts';

const current = '598134325805519', old = '598134325658789';
const now = new Date('2026-10-07T16:00:00Z');
const bid = (id, name, status, created = '2026-01-10T12:00:00Z', companyId = current, payload = {}) => ({ companyId, bidBoardId: id, projectName: name, status, payload: { status, created_on: created, ...payload } });
const run = (bids, policy, year = 2026) => calculateWinRate(bids, policy, year, now);

test('one win across contractors and instances, including old bid/new accepted conflicts', () => {
  const result = run([bid('1', 'J-Tech', 'BID_SUBMITTED', undefined, old), bid('2', ' J-Tech ', 'ACCEPTED'), bid('3', 'j-tech', 'LOST')]);
  assert.equal(result.total.won, 1);
  assert.equal(result.total.bid, 1);
  assert.equal(result.projects[0].sources.length, 3);
});
test('Created Date grouping preserves workbook-selected cohort, not migration or status-change year', () => {
  const policy = { groups: [{ key: 'job', names: ['Job', 'Job renamed'], preferredSource: `${old}:1`, createdDate: '2025-10-20T12:00:00Z' }], excludedSources: [] };
  const rows = [bid('1', 'Job', 'BID_SUBMITTED', '2025-10-20T12:00:00Z', old), bid('2', 'Job renamed', 'COMPLETE')];
  assert.equal(run(rows, policy).total.bid, 0);
  assert.equal(run(rows, policy, 2025).total.won, 0);
  assert.equal(run(rows, policy, null).total.bid, 0);
});
test('rolling numerator and denominator accumulate; total is a ratio, not an average', () => {
  const rows = [bid('1', 'Won', 'IN_PROGRESS'), bid('2', 'Lost', 'LOST', '2026-02-05T12:00:00Z'), bid('3', 'To do', 'TO_DO', '2026-02-06T12:00:00Z'), bid('4', 'Delayed', 'DELAYED', '2026-02-07T12:00:00Z'), bid('5', 'Estimating', 'ESTIMATING', '2026-02-08T12:00:00Z')];
  const r = run(rows);
  assert.equal(r.months[0].rate, 1);
  assert.equal(r.months[1].rate, .25);
  assert.deepEqual(r.total, { won: 1, bid: 4, total: 5, estimating: 1, rate: .25 });
  assert.equal(r.months[10], null);
});
test('a duplicate estimating bid does not remove a submitted project', () => {
  assert.equal(run([bid('1', 'Job', 'ESTIMATING'), bid('2', 'Job', 'BID_SUBMITTED')]).total.bid, 1);
});
test('reviewed source IDs stay in the same reporting group after a rename', () => {
  const policy = { groups: [{ key: 'job', names: ['Original'], preferredSource: `${old}:1`, sourceIds: [`${old}:1`, `${current}:2`], createdDate: '2026-01-01' }], excludedSources: [] };
  const r = run([bid('1', 'Original', 'BID_SUBMITTED', undefined, old), bid('2', 'Renamed project', 'COMPLETE')], policy);
  assert.equal(r.total.bid, 1);
  assert.equal(r.total.won, 1);
});
test('spacing and punctuation variants merge even when the workbook kept both rows', () => {
  const policy = { groups: [
    { key: 'one', names: ['Edge Metal Works'], preferredSource: `${old}:1`, createdDate: '2026-01-15' },
    { key: 'two', names: ['Edge Metalworks'], preferredSource: `${old}:2`, createdDate: '2026-02-10' },
  ], excludedSources: [] };
  const r = run([bid('1', 'Edge Metal Works', 'BID_SUBMITTED', undefined, old), bid('2', 'Edge Metalworks', 'ACCEPTED', undefined, old)], policy);
  assert.equal(r.total.bid, 1);
  assert.equal(r.total.won, 1);
  assert.equal(r.projects[0].createdDate, '2026-01-15');
});
test('active population excludes archived, templates, invitations, missing records and explicit exclusions', () => {
  const rows = [bid('1', 'A', 'COMPLETE', undefined, old, { archived: true }), bid('2', 'B', 'IN_PROGRESS', undefined, old, { deleted: true }), bid('3', 'C', 'ACCEPTED', undefined, old, { is_template: true }), bid('4', 'D', 'INVITATION'), bid('5', 'E', 'ACCEPTED', undefined, current, { sync_missing_from_procore: true }), bid('6', 'F', 'COMPLETE'), bid('legacy:7', 'G', 'COMPLETE')];
  assert.equal(run(rows, { groups: [], excludedSources: [`${current}:6`] }).total.bid, 0);
});
test('empty denominators remain unavailable, and missing Created Dates never use sync timestamps', () => {
  const r = run([bid('1', 'Missing date', 'COMPLETE', ''), bid('2', 'Estimating', 'ESTIMATING')]);
  assert.equal(r.total.rate, null);
  assert.equal(r.missingCreatedDates, 1);
});
test('combined reporting starts in 2026 and recalculates the ratio without pre-2026 jobs', () => {
  const r = calculateWinRate([bid('1', 'Prior', 'COMPLETE', '2025-01-01'), bid('2', 'First year', 'COMPLETE', '2026-01-01'), bid('3', 'Next year', 'LOST', '2027-01-01')], undefined, null, new Date('2027-10-07'));
  assert.equal(r.total.rate, .5);
  assert.deepEqual(r.years, [2026, 2027]);
  assert.equal(r.total.bid, 2);
});
test('KPI page and win-rate endpoint share the KPI permission', () => {
  assert.equal(resolvePermissionForPath('/kpi'), 'kpi');
  assert.equal(resolvePermissionForPath('/api/kpi/win-rate'), 'kpi');
});

test('Sales by Month passes its resolved year to win rate, including when the page filter is All Years', () => {
  const page = readFileSync(new URL('../src/app/kpi/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /selectedManagedYear = yearFilter \|\| String\(new Date\(\).getFullYear\(\)\)/);
  assert.match(page, /getKpiCardYearValues\(row.values, selectedManagedYear\)/);
  assert.match(page, /<KpiWinRateRow year=\{selectedManagedYear\} \/>/);
  assert.match(page, /Sales by Month · \{selectedManagedYear\}/);
  assert.doesNotMatch(page, /<KpiWinRateRow year=\{yearFilter\}/);
});

test('saved history preserves counts when all old-instance mirror records disappear', () => {
  const oldRows = [bid('1', 'Old won', 'COMPLETE', undefined, old), bid('2', 'Migrated', 'BID_SUBMITTED', undefined, old)];
  const currentRows = [bid('3', 'Migrated', 'ACCEPTED'), bid('4', 'New bid', 'BID_SUBMITTED')];
  const baseline = parseWinRateBaseline(JSON.stringify(createWinRateBaseline(oldRows, now)));
  const before = run([...oldRows, ...currentRows]);
  const withoutOldMirror = run(combineWinRateSources(currentRows, baseline));
  assert.deepEqual(withoutOldMirror, before);
  assert.equal(withoutOldMirror.total.won, 2);
  assert.equal(withoutOldMirror.total.bid, 3);
});
test('saved old bid advances to a win in the current instance without an extra project', () => {
  const baseline = createWinRateBaseline([bid('1', 'Migrated', 'BID_SUBMITTED', undefined, old)], now);
  assert.equal(run(combineWinRateSources([], baseline)).total.won, 0);
  const after = run(combineWinRateSources([bid('2', 'Migrated', 'IN_PROGRESS')], baseline));
  assert.equal(after.total.won, 1);
  assert.equal(after.total.bid, 1);
});
test('later old-instance deletions or mirror changes cannot modify saved history', () => {
  const row = bid('1', 'Historic', 'COMPLETE', undefined, old);
  const baseline = createWinRateBaseline([row], now);
  row.payload.status = 'LOST'; row.payload.deleted = true;
  const r = run(combineWinRateSources([row, bid('2', 'New', 'BID_SUBMITTED')], baseline));
  assert.equal(r.total.won, 1);
  assert.equal(r.total.bid, 2);
  assert.equal(baseline.bids[0].payload.status, 'COMPLETE');
});
test('baseline rejects empty or wrong-company data instead of silently dropping history', () => {
  assert.throws(() => createWinRateBaseline([bid('1', 'Current', 'COMPLETE')]), /empty/);
  assert.throws(() => parseWinRateBaseline(JSON.stringify({ version: 1, companyId: current, savedAt: now.toISOString(), bids: [] })), /Invalid/);
});
test('KPI reads saved history and only current-company mirrors; old polling is retired', () => {
  const route = readFileSync(new URL('../src/app/api/kpi/win-rate/route.ts', import.meta.url), 'utf8');
  const sync = readFileSync(new URL('../src/app/api/procore/sync/bid-board-projects/route.ts', import.meta.url), 'utf8');
  const cron = readFileSync(new URL('../src/app/api/cron/nightly-structure/route.ts', import.meta.url), 'utf8');
  const queue = readFileSync(new URL('../src/lib/procoreSyncQueue.ts', import.meta.url), 'utf8');
  assert.match(route, /findMany\(\{ where: \{ companyId: KPI_CURRENT_COMPANY \}/);
  assert.match(route, /combineWinRateSources\(bids, baseline\)/);
  assert.doesNotMatch(route, /KPI_OLD_COMPANY|fetch\(/);
  assert.match(cron, /excludeProjectIds: \["__old_company_bid_board__"\]/);
  assert.doesNotMatch(cron, /OLD_COMPANY_ID|OLD_BID_BOARD_QUEUE_ID/);
  assert.match(queue, /AND NOT \(project_id = ANY\(\$8::text\[\]\)\)/);
  assert.ok(sync.indexOf("reason: 'old_instance_history_saved'") < sync.indexOf('const accessToken = await getClientCredentialsToken()'));
});
