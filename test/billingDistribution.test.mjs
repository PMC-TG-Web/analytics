import test from 'node:test';
import assert from 'node:assert/strict';
import { groupBillingYear, distributeBillingInvoice, billingDistributionCsv } from '../src/lib/billingDistribution.ts';

const row = (projectId, costCode, totalHours, month = '2026-10') => ({ key: JSON.stringify([projectId, month, costCode]), projectId, projectName: 'Same name', projectNumber: projectId,
  month, costCode, costCodeName: 'Labor', timesheetHours: totalHours, productivityHours: 0, totalHours, entries: [] });

test('year view has twelve chronological months and separates same-name projects and other years', () => {
  const groups = groupBillingYear([row('b', '02', 8), row('a', '02', 3), row('a', '01', 5), row('a', '01', 10, '2025-10')], 2026);
  assert.equal(groups.length, 12);
  assert.equal(groups[0].month, '2026-01');
  assert.equal(groups[11].month, '2026-12');
  assert.equal(groups[9].totalHours, 16);
  assert.deepEqual(groups[9].projects.map(p => [p.projectId, p.totalHours]), [['a', 8], ['b', 8]]);
  assert.deepEqual(groups[9].projects[0].rows.map(r => r.costCode), ['01', '02']);
});

test('one-project invoice allocates only that project and retains both source hours', () => {
  const data = [row('a', '01', 30), { ...row('a', '02', 10), timesheetHours: 0, productivityHours: 10 }, row('b', '01', 60)];
  const result = distributeBillingInvoice(data, ['a'], '1000.00');
  assert.equal(result.error, null);
  assert.equal(result.totalHours, 40);
  assert.deepEqual(result.lines.map(l => [l.projectShare, l.invoiceShare, l.cents]), [[0.75, 0.75, 75000], [0.25, 0.25, 25000]]);
  assert.equal(result.lines[1].row.productivityHours, 10);
});

test('multiple-project invoice uses selected-month hours across projects, not separate full invoices per job', () => {
  const data = [row('a', '01', 30), row('a', '02', 10), row('b', '01', 60), row('c', '01', 1000)];
  const result = distributeBillingInvoice(data, ['a', 'b'], '2000');
  assert.equal(result.totalHours, 100);
  assert.deepEqual(result.lines.map(l => [l.projectShare, l.invoiceShare, l.cents]), [[0.75, 0.3, 60000], [0.25, 0.1, 20000], [1, 0.6, 120000]]);
  assert.equal(result.lines.reduce((sum, l) => sum + l.cents, 0), 200000);
});

test('rounding always reconciles, uses exact fractional weights, and is independent of display order', () => {
  const data = [row('a', '03', 0.0001), row('a', '01', 0.0001), row('a', '02', 0.0001), row('a', '04', 0)];
  for (const amount of ['0.01', '0.02', '10.00', '9999999999.99']) {
    const forward = distributeBillingInvoice(data, ['a'], amount);
    const reverse = distributeBillingInvoice([...data].reverse(), ['a'], amount);
    assert.equal(forward.error, null);
    assert.equal(forward.lines.reduce((sum, l) => sum + l.cents, 0), forward.invoiceCents);
    assert.deepEqual(Object.fromEntries(forward.lines.map(l => [l.row.key, l.cents])), Object.fromEntries(reverse.lines.map(l => [l.row.key, l.cents])));
    assert.equal(forward.lines[3].cents, 0);
  }
  assert.deepEqual(distributeBillingInvoice(data, ['a'], '10').lines.map(l => l.cents), [333, 334, 333, 0]);
});

test('shares are useful before entering dollars; amounts and unsafe scopes cannot produce an export', () => {
  const data = [row('a', '01', 10)];
  const preview = distributeBillingInvoice(data, ['a']);
  assert.equal(preview.lines[0].invoiceShare, 1);
  assert.equal(preview.lines[0].cents, null);
  assert.throws(() => billingDistributionCsv(preview, ''), /Enter the invoice amount/);
  for (const amount of ['-1', '0', '1.001', 'NaN', '1e3', '10000000000.00']) assert.ok(distributeBillingInvoice(data, ['a'], amount).error, amount);
  for (const [records, ids] of [[data, []], [data, ['missing']], [[row('a', '01', 0)], ['a']], [[row('a', '01', -1)], ['a']], [[row('a', '(Unassigned)', 1)], ['a']], [[...data, row('a', '01', 3, '2026-09')], ['a']], [[...data, ...data], ['a']], [[row('a', '01', Infinity)], ['a']]]) {
    const result = distributeBillingInvoice(records, ids, '100');
    assert.ok(result.error);
    assert.equal(result.lines.length, 0);
    assert.throws(() => billingDistributionCsv(result, ''));
  }
});

test('export names the project, month, code, basis and exact cents for QuickBooks entry', () => {
  const result = distributeBillingInvoice([row('a', '01', 3), row('b', '01', 1)], ['a', 'b'], '123.45');
  const csv = billingDistributionCsv(result, '=Vendor, "bill"');
  assert.ok(csv.includes(`"'=Vendor, ""bill"""`));
  assert.ok(csv.includes('"2026-10","a","a","Same name","01"'));
  assert.ok(csv.includes('"92.59","123.45"'));
  assert.ok(csv.includes('"30.86","123.45"'));
});
