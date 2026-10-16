 'use client';
import { useState } from 'react';
import { readBillResponse } from '@/lib/qboBillResponse';
type Item={lineKey:string;description:string;uom:string|null;sourceSignature:string;revision:number;ignored:boolean;unitCost:string|null;reason:string;allowPrice:boolean};
export default function ProjectLineRules({companyId,projectId,month,items,disabled,onBusy,onComplete}:{companyId:string;projectId:string;month:string;items:Item[];disabled:boolean;onBusy:(value:boolean)=>void;onComplete:()=>Promise<void>}) {
 const [key,setKey]=useState(''),[price,setPrice]=useState(''),[ignored,setIgnored]=useState(false),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const item=items.find(i=>i.lineKey===key);
 function choose(value:string){const next=items.find(i=>i.lineKey===value);setKey(value);setPrice(next?.unitCost || '');setIgnored(next?.ignored || false);setReason(next?.reason || '');setError('');onBusy(!!value);}
 async function save(){if(!item)return;setBusy(true);setError('');try{const response=await fetch('/api/accounting/direct-cost-bills/line-rule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId,projectId,month,lineKey:key,sourceSignature:item.sourceSignature,revision:item.revision,ignored,unitCost:price.trim() || null,reason})});const result=await readBillResponse(response);if(!response.ok)throw new Error(result.error || 'Unable to save.');onBusy(false);await onComplete();}catch(e){setError(e instanceof Error?e.message:'Unable to save.');}finally{setBusy(false);}}
 if(!items.length)return null;
 return <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"><h3 className="font-semibold">Project line settings</h3><p className="text-sm text-slate-600">Skip automatic updates for a line or set its project-specific unit price. Skipped lines already in QuickBooks stay unchanged, with their offsets preserved. Missing skipped lines are not added. Settings apply across months until changed.</p>
 {items.filter(i=>i.ignored||i.unitCost!==null).map(i=><div key={i.lineKey} className="flex flex-wrap justify-between gap-2 rounded border p-3 text-sm"><span>{i.description} — {i.ignored?'Skipped — keep QB unchanged':`Project price: $${i.unitCost} per ${i.uom}`}</span><button disabled={disabled||busy} className="text-blue-700 underline" onClick={()=>choose(i.lineKey)}>Change / restore</button></div>)}
 <label className="block text-sm">Line<select className="mt-1 w-full rounded border p-2" disabled={disabled||busy} value={key} onChange={e=>choose(e.target.value)}><option value="">Choose a line to adjust</option>{items.map(i=><option key={i.lineKey} value={i.lineKey}>{i.description} ({i.uom}){i.ignored?' — Skipped':''}</option>)}</select></label>
 {item&&<div className="space-y-3"><label className="flex gap-2 text-sm"><input type="checkbox" checked={ignored} disabled={busy} onChange={e=>setIgnored(e.target.checked)}/>Skip automatic updates for this line (keep existing QB entries)</label>
 {item.allowPrice&&<label className="block text-sm">Project unit price (blank uses catalog)<input className="ml-2 rounded border p-2" type="number" min="0.00000001" step="any" value={price} disabled={busy} onChange={e=>setPrice(e.target.value)}/></label>}
 <label className="block text-sm">Reason<input className="mt-1 w-full rounded border p-2" maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
 <p className="text-xs text-slate-500">To resume automatic updates, uncheck Skip. Clear the project price to return to catalog pricing.</p>
 {error&&<p role="alert" className="text-red-700">{error}</p>}<button disabled={busy} onClick={save} className="rounded bg-blue-700 px-4 py-2 text-white">{busy?'Saving…':'Save project setting'}</button><button disabled={busy} onClick={()=>choose('')} className="ml-3 underline">Cancel</button></div>}
 </section>;
}
