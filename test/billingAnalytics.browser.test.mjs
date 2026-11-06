import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { aggregateBillingHours, billingDateRange } from '../src/lib/billingAnalytics.ts';

const enabled = process.env.BILLING_ANALYTICS_BROWSER_TEST === '1';
const base = 'http://localhost:3000';
const source = { companyId: 'fixture', projectId: 'p1', projectName: 'Test project', projectNumber: '001',
  source: 'timesheet', updatedAt: '2026-11-08', deletedAt: null, costCode: '01', costCodeName: 'Labor',
  partyName: 'Sub Contractor', description: 'Subcontractor Hours', status: 'approved', notes: null, uom: 'hr' };
const entries = [
  { ...source, id: 'previous-year', date: '2025-12-31', hours: 16 },
  { ...source, id: 'new-year', date: '2026-01-01', hours: 32 },
  { ...source, id: 'before', date: '2026-11-05', hours: 100 },
  { ...source, id: 'selected-timesheet', date: '2026-11-06', hours: 2 },
  { ...source, id: 'selected-productivity', source: 'productivity', date: '2026-11-06', hours: 6 },
  { ...source, id: 'after', date: '2026-11-07', hours: 200 },
];

test('date filter updates totals, details, invoice weights, exports and cross-year months', { skip: !enabled, timeout: 120_000 }, async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const requests = []; let fail = false;
  await page.context().addCookies([{ name: 'dev_user_email', value: 'todd@pmcdecor.com', url: base, sameSite: 'Lax' }]);
  await page.route('**/api/accounting/billing-analytics?*', route => {
    const url = new URL(route.request().url());
    const from = url.searchParams.get('from'), through = url.searchParams.get('through');
    requests.push({ from, through });
    if (fail) return route.fulfill({ status: 503, json: { error: 'Unable to load billing hours. Please try again.' } });
    const { start, end } = billingDateRange(from, through);
    return route.fulfill({ json: { from, through, loadedAt: '2026-11-06T12:00:00Z',
      ...aggregateBillingHours(entries.filter(entry => new Date(entry.date) >= start && new Date(entry.date) < end), 'fixture') } });
  });
  const total = label => page.getByText(label, { exact: true }).locator('..').locator('p').nth(1);
  const waitTotal = value => total('Combined hours').filter({ hasText: new RegExp(`^${value}$`) }).waitFor();
  const months = page.getByRole('region', { name: 'Hours by month', exact: true });
  const exportHours = page.getByRole('button', { name: 'Export range hours', exact: true });
  try {
    await page.goto(`${base}/accounting/billing-analytics`, { waitUntil: 'networkidle' });
    await page.getByLabel('Year', { exact: true }).selectOption('2026');
    await waitTotal('340');
    assert.equal(await months.locator('details').count(), 12);
    await page.getByLabel('Start date', { exact: true }).fill('2026-11-06');
    await page.getByLabel('End date', { exact: true }).fill('2026-11-06');
    await waitTotal('8');
    assert.equal(await total('Timesheet hours').innerText(), '2');
    assert.equal(await total('Productivity hours').innerText(), '6');
    assert.equal(await months.locator('details').count(), 1);
    assert.equal(await page.getByLabel('Year', { exact: true }).inputValue(), '');
    await months.getByRole('button', { name: /01.*Labor/ }).click();
    const detail = page.getByRole('table', { name: 'Source entries · 01', exact: true });
    assert.equal(await detail.getByRole('row').count(), 3);
    assert.doesNotMatch(await detail.innerText(), /#before|#after/);
    await page.getByLabel('Invoice total (USD)', { exact: true }).fill('80');
    const [invoice] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export invoice distribution', exact: true }).click()]);
    const invoiceCsv = await readFile(await invoice.path(), 'utf8');
    assert.match(invoiceCsv, /"2","6","8"/);
    assert.match(invoiceCsv, /"80.00","80.00","2026-11-06","2026-11-06"/);
    const [download] = await Promise.all([page.waitForEvent('download'), exportHours.click()]);
    assert.equal(download.suggestedFilename(), 'subcontractor-hours-2026-11-06-through-2026-11-06.csv');
    assert.match(await readFile(await download.path(), 'utf8'), /"2","6","8","2026-11-06","2026-11-06"/);
    await mkdir('outputs/billing-date-range', { recursive: true });
    await page.screenshot({ path: 'outputs/billing-date-range/desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'outputs/billing-date-range/mobile.png', fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no page-level horizontal overflow');
    await page.setViewportSize({ width: 1440, height: 1000 });
    const beforeInvalid = requests.length;
    await page.getByLabel('Start date', { exact: true }).fill('2026-11-07');
    await page.getByRole('alert').filter({ hasText: 'Start date must be on or before end date.' }).waitFor();
    assert.equal(await exportHours.isDisabled(), true);
    assert.equal(requests.length, beforeInvalid);
    await page.getByLabel('Start date', { exact: true }).fill('2026-11-06');
    await waitTotal('8');
    assert.equal(await page.getByLabel('Invoice total (USD)', { exact: true }).inputValue(), '', 'range changes reset the temporary invoice');
    await page.getByLabel('Start date', { exact: true }).fill('2025-12-31');
    await page.getByLabel('End date', { exact: true }).fill('2026-01-01');
    await waitTotal('48');
    assert.equal(await months.locator('details').count(), 2);
    await page.getByLabel('Year', { exact: true }).selectOption('2026');
    await waitTotal('340');
    assert.equal(await page.getByLabel('Start date', { exact: true }).inputValue(), '2026-01-01');
    assert.equal(await page.getByLabel('End date', { exact: true }).inputValue(), '2026-12-31');
    await page.getByLabel('Start date', { exact: true }).fill('2026-11-08');
    await page.getByLabel('End date', { exact: true }).fill('2026-11-08');
    await waitTotal('0');
    await page.getByText('No subcontractor hours recorded within the selected dates for this month.', { exact: true }).waitFor();
    assert.equal(await exportHours.isDisabled(), true);
    fail = true;
    await page.getByRole('button', { name: 'Reload report', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Unable to load billing hours.' }).waitFor();
    assert.equal(await exportHours.isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
