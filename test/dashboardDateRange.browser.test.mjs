import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

test('dashboard ranges keep controls, reconcile cards, drill-throughs and exports, and recover failed loads', {
  skip: process.env.DASHBOARD_DATE_BROWSER_TEST !== '1', timeout: 90_000,
}, async () => {
  const require = createRequire(import.meta.url);
  const esbuild = require(process.env.WIP_TEST_ESBUILD || path.join(process.env.APPDATA, 'npm', 'node_modules', 'netlify-cli', 'node_modules', 'esbuild', 'lib', 'main.js'));
  const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import Dashboard from ${JSON.stringify(path.resolve('src', 'app', 'dashboard', 'page.tsx'))};createRoot(document.getElementById('root')).render(<Dashboard/>);`;
  const built = await esbuild.build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' },
    write: false, bundle: true, platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"' },
  });
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? built.outputFiles[0].text : '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  let releaseRead;
  try {
    const project = (id, name, sales, dateUpdated, status = 'Accepted') => ({
      id, bidBoardId: id, projectName: name, projectNumber: name, customer: 'Example GC', status,
      sales, cost: sales / 2, cogsCost: sales / 4, hours: sales / 10, dateUpdated,
      pmcGroup: { 'Slab On Grade Labor': sales / 10 }, salesByGroup: { 'Slab On Grade Labor': sales },
      cogsByGroup: { 'Slab On Grade Labor': sales / 4 },
    });
    const projects = [
      project('before', 'Outside September', 10, '2026-10-01T03:59:59.999Z'),
      project('start', 'Twin project', 100, '2026-10-01T04:00:00Z'),
      project('end', 'Twin project', 200, '2026-11-01T03:59:59.999Z'),
      project('date-only', 'October calendar', 50, '2026-10-31'),
      project('after', 'Outside November', 400, '2026-11-01T04:00:00Z', 'Bid Submitted'),
      project('missing', 'Missing date', 500, null),
      project('excluded', 'Invitation', 999, '2026-10-15', 'Invitations'),
    ];
    const metrics = (sales, count) => ({ sales, cost: sales / 2, cogsCost: sales / 4, hours: sales / 10, count,
      laborByGroup: { 'Slab On Grade Labor': sales / 10 }, salesByGroup: { 'Slab On Grade Labor': sales },
      cogsByGroup: { 'Slab On Grade Labor': sales / 4 }, concreteByGroup: {} });
    const summary = {
      totalSales: 1260, totalCost: 630, totalCogsCost: 315, totalHours: 126,
      statusGroups: { Accepted: metrics(860, 5), 'Bid Submitted': metrics(400, 1) },
      contractors: { 'Example GC': { ...metrics(1260, 6), byStatus: { Accepted: metrics(860, 5), 'Bid Submitted': metrics(400, 1) } } },
      pmcGroupHours: {}, laborBreakdown: {}, lastUpdated: null,
    };
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ timezoneId: 'America/New_York', acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let failed = false, requests = 0;
    let readStarted;
    const started = new Promise(resolve => { readStarted = resolve; });
    const readGate = new Promise(resolve => { releaseRead = resolve; });
    await page.route('**/api/dashboard-summary', route => route.fulfill({ json: { success: true, data: summary } }));
    await page.route('**/api/estimating-dashboard?*', async route => {
      requests++;
      if (requests === 1) { readStarted(); await readGate; }
      if (failed) return route.fulfill({ status: 503, json: { success: false, error: 'Fixture unavailable' } });
      const pageNumber = Number(new URL(route.request().url()).searchParams.get('page'));
      return route.fulfill({ json: { success: true, data: projects.slice((pageNumber - 1) * 4, pageNumber * 4),
        page: pageNumber, total: projects.length, hasNextPage: pageNumber === 1 } });
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url);
    const salesCard = page.getByText('Sales', { exact: true }).first().locator('..');
    await salesCard.getByText('$1,260', { exact: true }).waitFor();
    const from = page.getByLabel('From', { exact: true });
    const to = page.getByLabel('To', { exact: true });
    const originalInput = await from.elementHandle();
    await from.fill('2026-10-01');
    await started;
    await page.getByRole('status').filter({ hasText: 'Loading dashboard data' }).waitFor();
    assert.equal(await originalInput.evaluate(element => element.isConnected), true, 'date input must not unmount during loading');
    await to.fill('2026-10-31');
    releaseRead();
    await page.getByText('3 active projects in range', { exact: true }).waitFor();
    assert.equal(requests, 2, 'one complete paginated read, not a new request for every date edit');
    assert.ok((await salesCard.innerText()).includes('$350'));
    await page.getByText('1 projects have no valid Procore dates and are excluded from this range.', { exact: true }).waitFor();
    assert.ok((await page.locator('main').innerText()).includes('Total Project Count: 3'), 'distinct Bid Board IDs must not collapse by name');

    const accepted = page.getByRole('heading', { name: 'Accepted', exact: true }).locator('../..');
    await accepted.getByRole('button', { name: '$350', exact: true }).click();
    await page.getByRole('heading', { name: 'Accepted Projects', exact: true }).waitFor();
    assert.equal(await page.getByRole('button').filter({ hasText: 'Twin project' }).count(), 2);
    assert.equal(await page.getByRole('button').filter({ hasText: 'October calendar' }).count(), 1);
    assert.equal(await page.getByText('Outside September', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Outside November', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'x', exact: true }).click();

    await page.getByRole('button', { name: 'Example GC', exact: true }).click();
    await page.getByRole('heading', { name: 'Example GC - All Jobs', exact: true }).waitFor();
    assert.equal(await page.getByRole('button').filter({ hasText: 'Twin project' }).count(), 2);
    await page.getByRole('button', { name: 'x', exact: true }).click();
    const downloadReady = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Projects to CSV' }).click();
    const download = await downloadReady;
    const csv = await readFile(await download.path(), 'utf8');
    assert.equal(csv.trim().split('\n').length, 4);
    assert.equal(csv.split('\n').filter(line => line.includes('Twin project')).length, 2);
    assert.ok(csv.includes('October calendar'));
    assert.doesNotMatch(csv, /Outside|Missing date|Invitation/);

    await from.fill('2026-11-01');
    await page.getByRole('alert').filter({ hasText: 'From date must be on or before To date.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Export Projects to CSV' }).isDisabled(), true);
    await to.fill('2026-11-01');
    await page.getByText('1 active projects in range', { exact: true }).waitFor();
    assert.ok((await salesCard.innerText()).includes('$400'));
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    assert.ok((await salesCard.innerText()).includes('$1,260'));
    assert.equal(requests, 2);
    await from.fill('2027-01-01');
    await page.getByText('0 active projects in range', { exact: true }).waitFor();
    assert.ok((await salesCard.innerText()).includes('$0'));

    failed = true;
    await page.goto(url);
    await salesCard.getByText('$1,260', { exact: true }).waitFor();
    await from.fill('2026-10-01');
    await to.fill('2026-10-31');
    await page.getByRole('alert').filter({ hasText: 'Could not load dashboard projects.' }).waitFor();
    assert.equal(await from.isVisible(), true);
    assert.equal(await salesCard.count(), 0, 'failed reads must not display zero or unfiltered results');
    failed = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByText('3 active projects in range', { exact: true }).waitFor();
    assert.ok((await salesCard.innerText()).includes('$350'));
    assert.deepEqual(errors, []);
  } finally {
    releaseRead?.();
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
