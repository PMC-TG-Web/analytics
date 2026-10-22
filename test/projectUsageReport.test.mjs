import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildProjectUsageReport, filterProjectUsageReport, usagePeriod } from '../src/lib/projectUsageReport.ts';
import { createProjectUsageWorkbook } from '../src/lib/projectUsageWorkbook.ts';
import { calculateRebarUsageTons } from '../src/lib/rebarUsage.ts';
import { classifyProjectUsageItem } from '../src/lib/projectUsageClassification.ts';

const projects = [
  { procoreProjectId: '598134326634438', projectName: 'Same project name', projectNumber: '001', customer: 'Customer', status: 'Active' },
  { procoreProjectId: 'other', projectName: 'Same project name', projectNumber: '002', customer: null, status: 'Complete' },
];
const record = (id, extra = {}) => ({ id, sourceId: id, companyId: 'company', projectId: projects[0].procoreProjectId,
  source: 'Daily log', date: '2026-10-22', updatedAt: '2026-10-22T12:00:00Z', deletedAt: null, status: null,
  quantity: 10, costCode: '03-300-20-20', description: 'Concrete', worker: null, holderId: 'po1', lineItemId: 'line1',
  costType: 'M', uom: 'CY', holderTitle: 'Materials', metadataMatches: 1, ...extra });
const build = (rows, period = usagePeriod()) => buildProjectUsageReport('company', period, projects, rows);

test('placed concrete survives Other and Concrete PO cost types in project totals and Excel', () => {
  const report = build([
    record('slab', { description: 'Slab On Grade Concrete - SOG', costType: 'Other', quantity: 1913 }),
    record('site', { description: 'Site Concrete - Site', costCode: '03-300-30-20', costType: 'Other', quantity: 108 }),
    record('bollards', { description: 'Bollards Concrete', costCode: '05-100-10-20', costType: 'Other', quantity: 10 }),
    record('con-type', { projectId: 'other', description: 'Ready Mix Concrete For Slabs On Grade', costType: 'Concrete', quantity: 170 }),
    record('con-short', { projectId: 'other', description: 'non-taxable SOG concrete', costType: 'CON', quantity: 4 }),
    record('generic', { projectId: 'other', description: 'Concrete - Site', costCode: '03-300-30-20', costType: 'O', quantity: 10 }),
    record('fiber', { description: 'Fiber - SOG', costType: 'Other', quantity: 1752 }),
    record('pump', { description: 'Boom Pump', costType: 'Concrete', quantity: 999 }),
    record('unresolved', { description: 'Site Concrete', costType: 'Other', metadataMatches: 0, quantity: 999 }),
    record('conflict', { description: 'Site Concrete', costType: 'Other', metadataMatches: 2, quantity: 999 }),
    record('deleted', { description: 'Site Concrete', costType: 'Other', deletedAt: '2026-10-22', quantity: 999 }),
    record('billing', { description: 'Site Concrete', costType: 'Other', holderTitle: 'Billing File', quantity: 999 }),
  ]);
  const filtered = filterProjectUsageReport(report, projects[0].procoreProjectId);
  assert.equal(filtered.projects[0].concreteCy, 2031);
  assert.equal(filtered.projects[0].dailyLogHours, 0);
  assert.equal(filtered.materials.reduce((sum, r) => sum + r.concreteCy, 0), 2031);
  assert.equal(report.projects.find(p => p.projectId === 'other').concreteCy, 184);
  assert.equal(filtered.review.reduce((sum, r) => sum + r.entries, 0), 2);
  assert.match(filtered.materials[0].note, /Saved cost type: Other/);
  const saved = XLSX.read(XLSX.write(createProjectUsageWorkbook(filtered), { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  assert.equal(saved.Sheets.Projects.K6.v, 2031);
  assert.equal(XLSX.utils.sheet_to_json(saved.Sheets.Materials, { range: 4 }).reduce((s, r) => s + r['Concrete (CY)'], 0), 2031);
});

test('Other concrete inference requires matching material code, name and explicit cubic-yard unit', () => {
  for (const extra of [
    { description: 'Fiber - SOG' }, { description: 'Concrete testing' }, { description: 'Site Concrete labor' },
    { description: 'Unknown activity' }, { uom: 'EA' }, { uom: 'HR' }, { costCode: '03-300-20-10' },
    { costType: null }, { costType: 'Equipment' }, { costType: 'Subcontractors' },
  ]) assert.equal(classifyProjectUsageItem(record('x', { costType: 'Other', description: 'Slab On Grade Concrete', ...extra })), null);
});

test('legacy Labor-coded concrete and products retain actual quantities while PM EA follows the existing hour policy', () => {
  const report = build([
    record('concrete', { description: 'Slab On Grade Concrete - SOG', costCode: '03-300-20-10', costType: 'Labor', quantity: 3563 }),
    record('ready-mix', { description: 'Ready Mix Concrete For Foundations', costCode: '03-300-00-10', costType: 'L', uom: 'cubic yards', quantity: 43.5 }),
    record('sealer', { description: 'L&M Curing Compound 5 Gal.', costCode: '03-300-00-10', costType: 'Labor', uom: 'EA', quantity: 5 }),
    record('pm', { description: 'Project Management', costCode: '01-300-10-20', costType: 'Labor', uom: 'EA', quantity: 18 }),
    record('pump', { description: 'Boom Pump Rental w/Operator', costCode: '03-300-20-10', costType: 'Labor', uom: 'EA', quantity: 1 }),
    record('telehandler', { description: 'Telehandler 8000 lb (In-House) - SOG', costType: 'Labor', uom: 'EA', quantity: 8 }),
    record('telebelt', { description: 'Telebelt (4 hr minimum)', costType: 'Labor', uom: 'EA', quantity: 9 }),
    record('scrubber', { description: 'Auto scrubber rental', costType: 'Labor', uom: 'DAYS', quantity: 1 }),
    record('zero', { description: 'Labor Continuous Footing', costType: 'Labor', uom: 'EA', quantity: 0 }),
    record('missing', { description: 'Travel_API_Test', metadataMatches: 0 }),
  ]);
  const project = report.projects.find(p => p.projectId === projects[0].procoreProjectId);
  assert.equal(project.concreteCy, 3606.5);
  assert.equal(project.dailyLogHours, 18);
  assert.equal(report.materials.length, 3);
  assert.equal(report.other.length, 5);
  assert.equal(report.review.length, 1);
  assert.equal(report.review[0].description, 'Travel_API_Test');
  assert.equal(report.materials.find(r => r.quantity === 3563).costCode, '03-300-20-10');
  assert.match(report.materials.find(r => r.quantity === 3563).note, /Saved cost type: Labor/);
  assert.equal([...report.labor, ...report.materials, ...report.other, ...report.review].reduce((n, r) => n + r.entries, 0), 10);
  const workbook = createProjectUsageWorkbook(filterProjectUsageReport(report, project.projectId));
  assert.equal(workbook.Sheets.Projects.K6.v, 3606.5);
  assert.equal(workbook.Sheets.Projects.G6.v, 18);
});

test('reporting exceptions are bounded by item name, units, exact PM code and unique metadata', () => {
  for (const [description, uom] of [['Concrete finishing labor', 'CY'], ['Slab On Grade Concrete', 'HR'], ['Unknown concrete activity', 'CY'], ['L&M Curing Compound', 'HR'], ['L&M Curing Compound installation', 'EA']]) {
    assert.equal(classifyProjectUsageItem(record('x', { description, uom, costType: 'Labor' })), null);
  }
  assert.equal(classifyProjectUsageItem(record('x', { description: 'Project Management', costCode: 'other', costType: 'Labor', uom: 'EA' })), null);
  for (const description of ['TK-Floor Hardner and Densifier 55 gal', 'Aussie Built Earth Binder sealer', 'Aussie Built Stabilised Earth sealer', 'TK Cure n Seal', 'CO1 - V-Seal 102 5 gal']) {
    assert.equal(classifyProjectUsageItem(record('x', { description, costType: 'Labor', uom: 'EA' })).kind, 'materials');
  }
  const report = build([
    record('unmatched', { description: 'Slab On Grade Concrete', costType: 'Labor', metadataMatches: 0 }),
    record('conflicting', { description: 'Project Management', costCode: '01-300-10-20', costType: 'Labor', uom: 'EA', metadataMatches: 2 }),
    record('unknown', { description: 'Unknown labor', costType: 'Labor', uom: 'EA', quantity: 10 }),
    record('deleted', { description: 'Slab On Grade Concrete', costType: 'Labor', deletedAt: '2026-10-22' }),
  ]);
  assert.equal(report.review.length, 3); assert.equal(report.materials.length, 0); assert.equal(report.labor.length, 0);
});

test('rebar conversions require explicit, unambiguous dimensions and exclude accessories', () => {
  for (const label of ["#4 Rebar - 20' Pc", '#4 rebar 20’', "#4x20' rebar", "#9 - #4 Rebar - 20' Pc - SOG"]) {
    assert.equal(calculateRebarUsageTons(165, 'ea', [label]), 1.1022, label);
  }
  assert.equal(calculateRebarUsageTons(10, 'EA', ["#5 non taxable rebar - 20' pc"]), 0.1043);
  assert.equal(calculateRebarUsageTons(100, 'LF', ['#4 Rebar']), 0.0334);
  assert.equal(calculateRebarUsageTons(2000, 'LB', ['Rebar']), 1);
  assert.equal(calculateRebarUsageTons(-165, 'EA', ["#4 Rebar 20'"]), -1.1022);
  for (const description of ['#4 Rebar By The Piece', '#9 Rebar 20 ft', '#4 Rebar chairs 20 ft', '#4 Rebar dowels 20 ft',
    '#4 Rebar wire mesh 20 ft', '#4 Rebar 20 ft / #5 Rebar 20 ft', '#4 Rebar 20 ft / #4 Rebar 10 ft', '#4 Rebar 20 ft 6 in', '#4 Rebar 20 1/2 ft']) {
    assert.equal(calculateRebarUsageTons(10, 'EA', [description]), null, description);
  }
  assert.equal(calculateRebarUsageTons(10, 'bundle', ["#4 Rebar 20'"]), null);
  assert.equal(calculateRebarUsageTons(10, 'EA', ['Rebar material', "#4 Rebar 20'"]), 0.0668);
});

test('project concrete CY and rebar tons use material usage, retain incomplete counts, and export numeric columns', () => {
  const report = build([
    record('concrete', { quantity: 50, uom: 'EA' }),
    record('fiber', { quantity: 100, description: 'Fiber' }),
    record('bar', { quantity: 165, costCode: '03-200-30-20', description: 'Rebar material', logDescription: "#4 Rebar 20'", uom: 'EA' }),
    record('missing', { quantity: 10, costCode: '03-200-30-20', description: '#4 Rebar By The Piece', uom: 'EA' }),
    record('chair', { quantity: 500, costCode: '03-200-30-20', description: 'Rebar chairs', uom: 'EA' }),
    record('deleted', { quantity: 999, deletedAt: '2026-10-22' }),
    record('billing', { quantity: 999, holderTitle: 'Billing File' }),
    record('equipment', { quantity: 999, costType: 'E' }),
    record('pump', { quantity: 999, description: 'Boom Pump' }),
  ]);
  const summary = report.projects.find(p => p.projectId === projects[0].procoreProjectId);
  assert.equal(summary.concreteCy, 50); assert.equal(summary.rebarTons, 1.1022); assert.equal(summary.rebarUnconvertedEntries, 1);
  assert.equal(report.projects.find(p => p.projectId === 'other').concreteCy, 0);
  const filtered = filterProjectUsageReport(report, summary.projectId);
  const saved = XLSX.read(XLSX.write(createProjectUsageWorkbook(filtered), { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  const row = XLSX.utils.sheet_to_json(saved.Sheets.Projects, { range: 4 })[0];
  assert.equal(row['Concrete (CY)'], 50); assert.equal(row['Rebar (tons)'], 1.1022); assert.equal(row['Rebar entries not converted'], 1);
  const material = XLSX.utils.sheet_to_json(saved.Sheets.Materials, { range: 4 });
  assert.equal(material.reduce((n, r) => n + r['Rebar (tons)'], 0), 1.1022);
  assert.equal(material.reduce((n, r) => n + r['Concrete (CY)'], 0), 50);
});

test('project filter scopes every section by exact ID without changing the all-project source report', () => {
  const report = build([
    record('a'), record('b', { projectId: 'other' }),
    record('c', { source: 'Timecard' }), record('d', { source: 'Timecard', projectId: 'other' }),
    record('e', { costType: 'E' }), record('f', { costType: 'E', projectId: 'other' }),
    record('g', { metadataMatches: 0 }), record('h', { metadataMatches: 0, projectId: 'other' }),
    record('i', { projectId: null }),
  ]);
  assert.equal(filterProjectUsageReport(report, null), report);
  const filtered = filterProjectUsageReport(report, 'other');
  for (const key of ['projects', 'labor', 'materials', 'other', 'review']) {
    assert.equal(filtered[key].length, 1, key);
    assert.ok(filtered[key].every(row => row.projectId === 'other'));
  }
  assert.equal(report.projects.length, 3);
  assert.equal(filtered.projectFilter.id, 'other');
  assert.equal(filterProjectUsageReport(report, '').review[0].projectId, '');
  const missing = filterProjectUsageReport(report, 'no-match');
  assert.equal(missing.projects.length, 0); assert.equal(missing.labor.length, 0);
  const workbook = createProjectUsageWorkbook(filtered);
  for (const name of ['Projects', 'Labor', 'Materials', 'Other quantities', 'Review']) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { range: 4 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]['Procore project ID'], 'other');
  }
  assert.match(workbook.Sheets['Report notes'].B6.v, /Selected project.*other/);
});

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
  assert.equal(material['!autofilter'].ref, 'A5:S6');
  assert.equal(saved.Sheets.Projects['!ref'], 'A1:M7');
});
