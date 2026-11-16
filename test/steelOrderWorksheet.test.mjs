import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateSteelNeeds, filterSteelProjects, steelJobTotals, steelOrderQuantities } from '../src/lib/steelNeeds.ts';
import { steelOrderWorksheet, steelOrderWorksheetCsv } from '../src/lib/steelOrderWorksheet.ts';

const item = { key: 'rebar-ea', description: "#4 Rebar - 20' Pc", kind: 'Rebar', unit: 'EA', quantity: 100, order: null, lineCount: 1 };
const order = quantity => ({ quantity, orderedAt: '2026-11-11T02:00:00Z', revision: 1 });
const project = (key, quantity, saved, started = false) => ({ key, projectId: key, projectName: `Job ${key}`, projectNumber: key, customer: '', started, plannedStart: '2026-11', items: [{ ...item, quantity, order: saved }], issues: [] });
const filters = { status: '', kind: '', query: '', projectId: '', through: '', timing: '' };

test('worksheet aggregates confirmed order quantities and calculates outstanding need separately for each project', () => {
  const projects = [project('1', 100, order(80), true), project('2', 50, order(70)), project('3', 30, null)];
  const total = aggregateSteelNeeds(projects)[0];
  assert.equal(total.quantity, 180);
  assert.equal(total.orderedQuantity, 150);
  assert.equal(total.toOrderQuantity, 50, 'surplus 20 on Job 2 cannot cancel need on Job 1 or Job 3');
  assert.equal(total.startedQuantity, 100); assert.equal(total.notStartedQuantity, 80);
  assert.equal(total.changedOrders, 2);
  assert.deepEqual(steelOrderWorksheet(projects, 'needed')[0].projects.map(row => row.project.key), ['1', '3']);
  assert.deepEqual(steelOrderWorksheet(projects, 'ordered')[0].projects.map(row => row.project.key), ['1', '2']);
});

test('a cleared check restores full need; unchanged estimates reconcile and invalid saved amounts stay visible for review', () => {
  assert.deepEqual(steelOrderQuantities({ ...item, order: order(100) }), { orderedQuantity: 100, toOrderQuantity: 0, changed: false });
  assert.deepEqual(steelOrderQuantities({ ...item, order: { ...order(100), orderedAt: null } }), { orderedQuantity: 0, toOrderQuantity: 100, changed: false });
  assert.deepEqual(steelOrderQuantities({ ...item, order: order(null) }), { orderedQuantity: 0, toOrderQuantity: 100, changed: true });
  assert.equal(steelOrderQuantities({ ...item, quantity: 1.1, order: order(0.3) }).toOrderQuantity, 0.8);
  assert.deepEqual(steelOrderWorksheet([project('1', 100, order(100))], 'needed'), []);
  assert.deepEqual(steelOrderWorksheet([project('1', 100, null)], 'ordered'), []);
});

test('job header totals keep material types and units apart, never let a surplus cover another size, and convert rebar to bundles without rounding', () => {
  const job = project('1', 100, order(130));
  job.items.push({ ...item, key: 'rebar-5', description: "#5 Rebar - 20' Pc", quantity: 40, order: order(10) },
    { ...item, key: 'rebar-lf', unit: 'LF', quantity: 20 },
    { ...item, key: 'wire', kind: 'Wire', description: "Wire Mesh 6 ga 5'x10'", quantity: 12 });
  assert.deepEqual(steelJobTotals(job), [
    // #4: 100 needed, 130 ordered, 0 left. #5: 40 needed, 10 ordered, 30 left, which is 30 / 96 = 0.3125 bundles.
    { kind: 'Rebar', unit: 'EA', needed: 140, ordered: 140, left: 30, bundles: { needed: 1.0833, ordered: 0.9708, left: 0.3125, partial: false } },
    { kind: 'Rebar', unit: 'LF', needed: 20, ordered: 0, left: 20, bundles: null },
    { kind: 'Wire', unit: 'EA', needed: 12, ordered: 0, left: 12, bundles: null },
  ]);
  job.items.push({ ...item, key: 'dowels', description: 'Rebar dowels', quantity: 5 });
  const [rebar] = steelJobTotals(job);
  assert.equal(rebar.needed, 145); assert.equal(rebar.left, 35);
  assert.deepEqual(rebar.bundles, { needed: 1.0833, ordered: 0.9708, left: 0.3125, partial: true }, 'sizes without a bundle size are left out and flagged');
  assert.deepEqual(steelJobTotals({ items: [] }), []);
});

test('worksheet and exports honor project/activity filters, keep units separate, and export aggregated lines with contributing jobs', () => {
  const projects = [project('1', 100, order(100), true), project('2', 50, null)];
  projects[0].items.push({ ...item, key: 'rebar-lf', unit: 'LF', quantity: 20 });
  assert.equal(steelOrderWorksheet(projects, 'all').length, 2);
  const unstarted = filterSteelProjects(projects, { ...filters, status: 'not-started' });
  assert.equal(steelOrderWorksheet(unstarted, 'all')[0].toOrderQuantity, 50);
  assert.equal(steelOrderWorksheet(filterSteelProjects(projects, { ...filters, projectId: '1' }), 'all')[0].orderedQuantity, 100);
  const needed = steelOrderWorksheetCsv(projects, 'needed', 'All projects', '2026-11-10');
  assert.match(needed, /"Left to order"/); assert.match(needed, /"EA","50","2 · Job 2"/);
  const ordered = steelOrderWorksheetCsv(projects, 'ordered', 'All projects', '2026-11-10');
  assert.equal(ordered.split('\r\n').length, 2); assert.match(ordered, /"EA","100","1 · Job 1","11\/10\/2026"/); assert.doesNotMatch(ordered, /Job 2/);
  const all = steelOrderWorksheetCsv(projects, 'all', 'All projects', '2026-11-10');
  assert.match(all, /"EA","150","100","50"/);
  const unsafe = [project('1', 120, order(100))]; unsafe[0].projectName = '=formula'; unsafe[0].projectNumber = ''; unsafe[0].items[0].description = '=description';
  const escaped = steelOrderWorksheetCsv(unsafe, 'all', '=scope', 'now');
  assert.match(escaped, /"'=description"/); assert.match(escaped, /"'=formula"/); assert.match(escaped, /"'=scope"/); assert.match(escaped, /Estimate changed/);
});
