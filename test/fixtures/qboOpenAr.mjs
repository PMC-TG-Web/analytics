export function arFixture() {
  return {
    version: 1, companyId: '123', realmId: '456', environment: 'production',
    asOfDate: '2026-11-05', generatedAt: '2026-11-05T14:00:00.000Z', currency: 'USD',
    classes: [
      { id: 'concrete', name: 'Concrete', parentId: null, active: true },
      { id: 'retainage', name: 'Concrete:retainages', parentId: 'concrete', active: true },
      { id: 'flat', name: 'Concrete:Flatwork', parentId: 'concrete', active: true },
      { id: 'screed', name: 'Screeding', parentId: null, active: false },
      { id: '__unclassified__', name: 'Unclassified', parentId: null, active: true },
    ],
    invoices: [
      { id: '1', customerId: 'c1', customerName: 'Alpha project', number: 'INV-1', invoiceDate: '2026-08-01', dueDate: '2026-11-05', totalCents: 10000, balanceCents: 10000, classIds: ['retainage'] },
      { id: '2', customerId: 'c2', customerName: 'Beta project', number: 'INV-2', invoiceDate: '2026-08-01', dueDate: '2026-10-06', totalCents: 20000, balanceCents: 20000, classIds: ['flat'] },
      { id: '3', customerId: 'c3', customerName: 'Mixed project', number: 'INV-3', invoiceDate: '2026-08-01', dueDate: '2026-09-06', totalCents: 40000, balanceCents: 30000, classIds: ['flat', 'screed'] },
      { id: '4', customerId: 'c4', customerName: 'Unclassified project', number: 'INV-4', invoiceDate: '2026-08-01', dueDate: '2026-08-07', totalCents: 40000, balanceCents: 40000, classIds: ['__unclassified__'] },
      { id: '5', customerId: 'c5', customerName: 'Old project', number: 'INV-5', invoiceDate: '2026-07-01', dueDate: '2026-08-06', totalCents: 50000, balanceCents: 50000, classIds: ['flat'] },
    ],
    unappliedPaymentCents: 1000, unappliedPaymentCount: 1, remainingCreditCents: 0, remainingCreditCount: 0,
    qboAging: { current: 9000, days1To30: 20000, days31To60: 30000, days61To90: 40000, daysOver90: 50000, undated: 0, total: 149000 },
  };
}
export function agingFixture(amounts = [100, 0, 0, 0, 0, 100]) {
  return {
    Header: { Currency: 'USD', Option: [{ Name: 'report_date', Value: '2026-11-05' }, { Name: 'NoReportData', Value: 'false' }] },
    Columns: { Column: ['current', '0', '1', '2', '3', 'total'].map(key => ({ MetaData: [{ Name: 'ColKey', Value: key }] })) },
    Rows: { Row: [{ group: 'GrandTotal', Summary: { ColData: amounts.map(value => ({ value: value.toFixed(2) })) } }] },
  };
}
export function sourceReader(overrides = {}) {
  const invoice = {
    Id: 'i1', DocNumber: '1001', CustomerRef: { value: 'c1', name: 'Short name' }, TxnDate: '2026-09-01',
    DueDate: '2026-11-10', Balance: 100, TotalAmt: 120, CurrencyRef: { value: 'USD' },
    Line: [{ DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ClassRef: { value: 'flat' } } }],
  };
  const data = {
    Invoice: [invoice],
    Class: [{ Id: 'concrete', Name: 'Concrete', Active: true }, { Id: 'flat', FullyQualifiedName: 'Concrete:Flatwork', ParentRef: { value: 'concrete' }, Active: false }],
    Customer: [{ Id: 'c1', FullyQualifiedName: 'Customer:Project' }],
    Payment: [{ Id: 'p1', UnappliedAmt: 0 }], CreditMemo: [{ Id: 'cm1', RemainingCredit: 0 }],
    ...overrides,
  };
  const calls = [];
  return {
    data, calls,
    async query(query) {
      calls.push(query);
      const entity = query.match(/from (\w+)/)[1];
      return { QueryResponse: { [entity]: data[entity] } };
    },
    async getReport(name, parameters) { calls.push({ name, parameters }); return agingFixture(); },
  };
}
