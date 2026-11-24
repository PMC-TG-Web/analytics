import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetReview, buildCloseout, compareApplications, compareBills } from '../src/lib/jobCloseout.mjs';
import { changeCloseout, closeoutFolder, CloseoutFolderError } from '../src/lib/jobCloseoutStore.mjs';
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
test('customized Standard Budget uses visible cost columns without converting missing source values into zero', () => {
  const custom = { ...row, 'Direct Costs': 12 };
  for (const field of ['Job to Date Costs', 'Pending Cost Changes', 'Revised Budget']) delete custom[field];
  const totals = { ...custom, budget_line_item_ids: ['101'] };
  assert.equal(budgetReview(totals, [custom]).actualColumn, 'Direct Costs');
  assert.equal(budgetReview(totals, [custom]).overruns[0][3], '$12.00');
  assert.throws(() => budgetReview(totals, [{ ...custom, 'Direct Costs': null }]), /Incomplete budget column/);
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
test('undated negative payment stays in the report and reconciles only to a unique credit memo', () => {
  const sheet = {
    V2: { v: 3 },
    A31: { t: 's', v: 'Current Payment Due' },
    I31: { t: 'n', v: -12.305, w: '-12.31' },
  };
  const book = { SheetNames: ['Application for Payment'], Sheets: { 'Application for Payment': sheet } };
  const app = readApplication(book, 'Credit.xlsx');
  assert.equal(app.date, null);
  const memo = { id: 'c1', number: '200', date: '2026-08-04', amount: 1231 };
  const invoice = { ...memo, id: 'i1' };
  const result = compareApplications([app], [invoice], [memo]);
  assert.deepEqual(result.evidenceIssues, []);
  assert.deepEqual(result.rows[0].slice(3), ['-$12.31', 'Credit memo #200', '2026-08-04', '-$12.31', '$0.00']);
  assert.match(result.issues.join(' '), /blank Period To/);
  for (const candidates of [[], [memo, { ...memo, id: 'c2' }]]) {
    assert.equal(compareApplications([app], [invoice], candidates).evidenceIssues.length, 1);
  }
  assert.equal(compareApplications([app, { ...app, number: '4' }], [], [memo]).evidenceIssues.length, 2);
  sheet.V3 = { v: 'bad' };
  assert.throws(() => readApplication(book, 'Credit.xlsx'), /Period To/);
});

test('AIA credits reduce net applications without reducing the gross invoice comparison', () => {
  const app = { number: '1', date: '2026-08-01', file: 'One.xlsx', cell: 'I31', amount: 10000 };
  const credit = { ...app, number: '2', file: 'Two.xlsx', date: null, amount: -1000 };
  const input = {
    projectId: '12',
    budget: summary,
    lines: [row],
    primes: [],
    changes: [],
    headers: [],
    qbo: {
      cost: 0,
      sales: 9000,
      profit: 9000,
      bills: [],
      invoices: [{ id: 'i', number: '88', date: app.date, amount: 10000, balance: 0 }],
      credits: [{ id: 'c', number: '89', date: '2026-08-04', amount: 1000, balance: 0 }],
    },
    aia: { apps: [app, credit], issues: [], complete: true, schedule: [] },
  };
  const report = buildCloseout(input);
  const measures = Object.fromEntries(report.sections.find((s) => s.title === 'Reconciliation').rows);
  assert.equal(report.complete, true);
  assert.equal(measures['Net AIA current payments due (files read)'], '$90.00');
  assert.equal(measures['Gross invoices less positive AIA applications'], '$0.00');
  const pending = buildCloseout({ ...input, qbo: { ...input.qbo, credits: [] } });
  assert.equal(pending.complete, false);
  assert.match(pending.aiaEvidenceIssues[0], /Two.xlsx/);
});

test('direct cost discrepancies retain the record and line amounts for review', async () => {
  const { checkDirectCostLines } = await import('../src/lib/jobCloseout.mjs');
  const lines = [{ project: { id: '12' }, holder: { id: 31 }, amount: 7 }];
  assert.deepEqual(checkDirectCostLines('12', [{ id: 31, status: 'approved', amount: 8 }], lines), [
    ['31', 'approved', '$8.00', '$7.00', '-$1.00'],
  ]);
  assert.throws(() => checkDirectCostLines('99', [], lines), /another project/);
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
test('a refresh saves the portable project folder from an Explorer path', async () => {
  const folder = 'Contractor/Completed/Project';
  const absolute = '"C:\\Users\\Estimator\\Sales\\AIA Documents\\Contractor\\Completed\\Project"';
  for (const input of [
    absolute,
    '\\\\server\\sales\\aia documents\\' + folder + '\\',
    'AIA Documents/' + folder,
    folder,
  ]) {
    assert.equal(closeoutFolder(input), folder);
  }
  for (const input of [
    'C:\\Other\\Project',
    'C:\\Sales\\AIA Documents',
    'Contractor\\..\\Outside',
    'C:\\AIA Documents\\file.xlsx',
  ]) {
    assert.throws(() => closeoutFolder(input), CloseoutFolderError);
  }
  assert.equal(closeoutFolder(' '), null);
  let created;
  const tx = {
    $queryRaw: async () => [{ id: 'r', completion_count: 1 }],
    jobCloseoutRun: {
      findFirst: async () => ({ id: 'old', revision: 1, state: 'partial' }),
      create: async ({ data }) => {
        created = data;
      },
    },
  };
  const db = { $transaction: (action) => action(tx) };
  assert.equal(
    await changeCloseout(db, '9', 'office', {
      projectId: '123',
      runId: 'old',
      cycle: 1,
      action: 'refresh',
      folder: absolute,
    }),
    true,
  );
  assert.equal(created.folder, folder);
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
