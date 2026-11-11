import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSteelOrderInput, saveSteelOrderMark, SteelOrderConflict } from '../src/lib/steelOrderMarks.ts';
import { attachSteelOrderMarks, steelNeedsCsv, steelOrderedDate, steelOrderQuantities, steelOrderStatus } from '../src/lib/steelNeeds.ts';

function database() {
  const saved = new Map(); let forceConflict = false;
  const key = value => JSON.stringify([value.companyId, value.projectId, value.materialId]);
  const tx = { steelOrderMark: {
    findUnique: async ({ where }) => saved.get(key(where.companyId_projectId_materialId)) || null,
    create: async ({ data }) => { saved.set(key(data), data); return data; },
    updateMany: async ({ where, data }) => { const current = saved.get(key(where)); if (forceConflict || current?.revision !== where.revision) return { count: 0 }; saved.set(key(where), { ...current, ...data }); return { count: 1 }; },
    findUniqueOrThrow: async ({ where }) => saved.get(key(where.companyId_projectId_materialId)),
  } };
  return { db: { $transaction: async callback => callback(tx) }, saved, conflict: () => { forceConflict = true; } };
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
