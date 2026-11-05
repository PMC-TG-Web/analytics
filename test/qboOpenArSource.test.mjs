import test from 'node:test';
import assert from 'node:assert/strict';
import { loadQboOpenArSource } from '../src/lib/loadQboOpenArSource.ts';
import { sourceReader, agingFixture } from './fixtures/qboOpenAr.mjs';
const scope = { companyId: '123', realmId: '456', environment: 'production' };
const now = new Date('2026-11-05T14:00:00.000Z');

test('collector reads exact QBO identities, inactive classes, full history and 30-day report controls', async () => {
  const reader = sourceReader();
  const report = await loadQboOpenArSource(reader, scope, now);
  assert.equal(report.invoices[0].customerName, 'Customer:Project');
  assert.equal(report.invoices[0].balanceCents, 10000);
  assert.equal(report.classes.find(row => row.id === 'flat').active, false);
  assert.equal(report.qboAging.total, 10000);
  assert.ok(reader.calls.some(q => typeof q === 'string' && /Invoice where Balance > '0'/.test(q)));
  assert.ok(reader.calls.every(q => typeof q !== 'string' || !q.includes('TxnDate >=')), 'old open invoices are never date-windowed away');
  assert.ok(reader.calls.some(q => typeof q === 'string' && /from Payment startposition/.test(q)), 'UnappliedAmt is not filterable in the QBO API');
  assert.deepEqual(reader.calls.find(q => typeof q === 'object'), { name: 'AgedReceivables', parameters: { report_date: '2026-11-05', aging_method: 'Report_Date', num_periods: '4', aging_period: '30' } });
});
test('header, grouped, missing and unknown classes survive without amount allocation', async () => {
  const reader = sourceReader();
  reader.data.Invoice[0].ClassRef = { value: 'flat' };
  reader.data.Invoice[0].Line = [
    { DetailType: 'SalesItemLineDetail', SalesItemLineDetail: {} },
    { DetailType: 'GroupLineDetail', GroupLineDetail: { Line: [{ DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ClassRef: { value: 'unknown' } } }] } },
  ];
  let report = await loadQboOpenArSource(reader, scope, now);
  assert.deepEqual(report.invoices[0].classIds, ['flat', 'unknown']);
  assert.match(report.classes.find(row => row.id === 'unknown').name, /Unknown class/);
  delete reader.data.Invoice[0].ClassRef;
  report = await loadQboOpenArSource(reader, scope, now);
  assert.deepEqual(report.invoices[0].classIds, ['__unclassified__', 'unknown']);
});
test('payments and remaining credits are distinct unallocated controls', async () => {
  const reader = sourceReader({
    Payment: [{ Id: 'p', TxnDate: '2026-10-01', UnappliedAmt: 12.34 }],
    CreditMemo: [{ Id: 'c', TxnDate: '2026-10-01', RemainingCredit: 1.23 }],
  });
  const report = await loadQboOpenArSource(reader, scope, now);
  assert.equal(report.unappliedPaymentCents, 1234);
  assert.equal(report.remainingCreditCents, 123);
  assert.equal(report.invoices[0].balanceCents, 10000);
});
test('full pages paginate, including exact 1000-row final pages', async () => {
  const reader = sourceReader(); const original = reader.query.bind(reader);
  reader.query = async query => {
    if (!query.includes('from Invoice')) return original(query);
    reader.calls.push(query);
    return { QueryResponse: { Invoice: query.includes('startposition 1 ') ? Array.from({ length: 1000 }, (_, i) => ({ ...reader.data.Invoice[0], Id: String(i) })) : [] } };
  };
  const report = await loadQboOpenArSource(reader, scope, now);
  assert.equal(report.invoices.length, 1000);
  assert.ok(reader.calls.some(q => typeof q === 'string' && q.includes('Invoice') && q.includes('startposition 1001')));
});
test('missing reports, unexpected responses, mixed currencies and future dates fail closed', async () => {
  for (const mutate of [
    r => { r.query = async () => ({}); },
    r => { r.data.Invoice[0].Balance = 'bad'; },
    r => { r.data.Invoice[0].CurrencyRef = { value: 'EUR' }; },
    r => { r.data.Invoice[0].TxnDate = '2026-11-06'; },
    r => { r.data.Invoice.push(r.data.Invoice[0]); },
    r => { r.getReport = async () => ({ ...agingFixture(), Rows: { Row: [] } }); },
    r => { r.getReport = async () => ({ ...agingFixture(), Header: { Currency: 'USD', Option: [{ Name: 'report_date', Value: '2026-11-04' }] } }); },
  ]) {
    const reader = sourceReader(); mutate(reader);
    await assert.rejects(loadQboOpenArSource(reader, scope, now));
  }
});
test('QBO no-data report is explicitly empty, not a missing total fallback', async () => {
  const reader = sourceReader({ Invoice: [], Payment: [], CreditMemo: [] });
  reader.getReport = async () => ({ Header: { Currency: 'USD', Option: [{ Name: 'report_date', Value: '2026-11-05' }, { Name: 'NoReportData', Value: 'true' }] } });
  const report = await loadQboOpenArSource(reader, scope, now);
  assert.equal(report.invoices.length, 0); assert.equal(report.qboAging.total, 0);
});
