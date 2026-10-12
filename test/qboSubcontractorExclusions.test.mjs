import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aggregateDirectCostLabor } from '../src/lib/qboDirectCostLabor.ts';
import { aggregateDirectCosts } from '../src/lib/qboDirectCosts.ts';
import { isSubcontractorProductivity } from '../src/lib/qboSubcontractorExclusions.js';
const date = new Date('2026-09-25');
const card = (id, partyName) => ({ procoreId:id,partyName,date,updatedAt:date,hours:10,totalHoursWorked:null,costCodeFullCode:'03-300-20-10',costCodeName:'SOG' });
const rate = { costCode:'03-300-20-10',rate:'70.85',lineItemId:'1',updatedAt:date.toISOString() };
test('subcontractor workers never contribute quantity, source evidence, costs or unpriced-hour errors',()=>{
  const cards=[card('1','Sub Contractor'),card('2',' SUB-CONTRACTOR '),{...card('3',null),party:'Subcontractor'},card('4','Employee')];
  const result=aggregateDirectCostLabor(cards,[rate]);
  assert.equal(result.totalHours,'10');assert.equal(result.total,'708.50');assert.equal(result.excludedSubcontractorHours,'30');
  assert.deepEqual(result.lines[0].sourceLogs.map(s=>s.id),['4']);assert.equal(cards[0].hours,10);
  assert.deepEqual(aggregateDirectCostLabor(cards.slice(0,3),[]).issues,[]);
});
test('productivity exclusion precedes pricing and missing-line validation, including ls hours and resolved aliases',()=>{
  const log={id:'1',date,updatedAt:date,status:'approved',quantityUsed:34,lineItemId:'old',lineItemDescription:'#13 - Subcontractor Hours - 1.0 ls',lineItemHolderTitle:'Slab'};
  const first=aggregateDirectCosts([log],[],new Map());
  assert.equal(first.excluded.subcontractor,1);assert.equal(first.total,'0.00');assert.deepEqual(first.issues,[]);
  const second=aggregateDirectCosts([{...log,lineItemDescription:'Legacy labor'}],[{procoreId:'new',description:'CO2 - Sub Contractor Hours',unitCost:0,uom:'ls',updatedAt:date,costType:'Labor'}],new Map([['old','new']]));
  assert.equal(second.excluded.subcontractor,1);assert.deepEqual(second.issues,[]);assert.equal(second.laborHours,'0');
  for(const name of ['Somero SRS4','Subcontractor equipment rental','Non Contracted Labor','Labor SOG Concrete'])assert.equal(isSubcontractorProductivity(name),false,name);
});
test('database loader supplies worker identity to the billing-only exclusion',()=>{
  const source=readFileSync(new URL('../src/lib/loadQboDirectCosts.ts',import.meta.url),'utf8');
  assert.match(source,/party: true, partyName: true/);
});
