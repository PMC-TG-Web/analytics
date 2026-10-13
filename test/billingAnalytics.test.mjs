import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateBillingHours, billingHoursCsv, billingMonthRange, isSubcontractorHours, isSubcontractorParty } from '../src/lib/billingAnalytics.ts';
import { canAccessBillingAnalytics, isBillingAnalyticsPath } from '../src/lib/billingAnalyticsAccess.ts';
import { resolvePermissionForPath } from '../src/lib/permissionRoutes.js';

const entry = (overrides = {}) => ({ id: 'local-1', procoreId: '1', companyId: 'co', projectId: 'p1',
  projectName: 'Same name', projectNumber: '100', source: 'timesheet', date: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z',
  deletedAt: null, hours: 8, costCode: '03-300-20-10', costCodeName: 'SOG labor', description: null, partyName: 'Sub Contractor',
  status: null, notes: null, uom: 'hr', ...overrides });

test('only the three pilot accounts pass, including when other users have admin roles', () => {
  for (const email of ['todd@pmcdecor.com', 'shelly@pmcdecor.com', ' DAVID@pmcdecor.com ']) assert.equal(canAccessBillingAnalytics(email), true);
  for (const email of [null, undefined, '', 'admin@pmcdecor.com', 'todd@pmcdecor.com.example']) assert.equal(canAccessBillingAnalytics(email), false);
  for (const path of ['/accounting/billing-analytics', '/api/accounting/billing-analytics', '/api/accounting/billing-analytics/details']) {
    assert.equal(isBillingAnalyticsPath(path), true);
    assert.equal(resolvePermissionForPath(path), 'analytics');
  }
  assert.equal(isBillingAnalyticsPath('/accounting/billing-analytics-other'), false);
});

test('worker identity selects timesheets; subcontractor codes and equipment do not imply hours', () => {
  assert.ok(isSubcontractorParty(' SUB CONTRACTOR '));
  assert.ok(isSubcontractorHours('#13 - Subcontractor Hours - 1.0 ls'));
  assert.equal(isSubcontractorHours('Excavation Subcontractor'), false);
  assert.equal(isSubcontractorHours('Subcontractor Hours - equipment'), false);
  const report = aggregateBillingHours([entry(), entry({ procoreId: '2', partyName: 'Employee', costCodeName: 'Subcontractor', costCode: '01.S' })], 'co');
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].totalHours, 8);
});

test('groups by explicit company/project, UTC work month and cost code, keeping both sources additive', () => {
  const { rows } = aggregateBillingHours([
    entry(), entry({ id: 'mirror-copy', hours: 99, updatedAt: '2026-10-01T00:00:00Z' }),
    entry({ source: 'productivity', description: 'Subcontractor Hours', partyName: null, status: 'approved', hours: 34, uom: 'ls', costCode: '03-300-20-10.L' }),
    entry({ procoreId: '2', hours: -1.5 }),
    entry({ procoreId: '3', projectId: 'p2' }),
    entry({ procoreId: '4', date: '2026-09-30T00:00:00Z' }),
    entry({ procoreId: '5', costCode: '01-300-10-30' }),
    entry({ companyId: 'another-company', hours: 1000 }),
  ], 'co');
  assert.equal(rows.length, 4);
  const main = rows.find(row => row.projectId === 'p1' && row.month === '2026-10' && row.costCode === '03-300-20-10');
  assert.equal(main.timesheetHours, 6.5);
  assert.equal(main.productivityHours, 34);
  assert.equal(main.totalHours, 40.5);
  assert.equal(main.entries.length, 3);
});

test('deletions, approval, missing coding and invalid hours remain explicit', () => {
  const { rows, warnings } = aggregateBillingHours([
    entry(), entry({ deletedAt: '2026-10-03', updatedAt: '2026-10-03' }),
    entry({ procoreId: '2', source: 'productivity', description: 'Subcontractor Hours', status: 'pending' }),
    entry({ procoreId: '3', costCode: null, hours: 0 }),
    entry({ procoreId: '4', projectId: null }),
    entry({ procoreId: '5', hours: null }),
  ], 'co');
  assert.deepEqual(warnings, { missingProject: 1, missingCostCode: 1, invalidHours: 1, unapprovedProductivity: 1 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].costCode, '(Unassigned)');
  assert.equal(rows[0].totalHours, 0);
});

test('month ranges include the last month and reject invalid or excessive ranges', () => {
  const range = billingMonthRange('2026-01', '2026-12');
  assert.equal(range.start.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(range.end.toISOString(), '2027-01-01T00:00:00.000Z');
  for (const [from, through] of [['2026-00', '2026-01'], ['2026-02', '2026-01'], ['2024-01', '2026-01'], ['', '2026-01']]) assert.throws(() => billingMonthRange(from, through));
});

test('CSV preserves filtered totals and safely quotes spreadsheet text', () => {
  const { rows } = aggregateBillingHours([entry({ projectName: '=HYPERLINK("example")' })], 'co');
  const csv = billingHoursCsv(rows);
  assert.ok(csv.includes(`"'=HYPERLINK(""example"")"`));
  assert.ok(csv.endsWith('"8","0","8"'));
});
