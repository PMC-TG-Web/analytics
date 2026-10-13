import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

test('KPI shows read-only WIP hours by year, refreshes on return, and recovers from errors', { skip: process.env.WIP_BROWSER_TEST !== '1', timeout: 60_000 }, async () => {
  const require = createRequire(import.meta.url);
  const esbuild = require(process.env.WIP_TEST_ESBUILD || path.join(process.env.APPDATA, 'npm/node_modules/netlify-cli/node_modules/esbuild/lib/main.js'));
  const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import Row,{useWipScheduledHours}from ${JSON.stringify(path.resolve('src/components/KpiScheduledHoursRow.tsx'))};function App(){const data=useWipScheduledHours();const[year,setYear]=useState('2026');const years=year?[year]:['2026','2027'];return <><select aria-label="Year" value={year} onChange={e=>setYear(e.target.value)}><option value="">All Years</option><option>2026</option><option>2027</option></select><table><tbody><Row data={data} months={years.flatMap(year=>Array.from({length:12},(_,i)=>({year,month:i+1})))}/></tbody></table></>}createRoot(document.getElementById('root')).render(<App/>);`;
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
    let failed = false, october = 400.25;
    const methods = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/kpi/scheduled-hours', route => {
      methods.push(route.request().method());
      return route.fulfill(failed ? { status: 503, json: { error: 'Scheduled hours are unavailable. Please retry.' } } : { json: { data: { months: { '2026-10': october, '2026-11': 400, '2027-01': 200 }, years: ['2026','2027'], planCount: 1, excludedDraftCount: 1, localOnly: true } } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const row = page.getByRole('row', { name: 'Scheduled Hours', exact: true });
    const month = date => row.locator(`td[title="Saved WIP · ${date}"]`);
    await month('2026-10').waitFor();
    assert.equal(await month('2026-10').innerText(), '400.25');
    assert.equal(await month('2026-01').innerText(), '0');
    assert.equal(await row.locator('td').last().innerText(), '800.25');
    await month('2026-10').dblclick();
    assert.equal(await row.locator('input').count(), 0);
    await page.getByLabel('Year').selectOption('2027');
    assert.equal(await month('2027-01').innerText(), '200');
    assert.equal(await row.locator('td').last().innerText(), '200');
    await page.getByLabel('Year').selectOption('');
    assert.equal(await row.locator('td').count(), 25);
    assert.equal(await row.locator('td').last().innerText(), '1,000.25');
    october = 500;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.querySelector('td[title="Saved WIP · 2026-10"]')?.textContent === '500');
    assert.equal(await row.locator('td').last().innerText(), '1,100');
    failed = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await row.getByRole('status').waitFor();
    assert.match(await row.innerText(), /unavailable/);
    assert.equal(await row.locator('td[title^="Saved WIP"]').count(), 0, 'failed refresh does not present stale totals as current');
    failed = false;
    await row.getByRole('button', { name: 'Retry' }).click();
    await month('2026-10').waitFor();
    assert.equal(await month('2026-10').innerText(), '500');
    assert.ok(methods.length >= 4);
    assert.ok(methods.every(method => method === 'GET'));
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
