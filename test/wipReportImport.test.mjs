import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWipRevenueReport, supplementalWipProjects, reportMonthValues } from '../src/lib/wipReportImport.ts';
import { addWipReportHours, addWipReportSales } from '../src/lib/wipReportTotals.ts';
const header = ['Customer/Project Name','Job Sold Date','Project Hours','Contract Total','Start date','% of ','Contract total','Project Hours'];
const row = ['Example/Old job', 45657, 100, 1000, 45658, 0.25, 250, 25];

test('report import preserves partial historical hours and revenue, including multiple bases and zero-dollar hours', () => {
  const projects = parseWipRevenueReport([header, row, ['Example/Old job',45680,20,null,45689,1,0,20]], 'company', {});
  assert.equal(projects.length,1); assert.equal(projects[0].link,null);
  assert.deepEqual(reportMonthValues(projects[0],'2025-01'),{hours:25,revenue:250,percent:25});
  assert.deepEqual(reportMonthValues(projects[0],'2025-02'),{hours:20,revenue:0,percent:100});
  assert.equal(projects[0].issues.length,3);
  assert.match(projects[0].issues[0],/125%/);
  assert.equal(projects[0].lines[0].soldDate,'2024-12-31');
});

test('blank monthly revenue is calculated only when the workbook supplies both inputs; invalid amounts fail', () => {
  const blank = [...row]; blank[6] = null;
  const project = parseWipRevenueReport([header, blank], 'company', {})[0];
  assert.equal(project.lines[0].revenue,250); assert.match(project.issues[0],/blank monthly revenue/);
  const missing = [...blank]; missing[3] = null;
  assert.throws(()=>parseWipRevenueReport([header,missing],'company',{}),/Invalid/);
  const mismatch = [...row]; mismatch[7] = 99;
  assert.throws(()=>parseWipRevenueReport([header,mismatch],'company',{}),/reconcile/);
  assert.throws(()=>parseWipRevenueReport([header,row],'company',{'not in file':{companyId:'company',projectId:'1',mode:'history'}}),/not found/);
});

test('reviewed external links suppress existing WIP while old-company history stays independent', () => {
  const names = ['Current','Complete','Old company','Legacy'];
  const rows = names.map(name=>[name,...row.slice(1)]);
  const projects = parseWipRevenueReport([header,...rows],'company', {
    Current:{companyId:'company',projectId:'1',mode:'procore'},
    Complete:{companyId:'company',projectId:'2',mode:'history'},
    'Old company':{companyId:'old',projectId:'2',mode:'history'},
  });
  const selected=supplementalWipProjects({companyId:'company',projects},['2']);
  assert.deepEqual(selected.map(p=>p.sourceName),['Legacy','Old company']);
  assert.equal(new Set(projects.map(p=>p.id)).size,4);
  assert.deepEqual(supplementalWipProjects(null,[]),[]);
});

test('KPI supplements add exact report amounts once and expose matching project breakdowns', () => {
  const projects=parseWipRevenueReport([header,row],'company',{});
  const base={months:{'2025-01':100},years:['2025'],planCount:1,excludedDraftCount:1,localOnly:true};
  const hours=addWipReportHours(base,projects);
  assert.equal(hours.months['2025-01'],125); assert.equal(hours.reportProjectCount,1);
  assert.equal(base.months['2025-01'],100);
  const sales=addWipReportSales({...base,projectsByMonth:{}},projects);
  assert.equal(sales.months['2025-01'],350);
  assert.equal(sales.projectsByMonth['2025-01'][0].value,250);
  assert.match(sales.projectsByMonth['2025-01'][0].dateLabel,/row 2/);
});
