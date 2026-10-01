import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const state={pending:null,acquires:0};
process.env.PROCORE_COMPANY_ID='2';
globalThis.__budgetDb={pmcProject:{findFirst:async()=>({projectNumber:'P'})},procoreSyncProjectState:{findUnique:async()=>({lastError:state.pending,lastResult:{version:1,projectNumber:'P',verifiedAt:new Date().toISOString(),codes:['01-300-10-70.L']}})},budgetLineItem:{findMany:async()=>[]}};
globalThis.__budgetWorker={acquireProcoreWorker:async()=>{state.acquires++;return {acquired:false,reason:'rate_limit_cooldown'}},releaseProcoreWorker:async()=>{}};
registerHooks({resolve(s,c,n){if(c.parentURL?.endsWith('/ensureQboBudgetReadiness.ts')){
 if(s==='./prisma')return n('data:text/javascript,export const prisma=globalThis.__budgetDb;',c);
 if(s==='./procoreSyncQueue')return n('data:text/javascript,export const {acquireProcoreWorker,releaseProcoreWorker}=globalThis.__budgetWorker;',c);
 if(s==='./procore')return n('data:text/javascript,export const getClientCredentialsToken=()=>{throw Error("Unexpected token")};export const makeRequest=()=>{throw Error("Unexpected API")};export const withProcoreLiveApiBypassForSyncSecret=(r,fn)=>fn();',c);
 if(s==='./qboBudgetReadiness')return n(new URL('../src/lib/qboBudgetReadiness.ts',import.meta.url).href,c);
 }return n(s,c)}});
const {ensureQboBudgetReadiness}=await import('../src/lib/ensureQboBudgetReadiness.ts');
test('recent complete evidence allows a save without touching the rate-limited worker',async()=>{assert.equal((await ensureQboBudgetReadiness('2','3','P',['P-01-300-10-70.L'])).ready,true);assert.equal(state.acquires,0)});
test('pending mutation cannot be hidden by a recent snapshot',async()=>{state.pending=JSON.stringify({code:'01-300-10-70.L',kind:'budget'});assert.equal((await ensureQboBudgetReadiness('2','3','P',['P-01-300-10-70.L'])).ready,false);assert.equal(state.acquires,1);state.pending=null});
test('new code still needs live validation',async()=>{assert.equal((await ensureQboBudgetReadiness('2','3','P',['P-01-300-10-80.M'])).ready,false);assert.equal(state.acquires,2)});