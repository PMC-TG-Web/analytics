import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateEstimatePreview, hasEstimateVersions } from '../src/lib/kpiEstimatePreview.ts';
import { resolvePermissionForPath } from '../src/lib/permissions.ts';

const company = '598134325805519', old = '598134325658789';
const bid = (id, status = 'BID_SUBMITTED', extra = {}) => ({ companyId: company, bidBoardId: id, projectName: `Job ${id}`, status, payload: { created_on: '2026-10-02' }, ...extra });
const value = (id, extra = {}) => ({ bidBoardId: id, selectedProposalId: `p${id}`, hours: 1100, sales: 100000, customFields: { estimateLineCount: 10 }, ...extra });
const proposal = (id, extra = {}) => ({ bidBoardId: id, proposalId: `p${id}`, name: 'Original', type: 'ESTIMATE', primary: true, order: 1, updatedAt: '2026-10-05T12:00:00Z', hours: 1100, sales: 100000, ...extra });
const policy = { groups: [], excludedSources: [] };
const run = (bids, values, proposals = null, rules = policy, canonical = []) => calculateEstimatePreview(bids, values, proposals ?? values.filter(v => v.selectedProposalId).map(v => proposal(v.bidBoardId, { hours: v.customFields.estimateLineCount > 0 ? v.hours : null, sales: v.sales })), rules, canonical, new Date('2026-11-02T12:00:00Z'));

test('current qualifying statuses share Created Date months for dollars and full hours, including completed short jobs', () => {
  const statuses = ['ESTIMATING', 'ESTIMATED', 'BID_SUBMITTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETE', 'LOST', 'DELAYED', 'TO_DO', 'INVITATION'];
  const result = run(statuses.map((status, i) => bid(String(i), status)), statuses.map((_, i) => value(String(i))));
  assert.equal(result.projects.length, 5);
  assert.deepEqual(result.months['2026-10'], { count: 5, hours: 5500, sales: 500000, missingHours: 0, missingSales: 0, rebids: 0 });
  assert.equal(result.projects.some(p => p.status === 'ESTIMATING'), false);
  // PM is part of the full 1,100 estimate hours; it is never deducted here.
  assert.equal(result.projects.find(p => p.status === 'COMPLETE').hours, 1100);
});

test('an unfinished Estimating project is excluded without missing-estimate warnings, then counts when submitted', () => {
  const draft = bid('draft', 'ESTIMATING');
  const unfinished = run([draft], [value('draft', { hours: 0, sales: 0, customFields: { estimateLineCount: 0 } })]);
  assert.deepEqual(unfinished.projects, []);
  assert.deepEqual(unfinished.months, {});
  const submitted = run([{ ...draft, status: 'BID_SUBMITTED', payload: { ...draft.payload, updated_at: '2026-11-03' } }], [value('draft')]);
  assert.deepEqual(submitted.months['2026-10'], { count: 1, hours: 1100, sales: 100000, missingHours: 0, missingSales: 0, rebids: 0 });
  assert.equal(submitted.months['2026-11'], undefined, 'status change does not replace original Created Date');
});

test('current Estimating status supersedes a migrated old submitted bid', () => {
  const result = run([bid('old', 'BID_SUBMITTED', { companyId: old, projectName: 'Same' }), bid('new', 'ESTIMATING', { projectName: 'Same' })], [value('new')]);
  assert.deepEqual(result.projects, []);
  assert.deepEqual(result.months, {});
});

test('an Estimating customer copy cannot override or conflict with the submitted source', () => {
  const bids = [bid('draft', 'ESTIMATING', { projectName: 'Same' }), bid('submitted', 'BID_SUBMITTED', { projectName: 'Same' })];
  const rules = { groups: [{ key: 'one', names: ['Same'], preferredSource: `${company}:draft`, sourceIds: [`${company}:draft`, `${company}:submitted`], createdDate: '2026-10-02' }], excludedSources: [] };
  const result = run(bids, [value('draft', { hours: 0, sales: 0, customFields: { estimateLineCount: 0 } }), value('submitted')], null, rules);
  assert.equal(result.projects[0].bidBoardId, 'submitted');
  assert.deepEqual(result.projects[0].issues, []);
  assert.deepEqual(result.months['2026-10'], { count: 1, hours: 1100, sales: 100000, missingHours: 0, missingSales: 0, rebids: 0 });
});

test('approved reporting source and original dates survive migration and contractor duplicates', () => {
  const rules = { groups: [{ key: 'one', names: ['Old Job', 'New Name'], preferredSource: `${company}:b`, sourceIds: [`${old}:a`, `${company}:b`, `${company}:c`], createdDate: '2026-10-03' }], excludedSources: [] };
  const result = run([bid('a', 'BID_SUBMITTED', { companyId: old, projectName: 'Old Job' }), bid('b', 'IN_PROGRESS', { projectName: 'New Name', payload: { created_on: '2026-11-01' } }), bid('c', 'BID_SUBMITTED', { projectName: 'New Name' })], [value('b'), value('c', { sales: 120000 })], null, rules);
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].bidBoardId, 'b');
  assert.equal(result.months['2026-10'].sales, 100000);
  assert.equal(result.months['2026-11'], undefined);
  assert.equal(result.projects[0].sourceCount, 2);
});

test('current Lost status supersedes frozen old Bid Submitted status', () => {
  const result = run([bid('a', 'BID_SUBMITTED', { companyId: old, projectName: 'Same' }), bid('b', 'LOST', { projectName: 'Same' })], [value('b')]);
  assert.equal(result.projects.length, 0);
});

test('one count for matching customer copies, with differing estimates flagged instead of added', () => {
  const bids = [bid('a', 'BID_SUBMITTED', { projectName: 'New Job' }), bid('b', 'ACCEPTED', { projectName: 'New-Job' })];
  const equal = run(bids, [value('a'), value('b')]);
  assert.equal(equal.months['2026-10'].count, 1);
  assert.equal(equal.months['2026-10'].sales, 100000);
  const conflict = run(bids, [value('a'), value('b', { sales: 200000 })]);
  assert.equal(conflict.projects[0].sales, null);
  assert.equal(conflict.projects[0].hours, null);
  assert.equal(conflict.months['2026-10'].missingSales, 1);
  assert.match(conflict.projects[0].issues[0], /Customer copies/);
});

test('explicit execution-project identity combines renamed boards and selects its canonical bid', () => {
  const bids = [bid('a', 'COMPLETE', { procoreProjectId: 'execution1', projectName: 'First' }), bid('b', 'COMPLETE', { procoreProjectId: 'execution1', projectName: 'Renamed' })];
  const result = run(bids, [value('a'), value('b', { sales: 200000 })], null, policy, [{ procoreProjectId: 'execution1', bidBoardId: 'b' }]);
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].bidBoardId, 'b');
  assert.equal(result.months['2026-10'].sales, 200000);
});

test('missing estimates, missing hours, and zero estimates remain distinct', () => {
  const result = run([bid('a', 'COMPLETE', { companyId: old }), bid('b'), bid('c'), bid('d')], [value('b', { customFields: { estimateLineCount: 0 } }), value('c', { hours: 0, sales: 0 }), value('d', { selectedProposalId: null, hours: 0, sales: 0, customFields: {} })]);
  assert.equal(result.projects.find(p => p.name === 'Job a').sales, null);
  assert.equal(result.projects.find(p => p.name === 'Job b').hours, null);
  assert.equal(result.projects.find(p => p.name === 'Job c').hours, 0);
  assert.equal(result.projects.find(p => p.name === 'Job c').sales, 0);
  assert.equal(result.projects.find(p => p.name === 'Job d').sales, null);
  assert.deepEqual(result.months['2026-10'], { count: 4, hours: 0, sales: 100000, missingHours: 3, missingSales: 2, rebids: 0 });
});

test('a later update without a unique newer primary does not invent a rebid', () => {
  const result = run([bid('a', 'IN_PROGRESS', { payload: { created_on: '2026-10-02', updated_at: '2026-10-30' } })], [value('a')], [proposal('a'), proposal('a', { proposalId: 'copy', name: 'Revised', hours: 1300, sales: 125000 }), proposal('a', { proposalId: 'co', type: 'CHANGE_ORDER' })]);
  assert.equal(result.months['2026-11'], undefined);
  assert.equal(result.months['2026-10'].sales, 0);
  assert.equal(result.months['2026-10'].missingSales, 1);
  assert.equal(result.projects[0].proposals.length, 2);
  assert.equal(hasEstimateVersions(result.projects[0]), true);
  const copies = run([bid('a', 'COMPLETE', { projectName: 'Same' }), bid('b', 'COMPLETE', { projectName: 'Same' })], [value('a'), value('b')], [proposal('a'), proposal('b')]);
  assert.equal(hasEstimateVersions(copies.projects[0]), false);
});

test('newer primary contributes only the signed difference; prior-year projects can be rebid this year', () => {
  const versions = [proposal('a', { primary: false, isBaselineCandidate: true, order: 1, updatedAt: '2025-12-05T12:00:00Z', hours: 1000, sales: 100000 }), proposal('a', { proposalId: 'new', name: 'Revised', order: 2, updatedAt: '2026-10-05T12:00:00Z', hours: 1300, sales: 125000 })];
  const result = run([bid('a', 'COMPLETE', { payload: { created_on: '2025-12-02' } })], [value('a')], versions);
  assert.equal(result.months['2025-12'], undefined);
  assert.deepEqual(result.months['2026-10'], { count: 1, hours: 300, sales: 25000, missingHours: 0, missingSales: 0, rebids: 1 });
  assert.deepEqual(result.years, ['2026']);
});

test('October cutover excludes earlier initial bids even when a single estimate was updated later', () => {
  const result = run([
    bid('old', 'COMPLETE', { payload: { created_on: '2026-09-30' } }),
    bid('new', 'COMPLETE', { payload: { created_on: '2026-10-01' } }),
  ], [value('old'), value('new')]);
  assert.equal(result.startDate, '2026-10-01');
  assert.deepEqual(result.projects.map(project => project.name), ['Job new']);
  assert.equal(result.months['2026-09'], undefined);
  assert.deepEqual(result.months['2026-10'], { count: 1, hours: 1100, sales: 100000, missingHours: 0, missingSales: 0, rebids: 0 });
});

test('cross-month revisions compare only with the original on the selected customer source', () => {
  const bids = ['a', 'b'].map(id => bid(id, 'BID_SUBMITTED', { projectName: 'Shared project', payload: { created_on: '2026-07-28' } }));
  const rules = { groups: [{ key: 'one', names: ['Shared project'], preferredSource: `${company}:a`, sourceIds: [`${company}:a`, `${company}:b`] }], excludedSources: [] };
  const versions = [
    proposal('a', { primary: false, isBaselineCandidate: true, order: 2, updatedAt: '2026-09-14T12:00:00Z', hours: 400, sales: 70000 }),
    proposal('a', { proposalId: 'intermediate', name: 'Revision 1', primary: false, order: 1, updatedAt: '2026-09-15T12:00:00Z', hours: 500, sales: 75000 }),
    proposal('a', { proposalId: 'latest', name: 'Revision 2', order: 3, hours: 1300, sales: 225000 }),
    proposal('b', { isBaselineCandidate: true, updatedAt: '2026-07-29T12:00:00Z', hours: 900, sales: 155000 }),
    proposal('a', { proposalId: 'co', type: 'CHANGE_ORDER', hours: 100, sales: 10000 }),
    proposal('a', { proposalId: 'alternate', alternate: true, isBaselineCandidate: true, hours: 10, sales: 1000 }),
  ];
  const result = run(bids, [value('a'), value('b')], versions, rules);
  assert.deepEqual(result.months, { '2026-10': { count: 1, hours: 900, sales: 155000, missingHours: 0, missingSales: 0, rebids: 1 } });
  assert.equal(result.projects[0].events[1].previous.proposalId, 'pa');
  assert.equal(result.projects[0].events[1].basis, 'original-estimate');
  assert.deepEqual(result.projects[0].issues, []);
});

test('cutover uses the Eastern rebid date and keeps only the signed delta from a September bid', () => {
  const bids = [bid('a', 'COMPLETE', { payload: { created_on: '2026-09-01' } })];
  const earlier = proposal('a', { primary: false, isBaselineCandidate: true, updatedAt: '2026-09-02T12:00:00Z', hours: 1000, sales: 100000 });
  const revised = proposal('a', { proposalId: 'new', order: 2, updatedAt: '2026-10-01T03:59:59Z', hours: 900, sales: 95000 });
  assert.deepEqual(run(bids, [value('a')], [earlier, revised]).months, {});
  const result = run(bids, [value('a')], [earlier, { ...revised, updatedAt: '2026-10-01T04:00:00Z' }]);
  assert.deepEqual(result.months, { '2026-10': { count: 1, hours: -100, sales: -5000, missingHours: 0, missingSales: 0, rebids: 1 } });
  assert.equal(result.projects[0].events[1].previous.hours, 1000, 'earlier versions remain available for the comparison');
});

test('a migration copy created in October does not recount a pre-cutover project', () => {
  const rules = { groups: [{ key: 'one', names: [], preferredSource: `${company}:b`, sourceIds: [`${old}:a`, `${company}:b`], createdDate: '2026-09-03' }], excludedSources: [] };
  const result = run([bid('a', 'BID_SUBMITTED', { companyId: old }), bid('b')], [value('b')], null, rules);
  assert.deepEqual(result.months, {});
  assert.equal(result.projects.length, 0);
});

test('new project and versions in the same month count only the full primary once', () => {
  const versions = [proposal('a', { primary: false, order: 1, updatedAt: '2026-10-03T12:00:00Z', hours: 1000, sales: 100000 }), proposal('a', { proposalId: 'new', name: 'Revised', order: 2, updatedAt: '2026-10-05T12:00:00Z', hours: 900, sales: 95000 })];
  const result = run([bid('a', 'COMPLETE')], [value('a')], versions);
  assert.deepEqual(result.months['2026-10'], { count: 1, hours: 900, sales: 95000, missingHours: 0, missingSales: 0, rebids: 0 });
});

test('multiple October revisions of an older project contribute only the change from its original', () => {
  const versions = [proposal('a', { primary: false, isBaselineCandidate: true, order: 2, hours: 780, sales: 88056.71 }),
    proposal('a', { proposalId: 'revision-1', primary: false, order: 1, hours: 399.5, sales: 57489.63 }),
    proposal('a', { proposalId: 'revision-2', order: 3, hours: 391.5, sales: 63822.39 })];
  const result = run([bid('a', 'BID_SUBMITTED', { payload: { created_on: '2025-08-12' } })], [value('a')], versions);
  assert.deepEqual(result.months, { '2026-10': { count: 1, hours: -388.5, sales: -24234.32, missingHours: 0, missingSales: 0, rebids: 1 } });
  assert.deepEqual(result.projects[0].issues, []);
  assert.equal(result.projects[0].events.length, 2);
  assert.equal(result.projects[0].events[0].date, '2025-08-12');
});

test('November edits never move a May or October original bid into November', () => {
  const versions = [proposal('a', { primary: false, isBaselineCandidate: true, updatedAt: '2026-11-02T16:55:17Z', hours: 300, sales: 20000 }),
    proposal('a', { proposalId: 'new', name: 'Revision 2', updatedAt: '2026-11-02T17:49:12Z', hours: 250, sales: 80000 })];
  const expectedRevision = { count: 1, hours: -50, sales: 60000, missingHours: 0, missingSales: 0, rebids: 1 };
  for (const created_on of ['2026-05-22', '2026-10-22']) {
    const result = run([bid('a', 'IN_PROGRESS', { payload: { created_on } })], [value('a')], versions);
    assert.deepEqual(result.months['2026-11'], expectedRevision);
    assert.equal(result.projects[0].events[0].date, created_on);
    assert.equal(result.months['2026-05'], undefined, 'saved pre-cutover months are not recalculated');
    if (created_on.startsWith('2026-10')) assert.deepEqual(result.months['2026-10'], { count: 1, hours: 300, sales: 20000, missingHours: 0, missingSales: 0, rebids: 0 });
  }
});

test('owner-confirmed originals flow through the report only for the selected company and customer bid', () => {
  const bids = [bid('100', 'IN_PROGRESS', { payload: { created_on: '2026-05-22' } })];
  const values = [value('100')];
  const versions = [proposal('100', { proposalId: '200', name: 'Cloned Estimate', primary: false, hours: 300, sales: 20000 }),
    proposal('100', { proposalId: '201', name: 'Revision', hours: 250, sales: 80000 })];
  const confirmation = { companyId: company, bidBoardId: '100', proposalId: '200', confirmedAt: '2026-11-03T12:00:00Z', confirmedBy: 'owner@example.test' };
  const calculate = originals => calculateEstimatePreview(bids, values, versions, policy, [], new Date('2026-11-03'), [], originals);
  const result = calculate([confirmation]);
  assert.deepEqual(result.projects[0].issues, []);
  assert.equal(result.projects[0].events[0].date, '2026-05-22');
  assert.equal(result.projects[0].events[1].basis, 'confirmed-original');
  assert.deepEqual(result.months['2026-10'], { count: 1, hours: -50, sales: 60000, missingHours: 0, missingSales: 0, rebids: 1 });
  for (const changed of [{ companyId: old }, { bidBoardId: '999' }]) {
    assert.match(calculate([{ ...confirmation, ...changed }]).projects[0].issues.join(' '), /No original estimate/);
  }
});

test('archived, excluded, template, missing-source and prefixed copies do not enter totals', () => {
  const bids = ['archived', 'deleted', 'is_template', 'sync_missing_from_procore'].map(flag => bid(flag, 'COMPLETE', { payload: { created_on: '2026-10-02', [flag]: true } }));
  bids.push(bid('excluded'), bid(`${company}:copy`), bid('valid'));
  const result = run(bids, bids.map(b => value(b.bidBoardId)), [], { groups: [], excludedSources: [`${company}:excluded`] });
  assert.deepEqual(result.projects.map(p => p.name), ['Job valid']);
});

test('missing Created Date does not fall back to sync time; pre-cutover history stays outside preview totals', () => {
  const result = run([bid('a', 'COMPLETE', { payload: { updated_at: '2026-10-02' } }), bid('b', 'COMPLETE', { payload: { created_on: '2025-01-02' } })], [value('a'), value('b')]);
  assert.equal(result.projects.length, 0);
  assert.equal(result.missingCreatedDates, 1);
});

test('preview requires KPI permission, development mode and read-only database loading', () => {
  assert.equal(resolvePermissionForPath('/api/kpi/estimate-preview'), 'kpi');
  const route = readFileSync(new URL('../src/app/api/kpi/estimate-preview/route.ts', import.meta.url), 'utf8');
  assert.match(route, /NODE_ENV !== 'development'/);
  assert.match(route, /getRequestUserEmail/);
  assert.match(route, /hasDatabasePageAccess\(prisma, actor, 'kpi'\)/);
  assert.match(route, /private, no-store/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  const loader = readFileSync(new URL('../src/lib/loadKpiEstimatePreview.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(loader, /\.(create|update|upsert|delete|executeRaw)\s*\(|makeRequest|fetch\(/);
});
