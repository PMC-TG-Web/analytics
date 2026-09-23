import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
registerHooks({resolve(s,c,n){if(s.startsWith('.')&&!/\.[a-z]+$/.test(s)){const u=new URL(s+'.ts',c.parentURL);if(existsSync(fileURLToPath(u)))return n(u.href,c);}return n(s,c);}});
const { projectPrice } = await import('../src/lib/qboBillLineRules.ts');
const { catalogSourceSignature } = await import('../src/lib/qboCatalogMapping.ts');
const { aggregateDirectCosts } = await import('../src/lib/qboDirectCosts.ts');
const source={description:'Somero S-840',costCode:'03-300-20-30',costType:'Materials',uom:'ea'};
const rule={companyId:'1',projectId:'2',lineKey:'3',sourceSignature:catalogSourceSignature(source),revision:1,updatedBy:'operator',reason:'Project-specific price',unitCost:'1520',ignored:false};
test('project rate multiplies source quantity and keeps explicit project evidence',()=>{
 const price=projectPrice(source,rule);assert.equal(price.unitCost,1520);assert.equal(price.evidence.projectId,'2');
 const date=new Date('2026-09-10');
 const result=aggregateDirectCosts([{id:'4',date,status:'approved',quantityUsed:2,lineItemId:'3',updatedAt:date}],[{...source,procoreId:'3',unitCost:price.unitCost,projectPrice:price.evidence,updatedAt:date}],new Map());
 assert.equal(result.total,'3040.00');assert.equal(result.lines[0].projectPrice.revision,1);
});
test('changed units or source details require review and no rule retains normal pricing',()=>{
 assert.equal(projectPrice(source,undefined),null);assert.match(projectPrice({...source,uom:'hr'},rule).issue,/changed/);assert.match(projectPrice(source,{...rule,unitCost:'0'}).issue,/positive/);
});
const js=ts.transpileModule(readFileSync('src/app/api/accounting/direct-cost-bills/line-rule/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
test('line setting route enforces session, CSRF and company, and uses session attribution',async()=>{
 let actor='operator',allowed=true;const calls=[];
 const m={exports:{}};
 const imports={'next/server':{NextResponse:{json:(b,i)=>Response.json(b,i)}},'@/lib/requestUser':{getRequestUserEmail:async()=>actor},'@/lib/csrfProtection':{validateCsrfRequest:()=>({allowed})},'@/lib/saveQboBillLineRule':{saveQboBillLineRule:async(i,a)=>{calls.push({i,a});return {saved:true};}}};
 vm.runInNewContext(js,{exports:m.exports,process:{env:{PROCORE_COMPANY_ID:'1'}},require:id=>imports[id]});
 const request=(companyId='1')=>new Request('https://app.test/api/accounting/direct-cost-bills/line-rule',{method:'POST',body:JSON.stringify({companyId})});
 actor=null;assert.equal((await m.exports.POST(request())).status,401);actor='operator';allowed=false;assert.equal((await m.exports.POST(request())).status,403);allowed=true;assert.equal((await m.exports.POST(request('9'))).status,400);assert.equal(calls.length,0);
 const response=await m.exports.POST(request());assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(calls[0].a,'operator');
});
