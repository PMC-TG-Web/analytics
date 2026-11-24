import path from 'node:path';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { cents } from '../../src/lib/jobCloseout.mjs';

export function parseProfitAndLoss(report, customer) {
  if (
    report.Header?.Customer !== customer ||
    report.Header.ReportBasis !== 'Accrual' ||
    report.Header.Currency !== 'USD'
  )
    throw Error('Unexpected QBO report scope.');
  const columns = report.Columns.Column.map((c) => c.ColType);
  const [type, number, date, vendor, amount, balance] = [
    'txn_type',
    'doc_num',
    'tx_date',
    'name',
    'subt_nat_amount',
    'rbal_nat_amount',
  ].map((k) => columns.indexOf(k));
  if ([type, number, date, vendor, amount, balance].includes(-1))
    throw Error('QBO detail report columns changed.');
  const bills = new Map(),
    otherCosts = [];
  let sales = 0,
    cost = 0,
    otherIncome = 0,
    net = null;
  function visit(row, group) {
    const heading = row.Header?.ColData?.[0]?.value;
    if (['Income', 'Cost of Goods Sold', 'Expenses', 'Other Expenses', 'Other Income'].includes(heading))
      group = heading;
    const cols = row.ColData;
    if (cols) {
      const value = cents(cols[amount]?.value);
      if (group === 'Income') sales += value;
      else if (group === 'Other Income') otherIncome += value;
      else if (['Cost of Goods Sold', 'Expenses', 'Other Expenses'].includes(group)) {
        cost += value;
        if (cols[type].value === 'Bill') {
          const id = cols[type].id;
          if (!id) throw Error('Bill detail has no transaction ID.');
          const bill = bills.get(id) ?? {
            id,
            number: cols[number].value || id,
            date: cols[date].value,
            vendor: cols[vendor].value,
            amount: 0,
          };
          bill.amount += value;
          bills.set(id, bill);
        } else if (value)
          otherCosts.push({
            type: cols[type].value,
            number: cols[number].value || cols[type].id,
            date: cols[date].value,
            vendor: cols[vendor].value,
            amount: value,
          });
      } else if (value) throw Error('Unrecognized QBO detail section.');
    }
    for (const child of row.Rows?.Row ?? []) visit(child, group);
    if (row.Summary?.ColData?.[0]?.value === 'Net Income')
      net = cents(row.Summary.ColData[balance]?.value || row.Summary.ColData[amount]?.value);
  }
  for (const row of report.Rows?.Row ?? []) visit(row, '');
  const profit = sales + otherIncome - cost;
  if (net !== profit) throw Error('Project P&L detail does not tie to reported net income.');
  return { sales, cost, profit, bills: [...bills.values()], otherCosts };
}

async function readQbo(customer, company) {
  if (!/^\d+$/.test(customer)) throw Error('Invalid project customer ID.');
  dotenv.config({ quiet: true });
  const mod = (name) => import(pathToFileURL(path.resolve('src', name + '.js')));
  const store = await mod('token-store'),
    { IntuitClient } = await mod('intuit-client');
  let token = await store.readTokenRecord();
  if (
    !token ||
    process.env.INTUIT_ENVIRONMENT !== 'production' ||
    process.env.QBO_BILL_ALLOWED_REALM_ID !== String(token.realmId) ||
    process.env.PROCORE_COMPANY_ID !== company
  )
    throw Error('QBO host company configuration mismatch.');
  if (store.isTokenExpired(token)) {
    const { refreshAccessToken } = await mod('oauth');
    const renewed = await refreshAccessToken({
      clientId: process.env.INTUIT_CLIENT_ID,
      clientSecret: process.env.INTUIT_CLIENT_SECRET,
      refreshToken: token.refreshToken,
    });
    token = store.normalizeTokenRecord(renewed, token.realmId);
    await store.writeTokenRecord(token);
  }
  const client = new IntuitClient({
    accessToken: token.accessToken,
    realmId: token.realmId,
    environment: 'production',
  });
  const end = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const report = await client.getReport('ProfitAndLossDetail', {
    customer,
    start_date: '2000-01-01',
    end_date: end,
    accounting_method: 'Accrual',
    sort_by: 'created_time',
    sort_order: 'asc',
  });
  async function documents(entity) {
    const rows = [],
      seen = new Set();
    for (let offset = 1; offset <= 100001; offset += 100) {
      const result = await client.query(
        'select * from ' +
          entity +
          " where CustomerRef = '" +
          customer +
          "' and TxnDate <= '" +
          end +
          "' order by Id startposition " +
          offset +
          ' maxresults 100',
      );
      if (!result.QueryResponse) throw Error('Missing QBO response.');
      const batch = result.QueryResponse[entity] ?? [];
      for (const item of batch) {
        if (
          !item.Id ||
          seen.has(item.Id) ||
          item.CustomerRef?.value !== customer ||
          (item.CurrencyRef && item.CurrencyRef.value !== 'USD')
        )
          throw Error('Unexpected invoice or credit scope.');
        seen.add(item.Id);
        rows.push({
          id: item.Id,
          number: item.DocNumber || item.Id,
          date: item.TxnDate,
          amount: cents(item.TotalAmt),
          balance: cents(item.Balance ?? item.RemainingCredit),
        });
      }
      if (batch.length < 100) return rows;
    }
    throw Error('Incomplete QBO document list.');
  }
  return {
    ...parseProfitAndLoss(report, customer),
    invoices: await documents('Invoice'),
    credits: await documents('CreditMemo'),
  };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.stdout.write(JSON.stringify(await readQbo(process.argv[2], process.argv[3])));
  } catch (error) {
    console.error(
      'QBO read failed. ' +
        (error.status ? 'HTTP ' + error.status + ' ' + (error.errorCodes ?? []).join(',') : error.message),
    );
    process.exitCode = 1;
  }
}
