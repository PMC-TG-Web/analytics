import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildProjectUsageReport, usagePeriod } from '../src/lib/projectUsageReport.ts';
import { createProjectUsageWorkbook } from '../src/lib/projectUsageWorkbook.ts';

const projects = [
  { procoreProjectId: '598134326634438', projectName: 'Same project name', projectNumber: '001', customer: 'Customer', status: 'Active' },
  { procoreProjectId: 'other', projectName: 'Same project name', projectNumber: '002', customer: null, status: 'Complete' },
];
const record = (id, extra = {}) => ({ id, sourceId: id, companyId: 'company', projectId: projects[0].procoreProjectId,
  source: 'Daily log', date: '2026-10-22', updatedAt: '2026-10-22T12:00:00Z', deletedAt: null, status: null,
  quantity: 10, costCode: '03-300-20-20', description: 'Concrete', worker: null, holderId: 'po1', lineItemId: 'line1',
  costType: 'M', uom: 'CY', holderTitle: 'Materials', metadataMatches: 1, ...extra });
const build = (rows, period = usagePeriod()) => buildProjectUsageReport('company', period, projects, rows);

test('all canonical projects remain distinct, with zero usage and unmatched external IDs retained', () => {
  const result = build([record('1'), record('2', { projectId: 'unlisted' }), record('3', { companyId: 'another-company', quantity: 999 })]);
  assert.equal(result.projects.length, 3);
  assert.equal(result.projects.find(p => p.projectId === 'other').materialLines, 0);
  assert.equal(result.materials.length, 2);
  assert.equal(result.materials.reduce((sum, r) => sum + r.quantity, 0), 20);
});

test('latest source mirror wins before date and deletion filtering; local IDs do not deduplicate unrelated records', () => {
  const result = build([
    record('old', { sourceId: 'x', updatedAt: '2026-10-21T12:00:00Z' }),
    record('new', { sourceId: 'x', deletedAt: '2026-10-22T12:00:00Z' }),
    record('moved-old', { sourceId: 'y', updatedAt: '2026-10-21T12:00:00Z' }),
    record('moved-new', { sourceId: 'y', date: '2026-10-23' }),
    record('local1', { sourceId: null }), record('local2', { sourceId: null }),
    record('billing', { holderTitle: 'Monthly Billing File' }),
  ], usagePeriod('2026-10-22', '2026-10-22'));
  assert.equal(result.materials[0].quantity, 20);
  assert.equal(result.materials[0].entries, 2);
  assert.deepEqual(result.excluded, { deleted: 1, billingLogs: 1 });
});

test('labor sources and included subcontractor hours are separate from material and equipment quantities', () => {
  const result = build([
    record('tc', { source: 'Timecard', quantity: 8, worker: 'Alex' }),
    record('sub', { source: 'Timecard', quantity: 2, worker: 'Sub Contractor' }),
    record('labor', { costType: 'L', uom: 'HR', quantity: 3 }),
    record('legacy', { costType: 'L', uom: 'LS', quantity: 4 }),
    record('wrong-unit', { costType: 'L', uom: 'EA', quantity: 50 }),
    record('equipment', { costType: 'E', uom: 'HR', quantity: 100 }),
    record('material'),
  ]);
  const summary = result.projects.find(p => p.projectId === projects[0].procoreProjectId);
  assert.equal(summary.timecardHours, 10); assert.equal(summary.dailyLogHours, 7); assert.equal(summary.subcontractorHours, 2);
  assert.equal(result.materials[0].quantity, 10); assert.equal(result.other[0].quantity, 100); assert.equal(result.review[0].quantity, 50);
});

test('quantities aggregate only within the exact item and unit and preserve credits and source unit corrections', () => {
  const result = build([
    record('a', { quantity: 10.12345 }), record('b', { quantity: -2 }),
    record('c', { lineItemId: 'other-line' }), record('d', { holderId: 'other-po' }),
    record('fiber', { description: 'Fiber', uom: 'CY' }),
    record('bar', { description: 'Rebar', costCode: '03-200-30-20', uom: 'EA' }),
    record('bar2', { description: 'Rebar', costCode: '03-200-30-20', uom: 'LB' }),
  ]);
  assert.equal(result.materials.length, 6);
  assert.equal(result.materials.find(r => r.entries === 2).quantity, 8.1235);
  assert.equal(result.materials.find(r => r.description === 'Fiber').unit, 'EA');
  assert.deepEqual(result.materials.filter(r => r.description === 'Rebar').map(r => r.unit).sort(), ['EA', 'LB']);
});

test('unresolved metadata and invalid quantities stay visible in review, without inventing material totals', () => {
  const result = build([record('a', { metadataMatches: 0 }), record('b', { metadataMatches: 2 }),
    record('c', { quantity: null }), record('d', { projectId: null }),
    record('e', { uom: null, costCode: 'unknown' }), record('f', { costType: null }),
    record('zero', { quantity: 0 }),
  ]);
  assert.equal(result.materials.length, 1); assert.equal(result.materials[0].quantity, 0);
  assert.equal(result.review.reduce((n, r) => n + r.entries, 0), 6);
});

test('date filters are inclusive and reject invalid calendar dates and reversed periods', () => {
  for (const date of ['2026-02-30', '2026-13-01', 'not-a-date', '2026-1-01']) assert.throws(() => usagePeriod(date, ''));
  assert.throws(() => usagePeriod('2026-10-22', '2026-10-21'));
  assert.equal(build([record('a')], usagePeriod('2026-10-22', '2026-10-22')).materials.length, 1);
  assert.equal(build([record('a')], usagePeriod('', '2026-10-21')).materials.length, 0);
});

test('Excel round trip preserves all sheets, numbers, dates, text IDs, filters and formula-like source labels as text', () => {
  const report = build([record('a', { description: '=1+1', costCode: 'other' }), record('b', { source: 'Timecard', quantity: 8 })]);
  const workbook = createProjectUsageWorkbook(report);
  const saved = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellDates: true });
  assert.deepEqual(saved.SheetNames, ['Projects', 'Labor', 'Materials', 'Other quantities', 'Review', 'Report notes']);
  const material = saved.Sheets.Materials;
  assert.equal(material.C6.t, 's'); assert.equal(material.C6.v, projects[0].procoreProjectId);
  assert.equal(material.G6.v, '=1+1'); assert.equal(material.G6.t, 's'); assert.equal(material.G6.f, undefined);
  assert.equal(material.I6.t, 'n'); assert.equal(material.I6.v, 10);
  assert.equal(material.L6.t, 'd'); assert.equal(material.L6.v.toISOString().slice(0, 10), '2026-10-22');
  assert.equal(material['!autofilter'].ref, 'A5:P6');
  assert.equal(saved.Sheets.Projects['!ref'], 'A1:J7');
});
