import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateWinRate } from '../src/lib/kpiWinRate.ts';
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
  assert.equal(run(rows, policy, 2025).total.won, 1);
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
test('all-years total counts each project once and recalculates the combined rate', () => {
  const r = run([bid('1', 'Prior', 'COMPLETE', '2025-01-01'), bid('2', 'Now', 'LOST')], undefined, null);
  assert.equal(r.total.rate, .5);
  assert.deepEqual(r.years, [2025, 2026]);
});
test('KPI page and win-rate endpoint share the KPI permission', () => {
  assert.equal(resolvePermissionForPath('/kpi'), 'kpi');
  assert.equal(resolvePermissionForPath('/api/kpi/win-rate'), 'kpi');
});
test('old-instance header refresh never queues historical estimate details', () => {
  const sync = readFileSync(new URL('../src/app/api/procore/sync/bid-board-projects/route.ts', import.meta.url), 'utf8');
  const cron = readFileSync(new URL('../src/app/api/cron/nightly-structure/route.ts', import.meta.url), 'utf8');
  assert.match(sync, /body.headersOnly === true \? \[\] : persisted/);
  assert.match(cron, /headersOnly: headerCompanyId === OLD_COMPANY_ID/);
  assert.match(cron, /companyId: params.companyId \?\? COMPANY_ID/);
  assert.match(cron, /connection: headerCompanyId === OLD_COMPANY_ID \? 'shared' : undefined/);
  assert.match(cron, /'x-procore-connection': params.connection/);
  assert.match(cron, /withProcoreConnection\('shared', recordHeaderRateLimit\)/);
});
