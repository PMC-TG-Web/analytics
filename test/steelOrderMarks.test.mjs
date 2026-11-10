import test from 'node:test';
import assert from 'node:assert/strict';
import { saveSteelOrderMark, SteelOrderConflict } from '../src/lib/steelOrderMarks.ts';
import { attachSteelOrderMarks, steelNeedsCsv, steelOrderedDate } from '../src/lib/steelNeeds.ts';

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
  assert.deepEqual(cleared, { revision: 2, orderedAt: null, quantity: null });
  const second = await saveSteelOrderMark(fixture.db, 'company', 'first@example.com', { ...input, revision: 2 });
  assert.equal(second.revision, 3); assert.ok(second.orderedAt);
  fixture.conflict();
  await assert.rejects(saveSteelOrderMark(fixture.db, 'company', 'other@example.com', { ...input, revision: 3, ordered: false }), SteelOrderConflict);
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
