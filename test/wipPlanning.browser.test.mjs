import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

test('PM allocates across years, reviews history and retains unsaved edits after conflicts', { skip: process.env.WIP_BROWSER_TEST !== '1', timeout: 90_000 }, async () => {
  const require = createRequire(import.meta.url);
  const esbuild = require(process.env.WIP_TEST_ESBUILD || path.join(process.env.APPDATA, 'npm/node_modules/netlify-cli/node_modules/esbuild/lib/main.js'));
  const postcss = require('postcss');
  const tailwind = require('@tailwindcss/postcss');
  const entry = `import React from 'react';import{createRoot}from'react-dom/client';import Page from ${JSON.stringify(path.resolve('src/app/wip/page.tsx'))};createRoot(document.getElementById('root')).render(<Page/>);`;
  const built = await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, write: false, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': path.resolve('src') }, define: { 'process.env.NODE_ENV': '"test"' } });
  const stylesheet = await postcss([tailwind()]).process(readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', req.url === '/bundle.js' ? 'application/javascript' : req.url === '/style.css' ? 'text/css' : 'text/html');
    res.end(req.url === '/bundle.js' ? built.outputFiles[0].text : req.url === '/style.css' ? stylesheet.css : '<html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], posts = [];
    page.on('pageerror', error => errors.push(error.message));
    const source = { bidBoardId: '11', proposalId: '22', estimatedHours: 1200, projectManagementHours: 200, allocatableHours: 1000 };
    let plan = null, conflict = false;
    await page.route('**/api/wip*', async route => {
      if (route.request().method() === 'POST') {
        posts.push(route.request().postDataJSON());
        if (conflict) return route.fulfill({ status: 409, json: { error: 'Another user saved this plan. Reload before saving your changes.' } });
        const body = posts.at(-1);
        plan = { revision: body.revision + 1, source, allocations: body.allocations, notes: body.notes, updatedBy: 'pm@example.com', updatedAt: '2026-10-12T16:00:00Z' };
        return route.fulfill({ json: { plan } });
      }
      if (new URL(route.request().url()).searchParams.has('projectId')) return route.fulfill({ json: { history: [{ ...plan, createdBy: plan.updatedBy, createdAt: plan.updatedAt }] } });
      return route.fulfill({ json: { projects: [{ key: '101', projectId: '101', projectName: 'Project X', projectNumber: '2601', projectManager: 'PM One', customer: 'Example customer', source, fingerprint: 'current', issue: null, plan }] } });
    });
    await page.goto(origin);
    await page.getByRole('button', { name: 'Allocate months', exact: true }).click();
    await page.getByLabel('Month 1', { exact: true }).fill('2026-10');
    await page.getByLabel('Percentage 1', { exact: true }).fill('40');
    assert.equal(await page.getByRole('button', { name: 'Save allocation', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '+ Add month', exact: true }).click();
    await page.getByLabel('Percentage 2', { exact: true }).fill('40');
    await page.getByRole('button', { name: '+ Add month', exact: true }).click();
    await page.getByLabel('Month 3', { exact: true }).fill('2027-01');
    await page.getByLabel('Planning notes').fill('January work after the holiday break.');
    assert.equal(await page.getByRole('button', { name: 'Save allocation', exact: true }).isDisabled(), false);
    await page.getByRole('button', { name: 'Save allocation', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Saved Project X' }).waitFor();
    assert.deepEqual(posts[0].allocations, [{ month: '2026-10', percent: 40 }, { month: '2026-11', percent: 40 }, { month: '2027-01', percent: 20 }]);
    await page.getByLabel('12 months starting').fill('2026-10');
    assert.ok(await page.getByText('400 h', { exact: true }).count() >= 2);
    assert.ok(await page.getByText('200 h', { exact: true }).count() >= 1);
    if (process.env.WIP_SCREENSHOT) await page.screenshot({ path: process.env.WIP_SCREENSHOT, fullPage: true });
    await page.reload();
    await page.getByRole('button', { name: 'Edit allocation', exact: true }).click();
    await page.getByRole('button', { name: 'View revision history', exact: true }).click();
    await page.getByText(/Revision 1/).waitFor();
    conflict = true;
    await page.getByLabel('Planning notes').fill('Keep my unsaved update.');
    await page.getByRole('button', { name: 'Save allocation', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Another user saved' }).waitFor();
    assert.equal(await page.getByLabel('Planning notes').inputValue(), 'Keep my unsaved update.');
    assert.equal(await page.getByRole('button', { name: 'Refresh', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByLabel('Find a job').fill('No match');
    await page.getByText('No jobs match these filters.', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
