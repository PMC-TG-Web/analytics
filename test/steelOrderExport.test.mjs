import test from 'node:test';
import assert from 'node:assert/strict';
import { steelEasternDay, steelOrdersCsv, steelOrdersInRange } from '../src/lib/steelOrderExport.ts';

const entry = (id, quantity, createdAt, extra = {}) => ({ id, kind: 'order', quantity, createdAt, createdBy: 'buyer@example.com', voidedAt: null, voidedBy: null, ...extra });
const rebar = log => ({ key: 'rebar4', description: "#4 Rebar - 20' Pc", kind: 'Rebar', unit: 'EA', quantity: 500, lineCount: 1, order: null, log });
const wire = log => ({ key: 'wire', description: "Wire Mesh 6 ga 5'x10'", kind: 'Wire', unit: 'EA', quantity: 40, lineCount: 1, order: null, log });
const job = (key, projectName, items) => ({ key, projectId: key, projectName, projectNumber: `26-${key}`, items, issues: [] });
const projects = [
  job('1', 'Warehouse', [rebar([
    entry('a', 150, '2026-11-10T15:00:00Z'), entry('b', 75, '2026-11-12T15:00:00Z'),
    entry('c', 30, '2026-11-12T16:00:00Z', { voidedAt: '2026-11-12T17:00:00Z', voidedBy: 'buyer@example.com' }),
    entry('d', -25, '2026-11-12T18:00:00Z', { kind: 'correction' }),
  ]), wire([entry('e', 12, '2026-11-12T15:00:00Z')])]),
  // 03:30 UTC on the 12th is still the evening of the 11th in Eastern time.
  job('2', 'School', [rebar([entry('f', 150, '2026-11-12T03:30:00Z')])]),
  job('3', 'Barn', [rebar([entry('g', 10, '2026-11-12T15:00:00Z'), entry('h', -10, '2026-11-12T16:00:00Z', { kind: 'correction' })])]),
  // A total saved before the order log has no dated lines, so it can never be exported.
  job('4', 'Legacy', [{ ...rebar([]), order: { revision: 1, orderedAt: '2026-11-12T15:00:00Z', quantity: 60 } }]),
];
const pick = rows => rows.map(row => [row.description, row.quantity, row.bundles, row.projectName]);

test('the export holds only orders recorded in the Eastern date range: undone lines out, corrections netted', () => {
  assert.equal(steelEasternDay('2026-11-12T03:30:00Z'), '2026-11-11');
  const oneDay = steelOrdersInRange(projects, { from: '2026-11-12', to: '2026-11-12' });
  assert.deepEqual(pick(oneDay.rows), [["#4 Rebar - 20' Pc", 50, 0.3333, 'Warehouse'], ["Wire Mesh 6 ga 5'x10'", 12, null, 'Warehouse']],
    'the 150 from the 10th, the undone 30, the evening-before School order, the net-zero Barn and the undated Legacy total are all left out');
  assert.deepEqual([oneDay.orders, oneDay.jobs, oneDay.valid], [3, 1, true]);
});

test('a wider or open range lists each job that ordered a material, and an inverted range exports nothing', () => {
  for (const range of [{ from: '2026-11-10', to: '2026-11-12' }, { from: '', to: '' }, { from: '', to: '2026-11-12' }, { from: '2026-11-10', to: '' }]) {
    const result = steelOrdersInRange(projects, range);
    assert.deepEqual(pick(result.rows), [["#4 Rebar - 20' Pc", 150, 1, 'School'], ["#4 Rebar - 20' Pc", 200, 1.3333, 'Warehouse'], ["Wire Mesh 6 ga 5'x10'", 12, null, 'Warehouse']]);
    assert.deepEqual([result.orders, result.jobs], [5, 2]);
    assert.deepEqual(result.rows[1].days, ['2026-11-10', '2026-11-12']);
  }
  assert.deepEqual(steelOrdersInRange(projects, { from: '2026-11-13', to: '' }).rows, []);
  const inverted = steelOrdersInRange(projects, { from: '2026-11-13', to: '2026-11-12' });
  assert.deepEqual([inverted.rows.length, inverted.orders, inverted.valid], [0, 0, false]);
});

test('the orders file is one short row per job and material, keeps numbers numeric and neutralizes formulas', () => {
  const lines = steelOrdersCsv(projects, { from: '2026-11-10', to: '2026-11-12' }).replace('\uFEFF', '').split('\r\n');
  assert.deepEqual(lines, [
    '"Material","Unit","Quantity ordered","Bundles","Job number","Job","Order date"',
    '"#4 Rebar - 20\' Pc","EA","150","1","26-2","School","11/11/2026"',
    '"#4 Rebar - 20\' Pc","EA","200","1.33","26-1","Warehouse","11/10/2026; 11/12/2026"',
    '"Wire Mesh 6 ga 5\'x10\'","EA","12","","26-1","Warehouse","11/12/2026"',
    '', '', '', '', '',
    '"Material totals","Unit","Quantity ordered","Bundles","","",""',
    '"#4 Rebar - 20\' Pc","EA","350","2.33","","",""',
    '"Wire Mesh 6 ga 5\'x10\'","EA","12","","","",""',
  ]);
  const reduced = steelOrdersCsv([job('9', '=formula', [rebar([entry('z', -20, '2026-11-12T15:00:00Z', { kind: 'correction' })])])], { from: '2026-11-12', to: '2026-11-12' });
  assert.ok(reduced.split('\r\n').includes('"#4 Rebar - 20\' Pc","EA","-20","-0.13","26-9","\'=formula","11/12/2026"'), 'a negative correction stays a number; a formula-like name is neutralized');
  assert.ok(reduced.endsWith('"#4 Rebar - 20\' Pc","EA","-20","-0.13","","",""'));
});

test('material totals use the exported scope, keep units separate and convert bundles after aggregation', () => {
  const items = [1, 2, 3].map(id => job(String(id), `Job ${id}`, [rebar([entry(String(id), 1, '2026-11-12T15:00:00Z')])]));
  items[0].items.push({ ...rebar([entry('lf', 9, '2026-11-12T15:00:00Z')]), unit: 'LF' });
  const lines = steelOrdersCsv(items, { from: '2026-11-12', to: '2026-11-12' }).split('\r\n');
  assert.deepEqual(lines.slice(5, 10), ['', '', '', '', ''], 'exactly five blank rows after all four job rows');
  assert.deepEqual(lines.slice(10), [
    '"Material totals","Unit","Quantity ordered","Bundles","","",""',
    '"#4 Rebar - 20\' Pc","EA","3","0.02","","",""',
    '"#4 Rebar - 20\' Pc","LF","9","","","",""',
  ]);
  const filtered = steelOrdersCsv([items[0]], { from: '2026-11-12', to: '2026-11-12' });
  assert.ok(filtered.includes('"#4 Rebar - 20\' Pc","EA","1","0.01","","",""'));
  assert.equal(steelOrdersCsv(items, { from: '2026-11-13', to: '' }).split('\r\n').length, 1, 'no totals table without exported orders');
});
