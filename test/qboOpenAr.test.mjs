import test from 'node:test';
import assert from 'node:assert/strict';
import { AR_BUCKETS, arBucket, arCents, arTotals, filterArInvoices, arReconciliationDifference, openArCsv, parseOpenArReport } from '../src/lib/qboOpenAr.ts';
import { arFixture } from './fixtures/qboOpenAr.mjs';

test('aging is exact at 0/1/30/31/60/61/90/91 days and uses date-only UTC arithmetic', () => {
  for (const [days, bucket] of [[-1, 'current'], [0, 'current'], [1, 'days1To30'], [30, 'days1To30'], [31, 'days31To60'], [60, 'days31To60'], [61, 'days61To90'], [90, 'days61To90'], [91, 'daysOver90']]) {
    const due = new Date(Date.parse('2026-11-05') - days * 86_400_000).toISOString().slice(0, 10);
    assert.equal(arBucket(due, '2026-11-05'), bucket);
  }
  assert.equal(arBucket(null, '2026-11-05'), 'undated');
  assert.equal(arBucket('2024-02-29', '2024-03-30'), 'days1To30');
  assert.throws(() => arBucket('2026-02-30', '2026-11-05'), /valid date/);
});
test('integer-cent invoice subtotals reconcile independently of unallocated payments', () => {
  const report = parseOpenArReport(arFixture());
  const totals = arTotals(report.invoices, report.asOfDate);
  assert.deepEqual(totals, { current: 10000, days1To30: 20000, days31To60: 30000, days61To90: 40000, daysOver90: 50000, undated: 0, total: 150000 });
  assert.equal(AR_BUCKETS.reduce((sum, key) => sum + totals[key], 0), totals.total);
  assert.equal(arReconciliationDifference(report), 0);
  report.qboAging.total -= 123;
  assert.equal(arReconciliationDifference(report), 123, 'never conceal other A/R differences');
});
test('class filters use exact IDs, descendants, unclassified and full mixed-invoice balances', () => {
  const report = parseOpenArReport(arFixture());
  const ids = (classes, mode = 'exclude', search = '') => filterArInvoices(report, classes, mode, search).map(row => row.id);
  assert.equal(ids([]).length, 5); assert.equal(ids([], 'include').length, 5);
  assert.deepEqual(ids(['retainage']), ['2', '3', '5', '4']);
  assert.deepEqual(ids(['concrete']), ['4']);
  assert.deepEqual(ids(['concrete'], 'include'), ['1', '2', '3', '5']);
  assert.deepEqual(ids(['screed'], 'include'), ['3']);
  assert.equal(arTotals(filterArInvoices(report, ['screed'], 'include'), report.asOfDate).total, 30000, 'partially paid mixed invoice is never prorated');
  assert.deepEqual(ids(['__unclassified__'], 'include'), ['4']);
  assert.deepEqual(ids([], 'exclude', 'INV-2'), ['2']);
  assert.deepEqual(ids(['retainage'], 'include', 'no match'), []);
  assert.throws(() => ids(['Concrete']), /selected class/);
});
test('invalid snapshots never masquerade as zero balances or partial data', () => {
  for (const mutate of [
    r => { r.invoices[0].balanceCents = NaN; },
    r => { r.invoices[0].dueDate = 'bad'; },
    r => { r.invoices.push(r.invoices[0]); },
    r => { r.classes[0].parentId = 'flat'; },
    r => { r.classes[1].parentId = 'missing'; },
    r => { r.qboAging.total++; },
    r => { r.invoices[0].invoiceDate = '2026-11-06'; },
    r => { r.invoices[0].classIds = []; },
    r => { delete r.unappliedPaymentCents; },
  ]) {
    const value = arFixture(); mutate(value);
    assert.throws(() => parseOpenArReport(value));
  }
  for (const value of ['', null, undefined, 'garbage', Infinity, 1.001, '1,2.00']) assert.throws(() => arCents(value, 'test'));
  assert.equal(arCents('1,234.56', 'test'), 123456);
  assert.equal(arCents('-0.01', 'test'), -1);
});
test('CSV exports all filtered rows, fixed aging columns and safe text', () => {
  const report = parseOpenArReport(arFixture());
  report.invoices[0].customerName = '=HYPERLINK("bad")';
  const rows = filterArInvoices(report, ['concrete'], 'include');
  const csv = openArCsv(report, rows);
  assert.equal(csv.split('\r\n').length, rows.length + 1);
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /"1-30 days","31-60 days","61-90 days","90\+ days"/);
  assert.match(csv, /Concrete:Flatwork; Screeding/);
  assert.doesNotMatch(csv, /Unclassified project/);
});
