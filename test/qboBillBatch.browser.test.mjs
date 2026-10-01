// Opt-in browser rehearsal of the real React component. All API traffic is mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

for (const maxProjects of [1, 3]) test(`monthly batch selection limit ${maxProjects}, progress, reopened results and unresolved retry`, { skip: process.env.QBO_BATCH_BROWSER_TEST !== '1', timeout: 90_000 }, async t => {
  const require = createRequire(import.meta.url);
  const esbuildPath = process.env.QBO_BATCH_TEST_ESBUILD || path.join(process.env.APPDATA || '', 'npm/node_modules/netlify-cli/node_modules/esbuild/lib/main.js');
  const esbuild = require(esbuildPath);
  const entry = `import React, {useState,useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import MonthlyBillBatch from ${JSON.stringify(path.resolve('src/app/accounting/direct-cost-bills/MonthlyBillBatch.tsx'))};
function App(){const [running,setRunning]=useState(false);const [done,setDone]=useState(0);const [selected,setSelected]=useState('');const finish=useCallback(()=>setDone(n=>n+1),[]);
return <main style={{padding:24,maxWidth:1200,margin:'auto'}}><h1 style={{fontSize:24,marginBottom:20}}>Monthly bill update — isolated rehearsal</h1><MonthlyBillBatch companyId="1" month="2026-09" visibleProjectIds={['10','20','30']} disabled={false} onRunning={setRunning} onComplete={finish} onReview={setSelected}/><span hidden data-testid="running">{String(running)}</span><span hidden data-testid="completed">{done}</span><span hidden data-testid="selected">{selected}</span></main>}
createRoot(document.getElementById('root')).render(<App/>);`;
  const built = await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, write: false, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': path.resolve('src') }, define: { 'process.env.NODE_ENV': '"test"' } });
  const cssDir = '.netlify/static/_next/static/css';
  const cssFile = fs.existsSync(cssDir) ? fs.readdirSync(cssDir).filter(n => n.endsWith('.css')).sort((a, b) => fs.statSync(path.join(cssDir, b)).size - fs.statSync(path.join(cssDir, a)).size)[0] : null;
  const server = http.createServer((req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('content-type', 'application/javascript'); res.end(built.outputFiles[0].text); }
    else if (req.url === '/style.css') { res.setHeader('content-type', 'text/css'); res.end(cssFile ? fs.readFileSync(path.join(cssDir, cssFile)) : 'body{font-family:Arial,sans-serif}table{width:100%}td,th{padding:12px}'); }
    else if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); }
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
    const errors = [], posts = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    // No request can reach Procore, QBO, production Analytics or any other site.
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    let run = null, activeMonth = null;
    const issues = ['Curing compound needs a price. PO-002; daily log 2026-09-12.'];
    const project = (projectId, projectName, status, message) => ({ projectId, projectName, status, stage: 'review', message, issues: [], issueSources: [], billNumber: `${projectName} 001` });
    await context.route('**/api/accounting/direct-cost-bills/batch*', async route => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON(); posts.push(body);
        run = { id: body.retryOf ? 'retry1' : 'run1', companyId: '1', month: '2026-09', status: 'running', createdAt: new Date().toISOString(), requestedBy: 'tester@example.test', total: body.retryOf ? 1 : 4, finished: 0, projects: [project('10', 'Existing bill', 'queued', 'Checking source data.')] }; activeMonth = '2026-09';
        return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ runId: run.id, month: '2026-09', dispatched: true, message: 'Monthly update started.' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, run, activeMonth, maxProjects, projects: [{ procoreProjectId: '10', projectName: 'Existing bill' }, { procoreProjectId: '20', projectName: 'New bill' }, { procoreProjectId: '30', projectName: 'Warehouse' }] }) });
    });
    let page = await context.newPage(); await page.goto(origin);
    const button = page.getByRole('button', { name: 'Update selected bills for 2026-09', exact: true }); await button.waitFor();
    assert.equal(await button.isDisabled(), true, 'No implicit all-project run');
    await page.getByRole('checkbox', { name: 'Existing bill', exact: true }).check();
    assert.equal(await page.getByRole('checkbox', { name: 'New bill', exact: true }).isDisabled(), maxProjects === 1);
    if (maxProjects > 1) {
      await page.getByRole('searchbox', { name: 'Find projects to update' }).fill('bill');
      await page.getByRole('button', { name: 'Select all shown', exact: true }).click();
      assert.equal(await page.getByRole('checkbox', { name: 'New bill', exact: true }).isChecked(), true);
      await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
      assert.equal(await button.isDisabled(), true);
      await page.getByRole('button', { name: 'Select all shown', exact: true }).click();
      await page.getByRole('searchbox', { name: 'Find projects to update' }).fill('');
      assert.equal(await page.getByRole('checkbox', { name: 'Warehouse', exact: true }).isChecked(), false, 'Search only selects visible projects');
      await page.getByRole('checkbox', { name: 'Warehouse', exact: true }).check();
      await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
      assert.equal(await page.getByRole('checkbox', { name: 'Warehouse', exact: true }).isChecked(), false);
      await page.getByRole('searchbox', { name: 'Find projects to update' }).fill('bill');
      await page.getByRole('button', { name: 'Select all shown', exact: true }).click();
    }
    await button.click();
    await page.getByText('A monthly update is running for 2026-09.', { exact: false }).waitFor();
    assert.equal(await button.isDisabled(), true); assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].projectIds, maxProjects === 1 ? ['10'] : ['10','20']);
    assert.equal(await page.getByTestId('running').textContent(), 'true');
    // Closing/reopening the page reads saved server progress without starting a run.
    await page.close();
    run = { ...run, status: 'complete', total: 4, finished: 4, projects: [project('10', 'Existing bill', 'updated', 'Bill updated.'), project('20', 'New bill', 'created', 'Bill created.'), project('40', 'No activity', 'empty', 'No eligible costs.'), { ...project('50', 'Missing catalog price', 'needs_attention', issues[0]), issues, issueSources: [{ message: issues[0], date: '2026-09-12', purchaseOrderId: '222' }] }] }; activeMonth = null;
    page = await context.newPage(); await page.goto(origin);
    await page.getByText('4 of 4 projects checked', { exact: false }).waitFor();
    assert.equal(posts.length, 1); assert.equal(await page.getByRole('row').count(), 4, 'Empty project hidden from results rows');
    assert.match(await page.getByRole('link', { name: 'Open PO', exact: false }).getAttribute('href'), /projects\/50\/tools\/contracts\/commitments\/purchase_order_contracts\/222$/);
    await page.getByRole('button', { name: 'Open review', exact: true }).click(); assert.equal(await page.getByTestId('selected').textContent(), '50');
    fs.mkdirSync('.tmp', { recursive: true }); await page.screenshot({ path: '.tmp/bill-batch-browser-results.png', fullPage: true });
    await page.getByRole('button', { name: 'Retry unresolved projects', exact: true }).click();
    await page.getByText('A monthly update is running for 2026-09.', { exact: false }).waitFor();
    assert.equal(posts.length, 2); assert.equal(posts[1].retryOf, 'run1'); assert.notEqual(posts[0].requestKey, posts[1].requestKey);
    assert.deepEqual(errors, []);
    t.diagnostic('Button, active-run lock, reopened saved results, PO link, review selection and unresolved retry passed. No external traffic.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
