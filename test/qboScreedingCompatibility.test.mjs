import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyDirectCostCoding } from '../src/lib/qboDirectCostCoding.ts';

// Opt-in compatibility check against the installed host; pure planning/building
// only. No service connection, credentials, saved mappings or QBO writes.
test('subcontractor screeders retain their machine class through host setup and bill preparation', { skip: process.env.QBO_BILL_HOST_TEST !== '1' }, async () => {
 const host = path.resolve(process.env.QBO_BILL_HOST_ROOT || '../QBO_1');
 const module = name => import(pathToFileURL(path.join(host, 'src', name)).href);
 const { planProjectProducts } = await module('direct-cost-project-setup.js');
 const { applyScreedingClasses } = await module('screeding-classes.js');
 const { buildDirectCostBill } = await module('direct-cost-bill.js');
 const classes = { powerRake: { id:'10',name:'Screeding:Screed-Power Rake' },s940:{id:'11',name:'Screeding:Screed-940'},s15:{id:'12',name:'Screeding:Screed-S15'},srs:{id:'13',name:'Screeding:Screed-SRS'} };
 const screeding = { equipmentProducts:true,includeLegacySomeroMaterials:true,classes };
 const defaults = { material:{suffix:'M',templateId:'20'},labor:{suffix:'L',templateId:'21'},screeding };
 for (const [description,key] of [['Somero S-15R (boom screed) (8 hr minimum) - SOG','s15'],['S-15','s15'],['CO6 - Somero SRS4 (boom screed) - Site','srs'],['Somero S-940 (8 hr minimum)','s940'],['Somero S-840 (8 hr minimum)','s940'],['Somero Power Rake (8 hr minimum)','powerRake']]) {
  const line=applyDirectCostCoding({procoreLineItemId:'100',lineKey:'100',sourceType:'productivity',description,costCode:'03-300-20-30',costType:'Subcontractors',uom:'ea',quantity:'2',unitCost:'100',amount:'200.00',sourceLogs:[{id:'200',date:'2026-03-02',quantity:'2'}]});
  const draft={schemaVersion:1,scope:'productivity_logs',vendorName:'PMC Procore Direct Costs',companyId:'1',projectId:'2',projectNumber:'TEST',month:'2026-03',issues:[],lines:[line],total:'200.00'};
  const [product]=planProjectProducts(draft,defaults);
  assert.equal(product.name,'TEST-03-300-20-30.E');
  const mapping={environment:'sandbox',realmId:'1',companyId:'1',projectId:'2',vendorId:'3',customerId:'4',customerName:'Example',items:{'100':{itemId:'5',itemName:product.name,classId:'6',offsetCategory:'material'}},offsets:{customerAssignment:'none',material:{accountId:'7',accountName:'Direct Costs -',classId:'6'}}};
  const classified=applyScreedingClasses(draft,mapping,screeding);
  const bill=buildDirectCostBill(draft,classified,'2026-03-01','PMCDC001');
  assert.equal(classified.items['100'].className,classes[key].name);
  assert.equal(bill.payload.Line[0].ItemBasedExpenseLineDetail.ClassRef.value,classes[key].id);
  assert.equal(bill.payload.Line[1].AccountBasedExpenseLineDetail.ClassRef.value,classes[key].id);
  assert.equal(bill.payload.Line.reduce((total,line)=>total+line.Amount,0),0);
  assert.equal(bill.grossTotal,200);
 }
});
