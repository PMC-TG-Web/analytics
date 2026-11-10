import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { buildSteelNeeds } from '../src/lib/steelNeeds.ts';

const enabled = process.env.STEEL_NEEDS_BROWSER_TEST === '1';
const base = 'http://localhost:3000';
const source = { bidBoardId: 'b1', proposalId: 'e1', estimatedHours: 100, projectManagementHours: 0, allocatableHours: 100 };
const project = { key: 'p1', projectId: 'p1', projectName: 'Warehouse', projectNumber: '100', customer: 'Customer', projectManager: '', source, issue: null, plan: { revision: 1, source, allocations: [{ month: '2026-11', percent: 100 }], notes: '', updatedBy: '', updatedAt: '2026-11-10' } };
const line = { companyId: 'company', bidBoardProjectId: 'b1', proposalId: 'e1', lineItemId: 'l1', name: "#4 Rebar - 20' Pc", uom: 'EA', quantity: 100, syncedAt: '2026-11-10T12:00:00Z', payload: {} };
const projects = buildSteelNeeds('company', [project,
  { ...project, key: 'p2', projectId: 'p2', projectName: 'School', source: { ...source, bidBoardId: 'b2' }, plan: null },
], [{ ...line, quantity: 60 }, { ...line, lineItemId: 'footer', name: '#4 Rebar 2 Continuous Footer', quantity: 40 }, { ...line, bidBoardProjectId: 'b2', name: '#4 Rebar 10 ft Wall', quantity: 50 }, { ...line, lineItemId: 'wire', name: "Wire Mesh 6 ga 5'x10' Sheet", quantity: 20 }], [{ projectId: 'p1', dailyLogs: 2, timesheets: 3, firstActivity: '2026-11-01' }]);

test('Steel needs browser: grouping, project detail, filters, CSV, mobile and failed reload', { skip: !enabled, timeout: 120000 }, async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let fail = false;
  await page.context().addCookies([{ name: 'dev_user_email', value: 'todd@pmcdecor.com', url: base, sameSite: 'Lax' }]);
  // Refresh the signed permission cookie after adding a new page in a running dev session.
  assert.equal((await page.request.get(`${base}/api/permissions/me`)).status(), 200);
  await page.route('**/api/steel-needs', route => route.fulfill(fail ? { status: 503, json: { error: 'Unable to load Steel needs.' } } : { json: { projects, loadedAt: '2026-11-10T12:00:00Z', localOnly: false } }));
  try {
    await page.goto(`${base}/steel-needs`, { waitUntil: 'networkidle' });
    const table = page.getByRole('table', { name: 'Steel totals by description', exact: true });
    await table.getByText('150', { exact: true }).waitFor();
    await table.getByRole('button', { name: /#4 Rebar/ }).click();
    const detail = page.getByRole('table', { name: `Projects for ${line.name}`, exact: true });
    assert.match(await detail.innerText(), /Warehouse/); assert.match(await detail.innerText(), /School/);
    await page.getByLabel('Project status', { exact: true }).selectOption('not-started');
    assert.equal(await table.getByRole('button', { name: /Wire Mesh/ }).count(), 0);
    await table.getByText('50', { exact: true }).first().waitFor();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export order worksheet' }).click()]);
    const csv = await readFile(await download.path(), 'utf8');
    assert.match(csv, /School/); assert.doesNotMatch(csv, /Warehouse/); assert.match(csv, /"50"/);
    await page.getByLabel('Planned start through', { exact: true }).fill('2026-11');
    await page.getByText('No steel quantities match these filters.', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Export order worksheet' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await page.getByRole('button', { name: 'By project', exact: true }).click();
    await page.locator('summary').filter({ hasText: 'Warehouse' }).click();
    await page.getByRole('table', { name: 'Steel for Warehouse', exact: true }).waitFor();
    await page.getByText('2 daily-log entries · 3 timesheet entries', { exact: false }).waitFor();
    await page.getByLabel('Search description or project', { exact: true }).fill('School');
    assert.equal(await page.locator('summary').filter({ hasText: 'Warehouse' }).count(), 0);
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await page.getByRole('button', { name: 'By description', exact: true }).click();
    await mkdir('outputs/steel-needs', { recursive: true });
    await page.screenshot({ path: 'outputs/steel-needs/desktop-fixture.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no page-level overflow');
    await page.screenshot({ path: 'outputs/steel-needs/mobile-fixture.png', fullPage: true });
    fail = true;
    await page.getByRole('button', { name: 'Refresh saved data' }).click();
    await page.getByRole('alert').filter({ hasText: 'Unable to load Steel needs.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Export order worksheet' }).isDisabled(), true);
    assert.equal(await table.count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
