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
      { ...project('before', 'Outside September', 10, '2026-10-01T03:59:59.999Z'), dateCreated: '2026-09-01', contractDate: '2026-10-15' },
      { ...project('start', 'Twin project', 100, '2026-10-01T04:00:00Z'), dateCreated: '2026-10-01', contractDate: '2026-11-01' },
      { ...project('end', 'Twin project', 200, '2026-11-01T03:59:59.999Z'), dateCreated: '2026-09-01', contractDate: '2026-09-15' },
      { ...project('date-only', 'October calendar', 50, '2026-10-31'), dateCreated: '2026-10-31', contractDate: '2026-10-31' },
      { ...project('after', 'Outside November', 400, '2026-11-01T04:00:00Z', 'Bid Submitted'), dateCreated: '2026-10-10' },
      project('missing', 'Missing date', 500, null, 'Estimating'),
      project('excluded', 'Invitation', 999, '2026-10-15', 'Invitations'),
    ];
    const metrics = (sales, count) => ({ sales, cost: sales / 2, cogsCost: sales / 4, hours: sales / 10, count,
      laborByGroup: { 'Slab On Grade Labor': sales / 10 }, salesByGroup: { 'Slab On Grade Labor': sales },
      cogsByGroup: { 'Slab On Grade Labor': sales / 4 }, concreteByGroup: {} });
    const history = {
      savedAt: '2026-10-07T13:49:32Z',
      projects: [
        ...projects.slice(0, 4).map(row => ({
          id: row.id, projectName: row.projectName === 'Twin project' ? `Twin ${row.id} phase` : row.projectName,
          status: row.status, dateCreated: row.dateCreated, contractDate: row.contractDate,
          bid: true, won: true, hasSavedHistory: false, hasCurrentRecord: true, contractDateIssue: null,
        })),
        { id: 'history-after', projectName: 'Outside November', status: 'Bid Submitted', dateCreated: '2026-05-10',
          contractDate: null, bid: true, won: false, hasSavedHistory: true, hasCurrentRecord: true, contractDateIssue: null },
        { id: 'history-only', projectName: 'Saved May bid', status: 'Bid Submitted', dateCreated: '2026-05-20',
          contractDate: null, bid: true, won: false, hasSavedHistory: true, hasCurrentRecord: false, contractDateIssue: null },
      ],
    };
    const summary = {
      totalSales: 1260, totalCost: 630, totalCogsCost: 315, totalHours: 126,
      statusGroups: { Accepted: metrics(360, 4), 'Bid Submitted': metrics(400, 1), Estimating: metrics(500, 1) },
      contractors: { 'Example GC': { ...metrics(1260, 6), byStatus: { Accepted: metrics(360, 4), 'Bid Submitted': metrics(400, 1), Estimating: metrics(500, 1) } } },
      pmcGroupHours: {}, laborBreakdown: {}, lastUpdated: null,
      winRate: { won: 4, bid: 6, rate: 4 / 6, wonIds: ['before', 'start', 'end', 'date-only'],
        bidIds: history.projects.map(project => project.id), missingWonDateIds: [], missingBidDateIds: [] },
    };
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ timezoneId: 'America/New_York', acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let failed = false, requests = 0, missingContract = false, historyAvailable = true;
    let readStarted;
    const started = new Promise(resolve => { readStarted = resolve; });
    const readGate = new Promise(resolve => { releaseRead = resolve; });
    await page.route('**/api/dashboard-summary', route => route.fulfill({ json: { success: true, data: {
      ...summary,
      winRateHistory: historyAvailable ? { ...history, projects: history.projects.map(row =>
        missingContract && row.id === 'before' ? { ...row, contractDate: null, contractDateIssue: 'Missing linked Contract Date.' } : row) } : null,
    } } }));
    await page.route('**/api/estimating-dashboard?*', async route => {
      requests++;
      if (requests === 1) { readStarted(); await readGate; }
      if (failed) return route.fulfill({ status: 503, json: { success: false, error: 'Fixture unavailable' } });
      const pageNumber = Number(new URL(route.request().url()).searchParams.get('page'));
      const rows = projects.map(row => missingContract && row.id === 'before' ? { ...row, contractDate: null } : row);
      return route.fulfill({ json: { success: true, data: rows.slice((pageNumber - 1) * 4, pageNumber * 4),
        page: pageNumber, total: projects.length, hasNextPage: pageNumber === 1 } });
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url);
    const salesCard = page.getByText('Sales', { exact: true }).first().locator('..');
    await salesCard.getByText('$1,260', { exact: true }).waitFor();
    const winRateCard = page.getByRole('region', { name: 'Period win rate' });
    assert.ok((await winRateCard.innerText()).includes('66.7%'));
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
    assert.ok((await winRateCard.innerText()).includes('100.0%'));
    await winRateCard.getByRole('button', { name: '2 won', exact: true }).click();
    await page.getByRole('heading', { name: 'Win Rate - Won (2026-10-01 through 2026-10-31)', exact: true }).waitFor();
    const winDetails = page.getByRole('dialog');
    assert.equal(await winDetails.getByRole('cell', { name: 'Outside September', exact: true }).count(), 1, 'an older bid won in October counts despite its activity date');
    assert.equal(await winDetails.getByRole('cell', { name: 'October calendar', exact: true }).count(), 1);
    assert.equal(await winDetails.getByRole('cell', { name: /Twin/ }).count(), 0);
    await winDetails.getByRole('cell', { name: '2026-10-15', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close win-rate breakdown', exact: true }).click();
    await winRateCard.getByRole('button', { name: '2 bid', exact: true }).click();
    await page.getByRole('heading', { name: 'Win Rate - Bid (2026-10-01 through 2026-10-31)', exact: true }).waitFor();
    assert.equal(await winDetails.getByRole('cell', { name: 'Outside November', exact: true }).count(), 0, 'a migrated bid belongs in May, not its current creation month');
    assert.equal(await winDetails.getByRole('cell', { name: 'Twin start phase', exact: true }).count(), 1, 'a bid won later remains in its original bid period');
    await winDetails.getByRole('cell', { name: '2026-10-01', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close win-rate breakdown', exact: true }).click();

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
    assert.ok((await winRateCard.innerText()).includes('66.7%'));
    assert.equal(requests, 2);
    await from.fill('2026-05-01');
    await to.fill('2026-05-31');
    await page.getByText('0 active projects in range', { exact: true }).waitFor();
    assert.ok((await salesCard.innerText()).includes('$0'), 'history must not leak into current sales or hours');
    await winRateCard.getByRole('button', { name: '2 bid', exact: true }).click();
    await page.getByRole('heading', { name: 'Win Rate - Bid (2026-05-01 through 2026-05-31)', exact: true }).waitFor();
    assert.equal(await winDetails.getByRole('cell', { name: 'Saved May bid', exact: true }).count(), 1);
    assert.equal(await winDetails.getByRole('cell', { name: 'Outside November', exact: true }).count(), 1);
    assert.equal(await winDetails.getByRole('cell', { name: 'Saved history', exact: true }).count(), 1);
    assert.equal(await winDetails.getByRole('columnheader', { name: 'Sales', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Close win-rate breakdown', exact: true }).click();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await from.fill('2027-01-01');
    await page.getByText('0 active projects in range', { exact: true }).waitFor();
    assert.ok((await salesCard.innerText()).includes('$0'));
    assert.ok((await winRateCard.innerText()).includes('No bids in period'));

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
    assert.ok((await winRateCard.innerText()).includes('100.0%'));

    await page.goto(url);
    await winRateCard.getByRole('button', { name: '4 won', exact: true }).waitFor();
    await winRateCard.getByRole('button', { name: '4 won', exact: true }).click();
    await page.getByRole('heading', { name: 'Win Rate - Won (All dates)', exact: true }).waitFor();
    assert.equal(await winDetails.getByRole('cell', { name: /Twin .* phase/ }).count(), 2);
    await page.getByRole('button', { name: 'Close win-rate breakdown', exact: true }).click();

    missingContract = true;
    await page.goto(url);
    await salesCard.getByText('$1,260', { exact: true }).waitFor();
    await from.fill('2026-10-01');
    await to.fill('2026-10-31');
    await winRateCard.getByText('Needs dates', { exact: true }).waitFor();
    await winRateCard.getByRole('button', { name: 'Review 1 Contract Dates / 0 Created Dates', exact: true }).click();
    await page.getByRole('heading', { name: 'Win Rate - Dates needing review (2026-10-01 through 2026-10-31)', exact: true }).waitFor();
    assert.equal(await winDetails.getByRole('cell', { name: 'Outside September', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Close win-rate breakdown', exact: true }).click();
    missingContract = false;
    historyAvailable = false;
    await page.goto(url);
    await winRateCard.getByText('Unavailable', { exact: true }).waitFor();
    assert.ok((await salesCard.innerText()).includes('$1,260'));
    assert.equal(await winRateCard.getByText('No bids in period', { exact: true }).count(), 0);
    historyAvailable = true;
    await winRateCard.getByRole('button', { name: 'Retry win rate', exact: true }).click();
    await winRateCard.getByRole('button', { name: '6 bid', exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    releaseRead?.();
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
