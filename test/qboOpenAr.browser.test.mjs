import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { arFixture } from './fixtures/qboOpenAr.mjs';
const enabled = process.env.QBO_OPEN_AR_BROWSER_TEST === '1';
const base = 'http://localhost:3000';

async function assertFilteredSummaries(page, cents) {
  const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100);
  const summary = page.getByRole('region', { name: 'Filtered aging summary' });
  assert.deepEqual(await summary.locator('tbody td').allTextContents(), cents.map(money));
  const cards = {
    'Open invoices in view': cents[6],
    'Past due in view': cents[1] + cents[2] + cents[3] + cents[4],
    'Current in view': cents[0],
    '90+ days in view': cents[4],
  };
  for (const [label, amount] of Object.entries(cards)) {
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: label, exact: true }) });
    assert.equal(await card.locator('strong').innerText(), money(amount), label);
  }
}

test('A/R aging, whole-invoice class filters, CSV, paging, errors and mobile layout', { skip: !enabled, timeout: 120_000 }, async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.context().addCookies([{ name: 'dev_user_email', value: 'todd@pmcdecor.com', url: base, sameSite: 'Lax' }]);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let payload = arFixture(), fail = false, reads = 0, refreshes = 0;
  await page.route('**/api/accounting/open-ar*', async route => {
    if (route.request().method() === 'POST') refreshes++; else reads++;
    await route.fulfill(fail ? { status: 503, json: { error: 'Test refresh failed. Previous report retained.' } }
      : route.request().method() === 'POST' ? { status: 202, json: { refresh: { id: 'fixture', state: 'queued' } } }
        : { json: { report: payload, ...(route.request().url().includes('refreshId=') ? { refresh: { id: 'fixture', state: 'succeeded' } } : {}) } });
  });

  const total = label => page.getByRole('article').filter({ has: page.getByRole('heading', { name: label, exact: true }) }).locator('strong');
  try {
    await page.goto(`${base}/accounting/open-ar`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Open A/R', exact: true }).waitFor();
    await total('Open invoices in view').getByText('$1,500.00', { exact: true }).waitFor();
    assert.equal(refreshes, 0, 'page reads never call the QBO refresh operation');
    assert.ok(reads >= 1);
    for (const label of ['Current', '1-30 days', '31-60 days', '61-90 days', '90+ days']) {
      assert.equal(await page.getByRole('columnheader', { name: label, exact: true }).count(), 2);
    }
    await assertFilteredSummaries(page, [10000, 20000, 30000, 40000, 50000, 0, 150000]);
    const fullCompany = page.locator('summary').filter({ hasText: 'Full-company QBO reconciliation (unfiltered)' });
    assert.equal(await page.getByRole('heading', { name: 'QBO aging control - all classes', exact: true }).isVisible(), false);
    await page.locator('summary').filter({ hasText: 'Classes (' }).click();
    await page.getByRole('checkbox', { name: 'Concrete:retainages', exact: true }).check();
    assert.equal(await total('Open invoices in view').innerText(), '$1,400.00');
    await assertFilteredSummaries(page, [0, 20000, 30000, 40000, 50000, 0, 140000]);
    await fullCompany.click();
    const control = page.getByRole('heading', { name: 'QBO aging control - all classes', exact: true }).locator('..');
    assert.equal(await control.locator('tbody td').last().innerText(), '$1,490.00', 'unfiltered accounting reference is separate from report summaries');
    assert.match(await control.locator('p').last().innerText(), /All open invoices \$1,500\.00 less 1 unapplied payments \(\$10\.00\)/);
    await fullCompany.click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV', exact: true }).click()]);
    const csv = await readFile(await download.path(), 'utf8');
    assert.equal(csv.split('\r\n').length, 5);
    assert.doesNotMatch(csv, /INV-1/);
    await page.getByRole('checkbox', { name: 'Concrete', exact: true }).check();
    assert.equal(await total('Open invoices in view').innerText(), '$400.00', 'parent excludes all subclasses');
    await assertFilteredSummaries(page, [0, 0, 0, 40000, 0, 0, 40000]);
    await page.getByLabel('Class filter mode').selectOption('include');
    assert.equal(await total('Open invoices in view').innerText(), '$1,100.00');
    await assertFilteredSummaries(page, [10000, 20000, 30000, 0, 50000, 0, 110000]);
    await page.getByLabel('Customer / project or invoice').fill('INV-2');
    await assertFilteredSummaries(page, [0, 20000, 0, 0, 0, 0, 20000]);
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Screeding (inactive)', exact: true }).check();
    await page.getByLabel('Class filter mode').selectOption('include');
    assert.equal(await total('Open invoices in view').innerText(), '$300.00', 'mixed partially paid invoice uses its full balance');
    await assertFilteredSummaries(page, [0, 0, 30000, 0, 0, 0, 30000]);
    await page.getByText('Mixed class', { exact: true }).waitFor();
    await page.getByLabel('Customer / project or invoice').fill('absent');
    await page.getByText('No open invoices match these filters.', { exact: true }).waitFor();
    assert.equal(await total('Open invoices in view').innerText(), '$0.00');
    await assertFilteredSummaries(page, [0, 0, 0, 0, 0, 0, 0]);
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await assertFilteredSummaries(page, [10000, 20000, 30000, 40000, 50000, 0, 150000]);
    await page.getByRole('button', { name: 'Refresh from QBO', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /Waiting for the QBO host/ }).waitFor();
    await page.getByRole('button', { name: 'Refresh from QBO', exact: true }).waitFor();
    assert.equal(refreshes, 1);
    fail = true;
    await page.getByRole('button', { name: 'Refresh from QBO', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Test refresh failed' }).waitFor();
    assert.equal(await total('Open invoices in view').innerText(), '$1,500.00');
    assert.equal(refreshes, 2);
    fail = false;
    payload = arFixture();
    payload.invoices = Array.from({ length: 105 }, (_, index) => ({ ...payload.invoices[0], id: String(index), number: `INV-${index}`, classIds: ['flat'] }));
    await page.getByRole('button', { name: 'Reload saved report', exact: true }).click();
    await page.getByText(/105 matching invoices · Page/).waitFor();
    assert.equal(await page.locator('table').first().locator('tbody tr').count(), 100);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal(await page.locator('table').first().locator('tbody tr').count(), 5);
    await assertFilteredSummaries(page, [1050000, 0, 0, 0, 0, 0, 1050000]);
    const [allPages] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV', exact: true }).click()]);
    assert.equal((await readFile(await allPages.path(), 'utf8')).split('\r\n').length, 106);
    await page.getByLabel('Customer / project or invoice').fill('INV-104');
    await page.getByText(/1 matching invoices · Page/).waitFor();
    assert.match(await page.getByText(/matching invoices · Page/).innerText(), /Page 1 of 1/);
    await assertFilteredSummaries(page, [10000, 0, 0, 0, 0, 0, 10000]);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'table scrolls internally on mobile');
    await page.getByRole('checkbox', { name: 'Concrete:retainages', exact: true }).check();
    payload.classes = payload.classes.filter(row => row.id !== 'retainage');
    await page.getByRole('button', { name: 'Reload saved report', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'selected class is no longer available' }).waitFor();
    assert.deepEqual(await page.getByRole('article').locator('strong').allTextContents(), ['Unavailable', 'Unavailable', 'Unavailable', 'Unavailable']);
    assert.equal(await page.getByRole('region', { name: 'Filtered aging summary' }).locator('table').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Download CSV', exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('hourly health warnings and automatic saved-data reload preserve class filters without QBO calls', { skip: !enabled, timeout: 120_000 }, async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.context().addCookies([{ name: 'dev_user_email', value: 'todd@pmcdecor.com', url: base, sameSite: 'Lax' }]);
  await page.clock.install({ time: new Date('2026-11-05T16:00:00Z') });
  let payload = arFixture(), reads = 0, posts = 0;
  let health = { hostOnline: false, latestRefresh: { state: 'failed', requestedAt: '2026-11-05T15:00:00Z', finishedAt: '2026-11-05T15:01:00Z' } };
  await page.route('**/api/accounting/open-ar*', route => {
    if (route.request().method() === 'POST') posts++; else reads++;
    return route.fulfill({ json: { report: payload, health } });
  });
  const total = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Open invoices in view', exact: true }) }).locator('strong');
  try {
    await page.goto(`${base}/accounting/open-ar`, { waitUntil: 'domcontentloaded' });
    await total.getByText('$1,500.00', { exact: true }).waitFor();
    await page.getByRole('alert').filter({ hasText: 'A/R data is stale' }).waitFor();
    await page.getByRole('alert').filter({ hasText: 'QBO host is offline' }).waitFor();
    await page.getByRole('alert').filter({ hasText: 'latest A/R refresh' }).waitFor();
    await page.locator('summary').filter({ hasText: 'Classes (' }).click();
    await page.getByRole('checkbox', { name: 'Concrete:retainages', exact: true }).check();
    assert.equal(await total.innerText(), '$1,400.00');
    const before = reads;
    payload = arFixture();
    payload.generatedAt = '2026-11-05T16:00:00Z';
    payload.invoices[1].balanceCents = 22000;
    payload.invoices[1].totalCents = 22000;
    payload.qboAging.days1To30 += 2000; payload.qboAging.total += 2000;
    health = { hostOnline: true, latestRefresh: { state: 'succeeded', requestedAt: '2026-11-05T16:00:00Z', finishedAt: '2026-11-05T16:00:30Z' } };
    await page.clock.fastForward(61_000);
    await total.getByText('$1,420.00', { exact: true }).waitFor();
    await assertFilteredSummaries(page, [0, 22000, 30000, 40000, 50000, 0, 142000]);
    assert.ok(reads > before);
    assert.equal(posts, 0, 'automatic page reads never call QBO');
    assert.equal(await page.getByRole('checkbox', { name: 'Concrete:retainages', exact: true }).isChecked(), true);
    assert.equal(await page.getByRole('alert').filter({ hasText: 'A/R data is stale' }).count(), 0);
    assert.equal(await page.getByRole('alert').filter({ hasText: 'QBO host is offline' }).count(), 0);
    assert.equal(await page.getByRole('alert').filter({ hasText: 'latest A/R refresh' }).count(), 0);
  } finally { await browser.close(); }
});
