import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as logic from '../src/lib/estimatingDashboardLogic.ts';
const js=ts.transpileModule(fs.readFileSync('src/lib/loadQboDirectCostLaborRates.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function loader(boards){
 const prisma={pmcBidBoardProject:{findMany:async()=>boards},procoreEstimateProposal:{findMany:async()=>[{bidBoardProjectId:'22',proposalId:'33',payload:{type:'ESTIMATE',total:100}}]},procoreEstimateLineItem:{groupBy:async({where})=>{assert.equal(where.bidBoardProjectId,'22');return [{proposalId:'33',_count:1}]},findMany:async()=>[{costCode:'03-300-30-10',lineItemId:'44',syncedAt:new Date('2026-09-17'),payload:{cost_item:{type:'LABOR',unit:'HOUR',unit_labor_cost:38}}}]}};
 const imports={'./prisma':{prisma},'./estimatingDashboardLogic':logic,'./estimatingCostCodeCrosswalk':{loadEstimatingCostCodeCatalog:()=>new Map()}};
 const module={exports:{}};vm.runInNewContext(js,{exports:module.exports,require:id=>{assert.ok(imports[id],id);return imports[id]}});return module.exports.loadQboDirectCostLaborRates;
}
test('company-prefixed historical copy does not block labor rates or override current estimate stats',async()=>{
 for(const boards of [[{bidBoardId:'1:22',payload:{stats:{total:999}}},{bidBoardId:'22',payload:{stats:{total:100}}}],[{bidBoardId:'22',payload:{stats:{total:100}}},{bidBoardId:'1:22',payload:{stats:{total:999}}}]]){
 const r=await loader(boards)('1','2');assert.equal(r.issue,null);assert.equal(r.rates[0].rate,'38');assert.equal(r.proposalId,'33');
 }
});
test('genuinely different linked bid-board projects remain blocked',async()=>{
 const r=await loader([{bidBoardId:'22'},{bidBoardId:'23'}])('1','2');assert.match(r.issue,/one explicitly linked/);assert.equal(r.rates.length,0);
});
