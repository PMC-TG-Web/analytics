import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const state={pending:null,acquires:0,useSnapshot:true,mirrored:[],budgetQueries:[],snapshotQueries:[],snapshotVerifiedAt:null,lastCompleteAt:null};
process.env.PROCORE_COMPANY_ID='2';
globalThis.__budgetDb={pmcProject:{findFirst:async()=>({projectNumber:'P'})},procoreSyncProjectState:{findUnique:async()=>({lastError:state.pending,lastResult:state.useSnapshot?{version:1,projectNumber:'P',verifiedAt:state.snapshotVerifiedAt||new Date().toISOString(),codes:['01-300-10-70.L']}:null})},procoreBudgetSnapshotState:{findUnique:async query=>{
  state.snapshotQueries.push(query);
  return {lastCompleteAt:state.lastCompleteAt};
}},budgetLineItem:{findMany:async query=>{
  state.budgetQueries.push(query);
  return state.mirrored.filter(row=>query.where.sourceMissingAt===null?row.sourceMissingAt===null:true);
}}};
globalThis.__budgetWorker={acquireProcoreWorker:async()=>{state.acquires++;return {acquired:false,reason:'rate_limit_cooldown'}},releaseProcoreWorker:async()=>{}};
registerHooks({resolve(s,c,n){if(c.parentURL?.endsWith('/ensureQboBudgetReadiness.ts')){
 if(s==='./prisma')return n('data:text/javascript,export const prisma=globalThis.__budgetDb;',c);
 if(s==='./procoreConnection')return n('data:text/javascript,export const withBillingProcoreConnection=fn=>fn();',c);
 if(s==='./procoreSyncQueue')return n('data:text/javascript,export const {acquireProcoreWorker,releaseProcoreWorker}=globalThis.__budgetWorker;',c);
 if(s==='./procore')return n('data:text/javascript,export const getClientCredentialsToken=()=>{throw Error("Unexpected token")};export const makeRequest=()=>{throw Error("Unexpected API")};export const withProcoreLiveApiBypassForSyncSecret=(r,fn)=>fn();',c);
 if(s==='./qboBudgetReadiness')return n(new URL('../src/lib/qboBudgetReadiness.ts',import.meta.url).href,c);
 }return n(s,c)}});
const {ensureQboBudgetReadiness}=await import('../src/lib/ensureQboBudgetReadiness.ts');
test('recent complete evidence allows a save without touching the rate-limited worker',async()=>{assert.equal((await ensureQboBudgetReadiness('2','3','P',['P-01-300-10-70.L'])).ready,true);assert.equal(state.acquires,0)});
test('pending mutation cannot be hidden by a recent snapshot',async()=>{const snapshotsBefore=state.snapshotQueries.length;state.pending=JSON.stringify({code:'01-300-10-70.L',kind:'budget'});assert.equal((await ensureQboBudgetReadiness('2','3','P',['P-01-300-10-70.L'])).ready,false);assert.equal(state.acquires,1);assert.equal(state.snapshotQueries.length,snapshotsBefore);state.pending=null});
test('new code still needs live validation',async()=>{const snapshotsBefore=state.snapshotQueries.length;assert.equal((await ensureQboBudgetReadiness('2','3','P',['P-01-300-10-80.M'])).ready,false);assert.equal(state.acquires,2);assert.equal(state.snapshotQueries.length,snapshotsBefore)});
test('a recently synchronized budget row absent from Procore cannot satisfy bill readiness',async()=>{
  state.useSnapshot=false;
  state.mirrored=[{costCode:'01-300-10-70.L',syncedAt:new Date(),sourceMissingAt:new Date()}];
  const acquiredBefore=state.acquires;
  assert.equal((await ensureQboBudgetReadiness('2','3','P',['P-01-300-10-70.L'])).ready,false);
  assert.equal(state.acquires,acquiredBefore+1);
  assert.deepEqual(state.budgetQueries.at(-1).where,{companyId:'2',projectId:'3',sourceMissingAt:null});
});
test('an active budget can satisfy readiness while an older missing row with the same code remains evidence',async()=>{
  state.useSnapshot=false;
  state.mirrored=[
    {costCode:'01-300-10-70.L',syncedAt:new Date(),sourceMissingAt:new Date()},
    {costCode:'01-300-10-70.L',syncedAt:new Date(),sourceMissingAt:null},
  ];
  const acquiredBefore=state.acquires;
  assert.equal((await ensureQboBudgetReadiness('2','3','P',['P-01-300-10-70.L'])).ready,true);
  assert.equal(state.acquires,acquiredBefore);
});
test('a complete budget snapshot supersedes older verified codes when a required code is now missing',async()=>{
  const now=Date.now();
  state.useSnapshot=true;
  state.snapshotVerifiedAt=new Date(now-60_000).toISOString();
  state.lastCompleteAt=new Date(now-30_000);
  state.mirrored=[{costCode:'01-300-10-70.L',syncedAt:new Date(now-60_000),sourceMissingAt:state.lastCompleteAt}];
  const acquiredBefore=state.acquires;
  assert.equal((await ensureQboBudgetReadiness('2','3','P',['P-01-300-10-70.L'])).ready,false);
  assert.equal(state.acquires,acquiredBefore+1);
  assert.deepEqual(state.snapshotQueries.at(-1),{where:{companyId_projectId:{companyId:'2',projectId:'3'}},select:{lastCompleteAt:true}});
  assert.equal(state.pending,null);
});
test('codes verified after the complete budget snapshot can reuse the cache without mirror or live work',async()=>{
  const now=Date.now();
  state.useSnapshot=true;
  state.snapshotVerifiedAt=new Date(now-10_000).toISOString();
  state.lastCompleteAt=new Date(now-30_000);
  state.mirrored=[];
  const acquiredBefore=state.acquires;
  const mirrorReadsBefore=state.budgetQueries.length;
  assert.equal((await ensureQboBudgetReadiness('2','3','P',['P-01-300-10-70.L'])).ready,true);
  assert.equal(state.acquires,acquiredBefore);
  assert.equal(state.budgetQueries.length,mirrorReadsBefore);
});
