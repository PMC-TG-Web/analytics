import test from 'node:test';
import assert from 'node:assert/strict';
import { steelEasternDay, steelOrderRangeLabel, steelOrdersCsv, steelOrdersInRange } from '../src/lib/steelOrderExport.ts';

const entry = (id, quantity, createdAt, extra = {}) => ({ id, kind: 'order', quantity, createdAt, createdBy: 'buyer@example.com', voidedAt: null, voidedBy: null, ...extra });
const rebar = log => ({ key: 'rebar4', description: "#4 Rebar - 20' Pc", kind: 'Rebar', unit: 'EA', quantity: 500, lineCount: 1, order: null, log });
const wire = log => ({ key: 'wire', description: "Wire Mesh 6 ga 5'x10'", kind: 'Wire', unit: 'EA', quantity: 40, lineCount: 1, order: null, log });
const job = (key, projectName, items) => ({ key, projectId: key, projectName, projectNumber: `26-${key}`, items, issues: [] });
const projects = [
  job('1', 'Warehouse', [rebar([
    entry('a', 150, '2026-11-10T15:00:00Z'), entry('b', 75, '2026-11-12T15:00:00Z'),
    entry('c', 30, '2026-11-12T16:00:00Z', { voidedAt: '2026-11-12T17:00:00Z', voidedBy: 'buyer@example.com' }),
    entry('d', -25, '2026-11-12T18:00:00Z', { kind: 'correction', createdBy: 'boss@example.com' }),
  ]), wire([entry('e', 12, '2026-11-12T15:00:00Z')])]),
  // 03:30 UTC on the 12th is still the evening of the 11th in Eastern time.
  job('2', 'School', [rebar([entry('f', 150, '2026-11-12T03:30:00Z')])]),
  job('3', 'Barn', [rebar([entry('g', 10, '2026-11-12T15:00:00Z'), entry('h', -10, '2026-11-12T16:00:00Z', { kind: 'correction' })])]),
  // A total saved before the order log has no dated lines, so it can never be exported.
  job('4', 'Legacy', [{ ...rebar([]), order: { revision: 1, orderedAt: '2026-11-12T15:00:00Z', quantity: 60 } }]),
];
const pick = rows => rows.map(row => [row.type, row.description, row.quantity, row.bundles, row.projectName]);

test('the export holds only orders recorded in the Eastern date range: undone lines out, corrections netted and flagged', () => {
  assert.equal(steelEasternDay('2026-11-12T03:30:00Z'), '2026-11-11');
  const oneDay = steelOrdersInRange(projects, { from: '2026-11-12', to: '2026-11-12' });
  assert.deepEqual(pick(oneDay.rows), [
    ['Total', "#4 Rebar - 20' Pc", 50, 0.3333, 'All jobs (1)'], ['Job', "#4 Rebar - 20' Pc", 50, 0.3333, 'Warehouse'],
    ['Total', "Wire Mesh 6 ga 5'x10'", 12, null, 'All jobs (1)'], ['Job', "Wire Mesh 6 ga 5'x10'", 12, null, 'Warehouse'],
  ], 'the 150 from the 10th, the undone 30, the evening-before School order, the net-zero Barn and the undated Legacy total are all left out');
  assert.deepEqual([oneDay.orders, oneDay.jobs, oneDay.valid], [3, 1, true]);
  assert.deepEqual([oneDay.rows[0].corrected, oneDay.rows[2].corrected], [true, false]);
  assert.deepEqual(oneDay.rows[0].recordedBy, ['boss@example.com', 'buyer@example.com']);
});

test('a wider or open range adds up each material across jobs, and an inverted range exports nothing', () => {
  for (const range of [{ from: '2026-11-10', to: '2026-11-12' }, { from: '', to: '' }, { from: '', to: '2026-11-12' }, { from: '2026-11-10', to: '' }]) {
    const result = steelOrdersInRange(projects, range);
    assert.deepEqual(pick(result.rows).slice(0, 3), [['Total', "#4 Rebar - 20' Pc", 350, 2.3333, 'All jobs (2)'], ['Job', "#4 Rebar - 20' Pc", 150, 1, 'School'], ['Job', "#4 Rebar - 20' Pc", 200, 1.3333, 'Warehouse']]);
    assert.deepEqual([result.orders, result.jobs], [5, 2]);
    assert.deepEqual(result.rows[0].days, ['2026-11-10', '2026-11-11', '2026-11-12']);
  }
  assert.deepEqual(steelOrdersInRange(projects, { from: '2026-11-13', to: '' }).rows, []);
  const inverted = steelOrdersInRange(projects, { from: '2026-11-13', to: '2026-11-12' });
  assert.deepEqual([inverted.rows.length, inverted.orders, inverted.valid], [0, 0, false]);
});

test('the orders file lists totals then jobs, names its date range and scope, and keeps numbers numeric while neutralizing formulas', () => {
  const csv = steelOrdersCsv(projects, { from: '2026-11-12', to: '2026-11-12' }, 'All In Progress jobs', 'now');
  const lines = csv.replace('\uFEFF', '').split('\r\n');
  assert.equal(lines.length, 5);
  assert.equal(lines[0], '"Row","Material","Unit","Quantity ordered","Bundles","Pieces per bundle","Job number","Job","Order dates (Eastern)","Recorded by","Notes","Order date range (Eastern)","Filter scope","Data read at"');
  assert.equal(lines[1], '"Total","#4 Rebar - 20\' Pc","EA","50","0.33","150","","All jobs (1)","11/12/2026","boss@example.com; buyer@example.com","Includes a total correction","11/12/2026","All In Progress jobs","now"');
  assert.equal(lines[2], '"Job","#4 Rebar - 20\' Pc","EA","50","0.33","150","26-1","Warehouse","11/12/2026","boss@example.com; buyer@example.com","Includes a total correction","11/12/2026","All In Progress jobs","now"');
  assert.match(lines[3], /^"Total","Wire Mesh 6 ga 5'x10'","EA","12","","","","All jobs \(1\)"/);
  const reduced = steelOrdersCsv([job('9', '=formula', [rebar([entry('z', -20, '2026-11-12T15:00:00Z', { kind: 'correction' })])])], { from: '2026-11-12', to: '2026-11-12' }, '=scope', 'now');
  assert.match(reduced, /"Job","#4 Rebar - 20' Pc","EA","-20","-0.13","150","26-9","'=formula"/, 'a negative correction stays a number; a formula-like name is neutralized');
  assert.match(reduced, /"'=scope"/);
  assert.equal(steelOrderRangeLabel({ from: '2026-11-10', to: '2026-11-12' }), '11/10/2026 to 11/12/2026');
  assert.equal(steelOrderRangeLabel({ from: '2026-11-10', to: '' }), 'From 11/10/2026');
  assert.equal(steelOrderRangeLabel({ from: '', to: '2026-11-12' }), 'Through 11/12/2026');
  assert.equal(steelOrderRangeLabel({ from: '', to: '' }), 'All dates');
});
