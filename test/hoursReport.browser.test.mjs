import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { buildHoursReport, hoursTotals } from '../src/lib/hoursReport.ts';

const enabled = process.env.HOURS_REPORT_BROWSER_TEST === '1';
const base = 'http://localhost:3000';
async function open() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.context().addCookies([{ name: 'dev_user_email', value: 'todd@pmcdecor.com', url: base, sameSite: 'Lax' }]);
  return { browser, page };
}
function fixture() {
  const row = { id: 't1', sourceId: 't1', companyId: 'fixture', projectId: 'p1', source: 'Timecard', date: '2026-11-05',
    updatedAt: '2026-11-05T12:00:00Z', quantity: 8, worker: 'Test Worker', costCode: 'labor', description: 'Foundation labor', notes: 'East wing', status: 'Approved' };
  return buildHoursReport('fixture', { from: '', through: '' }, [
    { procoreProjectId: 'p1', projectName: 'Test project', projectNumber: '001' },
    { procoreProjectId: 'p2', projectName: 'Second project', projectNumber: '002' },
  ], [row, { ...row, id: 'p1', sourceId: 'p1', source: 'Daily log', quantity: 4, uom: 'HR', costType: 'L', metadataMatches: 1, worker: null },
    { ...row, id: 'review', sourceId: 'review', source: 'Daily log', metadataMatches: 0 },
    ...Array.from({ length: 104 }, (_, i) => ({ ...row, id: `other${i}`, sourceId: `other${i}`, projectId: 'p2', description: 'Wall labor', notes: '', quantity: 1 }))]);
}

test('filters, totals, paging, full CSV, date-change handling, errors and responsive layout', { skip: !enabled, timeout: 120_000 }, async () => {
  const { browser, page } = await open(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  let mode = 'success';
  await page.route('**/api/reporting/hours?*', route => mode === 'error'
    ? route.fulfill({ status: 503, json: { error: 'Unable to load hours. Please retry.' } })
    : route.fulfill({ json: mode === 'empty' ? { ...fixture(), entries: [], review: [] } : fixture() }));
  const total = label => page.getByRole('article').filter({ has: page.getByText(label, { exact: true }) }).locator('strong');
  try {
    await page.goto(`${base}/reporting/hours`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'All Hours', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Run report', exact: true }).click();
    await page.getByRole('heading', { name: 'Hour entries', exact: true }).waitFor();
    assert.equal(await total('Combined hours').innerText(), '116');
    assert.equal(await page.getByRole('row').count(), 102, '100 visible hour rows plus headings and column filters');
    const download = page.getByRole('button', { name: 'Download CSV', exact: true });
    const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);
    assert.equal((await readFile(await file.path(), 'utf8')).split('\r\n').length, 107);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    assert.match(await page.getByText(/matching entries · Page/).innerText(), /Page 2 of 2/);
    await page.getByLabel('Description or notes').fill('EAST');
    assert.equal(await total('Combined hours').innerText(), '12');
    assert.equal(await total('Timecard hours').innerText(), '8');
    assert.equal(await total('Productivity hours').innerText(), '4');
    await page.getByLabel('Description match', { exact: true }).selectOption('not-contains');
    assert.equal(await total('Combined hours').innerText(), '104');
    assert.equal(await page.getByText(/Needs review:/).count(), 0);
    const [excludedFile] = await Promise.all([page.waitForEvent('download'), download.click()]);
    const excludedCsv = await readFile(await excludedFile.path(), 'utf8');
    assert.equal(excludedCsv.split('\r\n').length, 105); assert.doesNotMatch(excludedCsv, /East wing/);
    await page.getByLabel('Description or notes').fill('');
    assert.equal(await total('Combined hours').innerText(), '116', 'empty exclusion includes all rows');
    await page.getByLabel('Description match', { exact: true }).selectOption('contains');
    await page.getByLabel('Description or notes').fill('EAST');
    await page.getByLabel('Worker match', { exact: true }).selectOption('not-contains');
    await page.getByLabel('Filter worker', { exact: true }).fill('TEST');
    assert.equal(await total('Combined hours').innerText(), '4');
    await page.getByLabel('Filter worker', { exact: true }).fill('');
    await page.getByLabel('Worker match', { exact: true }).selectOption('contains');
    await page.getByLabel('Cost code match', { exact: true }).selectOption('not-contains');
    await page.getByLabel('Filter cost code', { exact: true }).fill('LAB');
    assert.equal(await total('Combined hours').innerText(), '0');
    await page.getByLabel('Filter cost code', { exact: true }).fill('');
    await page.getByLabel('Cost code match', { exact: true }).selectOption('contains');
    await page.getByLabel('Status match', { exact: true }).selectOption('not-contains');
    await page.getByLabel('Filter status or source ID').fill('t1');
    assert.equal(await total('Combined hours').innerText(), '4');
    await page.getByRole('button', { name: 'Clear column filters', exact: true }).click();
    for (const label of ['Description match', 'Worker match', 'Cost code match', 'Status match']) assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), 'contains');
    assert.equal(await total('Combined hours').innerText(), '116');
    assert.equal(await page.getByRole('button', { name: 'Clear column filters', exact: true }).isDisabled(), true);
    await page.getByLabel('Description or notes').fill('EAST');
    await page.getByLabel('Source', { exact: true }).selectOption('Productivity');
    assert.equal(await total('Combined hours').innerText(), '4');
    const [filtered] = await Promise.all([page.waitForEvent('download'), download.click()]);
    const csv = await readFile(await filtered.path(), 'utf8'); assert.equal(csv.split('\r\n').length, 2); assert.match(csv, /Productivity/);
    await page.getByLabel('Source', { exact: true }).selectOption('');
    await page.getByLabel('Project', { exact: true }).selectOption('p2');
    await page.getByText('No hours match these filters.', { exact: true }).waitFor();
    await page.getByLabel('Project', { exact: true }).selectOption('');
    await page.getByLabel('Filter worker', { exact: true }).fill('TEST');
    await page.getByLabel('Filter cost code', { exact: true }).fill('LAB');
    await page.getByLabel('Filter status or source ID').fill('approved');
    assert.equal(await total('Combined hours').innerText(), '8');
    await page.getByLabel('Minimum hours', { exact: true }).fill('8');
    await page.getByLabel('Maximum hours', { exact: true }).fill('8');
    assert.equal(await total('Combined hours').innerText(), '8');
    await page.getByLabel('Minimum hours', { exact: true }).fill('9');
    await page.getByRole('alert').filter({ hasText: 'Minimum hours' }).waitFor();
    assert.equal(await total('Combined hours').innerText(), '—');
    assert.equal(await download.isDisabled(), true);
    await page.getByLabel('Minimum hours', { exact: true }).fill('');
    await page.getByLabel('Maximum hours', { exact: true }).fill('4');
    await page.getByLabel('Filter worker', { exact: true }).fill('');
    assert.equal(await total('Combined hours').innerText(), '4');
    await page.getByLabel('Filter work date from', { exact: true }).fill('2026-11-06');
    assert.equal(await total('Combined hours').innerText(), '0');
    await page.getByLabel('Filter work date through', { exact: true }).fill('2026-11-05');
    await page.getByRole('alert').filter({ hasText: 'Work date filter' }).waitFor();
    await page.getByLabel('Filter work date from', { exact: true }).fill('2026-11-05');
    assert.equal(await total('Combined hours').innerText(), '4');
    await page.getByRole('button', { name: 'Clear column filters', exact: true }).click();
    assert.equal(await total('Combined hours').innerText(), '116');
    assert.match(await page.getByText(/matching entries · Page/).innerText(), /Page 1 of 2/);
    await page.getByLabel('Description or notes').fill('EAST');
    await page.getByLabel('From work date', { exact: true }).fill('2026-11-01');
    assert.equal(await download.isDisabled(), true);
    await page.getByRole('button', { name: 'All dates', exact: true }).click();
    assert.equal(await download.isDisabled(), false);
    await page.getByText('Needs review: 1 entry excluded from hours', { exact: true }).click();
    await mkdir('.tmp/hours-report-check', { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: '.tmp/hours-report-check/desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page-wide horizontal overflow');
    await page.screenshot({ path: '.tmp/hours-report-check/mobile.png', fullPage: true });
    mode = 'error'; await page.getByRole('button', { name: 'Run report', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Unable to load hours' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Hour entries', exact: true }).count(), 0);
    mode = 'empty'; await page.getByRole('button', { name: 'Run report', exact: true }).click();
    await page.getByText('No hours match these filters.', { exact: true }).waitFor();
    assert.equal(await total('Combined hours').innerText(), '0');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('subcontractor description filters include and exclude both sources using Billing Analytics labels', { skip: !enabled, timeout: 120_000 }, async () => {
  const { browser, page } = await open();
  const row = { id: 'sub', sourceId: 'sub', companyId: 'fixture', projectId: 'p1', source: 'Timecard', date: '2026-11-05',
    updatedAt: '2026-11-05T12:00:00Z', quantity: 8, worker: 'Sub Contractor', description: 'Labor SOG Concrete', status: 'Approved' };
  const report = buildHoursReport('fixture', { from: '', through: '' }, [], [row,
    { ...row, id: 'named', sourceId: 'named', notes: 'Example vendor hourly sub labor', description: 'Labor Site Concrete', quantity: 4 },
    { ...row, id: 'productivity', sourceId: 'productivity', source: 'Daily log', description: 'Subcontractor Hours', costType: 'S', uom: 'LS', metadataMatches: 1, quantity: 6, worker: null },
    { ...row, id: 'employee', sourceId: 'employee', worker: 'Employee', quantity: 2 },
  ]);
  await page.route('**/api/reporting/hours?*', route => route.fulfill({ json: report }));
  const total = () => page.getByRole('article').filter({ has: page.getByText('Combined hours', { exact: true }) }).locator('strong').innerText();
  try {
    await page.goto(`${base}/reporting/hours`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Run report', exact: true }).click();
    await page.getByRole('heading', { name: 'Hour entries', exact: true }).waitFor();
    await page.getByLabel('Subcontractor labor', { exact: true }).selectOption('only');
    assert.equal(await total(), '18');
    await page.getByLabel('Source', { exact: true }).selectOption('Productivity');
    assert.equal(await total(), '6');
    await page.getByLabel('Source', { exact: true }).selectOption('');
    await page.getByLabel('Subcontractor labor', { exact: true }).selectOption('exclude');
    assert.equal(await total(), '2');
    const [selectionFile] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV', exact: true }).click()]);
    const selectionCsv = await readFile(await selectionFile.path(), 'utf8');
    assert.equal(selectionCsv.split('\r\n').length, 2); assert.doesNotMatch(selectionCsv, /"Subcontractor"/);
    await page.getByRole('button', { name: 'Clear column filters', exact: true }).click();
    assert.equal(await page.getByLabel('Subcontractor labor', { exact: true }).inputValue(), '');
    assert.equal(await total(), '20');
    await page.getByLabel('Description or notes').fill('Sub contractor labor');
    assert.equal(await total(), '18');
    await page.getByLabel('Description match', { exact: true }).selectOption('not-contains');
    assert.equal(await total(), '2');
    await page.getByLabel('Description match', { exact: true }).selectOption('contains');
    await page.getByLabel('Description or notes').fill('Sub Contractor');
    assert.equal(await total(), '18');
    assert.equal(await page.getByText('Work: Labor SOG Concrete', { exact: true }).count(), 1);
    assert.equal(await page.getByText('Worker: Sub Contractor', { exact: true }).count(), 1);
    await page.getByLabel('Description match', { exact: true }).selectOption('not-contains');
    assert.equal(await total(), '2');
    const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV', exact: true }).click()]);
    const csv = await readFile(await file.path(), 'utf8'); assert.equal(csv.split('\r\n').length, 2); assert.doesNotMatch(csv, /Sub Contractor|Subcontractor Hours/);
    await page.getByLabel('Description or notes').fill('subcontractor');
    assert.equal(await total(), '2');
    await page.getByLabel('Description match', { exact: true }).selectOption('contains');
    await page.getByLabel('Description or notes').fill('Example vendor');
    assert.equal(await total(), '4');
  } finally { await browser.close(); }
});

test('billable selection distinguishes false and unknown, updates CSV and review rows, and clears to all', { skip: !enabled, timeout: 120_000 }, async () => {
  const { browser, page } = await open();
  const row = { id: 'yes', sourceId: 'yes', companyId: 'fixture', projectId: 'p1', source: 'Timecard', date: '2026-11-05',
    updatedAt: '2026-11-05T12:00:00Z', quantity: 8, worker: 'Test Worker', description: 'Foundation labor', billable: true };
  const report = buildHoursReport('fixture', { from: '', through: '' }, [], [row,
    { ...row, id: 'no', sourceId: 'no', billable: false, quantity: 2 },
    { ...row, id: 'unknown', sourceId: 'unknown', billable: null, quantity: 1 },
    { ...row, id: 'productivity', sourceId: 'productivity', source: 'Daily log', uom: 'HR', costType: 'L', metadataMatches: 1, quantity: 4 },
    { ...row, id: 'review', sourceId: 'review', quantity: null },
  ]);
  await page.route('**/api/reporting/hours?*', route => route.fulfill({ json: report }));
  const total = () => page.getByRole('article').filter({ has: page.getByText('Combined hours', { exact: true }) }).locator('strong').innerText();
  try {
    await page.goto(`${base}/reporting/hours`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Run report', exact: true }).click();
    await page.getByRole('heading', { name: 'Hour entries', exact: true }).waitFor();
    const filter = page.getByLabel('Billable', { exact: true });
    assert.equal(await total(), '15');
    await filter.selectOption('not-billable');
    assert.equal(await total(), '2');
    assert.equal(await page.getByRole('cell', { name: 'No', exact: true }).count(), 1);
    assert.equal(await page.getByText(/Needs review:/).count(), 0);
    const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV', exact: true }).click()]);
    const csv = (await readFile(await file.path(), 'utf8')).split('\r\n');
    assert.equal(csv.length, 2); assert.ok(csv[0].endsWith(',"Billable"')); assert.ok(csv[1].endsWith(',"No"'));
    await filter.selectOption('billable');
    assert.equal(await total(), '8');
    await page.getByText('Needs review: 1 entry excluded from hours', { exact: true }).waitFor();
    await filter.selectOption('not-recorded');
    assert.equal(await total(), '5');
    await page.getByLabel('Source', { exact: true }).selectOption('Productivity');
    assert.equal(await total(), '4');
    await filter.selectOption('billable');
    await page.getByText('No hours match these filters.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Clear column filters', exact: true }).click();
    assert.equal(await filter.inputValue(), ''); assert.equal(await total(), '15');
  } finally { await browser.close(); }
});

test('saved all-history hours reconcile with the existing project report without external writes', { skip: !enabled, timeout: 180_000 }, async () => {
  const { browser, page } = await open();
  try {
    const response = await page.request.get(`${base}/api/reporting/hours`, { timeout: 120_000 });
    assert.equal(response.status(), 200); const report = await response.json();
    assert.ok(Array.isArray(report.entries)); assert.ok(report.entries.length > 0);
    const usageResponse = await page.request.get(`${base}/api/reporting/project-usage`, { timeout: 120_000 });
    assert.equal(usageResponse.status(), 200); const usage = await usageResponse.json();
    const totals = hoursTotals(report.entries);
    const sum = name => Math.round(usage.projects.reduce((n, p) => n + p[name], 0) * 10_000) / 10_000;
    assert.ok(Math.abs(totals.timecard - sum('timecardHours')) < 0.01);
    assert.ok(Math.abs(totals.productivity - sum('dailyLogHours')) < 0.01);
    console.log(`Saved-data reconciliation passed: ${report.entries.length} hour entries, ${report.review.length} review entries.`);
  } finally { await browser.close(); }
});
