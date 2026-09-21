'use client';

import { useState } from 'react';

type Row = { description: string; type: string; product: string; quantity: number | null; unitCost: number | null; amount: number; className: string; customer: string };
type Review = { manuallyChanged: boolean; fingerprint: string; billNumber: string; current: { rows: Row[]; total: number; note: string }; proposed: { rows: Row[]; total: number; note: string } };
const money = (value: number) => Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export default function BillReconciliation({ companyId, projectId, month, disabled, onBusy, onComplete }: { companyId: string; projectId: string; month: string; disabled: boolean; onBusy: (busy: boolean) => void; onComplete: () => Promise<void> }) {
  const [opened, setOpened] = useState(false);
  const [working, setWorking] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);
  async function request(operation: 'preview' | 'confirm') {
    if (operation === 'confirm' && review?.manuallyChanged !== true) return;
    setOpened(true); onBusy(true); setWorking(true); setError('');
    if (operation === 'preview') { setReview(null); setAccepted(false); }
    try {
      const response = await fetch('/api/accounting/direct-cost-bills/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, projectId, month, operation, fingerprint: review?.fingerprint }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to reconcile the bill.');
      if (operation === 'preview') setReview(data);
      else { onBusy(false); await onComplete(); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to reconcile the bill.'); setReview(null); setAccepted(false); }
    finally { setWorking(false); }
  }
  if (!opened) return <button disabled={disabled} className="rounded border border-blue-700 px-4 py-2 text-blue-800 disabled:opacity-50" onClick={() => request('preview')}>Check QBO bill</button>;
  return <section className={`space-y-4 rounded-xl border p-5 ${review?.manuallyChanged ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`} aria-label="QBO bill comparison">
    <h3 className="font-semibold">{review?.manuallyChanged ? 'Reconciliation needed' : review ? 'No reconciliation needed' : 'Check QBO bill'}{review ? ` · ${review.billNumber}` : ''}</h3>
    {review?.manuallyChanged ? <p className="text-sm">QBO reports that this bill changed since the last saved or reconciled version. Review the current QBO bill and the proposed monthly replacement. Confirming saves the reviewed version and an audit copy. Then use Update bill in QBO to replace its item lines and negative offsets. Manual line changes will be replaced.</p> : <p className="text-sm">{review ? 'QBO has not changed since the last saved or reconciled version. Differences in the proposed monthly bill do not require reconciliation. Close this comparison and use the normal Update bill action if monthly costs need updating.' : 'Checking whether the QBO bill changed since the last saved or reconciled version.'}</p>}
    {working && <p role="status">{review ? 'Saving reconciliation…' : 'Reading the current QBO bill…'}</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {review && <>{([['Current QBO bill', review.current], ['Proposed monthly bill', review.proposed]] as const).map(([title, bill]) => <div key={title} className="overflow-x-auto rounded border bg-white"><h4 className="p-3 font-medium">{title}</h4><table className="w-full text-left text-sm"><thead><tr>{['Line / product', 'Class / project', 'Quantity', 'Cost per', 'Amount'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{bill.rows.map((row, i) => <tr key={i} className="border-t"><td className="p-3">{row.description}<div className="text-xs text-slate-500">{row.type} · {row.product}</div></td><td className="p-3">{row.className || '—'}<div className="text-xs">{row.customer || 'No project'}</div></td><td className="p-3">{row.quantity ?? '—'}</td><td className="p-3">{row.unitCost === null ? '—' : money(row.unitCost)}</td><td className="p-3">{money(row.amount)}</td></tr>)}</tbody></table><p className="border-t p-3 font-medium">Net total: {money(bill.total)}</p>{bill.note && <p className="whitespace-pre-wrap px-3 pb-3 text-sm">Note: {bill.note}</p>}</div>)}
      {review.manuallyChanged && <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={working} checked={accepted} onChange={e => setAccepted(e.target.checked)} />I reviewed the changes and want the next update to replace the QBO bill with these monthly costs.</label>}
    </>}
    <div className="flex gap-3"><button disabled={working} className="rounded border px-4 py-2 disabled:opacity-50" onClick={() => { setOpened(false); setReview(null); onBusy(false); }}>{review?.manuallyChanged ? 'Cancel' : 'Close'}</button>{review?.manuallyChanged ? <button disabled={working || !accepted} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50" onClick={() => request('confirm')}>Confirm reconciliation</button> : !review ? <button disabled={working} className="rounded border px-4 py-2 disabled:opacity-50" onClick={() => request('preview')}>Reload comparison</button> : null}</div>
  </section>;
}
