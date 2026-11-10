import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateSteelNeeds, filterSteelProjects, steelOrderQuantities } from '../src/lib/steelNeeds.ts';
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

test('worksheet and exports honor project/activity filters, keep units separate, and export aggregated lines with contributing jobs', () => {
  const projects = [project('1', 100, order(100), true), project('2', 50, null)];
  projects[0].items.push({ ...item, key: 'rebar-lf', unit: 'LF', quantity: 20 });
  assert.equal(steelOrderWorksheet(projects, 'all').length, 2);
  const unstarted = filterSteelProjects(projects, { ...filters, status: 'not-started' });
  assert.equal(steelOrderWorksheet(unstarted, 'all')[0].toOrderQuantity, 50);
  assert.equal(steelOrderWorksheet(filterSteelProjects(projects, { ...filters, projectId: '1' }), 'all')[0].orderedQuantity, 100);
  const needed = steelOrderWorksheetCsv(projects, 'needed', 'All projects', '2026-11-10');
  assert.match(needed, /"Need to order"/); assert.match(needed, /"EA","50","2 · Job 2"/);
  const ordered = steelOrderWorksheetCsv(projects, 'ordered', 'All projects', '2026-11-10');
  assert.equal(ordered.split('\r\n').length, 2); assert.match(ordered, /"EA","100","1 · Job 1","11\/10\/2026"/); assert.doesNotMatch(ordered, /Job 2/);
  const all = steelOrderWorksheetCsv(projects, 'all', 'All projects', '2026-11-10');
  assert.match(all, /"EA","150","100","50"/);
  const unsafe = [project('1', 120, order(100))]; unsafe[0].projectName = '=formula'; unsafe[0].projectNumber = ''; unsafe[0].items[0].description = '=description';
  const escaped = steelOrderWorksheetCsv(unsafe, 'all', '=scope', 'now');
  assert.match(escaped, /"'=description"/); assert.match(escaped, /"'=formula"/); assert.match(escaped, /"'=scope"/); assert.match(escaped, /Estimate changed/);
});
