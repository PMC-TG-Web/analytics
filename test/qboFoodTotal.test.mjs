import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as food from '../src/lib/qboFoodTotal.ts';
import { directCostMonth } from '../src/lib/qboDirectCosts.ts';

test('monthly Food total is used once, replaces the previous value, and zero omits the line', () => {
  const saved = { amount: '85.86', revision: 1, updatedBy: 'operator@example.test', updatedAt: '2026-09-22' };
  const line = food.foodTotalLine('1', '2', '2026-09', saved);
  assert.equal(line.quantity, '1'); assert.equal(line.amount, '85.86'); assert.equal(line.unitCost, '85.86');
  assert.deepEqual(line.sourceLogs, []); assert.equal(line.costCode, '01-300-10-80');
  assert.equal(food.foodTotalLine('1', '2', '2026-09', { ...saved, amount: '100.00', revision: 2 }).amount, '100.00');
  assert.equal(food.foodTotalLine('1', '2', '2026-09', { ...saved, amount: '0.00' }), null);
  for (const value of ['', '-1', '1.005', 'NaN', '1e3', '1000000000', 85.86]) assert.throws(() => food.foodTotalAmount(value));
});
function service({ stale = false, conflict = false, missingProject = false } = {}) {
  const writes = [];
  const tx = { qboBillFoodTotal: { create: async args => { if (conflict) throw Object.assign(Error(), { code: 'P2002' }); writes.push(args.data); }, updateMany: async args => { writes.push(args); return { count: stale ? 0 : 1 }; } }, qboBillFoodTotalRevision: { create: async args => writes.push(args.data) } };
  const prisma = { pmcProject: { findUnique: async () => missingProject ? null : { procoreProjectId: '2' } }, $transaction: async fn => fn(tx) };
  const js = ts.transpileModule(fs.readFileSync('src/lib/saveQboFoodTotal.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const m = { exports: {} }; const imports = { './prisma': { prisma }, './qboFoodTotal': food, './qboDirectCosts': { directCostMonth } };
  vm.runInNewContext(js, { exports: m.exports, require: id => imports[id] });
  return { ...m.exports, writes };
}
const input = { companyId: '1', projectId: '2', month: '2026-09', amount: '85.86', revision: 0 };
test('Food save records session operator and audit revision; updates use optimistic locking', async () => {
  const h = service(); await h.saveQboFoodTotal(input, 'operator');
  assert.equal(h.writes[0].amount, '85.86'); assert.equal(h.writes[1].revision, 1); assert.equal(h.writes[1].updatedBy, 'operator');
  const updated = service(); await updated.saveQboFoodTotal({ ...input, amount: '100', revision: 1 }, 'operator');
  assert.equal(updated.writes[0].where.revision, 1); assert.equal(updated.writes[0].data.amount, '100.00'); assert.equal(updated.writes[1].revision, 2);
});
test('stale or concurrent saves and cross-project data cannot overwrite Food totals', async () => {
  await assert.rejects(service({ stale: true }).saveQboFoodTotal({ ...input, revision: 1 }, 'operator'), /changed/);
  await assert.rejects(service({ conflict: true }).saveQboFoodTotal(input, 'operator'), /changed/);
  await assert.rejects(service({ missingProject: true }).saveQboFoodTotal(input, 'operator'), /Project not found/);
});
