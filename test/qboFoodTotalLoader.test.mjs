import * as projectPolicy from '../src/lib/qboBillProjectPolicy.ts';
import * as projectManagement from '../src/lib/qboProjectManagementRate.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { Prisma } from '@prisma/client';
import * as costs from '../src/lib/qboDirectCosts.ts';
import * as food from '../src/lib/qboFoodTotal.ts';
import * as labor from '../src/lib/qboDirectCostLabor.ts';
import * as coding from '../src/lib/qboDirectCostCoding.ts';
const date=new Date('2026-09-10');
async function load(saved, rules = [], timecards = [], foodDescription = 'Food', extra = {}) {
 const items=[{procoreId:'10',description:foodDescription,costCode:'01-300-10-80',costType:'Materials',uom:'ea',updatedAt:date}, {procoreId:'11',description:'Other material',costCode:'03-200-30-20',costType:'Materials',uom:'ea',updatedAt:date}];
 const logs=items.map((i,index)=>({id:String(index+1),procoreId:String(index+1),lineItemId:i.procoreId,lineItemDescription:i.description,quantityUsed:index?2:85.86,status:'approved',date,updatedAt:date}));
 items.push(...(extra.items || [])); logs.push(...(extra.logs || []));
 const prisma={pmcProject:{findUnique:async()=>({projectName:'Example',projectNumber:'123'})},productivityLog:{findMany:async()=>logs},purchaseOrderLineItemContractDetail:{findMany:async()=>items},$queryRaw:async()=>[],timecardEntry:{findMany:async()=>timecards},qboBillLineRule:{findMany:async()=>rules},qboCostCatalogMapping:{findMany:async()=>[]},qboBillFoodTotal:{findUnique:async()=>saved},qboBillFoodEntry:{findMany:async()=>saved?[{id:'entry',amount:saved.amount,spentOn:'2026-09-22',note:'Lunch',createdBy:'operator',createdAt:date}]:[]},$transaction:async requests=>Promise.all(requests)};
 const imports={ './qboProjectManagementRate.js':projectManagement, './qboBillProjectPolicy':projectPolicy, './qboBillLineRules':{projectPrice:()=>null}, './prisma':{prisma}, './qboDirectCosts':costs,'@prisma/client':{Prisma}, './qboDirectCostLabor':labor, './loadQboDirectCostLaborRates':{loadQboDirectCostLaborRates:async()=>({rates:[{costCode:'03-300-20-10',rate:'50',lineItemId:'5',updatedAt:date.toISOString()}],issue:extra.catalogIssue})},'./loadQboCostCatalog':{loadQboCostCatalog:async()=>({fetchedAt:date.toISOString(),items:[]})},'./qboCostCatalog':{catalogSnapshotIssue:()=>extra.catalogIssue || null},'./qboCatalogMapping':{purchasePriceFallback:()=>null,catalogSourceSignature:()=> 'a'.repeat(64),duplicateCatalogSourceIds:()=>new Set(),mappedCatalogPrice:source=>{assert.equal(coding.isFoodCost(source),false);return {unitCost:3.5,evidence:null,issue:null};}},'./qboDirectCostCoding':coding,'./qboFoodTotal':food,'./estimatingCostCodeCrosswalk':{loadEstimatingCostCodeCatalog:()=>new Map()}};
 const js=ts.transpileModule(fs.readFileSync('src/lib/loadQboDirectCosts.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};vm.runInNewContext(js,{exports:m.exports,require:id=>imports[id]});
 return m.exports.loadQboDirectCosts('1','2','2026-09');
}
test('monthly loader excludes 85.86 Food log quantity and includes entered $85.86 exactly once',async()=>{
 const d=await load({amount:new Prisma.Decimal('85.86'),revision:1,updatedBy:'operator',updatedAt:date});
 assert.equal(d.total,'92.86'); assert.equal(d.food.logCount,1); assert.equal(d.lines.length,2);
 assert.equal(d.lines.find(l=>l.sourceType==='manual_food').amount,'85.86'); assert.equal(d.catalogMappingItems.some(i=>i.description==='Food'),false);
});

test('shared bill draft accepts .LS screeders as equipment and preserves their Procore source assignment',async()=>{
 const source={procoreId:'12',description:'Somero S-15R (boom screed) (8 hr minimum) - SOG',costCode:'03-300-20-30',costType:'Labor Laser Screeding',wbsCode:'03-300-20-30.LS',uom:'ea',updatedAt:date};
 const d=await load(null,[],[],'Food',{items:[source],logs:[{id:'3',procoreId:'3',lineItemId:'12',lineItemDescription:source.description,quantityUsed:2,status:'approved',date,updatedAt:date}]});
 const line=d.lines.find(l=>l.lineKey==='12');
 assert.equal(line.costType,'Equipment'); assert.equal(line.costCode,source.costCode);
 assert.equal(line.sourceCostType,'Labor Laser Screeding'); assert.equal(line.sourceWbsCode,source.wbsCode);
 assert.equal(line.description,source.description); assert.equal(line.quantity,'2');
 assert.equal(d.ruleItems.find(l=>l.lineKey==='12').costType,'Equipment');
 assert.equal(d.issues.length,0); assert.equal(source.costType,'Labor Laser Screeding');
});
test('shared bill draft blocks active screeds that are not assigned to .LS in Procore',async()=>{
 const source={procoreId:'12',description:'Somero S-15R (boom screed) (8 hr minimum) - SOG',costCode:'03-300-20-30',costType:'Equipment',wbsCode:'03-300-20-30.E',uom:'ea',updatedAt:date};
 const d=await load(null,[],[],'Food',{items:[source],logs:[{id:'3',procoreId:'3',lineItemId:'12',lineItemDescription:source.description,quantityUsed:2,status:'approved',date,updatedAt:date}]});
 assert.equal(d.lines.some(l=>l.lineKey==='12'),false);
 assert.equal(d.catalogMappingItems.some(i=>i.lineItemId==='12'),false);
 assert.ok(d.issues.some(issue=>/must use the Labor Laser Screeding \(\.LS\) budget code in Procore/.test(issue)));
 assert.equal(d.issueSources.find(issue=>/Labor Laser Screeding/.test(issue.message)).target,'purchaseOrder');
});
test('shared monthly draft omits boom lift rental from bill lines and catalog setup while retaining labor',async()=>{
 const cards=[{procoreId:'100',date,hours:2,totalHoursWorked:null,costCodeFullCode:'03-300-20-10.L',costCodeName:'SOG Labor',updatedAt:date}];
 const extra={items:[{procoreId:'12',description:'Boom lift rental',costCode:'03-300-20-30',costType:'Equipment',uom:'days',updatedAt:date}],logs:[{id:'3',procoreId:'3',lineItemId:'12',lineItemDescription:'Boom lift rental',quantityUsed:7,status:'approved',date,updatedAt:date}]};
 const d=await load(null,[],cards,'Food',extra);
 assert.equal(d.total,'107.00'); assert.equal(d.excluded.boomLiftRental,1);
 assert.equal(d.lines.some(l=>l.lineKey==='12'),false); assert.equal(d.catalogMappingItems.some(i=>i.lineItemId==='12'),false);
 assert.equal(d.labor.totalHours,'2'); assert.equal(d.issues.length,0);
});

test('Food entries are optional even with daily logs; zero omits Food without removing other materials',async()=>{
 const missing=await load(null);assert.equal(missing.issues.length,0);assert.equal(missing.lines.some(l=>l.sourceType==='manual_food'),false);assert.equal(missing.total,'7.00');
 const zero=await load({amount:new Prisma.Decimal(0),revision:1,updatedBy:'operator',updatedAt:date}); assert.equal(zero.total,'7.00');assert.equal(zero.issues.length,0);assert.equal(zero.lines.length,1);
});

test('ignored purchase lines are excluded before pricing and remain available to restore',async()=>{
 const d=await load(null,[{lineKey:'11',ignored:true,unitCost:null,revision:1,reason:'Handled separately'}]);
 assert.equal(d.total,'0.00');assert.equal(d.lines.length,0);assert.equal(d.issues.length,0);assert.equal(d.ruleItems.find(i=>i.lineKey==='11').ignored,true);
 assert.equal((await load(null)).total,'7.00');
});
test('ignored timecard categories remove hours and labor cost together',async()=>{
 const timecards=[{procoreId:'100',date,hours:2,totalHoursWorked:null,costCodeFullCode:'03-300-20-10.L',costCodeName:'SOG Labor',updatedAt:date}];
 const included=await load(null,[],timecards);assert.equal(included.labor.totalHours,'2');assert.equal(included.total,'107.00');
 const excluded=await load(null,[{lineKey:'labor:03-300-20-10',description:'SOG Labor',ignored:true,unitCost:null,revision:1,reason:'Elsewhere'}],timecards);
 assert.equal(excluded.labor.totalHours,'0');assert.equal(excluded.total,'7.00');assert.equal(excluded.timecardsNotIncluded.hours,0);assert.equal(excluded.issues.length,0);
 const later=await load(null,[{lineKey:'labor:03-300-20-10',description:'SOG Labor',ignored:true,unitCost:null,revision:1,reason:'Elsewhere'}]);assert.ok(later.ruleItems.some(i=>i.lineKey==='labor:03-300-20-10'));
});

test('Breakfast PO logs use the saved food ledger once without catalog pricing or errors',async()=>{
 const d=await load({amount:new Prisma.Decimal('884.75'),revision:5,updatedBy:'operator',updatedAt:date},[],[],'Breakfast');
 assert.equal(d.issues.length,0);assert.equal(d.food.logCount,1);
 assert.equal(d.lines.filter(l=>l.sourceType==='manual_food').length,1);
 assert.equal(d.lines.find(l=>l.sourceType==='manual_food').amount,'884.75');
 assert.equal(d.catalogMappingItems.some(i=>i.description==='Breakfast'),false);
 assert.equal(d.total,'891.75');
});

test('same labor code in productivity and timecards is additive, with distinct evidence and combined hour totals',async()=>{
 const cards=[{procoreId:'100',date,hours:2,totalHoursWorked:null,costCodeFullCode:'03-300-20-10.L',costCodeName:'SOG Labor',updatedAt:date}];
 const extra={items:[{procoreId:'12',description:'Labor slab on grade',costCode:'03-300-20-10',costType:'Labor',uom:'hr',updatedAt:date}],logs:[{id:'100',procoreId:'100',lineItemId:'12',lineItemDescription:'Pouring labor',quantityUsed:3,status:'approved',date,updatedAt:date}]};
 const d=await load(null,[],cards,'Food',extra);
 assert.deepEqual(Array.from(d.issues),[]);
 assert.equal(d.labor.combinedHours,'5'); assert.equal(d.labor.combinedPricedHours,'5'); assert.equal(d.labor.combinedUnpricedHours,'0');
 assert.equal(d.labor.totalHours,'2','Preserve the host timecard evidence contract');
 assert.equal(d.total,'117.50','Preserve each source rate and add both amounts');
 assert.equal(d.lines.filter(l=>l.costType==='Labor').length,2,'Keep source rows until the host validates and aggregates');
 assert.equal(d.lines.find(l=>l.sourceType==='timecard').sourceLogs[0].id,'100');
 assert.equal(d.lines.find(l=>l.lineKey==='12').sourceLogs[0].id,'100','IDs from different Procore datasets are distinct evidence');
 extra.logs[0].status='draft';
 const unapproved=await load(null,[],cards,'Food',extra); assert.equal(unapproved.labor.combinedHours,'2'); assert.equal(unapproved.total,'107.00');
});

test('shared create/update draft includes Project Management from both sources and honors explicit Ignore rules', async () => {
 const code='01-300-10-20';
 const cards=[{procoreId:'100',date,hours:8,totalHoursWorked:null,costCodeFullCode:`${code}.L`,costCodeName:'Project Management',updatedAt:date}];
 const extra={items:[{procoreId:'12',description:'Project Management',costCode:code,costType:'Labor',uom:'hr',updatedAt:date}],logs:[{id:'3',procoreId:'3',lineItemId:'12',lineItemDescription:'Project Management',quantityUsed:3,status:'approved',date,updatedAt:date}]};
 const draft=await load(null,[],cards,'Food',extra);
 assert.equal(draft.issues.length,0);
 assert.equal(draft.total,'612.00');
 assert.equal(draft.labor.combinedHours,'11');
 assert.equal(draft.labor.combinedPricedHours,'11');
 assert.equal(draft.labor.combinedUnpricedHours,'0');
 assert.equal(draft.lines.find(line=>line.lineKey===`labor:${code}`).amount,'440.00');
 assert.equal(draft.lines.find(line=>line.lineKey==='12').amount,'165.00');
 assert.equal(draft.lines.find(line=>line.lineKey==='12').fixedPrice.unitCost,'55');
 assert.equal(draft.catalogMappingItems.some(item=>item.lineItemId==='12'),false);
 assert.equal(draft.ruleItems.find(item=>item.lineKey==='12').allowPrice,false);
 const rules=['12',`labor:${code}`].map(lineKey=>({lineKey,description:'Project Management',ignored:true,unitCost:null,revision:1,reason:'Handled separately'}));
 const ignored=await load(null,rules,cards,'Food',extra);
 assert.equal(ignored.total,'7.00');
 assert.equal(ignored.labor.combinedHours,'0');
 assert.equal(ignored.lines.some(line=>line.costCode===code),false);
 assert.equal(ignored.catalogMappingItems.some(item=>item.lineItemId==='12'),false);
 assert.equal(ignored.issues.length,0);
 extra.items[0].costCode=`${code}.L`;
 extra.items[0].uom='ea';
 // A missing catalog and an older saved PO price cannot replace the explicit rate.
 const fixedOnly=await load(null,[
  {lineKey:'11',ignored:true,unitCost:null,revision:1,reason:'Elsewhere'},
  {lineKey:'12',description:'Project Management',ignored:false,unitCost:'99',revision:1,reason:'Old rate'},
 ],cards,'Food',{...extra,catalogIssue:'Catalog unavailable'});
 assert.equal(fixedOnly.issues.length,0);
 assert.equal(fixedOnly.total,'605.00');
 assert.equal(fixedOnly.lines.find(line=>line.lineKey==='12').costCode,code);
 assert.equal(fixedOnly.lines.find(line=>line.lineKey==='12').uom,'hr');
 assert.equal(fixedOnly.lines.find(line=>line.lineKey==='12').fixedPrice.sourceUom,'ea');
 assert.equal(fixedOnly.ruleItems.find(item=>item.lineKey==='12').unitCost,null);
 assert.equal(fixedOnly.labor.combinedPricedHours,'11');
});
