import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetCodesForProducts, recentBudgetCodesCover, ensureBudgetCodeStep } from '../src/lib/qboBudgetReadiness.ts';
const code='03-300-00-12.E';
function fixture() {
 const budget=[],writes=[],pending=[];
 const cost={id:2,code:'03-300-00-12',path_code:'03-300-00-12',status:'active',segment:{id:10,type:'cost_code'}};
 const type={id:3,code:'E',status:'active',segment:{id:11,type:'line_item_type'}};
 const wbs=[{id:1,flat_code:code,status:'active',segment_items:[cost,type]}];
 const io={pending:null,budgets:async()=>budget,wbs:async()=>wbs,segments:async id=>id===10?[cost]:[type],savePending:async p=>{io.pending=p;pending.push(p)},createWbs:async body=>{writes.push(body);const w={id:4,flat_code:code,status:'active',segment_items:[cost,type]};wbs.push(w);return w},createBudget:async id=>{writes.push(id);const b={id:8,wbs_code:{id,flat_code:code},original_budget_amount:'0.00'};budget.push(b);return b}};
 return {io,budget,wbs,writes,pending};
}
test('uses actual product suffix, deduplicates codes and rejects other projects',()=>{
 assert.deepEqual(budgetCodesForProducts('2508 - SC',['2508 - SC-'+code,'2508 - SC-'+code]),[code]);
 assert.throws(()=>budgetCodesForProducts('2508 - SC',['Other-'+code]),/prefix/);
});
test('existing nonzero budget remains untouched',async()=>{
 const f=fixture();f.budget.push({id:5,wbs_code:{id:1,flat_code:code},original_budget_amount:'1200'});
 assert.equal((await ensureBudgetCodeStep([code],f.io)).ready,true);assert.equal(f.writes.length,0);assert.equal(f.budget[0].original_budget_amount,'1200');
});
test('creates zero budget once then verifies live on continuation',async()=>{
 const f=fixture();assert.equal((await ensureBudgetCodeStep([code],f.io)).ready,false);
 assert.equal(f.budget[0].original_budget_amount,'0.00');assert.equal((await ensureBudgetCodeStep([code],f.io)).ready,true);assert.equal(f.writes.length,1);
});
test('lost response resolves by read without replay',async()=>{
 const f=fixture();const create=f.io.createBudget;f.io.createBudget=async id=>{await create(id);throw Error('timeout')};
 await assert.rejects(()=>ensureBudgetCodeStep([code],f.io),/timeout/);
 assert.deepEqual(f.io.pending,{code,kind:'budget'});
 assert.equal((await ensureBudgetCodeStep([code],f.io)).ready,true);assert.equal(f.writes.length,1);
});
test('uncertain absent write stays blocked, including when source code changed',async()=>{
 const f=fixture();f.io.pending={code,kind:'budget'};
 await assert.rejects(()=>ensureBudgetCodeStep(['01-300-10-70.L'],f.io),/not confirmed/);assert.equal(f.writes.length,0);
});
test('missing WBS is created from exact project segments before budget',async()=>{
 const f=fixture();f.wbs[0].flat_code='03-300-00-12.M';
 assert.equal((await ensureBudgetCodeStep([code],f.io)).ready,false);assert.equal(f.budget.length,0);
 assert.deepEqual(f.writes[0],{segment_items:[{segment_id:10,segment_item_id:2},{segment_id:11,segment_item_id:3}]});
 await ensureBudgetCodeStep([code],f.io);assert.equal(f.budget.length,1);
});
test('duplicate and inactive codes never create another row',async()=>{
 const f=fixture();f.wbs[0].status='inactive';await assert.rejects(()=>ensureBudgetCodeStep([code],f.io),/inactive/);assert.equal(f.writes.length,0);
 f.budget.push({wbs_code:{flat_code:code}},{wbs_code:{flat_code:code}});await assert.rejects(()=>ensureBudgetCodeStep([code],f.io),/Duplicate/);
});
test('missing cost segment cannot be substituted by name or a different type',async()=>{
 const f=fixture();f.wbs[0].flat_code='01-300-10-70.L';f.io.segments=async()=>[];
 await assert.rejects(()=>ensureBudgetCodeStep([code],f.io),/missing or ambiguous/);assert.equal(f.writes.length,0);
});

test('recent evidence must cover every exact code/type without duplicates',()=>{
 const now=Date.now(),rows=[{code,verifiedAt:new Date(now-1000)}];
 assert.equal(recentBudgetCodesCover([code],rows,now),true);
 assert.equal(recentBudgetCodesCover([code,'01-300-10-70.L'],rows,now),false);
 assert.equal(recentBudgetCodesCover([code.replace('.E','.M')],rows,now),false);
 assert.equal(recentBudgetCodesCover([code],[...rows,...rows],now),false);
 for(const age of [24*60*60_000,48*60*60_000,-1000]) assert.equal(recentBudgetCodesCover([code],[{code,verifiedAt:new Date(now-age)}],now),false);
 assert.equal(recentBudgetCodesCover([code],[{code,verifiedAt:'invalid'}],now),false);
});