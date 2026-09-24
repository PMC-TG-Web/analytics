import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDirectCosts } from '../src/lib/qboDirectCosts.ts';
import { aggregateDirectCostLabor } from '../src/lib/qboDirectCostLabor.ts';
const date=new Date('2026-07-21T00:00:00Z');
test('Project Management PO usage is excluded before missing catalog price validation',()=>{
 const logs=[{id:'1',date,status:'approved',quantityUsed:8,lineItemId:'10',lineItemDescription:'Project Management',lineItemHolderTitle:'Non-Budgeted',updatedAt:date}];
 const items=[{procoreId:'10',description:'Project Management',costCode:'01-300-10-20.L',costType:'Labor',uom:'ea',unitCost:null,pricingIssue:'No catalog price',updatedAt:date}];
 const r=aggregateDirectCosts(logs,items,new Map());assert.deepEqual(r.issues,[]);assert.deepEqual(r.lines,[]);assert.deepEqual(r.issueSources,[]);assert.equal(r.total,'0.00');assert.equal(logs[0].quantityUsed,8);
});
test('Project Management timecards never use fallback rates or block other labor',()=>{
 const cards=[{procoreId:'1',date,hours:8,totalHoursWorked:8,costCodeFullCode:'01-300-10-20',costCodeName:'Project Management',updatedAt:date},{procoreId:'2',date,hours:2,totalHoursWorked:2,costCodeFullCode:'03-300-20-10',costCodeName:'SOG labor',updatedAt:date}];
 const rates=[{costCode:'03-300-20-10',rate:'70',lineItemId:'20',updatedAt:date.toISOString()}];
 const r=aggregateDirectCostLabor(cards,rates);assert.deepEqual(r.issues,[]);assert.equal(r.lines.length,1);assert.equal(r.total,'140.00');assert.equal(cards[0].hours,8);
 const only=aggregateDirectCostLabor([cards[0]],[]);assert.deepEqual(only.issues,[]);assert.deepEqual(only.lines,[]);
});