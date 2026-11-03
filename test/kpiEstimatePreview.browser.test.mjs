import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

test('local estimate preview shows full hours and dollars, flags gaps, inspects versions, and never saves', { skip: process.env.KPI_ESTIMATE_PREVIEW_BROWSER_TEST !== '1', timeout: 60_000 }, async () => {
  const require = createRequire(import.meta.url);
  const esbuild = require(process.env.WIP_TEST_ESBUILD || path.join(process.env.APPDATA, 'npm/node_modules/netlify-cli/node_modules/esbuild/lib/main.js'));
  const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import Preview from ${JSON.stringify(path.resolve('src/components/KpiEstimatePreview.tsx'))};function App(){const[year,setYear]=useState('2026');return <main style={{fontFamily:'Arial',padding:16}}><h2>Estimates by Month</h2><select aria-label="Year" value={year} onChange={e=>setYear(e.target.value)}><option>2025</option><option>2026</option><option>2027</option><option value="">All Years</option></select><Preview year={year}/><p>Saved monthly actuals remain below.</p></main>}createRoot(document.getElementById('root')).render(<App/>);`;
  const built = await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, write: false, bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? built.outputFiles[0].text : '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], requests = [];
    let failed = false, hours = 1100, sameMonth = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/kpi/estimate-preview', route => {
      requests.push(route.request().method());
      const project = { key: 'one', name: 'Example completed job', createdDate: '2026-01-02', status: 'COMPLETE', bidBoardId: 'b1', customer: 'Builder', sourceCount: 2, hours, sales: 100000, issues: [], proposals: [
        { bidBoardId: 'b1', proposalId: 'original', name: 'Original Estimate', type: 'ESTIMATE', primary: false, isBaselineCandidate: true, sourceCreatedAt: '2026-01-02T12:00:00Z', order: 1, updatedAt: '2026-01-05T12:00:00Z', hours: 1000, sales: 90000 },
        { bidBoardId: 'b1', proposalId: 'copy', name: 'Revised Estimate', type: 'ESTIMATE', primary: true, order: 2, updatedAt: '2026-10-05T12:00:01Z', hours, sales: 100000 },
      ] };
      project.events = [{ date: '2026-01-02', kind: 'initial', hours: 1000, sales: 90000, previous: null, revised: project.proposals[0] }, { date: '2026-10-05', kind: 'rebid', basis: 'original-estimate', hours: hours - 1000, sales: 10000, previous: project.proposals[0], revised: project.proposals[1] }];
      if (sameMonth) {
        project.proposals[0].updatedAt = '2026-10-01T12:00:00Z';
        project.events = [{ date: '2026-10-05', kind: 'rebid', basis: 'same-month-primary', hours, sales: 100000, previous: null, revised: project.proposals[1] }];
      }
      return route.fulfill(failed ? { status: 503, json: { error: 'The estimate preview is unavailable. Please retry.' } } : { json: { data: {
        startDate: '2026-10-01',
        legacyLedger: { source: 'local-preview', records: 132, contributingProjects: 57, missingHours: 57 },
        months: { '2026-01': { count: 2, hours: 1000, sales: 90000, missingHours: 1, missingSales: 1, rebids: 0 }, '2026-10': { count: 1, hours: sameMonth ? hours : hours - 1000, sales: sameMonth ? 100000 : 10000, missingHours: 0, missingSales: 0, rebids: 1 }, '2026-11': { count: 1, hours: 0, sales: 0, missingHours: 1, missingSales: 1, rebids: 0 }, '2027-02': { count: 1, hours: 500, sales: 60000, missingHours: 0, missingSales: 0, rebids: 0 } },
        years: ['2026', '2027'], projects: [project, { ...project, key: 'missing', name: 'Missing estimate', hours: null, sales: null, proposals: [], events: [{ date: '2026-11-02', kind: 'initial', hours: null, sales: null, previous: null, revised: null }], issues: ['No current synchronized estimate is available for this project.'] }, { ...project, key: 'future', name: 'Next year', createdDate: '2027-02-01', hours: 500, sales: 60000, proposals: [], events: [{ date: '2027-02-01', kind: 'initial', hours: 500, sales: 60000, previous: null, revised: null }] }], missingCreatedDates: 0, asOf: '2026-11-02T12:00:00Z',
      } } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(requests.length, 0, 'no added database load while collapsed');
    await page.getByRole('button', { name: 'Review estimate calculation preview · local only' }).click();
    const table = page.getByRole('table', { name: 'Estimates and rebid changes by month' });
    const hoursRow = table.getByRole('row', { name: /^2026 Hours incl. PM/ });
    await hoursRow.waitFor();
    await page.getByText(/This draft has not been imported into the shared database/).waitFor();
    assert.equal(await hoursRow.locator('td').first().innerText(), '—');
    assert.equal(await hoursRow.locator('td').first().getByRole('button').count(), 0);
    await page.getByText('New calculation starts October 2026.', { exact: true }).waitFor();
    assert.equal(await table.getByRole('row', { name: /^2026 Bids Submitted \$/ }).locator('td').first().innerText(), '—');
    assert.equal(await hoursRow.locator('td').nth(9).innerText(), '100');
    assert.equal(await hoursRow.locator('td').last().innerText(), 'Known 100*');
    assert.equal(await table.getByRole('row', { name: /^2026 Distinct projects/ }).locator('td').last().innerText(), '2');
    await hoursRow.locator('td').nth(10).getByRole('button').click();
    const details = page.getByRole('region', { name: 'Estimate preview project breakdown' });
    await details.getByRole('cell', { name: /Missing estimate/ }).waitFor();
    assert.equal(await details.getByText('Unavailable', { exact: true }).count(), 2);
    await hoursRow.locator('td').nth(9).getByRole('button').click();
    await details.getByText(/Rebid change/).waitFor();
    await details.getByText(/1,100 − 1,000 hours; \$100,000 − \$90,000/).waitFor();
    await hoursRow.locator('td').last().getByRole('button').click();
    assert.equal(await details.getByText('Initial estimate · 2026-01-02', { exact: true }).count(), 0);
    assert.equal(await details.getByRole('cell', { name: '100', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Estimate version details (1 project)' }).click();
    const versions = page.getByRole('region', { name: 'Possible rebids' });
    await versions.locator('summary').click();
    await versions.getByRole('cell', { name: /Original Estimate/ }).waitFor();
    await versions.getByRole('cell', { name: /Revised Estimate/ }).waitFor();
    assert.ok(await versions.getByText(/Rebid change included/).count());
    await versions.getByRole('columnheader', { name: 'Comparison baseline' }).waitFor();
    await versions.getByRole('cell', { name: 'Original estimate', exact: true }).waitFor();
    await versions.getByRole('cell', { name: '2026-01-02', exact: true }).waitFor();
    await details.getByText(/Original baseline: Original Estimate/).waitFor();
    fs.mkdirSync('.tmp', { recursive: true });
    await page.screenshot({ path: '.tmp/kpi-estimate-preview-same-month-20261103.png', fullPage: true });
    await page.getByLabel('Year').selectOption('2025');
    const prior = table.getByRole('row', { name: /^2025 Hours incl. PM/ });
    assert.equal(await prior.getByRole('button').count(), 0);
    assert.equal(await prior.locator('td').last().innerText(), '—');
    await page.getByLabel('Year').selectOption('2027');
    assert.equal(await details.count(), 0);
    assert.equal(await table.getByRole('row', { name: /^2027 Hours incl. PM/ }).locator('td').nth(1).innerText(), '500');
    await page.getByLabel('Year').selectOption('');
    assert.equal(await table.locator('tbody tr').count(), 8);
    await page.getByLabel('Year').selectOption('2026');
    hours = 1200;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.querySelector('tbody tr:nth-child(2) td:last-child')?.textContent === 'Known 200*');
    sameMonth = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.querySelector('tbody tr:nth-child(2) td:last-child')?.textContent === 'Known 1,200*');
    await hoursRow.locator('td').nth(9).getByRole('button').click();
    await details.getByText(/Primary estimate, counted once/).waitFor();
    await details.getByText(/full primary counted once for October 2026/).waitFor();
    await versions.getByText(/Calculated automatically: the full primary is counted once/).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Unresolved estimate data' }).getByText('Example completed job:', { exact: true }).count(), 0);
    failed = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('status').waitFor();
    assert.equal(await table.count(), 0, 'failed refresh hides outdated values');
    failed = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await table.waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'wide tables scroll within the preview on mobile');
    assert.deepEqual(errors, []);
    assert.ok(requests.length >= 4 && requests.every(method => method === 'GET'));
    assert.equal(await page.locator('input').count(), 0);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
