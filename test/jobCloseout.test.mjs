import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetReview, buildCloseout, compareApplications, compareBills } from '../src/lib/jobCloseout.mjs';
import { changeCloseout } from '../src/lib/jobCloseoutStore.mjs';
import { readApplication } from '../scripts/lib/jobCloseoutAia.mjs';
import { apiPagePermissions } from '../src/lib/independentPagePermissions.js';
import { resolvePermissionForPath } from '../src/lib/permissionRoutes.js';

const zeros = Object.fromEntries(
  [
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
  ].map((k) => [k, '0.00']),
);
const row = {
  ...zeros,
  id: '101',
  wbs_code_id: 'w',
  budgeted: true,
  deletable: true,
  budget_forecast: { amount: 0 },
};
const summary = { ...row, budget_line_item_ids: ['101'] };
test('proposals require a full roster, zero activity, and a deletable row', () => {
  assert.equal(budgetReview(summary, [row]).cleanup.length, 1);
  assert.equal(budgetReview(summary, [{ ...row, deletable: false }]).cleanup.length, 0);
  assert.equal(budgetReview(summary, [{ ...row, budget_notes: 'retain' }]).cleanup.length, 0);
  assert.throws(() => budgetReview(summary, []), /rosters/);
  const forecast = { amount: 23 };
  assert.match(
    budgetReview({ ...summary, budget_forecast: forecast }, [{ ...row, budget_forecast: forecast }]).cleanup[0][3],
    /Set forecast/,
  );
});
test('displayed AIA cents, shifted payment label and dates survive reading', () => {
  const book = {
    SheetNames: ['Application for Payment'],
    Sheets: {
      'Application for Payment': {
        V2: { v: 4 },
        V3: { v: 46000 },
        B35: { t: 's', v: '8. CURRENT PAYMENT DUE' },
        I35: { t: 'n', v: 10.125, w: '$10.12' },
      },
    },
  };
  const app = readApplication(book, 'April.xls');
  assert.equal(app.amount, 1012);
  assert.match(app.cell, /I35/);
  const inv = { id: '1', number: '12', date: app.date, amount: 1013 };
  assert.match(compareApplications([app], [inv]).issues.join(' '), /\$0.01/);
  assert.match(compareApplications([app], [inv, { ...inv, id: '2' }]).issues.join(' '), /no unique/);
});
test('unlinked manual offsets cannot clear an individual bill by amount alone', () => {
  const result = compareBills('12', [{ id: 'x', amount: 10 }], [{ id: '11', amount: 1000, number: 'A' }]);
  assert.equal(result.issues.length, 2);
  assert.equal(
    compareBills('12', [{ id: 'x', origin_id: '11|12', amount: 10 }], [{ id: '11', amount: 1000, number: 'A' }])
      .issues.length,
    0,
  );
});
test('gross invoices, credits, signed adjustments, and profit margins have separate bases', () => {
  const report = buildCloseout({
    projectId: '12',
    budget: summary,
    lines: [row],
    primes: [{ revised_contract_amount: 80 }],
    changes: [{ id: 'c', number: '1', title: 'Deduction', status: 'approved', grand_total: -20, line_items: [] }],
    headers: [],
    qbo: {
      cost: 6000,
      sales: 8000,
      profit: 2000,
      bills: [],
      invoices: [{ date: '2026-01-01', number: '1', amount: 10000, balance: 4000 }],
      credits: [{ number: '2', amount: 2000, balance: 2000 }],
    },
    aia: { apps: [], issues: ['Missing AIA'], complete: false, schedule: [] },
    signed: [{ packageId: 'c', amount: -19, reference: 'signed CO' }],
  });
  assert.equal(report.complete, false);
  const rows = report.sections.find((s) => s.title === 'Profit and margin').rows;
  assert.equal(rows[0].at(-1), '25.00%');
  assert.equal(rows[1][1], '$81.00');
  assert.ok(
    report.sections
      .find((s) => s.title === 'Reconciliation')
      .rows.some(([k, v]) => k === 'Net billing' && v === '$80.00'),
  );
});
test('signoff checks current PM cycle, revision, sources, cleanup and accepted variances', async () => {
  let saved = 0;
  const run = {
    id: 'abc',
    state: 'ready',
    report: { complete: true, cleanupCount: 0, issues: ['Penny difference'] },
  };
  const tx = {
    $queryRaw: async () => [{ id: 'r', completion_count: 2 }],
    jobCloseoutRun: { findFirst: async () => run, updateMany: async () => ({ count: ++saved }) },
  };
  const db = { $transaction: (operate) => operate(tx) };
  const input = { action: 'close', projectId: '123', cycle: 2, runId: 'abc', note: 'Reviewed rounding.' };
  for (const bad of [{ cycle: 1 }, { runId: 'older' }, { note: '' }])
    assert.equal(await changeCloseout(db, '9', 'reviewer', { ...input, ...bad }), false);
  run.report.complete = false;
  assert.equal(await changeCloseout(db, '9', 'reviewer', input), false);
  run.report.complete = true;
  run.report.cleanupCount = 1;
  assert.equal(await changeCloseout(db, '9', 'reviewer', input), false);
  run.report.cleanupCount = 0;
  assert.equal(await changeCloseout(db, '9', 'reviewer', input), true);
});
test('both API methods and Help require the closeout permission', () => {
  for (const method of ['GET', 'POST'])
    assert.deepEqual(apiPagePermissions('/api/accounting/job-closeout', method), [
      'page:/accounting/job-closeout',
    ]);
  for (const path of ['/accounting/job-closeout', '/help/job-closeout', '/api/accounting/job-closeout'])
    assert.equal(resolvePermissionForPath(path), 'job-closeout');
});
