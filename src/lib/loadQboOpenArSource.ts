import { arArray, arCents, arDate, arRecord, arText, emptyArAmounts, OpenArDataError, parseOpenArReport, UNCLASSIFIED_AR, type ArClass, type ArInvoice, type OpenArReport } from './qboOpenAr.ts';

type Reader = { query(query: string, options?: { signal: AbortSignal }): Promise<unknown>; getReport(name: string, parameters: Record<string, string>, options?: { signal: AbortSignal }): Promise<unknown> };
type Scope = { companyId: string; realmId: string; environment: string };
const optionalText = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const ref = (value: unknown) => value == null ? {} : arRecord(value, 'QBO reference');

async function list(reader: Reader, entity: string, condition = ''): Promise<Record<string, unknown>[]> {
  const result: Record<string, unknown>[] = [];
  for (let start = 1; start <= 100_000; start += 1000) {
    const response = arRecord(await reader.query(`select * from ${entity}${condition ? ` where ${condition}` : ''} startposition ${start} maxresults 1000`, { signal: AbortSignal.timeout(45_000) }), entity);
    const query = arRecord(response.QueryResponse, `${entity} query response`);
    const rows = arArray(query[entity] ?? [], `${entity} rows`).map(value => arRecord(value, entity));
    result.push(...rows);
    if (rows.length < 1000) {
      if (new Set(result.map(row => arText(row.Id, `${entity} ID`))).size !== result.length) throw new OpenArDataError(`${entity} changed during pagination. Refresh again.`);
      return result;
    }
  }
  throw new OpenArDataError(`${entity} exceeded the reporting safety limit. No partial snapshot was saved.`);
}
function invoiceClasses(invoice: Record<string, unknown>): string[] {
  const result = new Set<string>();
  const headerClass = optionalText(ref(invoice.ClassRef).value);
  const visit = (lines: unknown, inherited: string | null) => {
    for (const value of arArray(lines, 'Invoice lines')) {
      const line = arRecord(value, 'Invoice line');
      if (line.DetailType === 'SalesItemLineDetail') {
        const detail = arRecord(line.SalesItemLineDetail, 'Sales line detail');
        result.add(optionalText(ref(detail.ClassRef).value) || inherited || UNCLASSIFIED_AR);
      } else if (line.DetailType === 'GroupLineDetail') {
        const group = arRecord(line.GroupLineDetail, 'Group line detail');
        visit(group.Line, optionalText(ref(group.ClassRef).value) || inherited);
      }
    }
  };
  visit(invoice.Line, headerClass);
  if (!result.size) result.add(headerClass || UNCLASSIFIED_AR);
  return [...result];
}
function agingAmounts(value: unknown, asOfDate: string) {
  const report = arRecord(value, 'A/R aging report');
  const header = arRecord(report.Header, 'A/R aging header');
  const options = arArray(header.Option, 'A/R aging options').map(option => arRecord(option, 'Report option'));
  if (!options.some(option => option.Name === 'report_date' && option.Value === asOfDate)) throw new OpenArDataError('QBO returned a different A/R report date.');
  const amounts = emptyArAmounts();
  if (options.some(option => option.Name === 'NoReportData' && option.Value === 'true')) return { currency: arText(header.Currency, 'QBO currency'), amounts };
  const columns = arArray(arRecord(report.Columns, 'Aging columns').Column, 'Aging columns').map(value => arRecord(value, 'Aging column'));
  const columnKeys = columns.map(column => {
    const metadata = arArray(column.MetaData ?? [], 'Column metadata').map(value => arRecord(value, 'Column metadata'));
    return String(metadata.find(value => value.Name === 'ColKey')?.Value || '').toLowerCase();
  });
  const findTotal = (rows: unknown): Record<string, unknown> | null => {
    for (const value of arArray(rows, 'Aging rows')) {
      const row = arRecord(value, 'Aging row');
      if (row.group === 'GrandTotal') return row;
      if (row.Rows) { const result = findTotal(arRecord(row.Rows, 'Nested rows').Row); if (result) return result; }
    }
    return null;
  };
  const total = findTotal(arRecord(report.Rows, 'Aging rows').Row);
  if (!total) throw new OpenArDataError('QBO aging grand total is missing.');
  const cells = arArray(arRecord(total.Summary, 'Aging total').ColData, 'Aging total cells');
  for (const [bucket, key] of [['current', 'current'], ['days1To30', '0'], ['days31To60', '1'], ['days61To90', '2'], ['daysOver90', '3'], ['total', 'total']] as const) {
    const index = columnKeys.indexOf(key);
    if (index < 0) throw new OpenArDataError(`QBO aging column ${key} is missing.`);
    amounts[bucket] = arCents(arRecord(cells[index], 'Aging amount').value, 'Aging amount');
  }
  return { currency: arText(header.Currency, 'QBO currency'), amounts };
}

// Called only by the authenticated QBO host's explicit read-only refresh operation.
export async function loadQboOpenArSource(reader: Reader, scope: Scope, now = new Date()): Promise<OpenArReport> {
  const asOfDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [rawInvoices, rawClasses, rawCustomers, rawPayments, rawCredits, rawAging] = await Promise.all([
    list(reader, 'Invoice', "Balance > '0'"), list(reader, 'Class', 'Active IN (true, false)'),
    list(reader, 'Customer', 'Active IN (true, false)'), list(reader, 'Payment'), list(reader, 'CreditMemo'),
    reader.getReport('AgedReceivables', { report_date: asOfDate, aging_method: 'Report_Date', num_periods: '4', aging_period: '30' }, { signal: AbortSignal.timeout(45_000) }),
  ]);
  const aging = agingAmounts(rawAging, asOfDate);
  const checkCurrency = (row: Record<string, unknown>) => {
    const currency = optionalText(ref(row.CurrencyRef).value);
    if (currency && currency !== aging.currency) throw new OpenArDataError('Foreign-currency receivables require conversion before this report can be refreshed.');
    if (arDate(row.TxnDate, 'Transaction date') > asOfDate) throw new OpenArDataError('Future-dated receivables require review before this report can be refreshed.');
  };
  const customers = new Map(rawCustomers.map(row => [String(row.Id), optionalText(row.FullyQualifiedName) || optionalText(row.DisplayName)]));
  const classes: ArClass[] = rawClasses.map(row => ({
    id: arText(row.Id, 'Class ID'), name: arText(row.FullyQualifiedName || row.Name, 'Class name'),
    parentId: optionalText(ref(row.ParentRef).value), active: row.Active !== false,
  }));
  classes.push({ id: UNCLASSIFIED_AR, name: 'Unclassified', parentId: null, active: true });
  const invoices: ArInvoice[] = rawInvoices.map(row => {
    checkCurrency(row);
    const customer = ref(row.CustomerRef);
    const customerId = arText(customer.value, 'Invoice customer ID');
    const classIds = invoiceClasses(row);
    for (const id of classIds) if (!classes.some(row => row.id === id)) classes.push({ id, name: `Unknown class (${id})`, parentId: null, active: false });
    const id = arText(row.Id, 'Invoice ID');
    return {
      id, customerId, customerName: customers.get(customerId) || optionalText(customer.name) || `Customer ${customerId}`,
      number: optionalText(row.DocNumber) || `ID ${id}`, invoiceDate: arDate(row.TxnDate, 'Invoice date'),
      dueDate: row.DueDate == null ? null : arDate(row.DueDate, 'Due date'), balanceCents: arCents(row.Balance, 'Invoice balance'),
      totalCents: arCents(row.TotalAmt, 'Invoice total'), classIds,
    };
  });
  const paymentBalances = rawPayments.map(row => ({ row, amount: arCents(row.UnappliedAmt, 'Unapplied payment amount') })).filter(entry => entry.amount > 0);
  const creditBalances = rawCredits.map(row => ({ row, amount: arCents(row.RemainingCredit, 'Remaining credit amount') })).filter(entry => entry.amount > 0);
  for (const { row } of [...paymentBalances, ...creditBalances]) checkCurrency(row);
  return parseOpenArReport({
    version: 1, ...scope, generatedAt: now.toISOString(), asOfDate, currency: aging.currency,
    invoices, classes: classes.sort((a, b) => a.name.localeCompare(b.name)),
    unappliedPaymentCents: paymentBalances.reduce((sum, entry) => sum + entry.amount, 0), unappliedPaymentCount: paymentBalances.length,
    remainingCreditCents: creditBalances.reduce((sum, entry) => sum + entry.amount, 0), remainingCreditCount: creditBalances.length,
    qboAging: aging.amounts,
  });
}
