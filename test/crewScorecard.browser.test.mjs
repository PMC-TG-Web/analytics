import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { buildCrewScorecard } from '../src/lib/crewScorecard.ts';

const enabled = process.env.CREW_SCORECARD_BROWSER_TEST === '1';
const base = process.env.CREW_SCORECARD_TEST_URL || 'http://localhost:3000';
const email = process.env.CREW_SCORECARD_TEST_EMAIL || 'todd@pmcdecor.com';

async function openLocalPage() {
  const url = new URL(base);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'browser tests must stay local');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.context().addCookies([{ name: 'dev_user_email', value: email, url: base, sameSite: 'Lax' }]);
  return { browser, page };
}

function fixture(week) {
  const secondDay = new Date(new Date(`${week}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  const source = { id: '1', procoreId: '1', companyId: 'fixture', projectId: 'p1', date: week,
    creatorId: 'foreman', creatorName: 'Alex Foreman', creatorLogin: 'alex@example.test', syncedAt: `${week}T12:00:00Z` };
  return buildCrewScorecard({
    companyId: 'fixture', week, now: new Date(new Date(`${week}T12:00:00Z`).getTime() + 7 * 86_400_000),
    employees: [
      { id: 'alex', firstName: 'Alex', lastName: 'Foreman', email: 'alex@example.test', jobTitle: 'Foreman', isActive: true },
      { id: 'jo', firstName: 'Jo', lastName: 'Foreman', email: 'jo@example.test', jobTitle: 'Foreman', isActive: true },
    ],
    projects: [{ procoreProjectId: 'p1', bidBoardId: 'b1', projectName: 'Test concrete project', projectNumber: '1' }],
    estimates: [{ procoreProjectId: 'p1', bidBoardId: 'b1', selectedProposalId: 'e1', proposalName: 'Test estimate',
      pmcGroup: { 'Slab On Grade Labor': 400 }, concreteGroup: { 'Slab On Grade': 600 } }],
    timecards: [{ ...source, hours: 50, workerId: 'worker', workerName: 'Test Worker', party: null,
      costCode: '03-300-20-10', costCodeName: 'SOG labor' }],
    logs: [
      { ...source, quantity: 100, lineItemId: 'po1', holderTitle: 'Materials', description: 'SOG concrete', costCode: '03-300-20-20', costType: 'M', uom: 'cy', metadataMatches: 1 },
      { ...source, id: '2', procoreId: '2', date: secondDay, creatorId: 'other', creatorName: 'Other Submitter', creatorLogin: 'other@example.test',
        quantity: 2, lineItemId: 'po2', holderTitle: 'Materials', description: 'Rebar chairs', costCode: '03-200-30-20', costType: 'M', uom: 'ea', metadataMatches: 1 },
    ],
  });
}

test('local scorecard displays exact metrics, filters, weekly navigation, source detail, mobile layout and retry states', { skip: !enabled, timeout: 120_000 }, async () => {
  const { browser, page } = await openLocalPage();
  const errors = [];
  const writes = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method()); });
  let mode = 'success';
  let reads = 0;
  await page.route('**/api/crew-scorecard?*', async route => {
    reads += 1;
    const week = new URL(route.request().url()).searchParams.get('week');
    if (mode === 'error') return route.fulfill({ status: 503, json: { error: 'Saved source unavailable. Please retry.' } });
    const result = fixture(week);
    if (mode === 'empty') result.crews = [];
    return route.fulfill({ json: result });
  });
  try {
    await page.goto(`${base}/crew-scorecard`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Foremen', exact: true }).waitFor();
    const metric = label => page.getByRole('article').filter({ hasText: label }).locator('strong');
    assert.equal(await metric('Field labor hours').innerText(), '50');
    assert.equal(await metric('Projects with records').innerText(), '1');
    assert.equal(await metric('Concrete quantity used').innerText(), '100 CY');
    assert.equal(await metric('Rebar installed (calc.)').innerText(), '0.00 tons');
    assert.equal(await metric('Items to review').innerText(), '1');
    await page.getByRole('heading', { name: 'Alex Foreman', exact: true }).click();
    const crew = page.locator('main details').filter({ has: page.getByRole('heading', { name: 'Alex Foreman', exact: true }) }).first();
    const rateRow = crew.getByRole('row').filter({ hasText: 'Slab On Grade' });
    assert.match(await rateRow.innerText(), /2\s+1\.5/);
    assert.ok((await rateRow.innerText()).includes('133%'));
    await crew.locator('summary').filter({ hasText: /^Quantity detail/ }).click();
    assert.ok(await crew.getByRole('cell', { name: 'CY', exact: true }).isVisible());
    await page.getByLabel('Needs review only').check();
    assert.equal(await page.getByRole('heading', { name: 'Alex Foreman', exact: true }).count(), 0);
    assert.equal(await metric('Field labor hours').innerText(), '0');
    await page.getByLabel('Needs review only').uncheck();
    await page.getByLabel('Filter submitter').selectOption('foreman:alex');
    assert.equal(await page.getByRole('heading', { name: 'Other submitters', exact: true }).count(), 0);
    assert.equal(await metric('Items to review').innerText(), '0');
    const before = await page.getByLabel('Choose week').inputValue();
    await page.getByRole('button', { name: 'Previous week', exact: true }).click();
    await page.getByRole('heading', { name: 'Other submitters', exact: true }).waitFor();
    assert.equal(new Date(before).getTime() - new Date(await page.getByLabel('Choose week').inputValue()).getTime(), 7 * 86_400_000);
    assert.equal(await page.getByLabel('Filter submitter').inputValue(), 'all');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('heading', { name: 'Alex Foreman', exact: true }).click();
    await page.getByRole('heading', { name: 'Daily job coverage', exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no document-level mobile overflow');
    const scrollRegion = page.locator('main table').first().locator('..');
    assert.ok(await scrollRegion.evaluate(element => element.scrollWidth > element.clientWidth), 'wide tables scroll inside their own region');
    if (process.env.CREW_SCORECARD_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.CREW_SCORECARD_SCREENSHOT_DIR, 'crew-scorecard-fixture-mobile.png'), fullPage: true });
    }
    mode = 'error';
    await page.getByRole('button', { name: 'Refresh saved data', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Saved source unavailable' }).waitFor();
    assert.equal(await page.getByRole('article').count(), 0, 'errors never retain success-shaped totals');
    mode = 'empty';
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByText('No saved field activity for this week.', { exact: true }).waitFor();
    mode = 'success';
    await page.getByRole('button', { name: 'Refresh saved data', exact: true }).click();
    await page.getByRole('heading', { name: 'Alex Foreman', exact: true }).waitFor();
    assert.ok(reads >= 5);
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
  } finally {
    await browser.close();
  }
});

test('pace comparisons show labeled green or red badges at the exact 100 percent threshold, with neutral unavailable results', { skip: !enabled, timeout: 120_000 }, async () => {
  const { browser, page } = await openLocalPage();
  const cases = [
    { percent: 198, label: 'Ahead of estimate', value: '198%', good: true },
    { percent: 100.1, label: 'Ahead of estimate', value: '>100%', good: true },
    { percent: 100, label: 'On estimate', value: '100%', good: true },
    { percent: 99.9, label: 'Behind estimate', value: '<100%', good: false },
    { percent: 85, label: 'Behind estimate', value: '85%', good: false },
    { percent: 0, label: 'Behind estimate', value: '0%', good: false },
    { percent: null },
  ];
  const unavailable = 'No unambiguous selected estimate is linked to this project.';
  await page.route('**/api/crew-scorecard?*', async route => {
    const result = fixture(new URL(route.request().url()).searchParams.get('week'));
    const crew = result.crews.find(row => row.id === 'foreman:alex');
    const rate = crew.rates[0];
    crew.rates = cases.map((entry, index) => ({
      ...rate, projectName: `Pace example ${index + 1}`,
      actualRate: entry.percent === null ? rate.actualRate : rate.estimatedRate * entry.percent / 100,
      estimatedRate: entry.percent === null ? null : rate.estimatedRate,
      percentOfEstimate: entry.percent, reason: entry.percent === null ? unavailable : null,
    }));
    result.crews = [crew];
    await route.fulfill({ json: result });
  });
  try {
    await page.goto(`${base}/crew-scorecard`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Alex Foreman', exact: true }).click();
    const table = page.locator('main table').first();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [index, entry] of cases.entries()) {
        const comparison = table.getByRole('row').nth(index + 1).getByRole('cell').last();
        await comparison.scrollIntoViewIfNeeded();
        if (entry.percent === null) {
          assert.equal(await comparison.innerText(), unavailable);
          assert.equal(await comparison.locator('strong').count(), 0, 'unavailable is not a good/bad score');
          assert.equal(await comparison.locator('span').evaluate(element => getComputedStyle(element).color), 'rgb(97, 119, 130)');
          continue;
        }
        const label = comparison.getByText(entry.label, { exact: true });
        assert.ok(await label.isVisible());
        assert.equal(await comparison.locator('small').innerText(), `${entry.value} of estimate pace`);
        const color = entry.good ? 'rgb(22, 101, 52)' : 'rgb(153, 27, 27)';
        assert.deepEqual(await label.evaluate(element => ({
          color: getComputedStyle(element).color,
          background: getComputedStyle(element.parentElement).backgroundColor,
        })), { color, background: entry.good ? 'rgb(220, 252, 231)' : 'rgb(254, 226, 226)' });
        assert.equal(await comparison.locator('small').evaluate(element => getComputedStyle(element).color), color);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'comparison badges do not overflow the page');
      if (process.env.CREW_SCORECARD_SCREENSHOT_DIR) {
        await table.locator('..').screenshot({ path: path.join(process.env.CREW_SCORECARD_SCREENSHOT_DIR, `crew-scorecard-pace-${width}.png`) });
      }
    }
  } finally {
    await browser.close();
  }
});

test('real saved data renders and local API/UI totals reconcile without mutations', { skip: !enabled, timeout: 120_000 }, async () => {
  const { browser, page } = await openLocalPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${base}/crew-scorecard`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Foremen', exact: true }).waitFor({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Previous week', exact: true }).click();
    await page.getByRole('heading', { name: 'Foremen', exact: true }).waitFor({ timeout: 60_000 });
    const week = await page.getByLabel('Choose week').inputValue();
    const response = await page.request.get(`${base}/api/crew-scorecard?week=${week}`);
    assert.equal(response.status(), 200);
    assert.match(response.headers()['cache-control'], /private, no-store/);
    const report = await response.json();
    const hours = report.crews.reduce((sum, crew) => sum + crew.hours, 0);
    const concrete = report.crews.reduce((sum, crew) => sum + crew.concrete, 0);
    const rebarTons = report.crews.reduce((sum, crew) => sum + crew.rebarTons, 0);
    assert.equal(await page.getByRole('article').filter({ hasText: 'Field labor hours' }).locator('strong').innerText(), hours.toLocaleString('en-US', { maximumFractionDigits: 1 }));
    assert.equal(await page.getByRole('article').filter({ hasText: 'Concrete quantity used' }).locator('strong').innerText(), `${concrete.toLocaleString('en-US', { maximumFractionDigits: 1 })} CY`);
    assert.equal(await page.getByRole('article').filter({ hasText: 'Rebar installed (calc.)' }).locator('strong').innerText(), `${rebarTons.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tons`);
    const measured = report.crews.find(crew => crew.rates.some(rate => rate.actualRate !== null));
    if (measured) {
      await page.getByLabel('Filter submitter').selectOption(measured.id);
      await page.getByRole('heading', { name: measured.name, exact: true }).click();
      await page.getByRole('heading', { name: 'Daily job coverage', exact: true }).waitFor();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    assert.equal((await page.request.get(`${base}/api/crew-scorecard?week=invalid`)).status(), 400);
    const anonymous = await browser.newContext();
    try { assert.equal((await anonymous.request.get(`${base}/api/crew-scorecard?week=${week}`)).status(), 401); }
    finally { await anonymous.close(); }
  } finally {
    await browser.close();
  }
});
