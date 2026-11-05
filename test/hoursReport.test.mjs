import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHoursReport, emptyHoursFilters, filterHourEntries, hoursReportCsv, hoursTotals } from '../src/lib/hoursReport.ts';
import { buildProjectUsageReport, usagePeriod } from '../src/lib/projectUsageReport.ts';

const projects = ['p1', 'p2'].map(procoreProjectId => ({ procoreProjectId, projectName: 'Same name', projectNumber: procoreProjectId, customer: null, status: 'Active' }));
const record = (id, overrides = {}) => ({ id, sourceId: id, companyId: 'company', projectId: 'p1', source: 'Timecard',
  date: '2026-11-05', updatedAt: '2026-11-05T12:00:00Z', deletedAt: null, status: 'Approved', quantity: 8,
  costCode: '03-100-10-10', description: 'Foundation labor', worker: 'Test Worker', holderId: null, lineItemId: null,
  costType: 'L', uom: 'HR', holderTitle: null, metadataMatches: 1, ...overrides });
const build = (records, period = usagePeriod()) => buildHoursReport('company', period, projects, records);

test('all labor sources and statuses reconcile with project usage, retaining legacy units and credits', () => {
  const records = [record('t1'), record('t2', { worker: 'Sub Contractor', quantity: 4 }),
    record('p1', { source: 'Daily log', quantity: 3, uom: 'LS' }),
    record('p2', { source: 'Daily log', description: 'Project Management', costCode: '01-300-10-20', uom: 'EA', quantity: 2 }),
    record('p3', { source: 'Daily log', description: 'Subcontractor Hours', costType: 'S', uom: 'LS', quantity: 5, status: 'Pending' }),
    record('credit', { quantity: -1 }), record('zero', { quantity: 0 }),
    record('material', { source: 'Daily log', description: 'Concrete', costType: 'L', uom: 'CY', quantity: 400 }),
    record('equipment', { source: 'Daily log', description: 'Telehandler rental', quantity: 100 }),
    record('billing', { source: 'Daily log', holderTitle: 'Billing File', quantity: 999 }),
    record('void', { status: 'voided', quantity: 999 }), record('deleted', { deletedAt: '2026-11-06', quantity: 999 }),
    record('missing-metadata', { source: 'Daily log', metadataMatches: 0 }), record('bad-number', { quantity: NaN })];
  const report = build(records);
  assert.deepEqual(hoursTotals(report.entries), { timecard: 11, productivity: 10, combined: 21, count: 7 });
  assert.equal(report.review.length, 2);
  assert.equal(report.entries.find(row => row.sourceId === 'p3').status, 'Pending');
  assert.equal(report.entries.find(row => row.sourceId === 'p2').unit, 'EA');
  assert.match(report.entries.find(row => row.sourceId === 'p2').note, /hours/);
  assert.equal(report.entries.filter(row => row.laborType === 'Subcontractor').length, 2);
  assert.deepEqual(report.excluded, { deleted: 2, billingLogs: 1, nonLabor: 2 });
  const usage = buildProjectUsageReport('company', usagePeriod(), projects, records);
  assert.equal(usage.projects.reduce((sum, p) => sum + p.timecardHours + p.dailyLogHours, 0), hoursTotals(report.entries).combined);
});

test('source identities stay company/project/source scoped, and latest copies win before inclusive date filtering', () => {
  const report = build([
    record('shared'), record('mirror', { sourceId: 'shared', quantity: 10, updatedAt: '2026-11-06' }),
    record('shared', { projectId: 'p2', quantity: 2 }), record('shared', { source: 'Daily log', quantity: 3 }),
    record('foreign', { companyId: 'other', quantity: 999 }),
    record('moved'), record('moved-new', { sourceId: 'moved', date: '2026-11-06', updatedAt: '2026-11-06' }),
    record('removed'), record('removed-new', { sourceId: 'removed', deletedAt: '2026-11-06', updatedAt: '2026-11-06' }),
    record('before', { date: '2026-11-04' }), record('local1', { sourceId: null, quantity: 1 }), record('local2', { sourceId: null, quantity: 1 }),
  ], usagePeriod('2026-11-05', '2026-11-05'));
  assert.equal(report.entries.length, 5);
  assert.equal(hoursTotals(report.entries).combined, 17);
  assert.equal(report.excluded.deleted, 1);
  assert.ok(report.entries.every(row => row.date === '2026-11-05'));
});

test('description filters match case-insensitive literal text and notes from both sources; totals and export follow exact project/source filters', () => {
  const report = build([record('one', { notes: 'Pour EAST wing' }), record('two', { source: 'Daily log', description: 'Foundation labor', logDescription: '#2 - EAST wing', quantity: 4 }),
    record('three', { projectId: 'p2', description: 'East finishing', quantity: 2 }), record('four', { description: '100% special_[work]' })]);
  const matching = filterHourEntries(report.entries, { ...emptyHoursFilters, description: '  eAst ' });
  assert.equal(matching.length, 3); assert.equal(hoursTotals(matching).combined, 14);
  const project = filterHourEntries(matching, { ...emptyHoursFilters, projectId: 'p1', source: 'Productivity' });
  assert.equal(project.length, 1); assert.equal(project[0].sourceId, 'two');
  assert.equal(filterHourEntries(report.entries, { ...emptyHoursFilters, description: '% special_[' }).length, 1);
  assert.equal(filterHourEntries(report.entries, { ...emptyHoursFilters, description: 'Test Worker' }).length, 0);
  const csv = hoursReportCsv(project); assert.match(csv, /#2 - EAST wing/); assert.doesNotMatch(csv, /East finishing/);
  assert.equal(csv.split('\r\n').length, 2);
});

test('CSV exports more than one table page, escapes quotes/newlines/formulas and retains numeric negative hours', () => {
  const report = build(Array.from({ length: 205 }, (_, i) => record(`id${i}`, { description: i === 0 ? '=FORMULA()' : 'labor', notes: i === 1 ? 'a,"b"\nc' : '', quantity: i === 2 ? -2 : 1 })));
  const csv = hoursReportCsv(report.entries);
  assert.equal(csv.split('\r\n').length, 206);
  assert.match(csv, /"'=FORMULA\(\)"/); assert.match(csv, /"a,""b""\nc"/); assert.match(csv, /,"-2",/);
  assert.equal(hoursTotals(report.entries).combined, 202);
  assert.equal(hoursTotals([]).combined, 0);
});

test('unresolved records remain outside hours, and invalid dates are rejected', () => {
  const report = build([record('unknown', { projectId: null }), record('unmatched', { projectId: 'unknown' }),
    record('missing', { source: 'Daily log', quantity: null }), record('unit', { source: 'Daily log', uom: 'EA' })]);
  assert.equal(report.review.length, 3); assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].projectName, 'Project unknown');
  assert.ok(report.review.every(row => row.hours === null));
  for (const period of [{ from: '2026-02-30', through: '' }, { from: '2026-11-06', through: '2026-11-05' }]) assert.throws(() => build([], period));
});
