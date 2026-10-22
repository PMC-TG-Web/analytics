import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import * as XLSX from 'xlsx';
import { buildProjectUsageReport, usagePeriod } from '../src/lib/projectUsageReport.ts';

const enabled = process.env.PROJECT_USAGE_BROWSER_TEST === '1';
const base = process.env.PROJECT_USAGE_TEST_URL || 'http://localhost:3000';
const email = process.env.PROJECT_USAGE_TEST_EMAIL || 'todd@pmcdecor.com';
async function open() {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.context().addCookies([{ name: 'dev_user_email', value: email, url: base, sameSite: 'Lax' }]);
  return { browser, page };
}
function fixture() {
  const record = { id: 'one', sourceId: 'one', companyId: 'fixture', projectId: 'p1', source: 'Timecard', date: '2026-10-22',
    updatedAt: '2026-10-22T12:00:00Z', quantity: 8, worker: 'Test Worker', costCode: 'labor', description: 'Field labor' };
  return buildProjectUsageReport('fixture', usagePeriod(), [
    { procoreProjectId: 'p1', projectName: 'Test concrete project', projectNumber: '001', customer: 'Customer A', status: 'Active' },
    { procoreProjectId: 'p2', projectName: 'Second project', projectNumber: '002', customer: 'Customer B', status: 'Complete' },
  ], [record, { ...record, id: 'two', sourceId: 'two', source: 'Daily log', quantity: 30, costType: 'M', uom: 'CY',
    metadataMatches: 1, description: 'Concrete', costCode: '03-300-20-20', worker: null, holderId: 'po1', lineItemId: 'li1' }]);
}

test('report preview, full workbook download, date changes, errors and mobile layout', { skip: !enabled, timeout: 120_000 }, async () => {
  const { browser, page } = await open(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  let mode = 'success';
  await page.route('**/api/reporting/project-usage?*', route => {
    if (new URL(route.request().url()).searchParams.get('view') === 'projects') return route.fulfill({ json: { projects: fixture().projects } });
    if (mode === 'error') return route.fulfill({ status: 503, json: { error: 'Unable to load saved records. Please retry.' } });
    const report = fixture(); if (mode === 'empty') report.projects = [];
    return route.fulfill({ json: report });
  });
  try {
    await page.goto(`${base}/reporting`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Project labor & materials' }).waitFor();
    const download = page.getByRole('button', { name: 'Download Excel' });
    const projectFilter = page.getByLabel('Project', { exact: true });
    await projectFilter.selectOption('project:p1');
    await projectFilter.selectOption('all');
    assert.equal(await download.isDisabled(), true);
    await page.getByRole('button', { name: 'Run report', exact: true }).click();
    await page.getByRole('button', { name: 'Test concrete project', exact: true }).waitFor();
    await page.getByLabel('Search preview').fill('Test concrete');
    assert.equal(await page.getByRole('button', { name: 'Second project', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Test concrete project', exact: true }).click();
    assert.equal(await page.getByRole('heading', { name: 'Material quantities used', exact: true }).count(), 1);
    const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);
    const saved = XLSX.read(await readFile(await file.path()), { type: 'buffer' });
    assert.equal(saved.SheetNames.length, 6);
    assert.equal(saved.Sheets.Projects['!ref'], 'A1:J7', 'preview search must not narrow the workbook');
    assert.equal(saved.Sheets.Materials.I6.v, 30);
    await projectFilter.selectOption('project:p1');
    assert.equal(await page.getByRole('article').filter({ hasText: 'Projects' }).locator('strong').innerText(), '1');
    const [projectFile] = await Promise.all([page.waitForEvent('download'), download.click()]);
    const projectWorkbook = XLSX.read(await readFile(await projectFile.path()), { type: 'buffer' });
    assert.equal(projectWorkbook.Sheets.Projects['!ref'], 'A1:J6');
    assert.equal(projectWorkbook.Sheets.Projects.E6.v, 'p1');
    assert.equal(projectWorkbook.Sheets.Materials.C6.v, 'p1');
    await projectFilter.selectOption('project:p2');
    assert.equal(await page.getByRole('article').filter({ hasText: 'Timecard hours' }).locator('strong').innerText(), '0');
    assert.equal(await page.getByRole('button', { name: 'Second project', exact: true }).count(), 1);
    assert.equal(await page.getByRole('heading', { name: /usage details/ }).count(), 0);
    await projectFilter.selectOption('all');
    assert.equal(await page.getByRole('button', { name: 'Test concrete project', exact: true }).count(), 1);
    await page.getByLabel('From work date', { exact: true }).fill('2026-10-01');
    assert.equal(await download.isDisabled(), true);
    await page.getByRole('button', { name: 'All dates', exact: true }).click();
    assert.equal(await download.isDisabled(), false);
    await mkdir('.tmp/project-usage-check', { recursive: true });
    await page.screenshot({ path: path.resolve('.tmp/project-usage-check/desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page-wide horizontal overflow');
    await page.screenshot({ path: path.resolve('.tmp/project-usage-check/mobile.png'), fullPage: true });
    mode = 'error'; await page.getByRole('button', { name: 'Run report', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Unable to load saved records' }).waitFor();
    assert.equal(await download.isDisabled(), true);
    mode = 'empty'; await page.getByRole('button', { name: 'Run report', exact: true }).click();
    await page.getByText('No saved projects or usage records were found.', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('saved all-history report loads and exports the same complete data without external mutations', { skip: !enabled, timeout: 180_000 }, async () => {
  const { browser, page } = await open();
  try {
    await page.goto(`${base}/reporting`, { waitUntil: 'networkidle' });
    const start = Date.now();
    const response = await page.request.get(`${base}/api/reporting/project-usage`, { timeout: 120_000 });
    assert.equal(response.status(), 200, await response.text());
    const report = await response.json();
    assert.ok(report.projects.length > 0);
    assert.equal(new Set(report.projects.map(p => p.projectId)).size, report.projects.length);
    for (const project of report.projects) {
      const labor = report.labor.filter(r => r.projectId === project.projectId);
      const sum = source => labor.filter(r => r.source === source).reduce((n, r) => n + r.quantity, 0);
      assert.ok(Math.abs(project.timecardHours - sum('Timecard')) < 0.01);
      assert.ok(Math.abs(project.dailyLogHours - sum('Daily log')) < 0.01);
      assert.equal(project.materialLines, report.materials.filter(r => r.projectId === project.projectId).length);
    }
    console.log(JSON.stringify({ readMs: Date.now() - start, projects: report.projects.length, laborRows: report.labor.length,
      materialRows: report.materials.length, otherRows: report.other.length, reviewRows: report.review.length,
      responseBytes: Buffer.byteLength(JSON.stringify(report)) }));
    // Reuse the successful read for UI/export verification without another full database scan.
    await page.route('**/api/reporting/project-usage?*', route => route.fulfill({ json: report }));
    await page.getByRole('button', { name: 'Run report', exact: true }).click();
    await page.getByRole('button', { name: 'Download Excel' }).waitFor();
    const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Excel' }).click()]);
    const workbook = XLSX.read(await readFile(await file.path()), { type: 'buffer' });
    for (const [sheet, rows] of [['Projects', report.projects], ['Labor', report.labor], ['Materials', report.materials], ['Review', report.review]]) {
      const decoded = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { range: 4 });
      assert.equal(decoded.length, rows.length);
    }
  } finally { await browser.close(); }
});
