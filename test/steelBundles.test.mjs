import test from 'node:test';
import assert from 'node:assert/strict';
import { steelBundleSize, steelBundles } from '../src/lib/steelBundles.ts';
import { steelOrderWorksheet, steelOrderWorksheetCsv } from '../src/lib/steelOrderWorksheet.ts';
import { steelNeedsCsv } from '../src/lib/steelNeeds.ts';

const item = size => ({ key: `rebar-${size}`, description: `#${size} Rebar - 20' Pc`, kind: 'Rebar', unit: 'EA', quantity: 100, order: null, lineCount: 1 });
test('owner bundle quantities apply only to known piece-unit rebar sizes', () => {
  for (const [size, pieces] of [[3, 264], [4, 150], [5, 96], [6, 68], [7, 49], [8, 38]]) {
    assert.equal(steelBundleSize(item(size)), pieces);
    assert.deepEqual(steelBundles(item(size), pieces), { piecesPerBundle: pieces, equivalent: 1, wholeBundles: 1, wholeBundlePieces: pieces, extraPieces: 0 });
  }
  for (const unknown of [item(9), { ...item(4), unit: 'LF' }, { ...item(4), kind: 'Wire' }, { ...item(4), description: '#4 / #5 Rebar' }, { ...item(4), description: 'Wire Mesh 4 ga' }]) {
    assert.equal(steelBundleSize(unknown), null); assert.equal(steelBundles(unknown, 100), null);
  }
});
test('whole bundles round up after aggregation and expose extra pieces without altering recorded quantities', () => {
  const pack = steelBundles(item(4), 310);
  assert.equal(pack.wholeBundles, 3); assert.equal(pack.wholeBundlePieces, 450); assert.equal(pack.extraPieces, 140);
  assert.equal(steelBundles(item(4), 0).wholeBundles, 0);
  assert.equal(steelBundles(item(4), 300.00000000001).wholeBundles, 2);
  assert.equal(steelBundles(item(4), 300.0001).wholeBundles, 3);
  for (const invalid of [-1, NaN, Infinity]) assert.equal(steelBundles(item(4), invalid), null);
  const projects = [1, 2].map(id => ({ key: String(id), projectId: String(id), projectName: `Job ${id}`, projectNumber: '', items: [{ ...item(4), quantity: 75 }] }));
  const row = steelOrderWorksheet(projects, 'needed')[0];
  assert.equal(row.toOrderQuantity, 150); assert.equal(steelBundles(row, row.toOrderQuantity).wholeBundles, 1);
  assert.equal(projects.reduce((sum, p) => sum + steelBundles(p.items[0], 75).wholeBundles, 0), 2, 'separate project packs differ from a combined order');
  const csv = steelOrderWorksheetCsv(projects, 'needed', 'all', 'now');
  assert.match(csv, /"Whole bundles to order \(rounded up\)"/);
  assert.match(csv, /"150","1","150","0"$/);
  const detail = steelNeedsCsv(projects.map(p => ({ ...p, issues: [] })));
  assert.equal(detail.split('\r\n').slice(1).filter(row => row.endsWith('"150","0.5","1","150","75"')).length, 2);
  assert.equal(projects[0].items[0].quantity, 75); assert.equal(projects[0].items[0].order, null);
});
test('ordered exports show bundle equivalents without inventing rounded-up ordered quantities; wire stays unconverted', () => {
  const projects = [{ key: '1', projectName: 'Job', items: [{ ...item(4), order: { quantity: 100, orderedAt: '2026-11-10T12:00:00Z', revision: 1 } }, { ...item(4), key: 'wire', kind: 'Wire', description: "Wire Mesh 6 ga 5'x10'" }] }];
  const ordered = steelOrderWorksheetCsv(projects, 'ordered', 'all', 'now');
  assert.match(ordered, /"150","0.6667"$/); assert.doesNotMatch(ordered, /Whole bundles/);
  const needed = steelOrderWorksheetCsv(projects, 'needed', 'all', 'now');
  assert.match(needed, /"now","","","",""$/);
  const all = steelOrderWorksheetCsv(projects, 'all', 'all', 'now');
  assert.match(all, /"150","0.6667","0.6667","0","0","0"/);
});
