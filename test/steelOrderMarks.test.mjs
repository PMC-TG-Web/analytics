import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSteelOrderInput, saveSteelOrder, saveSteelOrderMark, SteelOrderConflict } from '../src/lib/steelOrderMarks.ts';
import { attachSteelOrderMarks, steelNeedsCsv, steelOrderedDate, steelOrderLog, steelOrderLogText, steelOrderQuantities, steelOrderStatus } from '../src/lib/steelNeeds.ts';

function database() {
  const saved = new Map(), entries = []; let forceConflict = false;
  const key = value => JSON.stringify([value.companyId, value.projectId, value.materialId]);
  const matches = (row, where) => Object.entries(where).every(([field, value]) => row[field] === value);
  const tx = { steelOrderMark: {
    findUnique: async ({ where }) => saved.get(key(where.companyId_projectId_materialId)) || null,
    create: async ({ data }) => { saved.set(key(data), data); return data; },
    updateMany: async ({ where, data }) => { const current = saved.get(key(where)); if (forceConflict || current?.revision !== where.revision) return { count: 0 }; saved.set(key(where), { ...current, ...data }); return { count: 1 }; },
    findUniqueOrThrow: async ({ where }) => saved.get(key(where.companyId_projectId_materialId)),
  }, steelOrderEntry: {
    create: async ({ data }) => { const row = { id: `00000000-0000-4000-8000-${String(entries.length + 1).padStart(12, '0')}`, voidedAt: null, voidedBy: null, ...data }; entries.push(row); return row; },
    findFirst: async ({ where }) => entries.find(row => matches(row, where)) || null,
    findMany: async ({ where }) => entries.filter(row => matches(row, where)),
    updateMany: async ({ where, data }) => { const rows = entries.filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; },
  } };
  return { db: { $transaction: async callback => callback(tx) }, saved, entries, conflict: () => { forceConflict = true; } };
}
const input = { projectId: '101', itemKey: '["#4 rebar - 20\u0027 pc","EA"]', quantity: 100, revision: 0, ordered: true };
test('checking stamps server time; repeated check preserves date; uncheck clears; stale screens cannot overwrite', async () => {
  const fixture = database();
  const before = Date.now();
  const first = await saveSteelOrderMark(fixture.db, 'company', 'first@example.com', input);
  assert.ok(new Date(first.orderedAt).getTime() >= before); assert.equal(first.revision, 1); assert.equal(first.quantity, 100);
  assert.deepEqual(await saveSteelOrderMark(fixture.db, 'company', 'other@example.com', { ...input, revision: 1 }), first);
  await assert.rejects(saveSteelOrderMark(fixture.db, 'company', 'other@example.com', { ...input, ordered: false }), SteelOrderConflict);
  const cleared = await saveSteelOrderMark(fixture.db, 'company', 'first@example.com', { ...input, revision: 1, ordered: false });
  assert.deepEqual(cleared, { revision: 2, orderedAt: null, quantity: null, estimateQuantity: null });
  const second = await saveSteelOrderMark(fixture.db, 'company', 'first@example.com', { ...input, revision: 2 });
  assert.equal(second.revision, 3); assert.ok(second.orderedAt);
  fixture.conflict();
  await assert.rejects(saveSteelOrderMark(fixture.db, 'company', 'other@example.com', { ...input, revision: 3, ordered: false }), SteelOrderConflict);
});

test('partial piece quantities replace the cumulative total, preserve estimate basis, and retain conflict protection', async () => {
  const fixture = database();
  const partial = { ...input, quantity: 450, orderedQuantity: 150 };
  const first = await saveSteelOrderMark(fixture.db, 'company', 'actor@example.com', partial);
  assert.equal(first.quantity, 150); assert.equal(first.estimateQuantity, 450);
  const item = { quantity: 450, order: first };
  assert.deepEqual(steelOrderQuantities(item), { orderedQuantity: 150, toOrderQuantity: 300, changed: false });
  assert.equal(steelOrderStatus(item), 'Partially ordered');
  const csv = steelNeedsCsv([{ projectId: '101', projectName: 'A', items: [{ ...item, description: '#4 Rebar', kind: 'Rebar', unit: 'EA' }], issues: [] }]);
  assert.match(csv, /"150","450","Partially ordered","300"/);
  assert.equal(steelOrderQuantities({ ...item, quantity: 500 }).changed, true);
  assert.deepEqual(await saveSteelOrderMark(fixture.db, 'company', 'actor@example.com', { ...partial, revision: 1 }), first);
  const second = await saveSteelOrderMark(fixture.db, 'company', 'actor@example.com', { ...partial, revision: 1, orderedQuantity: 300 });
  assert.equal(second.quantity, 300, 'replace, never add 300 to the prior 150'); assert.equal(second.revision, 2);
  await assert.rejects(saveSteelOrderMark(fixture.db, 'company', 'actor@example.com', { ...partial, revision: 1, orderedQuantity: 450 }), SteelOrderConflict);
  const over = await saveSteelOrderMark(fixture.db, 'company', 'actor@example.com', { ...partial, revision: 2, orderedQuantity: 600 });
  assert.equal(steelOrderStatus({ ...item, order: over }), 'Fully ordered');
  assert.equal(steelOrderQuantities({ ...item, order: over }).changed, false);
  const cleared = await saveSteelOrderMark(fixture.db, 'company', 'actor@example.com', { ...partial, revision: 3, ordered: false, orderedQuantity: 0 });
  assert.equal(cleared.orderedAt, null); assert.equal(cleared.quantity, null); assert.equal(cleared.estimateQuantity, null);
});

test('piece inputs reject negative, fractional, malformed and contradictory quantities while allowing totals above estimate', () => {
  for (const orderedQuantity of [-1, 0.5, NaN, Infinity, 1e13, '150', null]) assert.equal(parseSteelOrderInput({ ...input, orderedQuantity }), null);
  assert.equal(parseSteelOrderInput({ ...input, orderedQuantity: 0 }), null);
  assert.equal(parseSteelOrderInput({ ...input, ordered: false, orderedQuantity: 150 }), null);
  assert.equal(parseSteelOrderInput({ ...input, itemKey: 'unknown', orderedQuantity: 1 }), null);
  assert.equal(parseSteelOrderInput({ ...input, orderedQuantity: 150 }).orderedQuantity, 150);
  assert.equal(parseSteelOrderInput({ ...input, ordered: false, orderedQuantity: 0 }).orderedQuantity, 0);
  assert.equal(parseSteelOrderInput({ ...input, itemKey: '["wire","LF"]', orderedQuantity: 1.25 }).orderedQuantity, 1.25);
  assert.equal(parseSteelOrderInput({ ...input, itemKey: '["wire","LF"]', orderedQuantity: 1.23456 }), null);
});
test('company, project and material identity isolate markers and retain actor attribution', async () => {
  const fixture = database();
  for (const [company, projectId, itemKey] of [['a', '101', input.itemKey], ['a', '102', input.itemKey], ['b', '101', input.itemKey], ['a', '101', 'wire']]) {
    await saveSteelOrderMark(fixture.db, company, 'actor@example.com', { ...input, projectId, itemKey });
  }
  assert.equal(fixture.saved.size, 4);
  for (const value of fixture.saved.values()) { assert.equal(value.updatedBy, 'actor@example.com'); assert.match(value.materialId, /^[a-f0-9]{64}$/); }
});
test('saved marks join exact materials/projects, preserve estimate quantities and export Eastern dates', () => {
  const item = { key: 'material', description: '#4 Rebar', unit: 'EA', quantity: 120, lineCount: 1, kind: 'Rebar', order: null };
  const projects = [{ projectId: '101', projectName: 'A', items: [item], issues: [] }, { projectId: '102', projectName: 'B', items: [item], issues: [] }];
  const result = attachSteelOrderMarks(projects, [{ projectId: '101', itemKey: 'material', revision: 1, orderedAt: '2026-11-11T02:00:00Z', quantity: 100 }]);
  assert.equal(result[0].items[0].quantity, 120); assert.equal(result[0].items[0].order.quantity, 100); assert.equal(result[1].items[0].order, null);
  assert.equal(steelOrderedDate('2026-11-11T02:00:00Z'), '11/10/2026');
  assert.match(steelNeedsCsv(result), /"Yes","11\/10\/2026","100"/);
});

const base = { projectId: '101', itemKey: input.itemKey, quantity: 100 };
const change = (fixture, actor, fields) => saveSteelOrder(fixture.db, 'company', actor, parseSteelOrderInput({ ...base, ...fields }));
test('order log: each order adds to the running total, undo removes only that order, and stale screens cannot write', async () => {
  const fixture = database();
  const first = await change(fixture, 'a@example.com', { revision: 0, addQuantity: 30 });
  assert.equal(first.order.quantity, 30); assert.equal(first.order.estimateQuantity, 100); assert.equal(first.log.length, 1);
  const second = await change(fixture, 'b@example.com', { revision: 1, addQuantity: 40 });
  assert.equal(second.order.quantity, 70, 'add 40 to the earlier 30; never replace it');
  assert.deepEqual(second.log.map(entry => [entry.kind, entry.quantity, entry.createdBy, entry.voidedAt]), [['order', 30, 'a@example.com', null], ['order', 40, 'b@example.com', null]]);
  await assert.rejects(change(fixture, 'b@example.com', { revision: 1, addQuantity: 5 }), SteelOrderConflict);
  assert.equal(fixture.entries.length, 2, 'a refused order leaves no log line');
  const undone = await change(fixture, 'c@example.com', { revision: 2, undoEntryId: second.log[0].id });
  assert.equal(undone.order.quantity, 40); assert.equal(undone.order.revision, 3);
  assert.equal(undone.log[0].voidedBy, 'c@example.com'); assert.ok(undone.log[0].voidedAt); assert.equal(undone.log[1].voidedAt, null);
  await assert.rejects(change(fixture, 'c@example.com', { revision: 3, undoEntryId: second.log[0].id }), SteelOrderConflict, 'an order cannot be undone twice');
  const item = { quantity: 100, order: undone.order, log: undone.log };
  assert.deepEqual(steelOrderQuantities(item), { orderedQuantity: 40, toOrderQuantity: 60, changed: false });
  assert.equal(steelOrderLog(item).orders, 1); assert.equal(steelOrderLog(item).unlogged, 0);
  const cleared = await change(fixture, 'c@example.com', { revision: 3, undoEntryId: second.log[1].id });
  assert.deepEqual(cleared.order, { revision: 4, orderedAt: null, quantity: null, estimateQuantity: null });
  assert.equal(cleared.log.length, 2, 'undone orders stay in the log');
});
test('order log: fixing the total is logged as a correction, and totals saved before the log stay visible', async () => {
  const fixture = database();
  await change(fixture, 'a@example.com', { revision: 0, addQuantity: 30 });
  const fixed = await change(fixture, 'a@example.com', { revision: 1, ordered: true, orderedQuantity: 10 });
  assert.equal(fixed.order.quantity, 10);
  assert.deepEqual(fixed.log.map(entry => [entry.kind, entry.quantity]), [['order', 30], ['correction', -20]]);
  assert.equal(steelOrderLog({ quantity: 100, order: fixed.order, log: fixed.log }).unlogged, 0);
  const same = await change(fixture, 'a@example.com', { revision: 2, ordered: true, orderedQuantity: 10 });
  assert.equal(same.order.revision, 2); assert.equal(same.log.length, 2, 'an unchanged total adds no log line');
  const floor = await change(fixture, 'a@example.com', { revision: 2, undoEntryId: fixed.log[0].id });
  assert.equal(floor.order.quantity, null, 'undoing more than the running total clears it instead of going negative');
  const earlier = { quantity: 100, order: { revision: 1, orderedAt: '2026-11-11T02:00:00Z', quantity: 60 }, log: [] };
  assert.equal(steelOrderLog(earlier).unlogged, 60);
  assert.equal(steelOrderLogText(earlier), 'Before order log +60');
  const logged = { ...earlier, order: { ...earlier.order, quantity: 100 }, log: [
    { id: '1', kind: 'order', quantity: 30, createdAt: '2026-11-11T02:00:00Z', createdBy: 'a', voidedAt: null, voidedBy: null },
    { id: '2', kind: 'order', quantity: 5, createdAt: '2026-11-12T02:00:00Z', createdBy: 'a', voidedAt: '2026-11-12T03:00:00Z', voidedBy: 'a' },
    { id: '3', kind: 'correction', quantity: 10, createdAt: '2026-11-13T02:00:00Z', createdBy: 'a', voidedAt: null, voidedBy: null }] };
  assert.equal(steelOrderLogText(logged), 'Before order log +60; 11/10/2026 +30; 11/12/2026 +10 (correction)');
  const joined = attachSteelOrderMarks([{ projectId: '101', projectName: 'A', items: [{ key: 'material', description: '#4 Rebar', unit: 'EA', quantity: 100, lineCount: 1, kind: 'Rebar', order: null }], issues: [] }],
    [{ projectId: '101', itemKey: 'material', ...logged.order }], [...logged.log.map(entry => ({ ...entry, projectId: '101', itemKey: 'material' })), { ...logged.log[0], id: '4', projectId: '102', itemKey: 'material' }]);
  assert.deepEqual(joined[0].items[0].log.map(entry => entry.id), ['1', '2', '3'], 'log lines join only their own job and material');
  assert.match(steelNeedsCsv(joined), /"Fully ordered","0","Before order log \+60; 11\/10\/2026 \+30; 11\/12\/2026 \+10 \(correction\)"/);
});
test('order log inputs accept one change at a time and reject invalid order amounts and log ids', () => {
  for (const addQuantity of [0, -1, 0.5, NaN, 1e13, '5', null]) assert.equal(parseSteelOrderInput({ ...base, revision: 0, addQuantity }), null);
  assert.equal(parseSteelOrderInput({ ...base, revision: 0, addQuantity: 5, ordered: true, orderedQuantity: 5 }), null);
  assert.equal(parseSteelOrderInput({ ...base, revision: 0, addQuantity: 5, undoEntryId: '00000000-0000-4000-8000-000000000001' }), null);
  for (const undoEntryId of ['', 'not-an-id', 7, null]) assert.equal(parseSteelOrderInput({ ...base, revision: 1, undoEntryId }), null);
  assert.equal(parseSteelOrderInput({ ...base, revision: 0, addQuantity: 5 }).addQuantity, 5);
  assert.equal(parseSteelOrderInput({ ...base, itemKey: '["wire","LF"]', revision: 0, addQuantity: 1.25 }).addQuantity, 1.25);
  assert.equal(parseSteelOrderInput({ ...base, revision: 1, undoEntryId: '00000000-0000-4000-8000-000000000001' }).undoEntryId, '00000000-0000-4000-8000-000000000001');
});
