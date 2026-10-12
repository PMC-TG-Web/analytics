import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {prepareSubcontractorCorrection} from './lib/qboSubcontractorCorrection.mjs';
const {values}=parseArgs({options:{host:{type:'string'},sources:{type:'string'},out:{type:'string'},apply:{type:'boolean',default:false},confirm:{type:'string'}}});
if(!values.host||!values.sources||!values.out)throw Error('Required: --host PATH --sources FILE --out DIRECTORY; preview is default.');
const host=path.resolve(values.host),out=path.resolve(values.out),req=createRequire(path.join(host,'package.json'));
const {parse}=req('dotenv');const env=parse(await fs.readFile(path.join(host,'.env'),'utf8'));
const sourcesPath=path.resolve(values.sources);
process.chdir(host);
// Token-store configuration is host-owned. Never print the environment or token record.
for(const [k,v] of Object.entries(env))process.env[k]=v;
const moduleAt=rel=>import(pathToFileURL(path.join(host,rel)).href);
const [{IntuitClient},{QboBillWriter},tokenStore,{savedPrepared},{expenseAmount},{syncMonthlyBill}]=await Promise.all([
  moduleAt('src/intuit-client.js'),moduleAt('src/bill-writer.js'),moduleAt('src/token-store.js'),moduleAt('src/qbo-managed-bill.js'),moduleAt('src/direct-cost-bill.js'),moduleAt('src/monthly-bill-sync.js')]);
const token=await tokenStore.readTokenRecord(tokenStore.getTokenFilePath());
if(!token||String(token.realmId)!==env.QBO_BILL_ALLOWED_REALM_ID||tokenStore.isTokenExpired(token))throw Error('A current host token for the configured QBO company is required.');
const client={accessToken:token.accessToken,realmId:token.realmId,environment:env.INTUIT_ENVIRONMENT};
const reader=new IntuitClient(client),writer=new QboBillWriter({...client,enabled:env.QBO_BILL_WRITES_ENABLED==='true',allowedRealmId:env.QBO_BILL_ALLOWED_REALM_ID});
const source=JSON.parse(await fs.readFile(sourcesPath,'utf8'));
if(source.companyId!==env.PROCORE_COMPANY_ID)throw Error('Source company differs from configured host');
const targets=new Map();
for(const row of [...source.detail.map(r=>({projectId:r.procoreProjectId,projectName:r.projectName,month:r.month,sourceType:'timecard',id:r.procoreId,date:r.date,quantity:String(r.hours)})),
  ...source.extra.map(r=>({projectId:r.procoreProjectId,projectName:r.projectName,month:r.date.slice(0,7),sourceType:'productivity',id:r.procoreId,date:r.date.slice(0,10),quantity:String(r.quantityUsed)}))]){
  const key=row.projectId+'|'+row.month;const t=targets.get(key)||{projectId:row.projectId,projectName:row.projectName,month:row.month,excluded:[]};t.excluded.push(row);targets.set(key,t);
}
await fs.mkdir(out,{recursive:true});
const plan=[];
for(const t of targets.values()){
  const identity=createHash('sha256').update(JSON.stringify([env.INTUIT_ENVIRONMENT,token.realmId,source.companyId,t.projectId,t.month])).digest('hex');
  const claim=path.join(host,'.runtime/direct-cost-bills/posted',identity);
  const receipt=JSON.parse(await fs.readFile(path.join(claim,'receipt.json'),'utf8'));
  const saved=await savedPrepared(claim,receipt),current=(await reader.getBill(receipt.billId)).Bill;
  if(saved.identity!==identity)throw Error('Monthly identity mismatch');
  const correction=prepareSubcontractorCorrection({saved,receipt,current,excluded:t.excluded,expenseAmount});
  plan.push({...t,identity,billId:receipt.billId,billNumber:receipt.docNumber,version:current.SyncToken,receiptFingerprint:receipt.fingerprint,correction,current});
}
const fingerprint=createHash('sha256').update(JSON.stringify(plan.map(p=>({billId:p.billId,version:p.version,receipt:p.receiptFingerprint,prepared:p.correction.prepared?.fingerprint||null})))).digest('hex');
if(!values.apply){
  await fs.writeFile(path.join(out,'preview.json'),JSON.stringify({fingerprint,plan},null,2));
  console.log(JSON.stringify({mode:'preview',fingerprint,bills:plan.length,changedBills:plan.filter(p=>!p.correction.unchanged).length,removedHours:plan.reduce((n,p)=>n+p.correction.removed.reduce((s,l)=>s+Number(l.quantity),0),0),reduction:plan.reduce((n,p)=>n+Math.round((p.correction.reduction||0)*100),0)/100,notPostedHours:plan.reduce((n,p)=>n+p.correction.notPosted.reduce((s,l)=>s+Number(l.quantity),0),0),details:plan.map(p=>({project:p.projectName,month:p.month,bill:p.billNumber,billId:p.billId,hours:p.correction.removed.reduce((n,l)=>n+Number(l.quantity),0),reduction:p.correction.reduction,adjustments:p.correction.adjustments}))},null,2));
}else{
  if(values.confirm!==fingerprint)throw Error('The exact reviewed plan changed; run preview and review again.');
  await fs.writeFile(path.join(out,`approved-${fingerprint}.json`),JSON.stringify({fingerprint,plan},null,2),{flag:'wx'});
  const results=[];
  for(const p of plan){
    if(p.correction.unchanged){results.push({billId:p.billId,unchanged:true});continue;}
    const currentReceipt=JSON.parse(await fs.readFile(path.join(host,'.runtime/direct-cost-bills/posted',p.identity,'receipt.json'),'utf8'));
    if(currentReceipt.fingerprint!==p.receiptFingerprint)throw Error('Receipt changed after preview; no further writes sent');
    const result=await syncMonthlyBill({directory:path.join(host,'.runtime/direct-cost-bills/posted'),prepared:p.correction.prepared,
      createBill:async()=>{throw Error('Creating a bill is forbidden in this correction');},
      readBill:async id=>(await reader.getBill(id)).Bill,
      updateBill:async(prepared,current)=>{if(String(current.SyncToken)!==String(p.version))throw Error('Bill changed after preview');return writer.updateBill(prepared,current);}});
    const verified=(await reader.getBill(p.billId)).Bill;
    const proposed=p.correction.prepared.payload.Line.concat(p.correction.prepared.preservedLines);
    if(verified.Line.length!==proposed.length||Math.round(verified.TotalAmt*100)!==Math.round(p.current.TotalAmt*100))throw Error('Readback bill total or row count mismatch');
    for(const expected of proposed){const actual=verified.Line.find(l=>String(l.Id)===String(expected.Id));if(!actual||Math.round(actual.Amount*100)!==Math.round(expected.Amount*100)||JSON.stringify(actual.ItemBasedExpenseLineDetail)!==JSON.stringify(expected.ItemBasedExpenseLineDetail)||JSON.stringify(actual.AccountBasedExpenseLineDetail)!==JSON.stringify(expected.AccountBasedExpenseLineDetail))throw Error('Readback line mismatch');}
    await fs.writeFile(path.join(out,`verified-${p.billId}.json`),JSON.stringify(verified,null,2),{flag:'wx'});
    results.push({billId:p.billId,number:p.billNumber,project:p.projectName,month:p.month,removedHours:p.correction.removed.reduce((n,l)=>n+Number(l.quantity),0),reduction:p.correction.reduction,syncToken:result.syncToken,total:verified.TotalAmt});
    await fs.writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify(results.at(-1)));
  }
}
