// All comparisons use signed integer cents. Display rounding never changes a match.
export function cents(value) {
  if (value == null || String(value).trim() === '' || !Number.isFinite(Number(value)))
    throw Error('Missing financial amount.');
  const result = Math.round(Math.abs(Number(value)) * 100 + 1e-7) * Math.sign(Number(value));
  if (!Number.isSafeInteger(result)) throw Error('Amount outside supported range.');
  return result;
}
export const money = (n) =>
  n == null ? 'Unavailable' : (n / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const sum = (rows, pick) => rows.reduce((n, row) => n + pick(row), 0);
const margin = (profit, sales) => (sales ? ((100 * profit) / sales).toFixed(2) + '%' : 'Unavailable');
const section = (title, columns, rows) => ({ title, columns, rows });

export function compareApplications(apps, invoices) {
  const used = new Set(),
    rows = [],
    issues = [];
  const groups = Map.groupBy(apps, (a) => a.date);
  for (const app of apps) {
    const sameDate = invoices.filter((i) => i.date === app.date);
    let candidates = sameDate.filter((i) => i.amount === app.amount);
    if (!candidates.length && sameDate.length === 1 && groups.get(app.date).length === 1) candidates = sameDate;
    const match =
      candidates.length === 1 &&
      !used.has(candidates[0].id) &&
      groups.get(app.date).filter((a) => a.amount === app.amount).length === 1
        ? candidates[0]
        : null;
    if (match) used.add(match.id);
    const diff = match ? match.amount - app.amount : null;
    if (!match || diff)
      issues.push(
        'AIA #' +
          app.number +
          (match ? ': invoice minus application ' + money(diff) : ': no unique invoice match.'),
      );
    rows.push([
      app.number,
      app.date,
      app.file + ' · ' + app.cell,
      money(app.amount),
      match?.number ?? 'Review',
      money(match?.amount),
      money(diff),
    ]);
  }
  for (const i of invoices.filter((i) => !used.has(i.id))) {
    issues.push('Invoice #' + i.number + ' has no confirmed AIA match.');
    rows.push(['—', i.date, '—', '—', i.number, money(i.amount), 'Review']);
  }
  return { rows, issues };
}

export function compareBills(projectId, headers, bills) {
  const groups = new Map(),
    manual = [],
    issues = [],
    rows = [];
  for (const h of headers) {
    const [billId, project, extra] = String(h.origin_id ?? '').split('|');
    if (!/^\d+$/.test(billId) || project !== projectId || extra !== undefined) {
      manual.push(h);
      continue;
    }
    const prior = groups.get(billId) ?? [];
    prior.push(h);
    groups.set(billId, prior);
  }
  for (const bill of bills) {
    const pro = groups.get(bill.id) ?? [];
    groups.delete(bill.id);
    const amount = sum(pro, (h) => cents(h.amount)),
      diff = bill.amount - amount;
    const status = !pro.length
      ? 'No linked direct cost'
      : pro.length > 1
        ? 'Multiple linked direct costs'
        : diff
          ? 'Amount differs'
          : 'Matched';
    if (status !== 'Matched')
      issues.push(
        'Bill #' + bill.number + ' (' + bill.vendor + '): ' + status + ', difference ' + money(diff) + '.',
      );
    rows.push([bill.number, bill.vendor, bill.date, money(bill.amount), money(amount), money(diff), status]);
  }
  for (const h of [...manual, ...[...groups.values()].flat()]) {
    issues.push('Check Procore direct cost ' + h.id + ' against the QBO bill detail.');
    rows.push([
      '—',
      h.description || 'Procore #' + h.id,
      '',
      '—',
      money(cents(h.amount)),
      '—',
      'Unmatched · verify supporting lines',
    ]);
  }
  return { issues, rows };
}

const budgetFields = [
  'original_budget_amount',
  'Approved Budget Changes',
  'Approved COs',
  'Pending COs',
  'Revised Budget',
  'Projected Budget',
  'Direct Costs',
  'Job to Date Costs',
  'Pending Cost Changes',
  'Projected Costs',
  'Estimated Cost at Completion',
  'Projected over Under',
];
export function budgetReview(summary, lines) {
  const ids = summary.budget_line_item_ids?.map(String);
  if (
    !ids ||
    !ids.length ||
    new Set(ids).size !== ids.length ||
    lines.length !== ids.length ||
    new Set(lines.map((r) => String(r.id))).size !== ids.length ||
    !lines.every((r) => ids.includes(String(r.id)))
  )
    throw Error('Standard Budget detail and summary rosters differ.');
  for (const f of budgetFields) {
    if (sum(lines, (r) => cents(r[f])) !== cents(summary[f]))
      throw Error('Standard Budget detail does not reconcile for ' + f + '.');
  }
  if (sum(lines, (r) => cents(r.budget_forecast?.amount)) !== cents(summary.budget_forecast?.amount))
    throw Error('Forecast detail does not reconcile.');
  const cleanup = [],
    overruns = [];
  for (const r of lines) {
    const code = r.wbs_code?.flat_code ?? '',
      description = r.wbs_code?.description ?? '';
    const forecast = cents(r.budget_forecast.amount);
    if (forecast)
      cleanup.push([
        code,
        description,
        String(r.id),
        'Set forecast to $0 after confirming no remaining cost',
        money(forecast),
        '$0.00',
      ]);
    else if (
      r.budgeted === true &&
      r.deletable === true &&
      budgetFields.every((f) => cents(r[f]) === 0) &&
      (!('Committed Costs' in r) || cents(r['Committed Costs']) === 0) &&
      !r.budget_notes &&
      !r.budget_forecast.notes
    ) {
      cleanup.push([
        code,
        description,
        String(r.id),
        'Delete candidate · verify no underlying activity in Procore',
        '$0.00',
        'Remove row',
      ]);
    }
    const variance = cents(r['Job to Date Costs']) - cents(r['Projected Budget']);
    if (variance > 0)
      overruns.push({
        variance,
        row: [
          code,
          description,
          money(cents(r['Projected Budget'])),
          money(cents(r['Job to Date Costs'])),
          money(variance),
        ],
      });
  }
  return { cleanup, overruns: overruns.sort((a, b) => b.variance - a.variance).map((r) => r.row) };
}

export function buildCloseout({ projectId, budget, lines, primes, changes, headers, qbo, aia, signed = [] }) {
  const { cleanup, overruns } = budgetReview(budget, lines);
  const issues = [...aia.issues],
    sections = [];
  const actual = cents(budget['Direct Costs']),
    projected = cents(budget['Projected Budget']),
    forecast = cents(budget.budget_forecast.amount);
  const estimate = cents(budget['Estimated Cost at Completion']),
    prime = primes.length ? sum(primes, (p) => cents(p.revised_contract_amount)) : null;
  const keys = new Set(lines.map((r) => String(r.wbs_code_id)));
  const decisions = new Map(signed.map((s) => [s.packageId, s]));
  let basis = prime;
  const changeRows = changes.map((change) => {
    const amount = cents(change.grand_total),
      decision = decisions.get(String(change.id));
    const delta = decision && change.status === 'approved' ? cents(decision.amount) - amount : 0;
    if (basis != null) basis += delta;
    const absent = (change.line_items ?? []).filter((l) => !keys.has(String(l.wbs_code?.id)));
    const missing = sum(absent, (l) => cents(l.total_amount));
    if (missing && change.status === 'approved')
      issues.push(
        'CO #' +
          change.number +
          ' ' +
          change.title +
          ': ' +
          money(missing) +
          ' has no matching Standard Budget row.',
      );
    if (delta)
      issues.push('CO #' + change.number + ' differs from reviewed signed amount by ' + money(delta) + '.');
    return [
      change.number,
      change.title,
      change.status,
      money(amount),
      decision ? money(cents(decision.amount)) : '—',
      decision?.reference || '',
      absent.length ? money(missing) : '—',
    ];
  });
  if (signed.some((s) => !changes.some((c) => String(c.id) === s.packageId && c.status === 'approved')))
    issues.push('A reviewed signed amount has no current approved change order. Verify its source.');
  if (prime == null) issues.push('Prime contract unavailable.');
  const { rows: billRows, issues: billIssues } = compareBills(projectId, headers, qbo.bills);
  const { rows: aiaRows, issues: aiaIssues } = compareApplications(aia.apps, qbo.invoices);
  issues.push(...billIssues, ...aiaIssues);
  const invoiceTotal = sum(qbo.invoices, (i) => i.amount),
    creditTotal = sum(qbo.credits, (i) => i.amount),
    net = invoiceTotal - creditTotal;
  const billTotal = sum(qbo.bills, (b) => b.amount);
  if (actual !== billTotal)
    issues.push('QBO bills minus Procore Direct Costs: ' + money(billTotal - actual) + '.');
  if (qbo.cost !== billTotal) issues.push('QBO has other posted costs of ' + money(qbo.cost - billTotal) + '.');
  if (net !== qbo.sales) issues.push('Net invoices differ from QBO P&L sales by ' + money(net - qbo.sales) + '.');
  if (basis != null && net !== basis)
    issues.push('Net billing minus signed contract basis: ' + money(net - basis) + '.');
  if (cleanup.length) issues.push(cleanup.length + ' proposed budget cleanup item(s) to review.');
  if (overruns.length) issues.push(overruns.length + ' budget line(s) have actual costs above Projected Budget.');
  const enteredBudget =
    cents(budget.original_budget_amount) +
    sum(
      changes.filter((c) => c.status === 'approved'),
      (c) => cents(c.grand_total),
    );
  sections.push(
    section(
      'Profit and margin',
      ['Basis', 'Revenue / budget', 'Cost', 'Profit / over-under', 'Margin'],
      [
        ['QBO P&L', money(qbo.sales), money(qbo.cost), money(qbo.profit), margin(qbo.profit, qbo.sales)],
        [
          'Signed contract basis',
          money(basis),
          money(actual),
          money(basis == null ? null : basis - actual),
          basis == null ? 'Unavailable' : margin(basis - actual, basis),
        ],
        [
          'Procore revised prime contract',
          money(prime),
          money(actual),
          money(prime == null ? null : prime - actual),
          prime == null ? 'Unavailable' : margin(prime - actual, prime),
        ],
        [
          'Original budget + approved prime COs as entered',
          money(enteredBudget),
          money(actual),
          money(enteredBudget - actual),
          margin(enteredBudget - actual, enteredBudget),
        ],
        [
          'Procore Standard Budget · Projected Budget',
          money(projected),
          money(estimate),
          money(projected - estimate),
          margin(projected - estimate, projected),
        ],
      ],
    ),
  );
  const creditOrders = changes.filter((c) => c.status === 'approved' && cents(c.grand_total) < 0);
  const creditRows = qbo.credits.map((c) => {
    const matches = creditOrders.filter((o) => -cents(o.grand_total) === c.amount);
    const unique = matches.length === 1 && qbo.credits.filter((other) => other.amount === c.amount).length === 1;
    if (!unique) issues.push('Credit memo #' + c.number + ' needs supporting Procore or AIA documentation.');
    return [
      c.number,
      c.date,
      money(-c.amount),
      unique ? '#' + matches[0].number + ' ' + matches[0].title : 'Review supporting documents',
      unique ? money(cents(matches[0].grand_total)) : '—',
    ];
  });
  const open = sum(qbo.invoices, (i) => i.balance),
    credits = sum(qbo.credits, (i) => i.balance);
  sections.push(
    section(
      'Reconciliation',
      ['Measure', 'Amount'],
      [
        ['Direct Costs in Procore', money(actual)],
        ['Project costs on QBO bills', money(billTotal)],
        ['QBO bills minus Procore costs', money(billTotal - actual)],
        ['Forecast to Complete', money(forecast)],
        [
          'AIA current payments due (files read)',
          aia.apps.length ? money(sum(aia.apps, (a) => a.amount)) : 'Unavailable',
        ],
        ['QBO gross invoices', money(invoiceTotal)],
        [
          'Gross invoices less AIA payments due',
          aia.complete ? money(invoiceTotal - sum(aia.apps, (a) => a.amount)) : 'Unavailable',
        ],
        ['Credit memos issued', money(creditTotal)],
        ['Net billing', money(net)],
        ['Projected Budget less net billing', money(projected - net)],
        ['Open invoices', money(open)],
        ['Open credits', money(credits)],
        ['Open invoices less open credits', money(open - credits)],
      ],
    ),
    section(
      'Budget cleanup proposals',
      ['Budget code', 'Description', 'Procore row', 'Proposed action', 'Before', 'After'],
      cleanup,
    ),
    section(
      'Budget overruns',
      ['Budget code', 'Description', 'Projected Budget', 'Job to Date Costs', 'Over budget'],
      overruns,
    ),
    section(
      'Bills and direct costs',
      ['QBO bill', 'Vendor / description', 'Date', 'QBO', 'Procore', 'QBO minus Procore', 'Result'],
      billRows,
    ),
    section(
      'AIA applications and invoices',
      [
        'Application',
        'Period ending',
        'Source',
        'Current payment due',
        'QBO invoice',
        'Invoice amount',
        'Difference',
      ],
      aiaRows,
    ),
    section(
      'Invoice and credit balances',
      ['Type', 'Number', 'Date', 'Amount', 'Open'],
      [
        ...qbo.invoices.map((i) => ['Invoice', i.number, i.date, money(i.amount), money(i.balance)]),
        ...qbo.credits.map((i) => ['Credit memo', i.number, i.date, money(i.amount), money(i.balance)]),
      ],
    ),
    section(
      'Credit memos and approved deductions',
      ['QBO credit memo', 'Date', 'Credit issued', 'Procore candidate by amount', 'Approved deduction'],
      creditRows,
    ),
    section(
      'Other QBO costs',
      ['Transaction', 'Number', 'Date', 'Name', 'Amount'],
      (qbo.otherCosts ?? []).map((t) => [t.type, t.number, t.date, t.vendor, money(t.amount)]),
    ),
    section(
      'Prime contract change orders',
      ['CO', 'Description', 'Status', 'Procore', 'Signed amount reviewed', 'Evidence', 'Outside budget rows'],
      changeRows,
    ),
    section(
      'AIA schedule of values',
      ['Description', 'Scheduled value'],
      aia.schedule.map((r) => [r.description, money(r.amount)]),
    ),
  );
  return { issues, sections, complete: aia.complete, cleanupCount: cleanup.length };
}
