import { createHash } from 'node:crypto';
const cents = value => Math.round(Number(value) * 100);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const units = value => {
  const text=String(value); if(!/^\d+(\.\d{1,8})?$/.test(text))throw Error('Invalid source quantity');
  const [whole,fraction='']=text.split('.');return BigInt(whole+fraction.padEnd(8,'0'));
};
const decimal = value => `${value/100000000n}.${String(value%100000000n).padStart(8,'0')}`.replace(/\.?0+$/,'');
const refKey = detail => JSON.stringify([detail.AccountRef.value,detail.ClassRef?.value||null,detail.CustomerRef?.value||null]);

// A removal-only plan against successful posting evidence and explicit source IDs.
// It never reprices remaining labor, rewrites other source quantities, or creates bills.
export function prepareSubcontractorCorrection({saved,receipt,current,excluded,expenseAmount}) {
  if(saved.fingerprint!==receipt.fingerprint || String(current.Id)!==String(receipt.billId)
    || current.DocNumber!==receipt.docNumber || current.VendorRef?.value!==saved.payload.VendorRef.value)
    throw Error('Bill identity/history mismatch');
  if(current.LinkedTxn?.length)throw Error('Linked bill requires review');
  if(!receipt.sourceBindings || !receipt.managedLines)throw Error('Verified source bindings are required');
  const removals=new Map(excluded.map(e=>[`${e.sourceType}:${e.id}`,e]));
  if(removals.size!==excluded.length)throw Error('Duplicate exclusion IDs');
  const nextSource=[],affected=new Map(),removed=[];
  for(const source of saved.source){
    let quantity=0n;const logs=[];
    for(const log of source.sourceLogs||[]){
      const e=removals.get(`${source.sourceType}:${log.id}`);
      if(e){
        if(log.date!==e.date || units(log.quantity)!==units(e.quantity))throw Error('Excluded source date/quantity changed');
        quantity+=units(log.quantity);removed.push({...e,lineKey:source.lineKey});
      }else logs.push(log);
    }
    if(!quantity){nextSource.push(structuredClone(source));continue;}
    const id=String(receipt.sourceBindings[source.lineKey]||'');if(!id)throw Error('Excluded source has no QBO line binding');
    const a=affected.get(id)||{quantity:0n,source};a.quantity+=quantity;affected.set(id,a);
    const remainder=units(source.quantity)-quantity;if(remainder<0n)throw Error('Source removal exceeds quantity');
    if(remainder)nextSource.push({...structuredClone(source),quantity:decimal(remainder),sourceLogs:logs});
  }
  if(!removed.length)return {unchanged:true,removed:[],notPosted:excluded};
  const lineById=new Map(current.Line.map(l=>[String(l.Id),structuredClone(l)]));
  const adjustments=[],drop=new Set();let reduction=0;
  for(const [id,a] of affected){
    const line=lineById.get(id),baseline=receipt.managedLines.find(l=>String(l.Id)===id);
    const detail=line?.ItemBasedExpenseLineDetail,old=baseline?.ItemBasedExpenseLineDetail;
    if(!detail||!old||detail.ItemRef.value!==old.ItemRef.value||detail.CustomerRef?.value!==old.CustomerRef?.value
      ||units(detail.Qty)!==units(old.Qty))throw Error('Affected QBO line identity or quantity changed');
    const boundSources=saved.source.filter(s=>String(receipt.sourceBindings[s.lineKey])===id);
    if(boundSources.reduce((n,s)=>n+units(s.quantity),0n)!==units(detail.Qty))throw Error('Source quantities do not explain complete QBO line');
    if(!Number.isFinite(detail.UnitPrice)||detail.UnitPrice<=0||cents(line.Amount)!==cents(expenseAmount(detail.Qty,detail.UnitPrice)))throw Error('Affected line has inconsistent live pricing');
    const remain=units(detail.Qty)-a.quantity;if(remain<0n)throw Error('Removal exceeds live QBO quantity');
    const nextAmount=remain?expenseAmount(decimal(remain),detail.UnitPrice):0;
    const delta=cents(line.Amount)-cents(nextAmount);if(delta<0)throw Error('Correction must only reduce cost');
    const labor=a.source.sourceType==='timecard'||/\.L$/.test(a.source.qboItemName||'');
    const templates=saved.payload.Line.filter(l=>l.AccountBasedExpenseLineDetail&&
      /(?:^|:)Labor -$/.test(l.AccountBasedExpenseLineDetail.AccountRef.name||'')===labor);
    const accounts=new Set(templates.map(l=>l.AccountBasedExpenseLineDetail.AccountRef.value));
    const offsets=[...lineById.values()].filter(l=>l.AccountBasedExpenseLineDetail&&accounts.has(l.AccountBasedExpenseLineDetail.AccountRef.value)
      &&(l.AccountBasedExpenseLineDetail.ClassRef?.value||null)===(detail.ClassRef?.value||null));
    if(offsets.length!==1)throw Error('One matching offset account/class is required');
    const offset=offsets[0];
    if(!templates.some(t=>refKey(t.AccountBasedExpenseLineDetail)===refKey(offset.AccountBasedExpenseLineDetail)))throw Error('Offset ownership mismatch');
    if(cents(offset.Amount)+delta>0)throw Error('Removal exceeds negative offset');
    offset.Amount=(cents(offset.Amount)+delta)/100;
    adjustments.push({lineId:id,description:line.Description,item:detail.ItemRef.name,oldQuantity:detail.Qty,
      removedHours:Number(decimal(a.quantity)),newQuantity:Number(decimal(remain)),rate:detail.UnitPrice,
      oldAmount:line.Amount,newAmount:nextAmount,reduction:delta/100,offsetId:String(offset.Id),offsetAccount:offset.AccountBasedExpenseLineDetail.AccountRef.name});
    reduction+=delta;
    if(remain){detail.Qty=Number(decimal(remain));line.Amount=nextAmount;}else drop.add(id);
  }
  const known=new Set(receipt.managedLines.map(l=>String(l.Id)));
  const preserved=current.Line.filter(l=>!known.has(String(l.Id)));
  const all=current.Line.filter(l=>!drop.has(String(l.Id))).map(l=>lineById.get(String(l.Id)));
  if(all.reduce((n,l)=>n+cents(l.Amount),0)!==current.Line.reduce((n,l)=>n+cents(l.Amount),0))throw Error('Correction changes bill total');
  const managed=all.filter(l=>known.has(String(l.Id)));
  const sourceKeys=new Set(nextSource.map(s=>s.lineKey));
  const itemSourceKeys=managed.filter(l=>l.ItemBasedExpenseLineDetail).map(l=>Object.entries(receipt.sourceBindings).filter(([k,id])=>String(id)===String(l.Id)&&sourceKeys.has(k)).map(([k])=>k));
  if(itemSourceKeys.some(keys=>!keys.length))throw Error('Retained managed item lacks source evidence');
  const {Id,SyncToken,MetaData,domain,sparse,TotalAmt,Balance,...header}=current;
  const payload={...header,Line:managed};
  const grossTotal=managed.filter(l=>l.ItemBasedExpenseLineDetail).reduce((n,l)=>n+cents(l.Amount),0)/100;
  const total=managed.reduce((n,l)=>n+cents(l.Amount),0)/100;
  const fingerprint=hash({purpose:'remove-subcontractor-source-hours',identity:saved.identity,version:SyncToken,payload,source:nextSource,removed});
  return {unchanged:false,removed,notPosted:excluded.filter(e=>!removed.some(r=>r.sourceType===e.sourceType&&r.id===e.id)),adjustments,reduction:reduction/100,
    prepared:{...saved,payload,source:nextSource,itemSourceKeys,grossTotal,total,offsetTotal:total-grossTotal,
      autoMerge:true,expectedQboVersion:String(SyncToken),preservedLines:preserved,
      qboPrices:receipt.qboPrices||{},qboOffsetAdjustments:receipt.qboOffsetAdjustments||[],fingerprint,
      requestId:`pc-${fingerprint.slice(0,40)}`,requestedBy:'Todd Gilmore: remove separately invoiced subcontractor hours'}};
}
