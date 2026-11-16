import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { buildSteelNeeds } from '../src/lib/steelNeeds.ts';

const enabled = process.env.STEEL_NEEDS_BROWSER_TEST === '1';
// The page needs the local developer sign-in. Point this at another local server when port 3000 runs a checkout without it.
const base = process.env.STEEL_NEEDS_BROWSER_BASE || 'http://localhost:3000';
const actor = 'todd@pmcdecor.com', stamp = '2026-11-11T02:00:00Z';
const source = { bidBoardId: 'b1', proposalId: 'e1', estimatedHours: 100, projectManagementHours: 0, allocatableHours: 100 };
const project = { key: 'p1', projectId: 'p1', projectName: 'Warehouse', projectNumber: '100', customer: 'Customer', projectManager: '', source, issue: null, plan: { revision: 1, source, allocations: [{ month: '2026-11', percent: 100 }], notes: '', updatedBy: '', updatedAt: '2026-11-10' } };
const line = { companyId: 'company', bidBoardProjectId: 'b1', proposalId: 'e1', lineItemId: 'l1', name: "#4 Rebar - 20' Pc", uom: 'EA', quantity: 100, syncedAt: '2026-11-10T12:00:00Z', payload: {} };
const projects = buildSteelNeeds('company', [project,
  { ...project, key: 'p2', projectId: 'p2', projectName: 'School', source: { ...source, bidBoardId: 'b2' }, plan: null },
], [{ ...line, quantity: 60 }, { ...line, lineItemId: 'footer', name: '#4 Rebar 2 Continuous Footer', quantity: 40 }, { ...line, bidBoardProjectId: 'b2', name: '#4 Rebar 10 ft Wall', quantity: 50 },
  { ...line, lineItemId: 'wire', name: "Wire Mesh 6 ga (2.9x2.9 6x6) 5'x10' Sheet", quantity: 12 },
  { ...line, lineItemId: 'wire-sog', name: 'Wire Mesh 6 ga - House Keeping Pds', quantity: 8 },
  { ...line, lineItemId: 'wire-w4', name: "Wire Mesh 6x6 W4.0 W4.0 5'x10' Sheet", quantity: 10 },
  { ...line, lineItemId: 'wire-4ga', name: "Wire Mesh 4 ga 5'x10' Sheet", quantity: 5 },
  { ...line, lineItemId: 'wire-large', name: "Wire Mesh 6 ga (6x6) 8'x15' Sheet", quantity: 7 },
], [{ projectId: 'p1', dailyLogs: 2, timesheets: 3, firstActivity: '2026-11-01' }]);

async function settle(read, expected, message) {
  const deadline = Date.now() + 10000; let actual;
  do {
    actual = await read();
    try { assert.deepEqual(actual, expected); return; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  } while (Date.now() < deadline);
  assert.deepEqual(actual, expected, message);
}

test('Steel needs browser: by-job orders, order log, undo, corrections, buying list, filters, CSV, mobile and failed reload', { skip: !enabled, timeout: 120000 }, async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let fail = false, failSave = false, ids = 0;
  let saveGate = null, releaseSave;
  const fixtureProjects = structuredClone(projects);
  for (const row of fixtureProjects) for (const item of row.items) { item.orderSnapshot = 'fixture-snapshot'; item.log = []; }
  // A total saved before the order log existed has no log lines.
  fixtureProjects[0].items.find(item => item.description === "Wire Mesh 4 ga 5'x10'").order = { revision: 1, orderedAt: '2026-11-05T15:00:00Z', quantity: 5, estimateQuantity: 15 };
  await page.context().addCookies([{ name: 'dev_user_email', value: actor, url: base, sameSite: 'Lax' }]);
  // Refresh the signed permission cookie after adding a new page in a running dev session.
  assert.equal((await page.request.get(`${base}/api/permissions/me`)).status(), 200);
  await page.route('**/api/steel-needs', async route => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON();
      if (input.projectId === 'p1' && saveGate) await saveGate;
      if (failSave) return route.fulfill({ status: 503, json: { error: 'Unable to save the order. Refresh saved data before retrying.' } });
      const item = fixtureProjects.find(row => row.projectId === input.projectId)?.items.find(material => material.key === input.itemKey);
      assert.ok(item); assert.equal(input.quantity, item.quantity); assert.equal(input.revision, item.order?.revision || 0);
      assert.equal(input.orderSnapshot, item.orderSnapshot);
      const total = item.order?.quantity || 0;
      const record = (kind, quantity) => item.log.push({ id: `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`, kind, quantity, createdAt: stamp, createdBy: actor, voidedAt: null, voidedBy: null });
      let next;
      if (input.undoEntryId) {
        const target = item.log.find(entry => entry.id === input.undoEntryId && !entry.voidedAt);
        assert.ok(target); target.voidedAt = stamp; target.voidedBy = actor; next = Math.max(0, total - target.quantity);
      } else if (input.addQuantity !== undefined) {
        assert.ok(input.addQuantity > 0); assert.equal(input.orderedQuantity, undefined);
        record('order', input.addQuantity); next = total + input.addQuantity;
      } else {
        assert.equal(input.ordered, input.orderedQuantity > 0);
        if (input.orderedQuantity !== total) record('correction', input.orderedQuantity - total);
        next = input.orderedQuantity;
      }
      item.order = { revision: input.revision + 1, orderedAt: next > 0 ? stamp : null, quantity: next > 0 ? next : null, estimateQuantity: next > 0 ? item.quantity : null };
      return route.fulfill({ json: { order: item.order, log: item.log } });
    }
    return route.fulfill(fail ? { status: 503, json: { error: 'Unable to load Steel needs.' } } : { json: { projects: fixtureProjects, loadedAt: '2026-11-10T12:00:00Z', localOnly: false } });
  });
  const material = (name, job) => {
    const label = `${name} for ${job}`, group = page.getByRole('group', { name: label, exact: true });
    return { group, stats: () => group.locator('dd').allInnerTexts(),
      quantity: page.getByRole('spinbutton', { name: `Order quantity for ${label}`, exact: true }),
      add: page.getByRole('button', { name: `Add order for ${label}`, exact: true }),
      rest: page.getByRole('button', { name: `Order the rest of ${label}`, exact: true }),
      log: page.getByRole('list', { name: `Order log for ${label}`, exact: true }),
      total: page.getByRole('spinbutton', { name: `Total ordered for ${label}`, exact: true }),
      setTotal: page.getByRole('button', { name: `Set total ordered for ${label}`, exact: true }) };
  };
  const job = name => page.getByRole('region', { name: `Steel for ${name}`, exact: true });
  const refresh = page.getByRole('button', { name: 'Refresh saved data' });
  const exportList = page.getByRole('button', { name: 'Export buying list' });
  try {
    await page.goto(`${base}/steel-needs`, { waitUntil: 'networkidle' });
    const rebar = material(line.name, 'Warehouse'), school = material(line.name, 'School');
    const schoolToggle = page.getByRole('button', { name: 'School', exact: true }), warehouseToggle = page.getByRole('button', { name: 'Warehouse', exact: true });
    const collapseAll = page.getByRole('button', { name: 'Collapse all', exact: true }), expandAll = page.getByRole('button', { name: 'Expand all', exact: true });
    await job('Warehouse').waitFor();
    // Jobs are listed soonest planned start first and start collapsed to a one-line summary.
    assert.deepEqual(await page.getByRole('region', { name: /^Steel for / }).evaluateAll(sections => sections.map(section => section.getAttribute('aria-label'))), ['Steel for Warehouse', 'Steel for School']);
    assert.equal(await warehouseToggle.getAttribute('aria-expanded'), 'false'); assert.equal(await schoolToggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await rebar.group.isVisible(), false); assert.equal(await school.group.isVisible(), false);
    assert.equal(await collapseAll.isDisabled(), true);
    await page.getByText('2 jobs · click a job to open it', { exact: true }).waitFor();
    await job('Warehouse').getByText('4 of 4 left to order', { exact: true }).waitFor();
    const started = job('Warehouse').getByText('Started', { exact: true }), notStarted = job('School').getByText('No start month', { exact: true });
    await started.waitFor(); await notStarted.waitFor();
    assert.match(await started.getAttribute('class'), /text-emerald-700/, 'started work is green');
    assert.match(await notStarted.getAttribute('class'), /text-red-700/, 'work not started is red');
    assert.doesNotMatch(await job('Warehouse').innerText(), /Starts /, 'a started job no longer shows its planned start month');
    await mkdir('outputs/steel-needs', { recursive: true });
    await page.screenshot({ path: 'outputs/steel-needs/order-log-collapsed.png', fullPage: true });
    await warehouseToggle.click();
    assert.equal(await rebar.group.isVisible(), true); assert.equal(await school.group.isVisible(), false);
    await page.getByText('2 jobs · 1 open', { exact: true }).waitFor();
    await expandAll.click();
    assert.equal(await expandAll.isDisabled(), true);
    // Every line reads needed, ordered, left to order.
    assert.deepEqual(await rebar.stats(), ['100', '0', '100']);
    assert.deepEqual(await school.stats(), ['50', '0', '50']);
    assert.equal(await rebar.add.isDisabled(), true, 'nothing to add until a quantity is typed');
    assert.equal(await rebar.log.count(), 0, 'no order log before anything is ordered');

    // A deliberately held save shows Saving without changing totals or blocking another job.
    saveGate = new Promise(resolve => { releaseSave = resolve; });
    await rebar.quantity.fill('30');
    await rebar.add.click();
    await rebar.group.getByText('Saving…', { exact: true }).waitFor();
    assert.equal(await rebar.quantity.isDisabled(), true);
    assert.deepEqual(await rebar.stats(), ['100', '0', '100'], 'only confirmed saves change totals');
    assert.equal(await refresh.isDisabled(), true); assert.equal(await exportList.isDisabled(), true);
    await school.rest.click();
    await settle(school.stats, ['50', '50', '0']);
    await job('School').getByText('All steel ordered', { exact: true }).waitFor();
    assert.equal(await school.rest.count(), 0);
    saveGate = null; releaseSave();
    await settle(rebar.stats, ['100', '30', '70']);
    assert.equal(await rebar.quantity.inputValue(), '', 'the box clears after a confirmed order');

    // A second order adds to the first; the log lists both.
    await rebar.quantity.fill('40');
    await rebar.add.click();
    await settle(rebar.stats, ['100', '70', '30']);
    await rebar.group.getByText('Order log · 2 orders · last change 11/10/2026', { exact: true }).click();
    assert.deepEqual(await rebar.log.getByRole('listitem').evaluateAll(rows => rows.map(row => row.firstElementChild.textContent)),
      [`11/10/2026 · Ordered 30 pieces · ${actor}`, `11/10/2026 · Ordered 40 pieces · ${actor}`]);

    // Undo removes just that order, keeps it visible, and leaves the log open.
    await rebar.log.getByRole('button', { name: /^Undo order of 30 / }).click();
    await settle(rebar.stats, ['100', '40', '60']);
    assert.equal(await rebar.log.isVisible(), true);
    await rebar.log.getByText('Undone 11/10/2026', { exact: false }).waitFor();
    assert.equal(await rebar.log.getByRole('button', { name: /^Undo / }).count(), 1);
    await rebar.group.getByText('Order log · 1 order · last change 11/10/2026', { exact: true }).waitFor();

    // Fixing the total replaces it and is noted in the log.
    assert.equal(await rebar.total.inputValue(), '40');
    assert.equal(await rebar.setTotal.isDisabled(), true);
    await rebar.total.fill('45');
    await rebar.setTotal.click();
    await settle(rebar.stats, ['100', '45', '55']);
    await rebar.log.getByText(`11/10/2026 · Total corrected +5 pieces · ${actor}`, { exact: true }).waitFor();

    // A failed save names the job and material, keeps the totals and keeps what was typed.
    failSave = true;
    await rebar.quantity.fill('10');
    await rebar.add.click();
    await page.getByRole('alert').filter({ hasText: `Warehouse · ${line.name}: Unable to save the order.` }).waitFor();
    assert.deepEqual(await rebar.stats(), ['100', '45', '55']);
    assert.equal(await rebar.quantity.inputValue(), '10');
    failSave = false;
    await rebar.rest.click();
    await settle(rebar.stats, ['100', '100', '0']);
    await job('Warehouse').getByText('3 of 4 left to order', { exact: true }).waitFor();

    // A job closes back to its one-line summary and keeps what was typed; open jobs stay open across tabs.
    await school.quantity.fill('7');
    await schoolToggle.click();
    assert.equal(await schoolToggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await school.group.isVisible(), false); assert.equal(await rebar.group.isVisible(), true);
    await job('School').getByText('All steel ordered', { exact: true }).waitFor();
    await schoolToggle.click();
    assert.equal(await school.quantity.inputValue(), '7');
    await school.quantity.fill('');
    await collapseAll.click();
    assert.equal(await rebar.group.isVisible(), false); assert.equal(await school.group.isVisible(), false);
    await job('Warehouse').getByText('3 of 4 left to order', { exact: true }).waitFor();
    await warehouseToggle.click();
    await page.getByRole('button', { name: 'Buying list', exact: true }).click();
    await page.getByRole('button', { name: 'By job', exact: true }).click();
    assert.equal(await rebar.group.isVisible(), true); assert.equal(await school.group.isVisible(), false);
    await expandAll.click();
    assert.equal(await school.group.isVisible(), true);
    await rebar.group.locator('summary').click();

    // A total saved before the log existed is shown as such.
    const earlier = material("Wire Mesh 4 ga 5'x10'", 'Warehouse');
    assert.deepEqual(await earlier.stats(), ['15', '5', '10']);
    await earlier.group.getByText('Order log · earlier total only · last change 11/05/2026', { exact: true }).click();
    await earlier.log.getByText('Recorded before the order log · +5 pieces', { exact: true }).waitFor();
    assert.doesNotMatch(await page.getByRole('main').innerText(), /2.9x2.9|6x6|SOG|House Keeping|W4\.0/);

    await mkdir('outputs/steel-needs', { recursive: true });
    await page.evaluate(() => { window.scrollTo(0, 0); });
    await page.screenshot({ path: 'outputs/steel-needs/order-log-by-job.png', fullPage: true });

    // Hide fully ordered leaves only what still needs ordering.
    const hide = page.getByRole('checkbox', { name: 'Hide fully ordered', exact: true });
    await hide.check();
    assert.equal(await rebar.group.count(), 0); assert.equal(await job('School').count(), 0); assert.equal(await earlier.group.count(), 1);
    await hide.uncheck();
    await school.group.locator('summary').click();
    await school.log.getByRole('button', { name: /^Undo order of 50 / }).click();
    await settle(school.stats, ['50', '0', '50']);
    await school.group.getByText('Order log · no orders now', { exact: true }).waitFor();

    // Buying list: one line per material, added up across jobs, with whole bundles on what is left.
    await page.getByRole('button', { name: 'Buying list', exact: true }).click();
    const buying = page.getByRole('table', { name: 'Steel buying list', exact: true });
    const buyingRebar = buying.getByRole('row').filter({ has: page.locator('summary').filter({ hasText: line.name }) });
    const buyingValues = () => buyingRebar.getByRole('cell').evaluateAll(cells => cells.slice(1).map(cell => cell.firstChild?.textContent));
    assert.deepEqual(await buyingValues(), ['150', '100', '50', '2']);
    await buyingRebar.getByText('EA · 150 pcs / bundle', { exact: true }).waitFor();
    await buyingRebar.getByRole('cell').nth(3).getByText('150 pcs · 100 extra', { exact: true }).waitFor();
    assert.equal(await page.getByRole('spinbutton', { name: /^Order quantity/ }).count(), 0, 'orders are recorded only under By job');
    await hide.check();
    await buyingRebar.locator('summary').click();
    const buyingJobs = page.getByRole('list', { name: `Jobs for ${line.name}`, exact: true });
    assert.match(await buyingJobs.innerText(), /School/); assert.doesNotMatch(await buyingJobs.innerText(), /Warehouse/);
    await buyingJobs.getByText('Needed 50 · Ordered 0 · Left to order 50', { exact: true }).waitFor();
    await page.screenshot({ path: 'outputs/steel-needs/order-log-buying-list.png', fullPage: true });
    const [listDownload] = await Promise.all([page.waitForEvent('download'), exportList.click()]);
    assert.equal(listDownload.suggestedFilename(), 'steel-buying-list-needed.csv');
    const listCsv = await readFile(await listDownload.path(), 'utf8');
    const rebarLine = listCsv.split('\r\n').find(row => row.startsWith(`"${line.name}"`));
    assert.match(listCsv, /"Left to order"/); assert.match(listCsv, /Left to order only/);
    assert.match(rebarLine, /"EA","50","100 · School"/); assert.doesNotMatch(rebarLine, /Warehouse/);
    const [detailDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export job detail' }).click()]);
    const detailCsv = await readFile(await detailDownload.path(), 'utf8');
    assert.match(detailCsv, /"Order log \(Eastern\)"/);
    assert.match(detailCsv, /"Fully ordered","0","11\/10\/2026 \+40; 11\/10\/2026 \+5 \(correction\); 11\/10\/2026 \+55"/);
    assert.match(detailCsv, /"Partially ordered","10","Before order log \+5"/);
    await hide.uncheck();

    // Saved orders and the log survive a reload. Jobs are collapsed again; choosing one job opens it.
    await page.reload({ waitUntil: 'networkidle' });
    await job('Warehouse').waitFor();
    assert.equal(await rebar.group.isVisible(), false);
    await page.getByLabel('Job', { exact: true }).selectOption('p1');
    await settle(rebar.stats, ['100', '100', '0']);
    assert.equal(await job('School').count(), 0);
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    assert.equal(await rebar.group.isVisible(), true); assert.equal(await school.group.isVisible(), false);
    await expandAll.click();
    await rebar.group.locator('summary').click();
    assert.equal(await rebar.log.getByRole('listitem').count(), 4);

    // Filters share one scope across both tabs.
    await page.getByLabel('Search material or job', { exact: true }).fill('School');
    assert.equal(await job('Warehouse').count(), 0); assert.equal(await job('School').count(), 1);
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await page.getByText('More filters', { exact: true }).click();
    await page.getByLabel('Field work', { exact: true }).selectOption('not-started');
    assert.equal(await job('Warehouse').count(), 0); assert.equal(await job('School').count(), 1);
    await page.getByText('More filters (1 on)', { exact: true }).waitFor();
    await page.getByLabel('Starting by', { exact: true }).fill('2026-11');
    await page.getByText('No jobs with steel match these filters.', { exact: false }).waitFor();
    assert.equal(await exportList.isDisabled(), true);
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    assert.equal(await job('Warehouse').count(), 1);

    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no page-level overflow by job');
    assert.ok(await rebar.group.evaluate(element => element.scrollWidth <= element.clientWidth), 'a job line fits a phone without sideways scrolling');
    await page.evaluate(() => { window.scrollTo(0, 0); });
    await page.screenshot({ path: 'outputs/steel-needs/order-log-mobile-by-job.png', fullPage: true });
    await page.getByRole('button', { name: 'Buying list', exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no page-level overflow on the buying list');
    assert.ok(await buying.evaluate(element => element.parentElement.scrollWidth <= element.parentElement.clientWidth), 'the buying list fits a phone without sideways scrolling');
    await page.evaluate(() => { window.scrollTo(0, 0); });
    await page.screenshot({ path: 'outputs/steel-needs/order-log-mobile-buying-list.png', fullPage: true });

    fail = true;
    await refresh.click();
    await page.getByRole('alert').filter({ hasText: 'Unable to load Steel needs.' }).waitFor();
    assert.equal(await exportList.isDisabled(), true);
    assert.equal(await buying.count(), 0);
    assert.equal(await page.getByRole('region', { name: /^Steel for / }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { releaseSave?.(); await browser.close(); }
});
