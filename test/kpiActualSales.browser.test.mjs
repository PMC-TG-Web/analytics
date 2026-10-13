import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

test('Actual Sales shows contract months, switches years, exposes missing dates, and refreshes safely', { skip: process.env.WIP_BROWSER_TEST !== '1', timeout: 60_000 }, async () => {
  const require = createRequire(import.meta.url);
  const esbuild = require(process.env.WIP_TEST_ESBUILD || path.join(process.env.APPDATA, 'npm/node_modules/netlify-cli/node_modules/esbuild/lib/main.js'));
  const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import Row,{useKpiActualSales}from ${JSON.stringify(path.resolve('src/components/KpiActualSalesRow.tsx'))};function App(){const data=useKpiActualSales();const[year,setYear]=useState('2026');return <><select aria-label="Year" value={year} onChange={e=>setYear(e.target.value)}><option>2026</option><option>2027</option></select><table><tbody><Row data={data} year={year}/><tr><td>Rolling Win Rate</td></tr></tbody></table></>}createRoot(document.getElementById('root')).render(<App/>);`;
  const built = await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, write: false, bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? built.outputFiles[0].text : '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    let failed = false, january = 100000;
    const methods = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/kpi/actual-sales', route => {
      methods.push(route.request().method());
      return route.fulfill(failed ? { status: 503, json: { error: 'Actual sales are unavailable. Please retry.' } } : { json: { data: { months: { '2026-01': january, '2027-02': 200000 }, years: ['2026','2027'], projects: [{ projectId: 'p1', bidBoardId: 'b1', projectName: 'Project X', customer: 'Example', projectNumber: '2601', contractDate: '2026-01-31', value: january }], excluded: [{ projectId: 'p2', projectName: 'Project Y', reason: 'Missing or invalid Contract Date.' }] } } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const row = page.getByRole('row', { name: 'Actual Sales', exact: true });
    const month = date => row.locator(`td[title="Contract sales · ${date}"]`);
    await month('2026-01').waitFor();
    assert.equal(await month('2026-01').innerText(), '$100,000');
    assert.equal(await month('2026-02').innerText(), '$0');
    assert.equal(await row.locator('td').last().innerText(), '$100,000');
    await month('2026-01').getByRole('button').click();
    const details = page.getByRole('region', { name: 'Actual sales project breakdown' });
    await details.getByText('Project X', { exact: true }).waitFor();
    assert.ok(await details.getByText('2026-01-31', { exact: true }).count());
    await page.getByLabel('Year').selectOption('2027');
    assert.equal(await details.count(), 0);
    assert.equal(await month('2027-02').innerText(), '$200,000');
    await row.getByRole('button', { name: '1 need review' }).click();
    await details.getByText('Project Y: Missing or invalid Contract Date.', { exact: true }).waitFor();
    await details.getByRole('button', { name: 'Close breakdown' }).click();
    await page.getByLabel('Year').selectOption('2026');
    january = 120000;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.querySelector('td[title="Contract sales · 2026-01"]')?.textContent === '$120,000');
    failed = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await row.getByRole('status').waitFor();
    assert.equal(await row.locator('td[title^="Contract sales"]').count(), 0);
    failed = false;
    await row.getByRole('button', { name: 'Retry' }).click();
    await month('2026-01').waitFor();
    assert.equal(await month('2026-01').innerText(), '$120,000');
    assert.equal(await row.locator('input').count(), 0);
    assert.ok(methods.every(method => method === 'GET'));
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
