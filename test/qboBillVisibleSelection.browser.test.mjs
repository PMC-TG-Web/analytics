import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

test('bulk selection submits only available projects in the filtered bill table', { skip: process.env.QBO_BATCH_BROWSER_TEST !== '1', timeout: 90_000 }, async () => {
  const require = createRequire(import.meta.url);
  const esbuild = require(process.env.QBO_BATCH_TEST_ESBUILD || path.join(process.env.APPDATA, 'npm/node_modules/netlify-cli/node_modules/esbuild/lib/main.js'));
  const entry = `import React,{useState,useCallback} from 'react';import{createRoot}from'react-dom/client';
import Batch from ${JSON.stringify(path.resolve('src/app/accounting/direct-cost-bills/MonthlyBillBatch.tsx'))};
import Queue from ${JSON.stringify(path.resolve('src/app/accounting/direct-cost-bills/ProjectBillQueue.tsx'))};
const noop=()=>{};
function App(){const[ids,setIds]=useState(null);const[loading,setLoading]=useState(false);const visible=useCallback((_company,_month,ids)=>setIds(ids),[]);return <><Batch companyId="1" month="2026-09" visibleProjectIds={ids} refreshing={loading&&ids!==null} disabled={loading} onRunning={noop} onComplete={noop} onReview={noop}/><Queue companyId="1" month="2026-09" revision={0} disabled={false} selectedProjectId="" onReview={noop} onLoading={setLoading} onVisibleProjects={visible} expandedContent={null}/></>}
createRoot(document.getElementById('root')).render(<App/>);`;
  const built = await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, write: false, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': path.resolve('src') }, define: { 'process.env.NODE_ENV': '"test"' } });
  const server = http.createServer((req, res) => { res.setHeader('content-type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html'); res.end(req.url === '/bundle.js' ? built.outputFiles[0].text : '<!doctype html><html><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    const errors = [], posts = [];
    page.on('pageerror', error => errors.push(error.message));
    const projects = [{ procoreProjectId: '10', projectName: 'Existing bill' }, { procoreProjectId: '20', projectName: 'New bill' }, { procoreProjectId: '30', projectName: 'Current bill' }, { procoreProjectId: '40', projectName: 'No costs' }, { procoreProjectId: '99', projectName: 'Not in table' }];
    let failQueue = false, holdQueue = false, releaseQueue = () => {};
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.endsWith('/batch')) {
        if (route.request().method() === 'POST') { posts.push(route.request().postDataJSON()); return route.fulfill({ status: 202, json: { month: '2026-09', message: 'Started' } }); }
        return route.fulfill({ json: { enabled: true, run: null, activeMonth: null, maxProjects: 100, projects } });
      }
      if (url.pathname === '/api/accounting/direct-cost-bills') {
        if (failQueue) return route.fulfill({ status: 400, json: { error: 'Queue temporarily unavailable' } });
        if (holdQueue) await new Promise(resolve => { releaseQueue = resolve; });
        assert.equal(url.searchParams.get('paged'), '1');
        const rows = projects.slice(0, 4).map((p, i) => ({ projectId: p.procoreProjectId, projectName: p.projectName, projectNumber: p.procoreProjectId, status: ['update', 'create', 'current', 'no_activity'][i], billNumber: null, gross: null, previousGross: null, laborHours: null, lastPosted: null, reasons: [] }));
        const after = url.searchParams.get('after');
        return route.fulfill({ json: { generatedAt: new Date().toISOString(), totalProjects: 4, nextCursor: after ? null : '20', rows: after ? rows.slice(2) : rows.slice(0, 2) } });
      }
      return route.continue();
    });
    await page.goto(origin);
    const all = page.getByRole('button', { name: 'Select all shown', exact: true });
    const submit = page.getByRole('button', { name: 'Update selected bills for 2026-09', exact: true });
    const selectAll = async () => { await all.click(); };
    await page.getByRole('checkbox', { name: 'Existing bill', exact: true }).waitFor();
    assert.equal(await page.getByRole('checkbox').count(), 2);
    await selectAll();
    await page.getByRole('combobox', { name: 'Bill status' }).selectOption('current');
    await page.getByRole('checkbox', { name: 'Current bill', exact: true }).waitFor();
    assert.equal(await submit.isDisabled(), true, 'Filtered-out selections cannot be submitted');
    await selectAll();
    await page.getByRole('combobox', { name: 'Bill status' }).selectOption('all');
    await page.getByRole('checkbox', { name: 'Existing bill', exact: true }).waitFor();
    assert.equal(await page.getByRole('checkbox').count(), 3, 'No-cost and absent table projects are not available');
    await page.getByRole('textbox', { name: 'Search projects' }).fill('Existing');
    await page.waitForFunction(() => document.querySelectorAll('input[type=checkbox]').length === 1);
    assert.equal(await submit.isDisabled(), true);
    await selectAll();
    await page.getByRole('searchbox', { name: 'Find projects to update' }).fill('nothing');
    assert.equal(await submit.isDisabled(), true);
    assert.equal(await all.isDisabled(), true);
    await page.getByRole('searchbox', { name: 'Find projects to update' }).fill('');
    await selectAll();
    holdQueue = true;
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await page.getByText('Refreshing status… 1 verified projects remain shown', { exact: true }).waitFor();
    assert.equal(await page.getByRole('checkbox', { name: 'Existing bill', exact: true }).count(), 1, 'Verified projects remain visible during a refresh');
    assert.equal(await page.getByRole('checkbox', { name: 'Existing bill', exact: true }).isDisabled(), true, 'The retained list cannot be submitted while its status refreshes');
    holdQueue = false; releaseQueue();
    await page.getByText('1 available projects shown', { exact: true }).waitFor();
    failQueue = true;
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Queue temporarily unavailable' }).waitFor();
    assert.equal(await submit.isDisabled(), true, 'An unavailable queue cannot authorize a stale selection');
    failQueue = false;
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Existing bill', exact: true }).waitFor();
    if (!await page.getByRole('checkbox', { name: 'Existing bill', exact: true }).isChecked()) await selectAll();
    await submit.click();
    await page.getByText('Started', { exact: true }).waitFor();
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].projectIds, ['10']);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
