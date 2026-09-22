import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as food from '../src/lib/qboFoodTotal.ts';

test('monthly Food total is used once, replaces the previous value, and zero omits the line', () => {
  const saved = { amount: '85.86', revision: 1, updatedBy: 'operator@example.test', updatedAt: '2026-09-22' };
  const line = food.foodTotalLine('1', '2', '2026-09', saved);
  assert.equal(line.quantity, '1'); assert.equal(line.amount, '85.86'); assert.equal(line.unitCost, '85.86');
  assert.deepEqual(line.sourceLogs, []); assert.equal(line.costCode, '01-300-10-80');
  assert.equal(food.foodTotalLine('1', '2', '2026-09', { ...saved, amount: '100.00', revision: 2 }).amount, '100.00');
  assert.equal(food.foodTotalLine('1', '2', '2026-09', { ...saved, amount: '0.00' }), null);
  for (const value of ['', '-1', '1.005', 'NaN', '1e3', '1000000000', 85.86]) assert.throws(() => food.foodTotalAmount(value));
});
function service({ missingProject = false } = {}) {
  const entries = new Map(); let total = null; const audits = []; const increments = [];
  const tx = { qboBillFoodEntry: { create: async ({data}) => { if(entries.has(data.id)) throw Object.assign(Error(),{code:'P2002'}); entries.set(data.id,{...data,amount:{toFixed:()=>data.amount}}); } }, qboBillFoodTotal: { upsert: async ({create,update}) => { increments.push(update.amount.increment); total = { amount: { value: Number(total?.amount.value || 0) + Number(create.amount), gt: value=>Number(total.amount.value)>Number(value) }, revision: (total?.revision || 0)+1 }; return total; } }, qboBillFoodTotalRevision: { create: async ({data}) => audits.push(data) } };
  let lane=Promise.resolve();
  const prisma = { pmcProject: { findUnique: async () => missingProject ? null : { procoreProjectId: '2' } }, qboBillFoodEntry:{findUnique:async ({where})=>entries.get(where.id)||null}, $transaction: fn => {const next=lane.then(()=>fn(tx));lane=next.catch(()=>{});return next;} };
  const js = ts.transpileModule(fs.readFileSync('src/lib/saveQboFoodTotal.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const m = { exports: {} }; const imports = { './prisma': { prisma }, './qboFoodTotal': food };
  vm.runInNewContext(js, { exports: m.exports, require: id => imports[id] });
  return { ...m.exports, entries, audits, increments, total:()=>total };
}
const input = { entryId:'11111111-1111-4111-8111-111111111111', companyId:'1',projectId:'2',month:'2026-09',spentOn:'2026-09-22',note:'Lunch',amount:'85.86' };
test('Food additions accumulate and retries of the same entry never add twice', async () => {
 const h=service();await h.saveQboFoodTotal(input,'operator');await h.saveQboFoodTotal(input,'operator');
 assert.equal(h.entries.size,1);assert.equal(h.total().amount.value,85.86);assert.equal(h.audits.length,1);
 await h.saveQboFoodTotal({...input,entryId:'22222222-2222-4222-8222-222222222222',amount:'10'},'operator');
 assert.equal(h.total().amount.value,95.86);assert.equal(h.audits[1].revision,2);assert.equal(h.increments[1],'10.00');
});
test('simultaneous additions preserve both entries through atomic increments',async()=>{
 const h=service();await Promise.all([h.saveQboFoodTotal(input,'operator'),h.saveQboFoodTotal({...input,entryId:'22222222-2222-4222-8222-222222222222',amount:'10'},'operator')]);
 assert.equal(h.entries.size,2);assert.equal(h.total().amount.value,95.86);
});
test('entry identity cannot be reused for different data or another project',async()=>{
 const h=service();await h.saveQboFoodTotal(input,'operator');
 await assert.rejects(h.saveQboFoodTotal({...input,amount:'100'},'operator'),/different details/);
 await assert.rejects(h.saveQboFoodTotal({...input,projectId:'9'},'operator'),/different details/);
 await assert.rejects(service({missingProject:true}).saveQboFoodTotal(input,'operator'),/Project not found/);
 for(const change of [{spentOn:'2026-08-31'},{spentOn:'2026-09-31'},{entryId:'bad'},{amount:'-1'},{note:'x'.repeat(201)}]) assert.throws(()=>food.validateFoodEntry({...input,...change}));
});
test('simultaneous retries with one entry ID create one ledger row and one increment',async()=>{
 const h=service();const results=await Promise.all([h.saveQboFoodTotal(input,'operator'),h.saveQboFoodTotal(input,'operator')]);
 assert.equal(h.entries.size,1);assert.equal(h.audits.length,1);assert.equal(h.total().amount.value,85.86);assert.ok(results.some(r=>r.alreadySaved));
});
