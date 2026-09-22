import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { Prisma } from '@prisma/client';
import * as costs from '../src/lib/qboDirectCosts.ts';
import * as food from '../src/lib/qboFoodTotal.ts';
import * as coding from '../src/lib/qboDirectCostCoding.ts';
const date=new Date('2026-09-10');
async function load(saved) {
 const items=[{procoreId:'10',description:'Food',costCode:'03-150-10-85',costType:'Materials',uom:'ea',updatedAt:date}, {procoreId:'11',description:'Other material',costCode:'03-200-30-20',costType:'Materials',uom:'ea',updatedAt:date}];
 const logs=items.map((i,index)=>({id:String(index+1),procoreId:String(index+1),lineItemId:i.procoreId,lineItemDescription:i.description,quantityUsed:index?2:85.86,status:'approved',date,updatedAt:date}));
 const prisma={pmcProject:{findUnique:async()=>({projectName:'Example',projectNumber:'123'})},productivityLog:{findMany:async()=>logs},purchaseOrderLineItemContractDetail:{findMany:async()=>items},$queryRaw:async()=>[],timecardEntry:{findMany:async()=>[]},qboCostCatalogMapping:{findMany:async()=>[]},qboBillFoodTotal:{findUnique:async()=>saved},qboBillFoodEntry:{findMany:async()=>saved?[{id:'entry',amount:saved.amount,spentOn:'2026-09-22',note:'Lunch',createdBy:'operator',createdAt:date}]:[]},$transaction:async requests=>Promise.all(requests)};
 const imports={ './prisma':{prisma}, './qboDirectCosts':costs,'@prisma/client':{Prisma}, './qboDirectCostLabor':{aggregateDirectCostLabor:()=>({rows:[],lines:[],issues:[],total:'0.00',totalHours:'0',unpricedHours:'0'})}, './loadQboDirectCostLaborRates':{loadQboDirectCostLaborRates:async()=>({rates:[]})},'./loadQboCostCatalog':{loadQboCostCatalog:async()=>({fetchedAt:date.toISOString(),items:[]})},'./qboCostCatalog':{catalogSnapshotIssue:()=>null},'./qboCatalogMapping':{duplicateCatalogSourceIds:()=>new Set(),mappedCatalogPrice:source=>{assert.notEqual(source.description,'Food');return {unitCost:3.5,evidence:null,issue:null};}},'./qboDirectCostCoding':coding,'./qboFoodTotal':food,'./estimatingCostCodeCrosswalk':{loadEstimatingCostCodeCatalog:()=>new Map()}};
 const js=ts.transpileModule(fs.readFileSync('src/lib/loadQboDirectCosts.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};vm.runInNewContext(js,{exports:m.exports,require:id=>imports[id]});
 return m.exports.loadQboDirectCosts('1','2','2026-09');
}
test('monthly loader excludes 85.86 Food log quantity and includes entered $85.86 exactly once',async()=>{
 const d=await load({amount:new Prisma.Decimal('85.86'),revision:1,updatedBy:'operator',updatedAt:date});
 assert.equal(d.total,'92.86'); assert.equal(d.food.logCount,1); assert.equal(d.lines.length,2);
 assert.equal(d.lines.find(l=>l.sourceType==='manual_food').amount,'85.86'); assert.equal(d.catalogMappingItems.some(i=>i.description==='Food'),false);
});
test('Food logs require an explicit total; zero removes Food without removing other materials',async()=>{
 const missing=await load(null);assert.ok(missing.issues.some(i=>i.includes('Add Food expenses')));assert.equal(missing.total,'7.00');
 const zero=await load({amount:new Prisma.Decimal(0),revision:1,updatedBy:'operator',updatedAt:date}); assert.equal(zero.total,'7.00');assert.equal(zero.issues.length,0);assert.equal(zero.lines.length,1);
});
