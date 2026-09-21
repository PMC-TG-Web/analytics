'use client';

import { useState } from 'react';
import { matchQboCustomer } from '@/lib/qboCustomerMatch';
type Options = { customers: { id: string; name: string; fullName: string; suggested: boolean }[]; customerId: string | null; products: { name: string; description: string }[]; otherCostItems?: string[] };
export default function ProjectSetup({ companyId, projectId, projectName, month, blockedReason, onBusy, onComplete }: { companyId: string; projectId: string; projectName: string; month: string; blockedReason?: string; onBusy: (busy: boolean) => void; onComplete: () => Promise<void> }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [choosingCustomer, setChoosingCustomer] = useState(true);
  const [otherCostsConfirmed, setOtherCostsConfirmed] = useState(false);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  async function request(operation: string) {
    const response = await fetch('/api/accounting/direct-cost-bills/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, projectId, month, operation, customerId, otherCostsConfirmed }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to complete project setup.');
    return result;
  }
  async function run(apply: boolean) {
    setBusy(true); onBusy(true); setError('');
    let keepOpen = !!options;
    try {
      if (!apply) {
        setProgress('Loading QBO projects...');
        const result: Options = await request('setup-options');
        keepOpen = true;
        const matchedId = result.customerId || matchQboCustomer(projectName, result.customers);
        setOptions(result); setCustomerId(matchedId || ''); setChoosingCustomer(!matchedId); setProgress('');
      } else {
        for (let step = 0; step < 501; step++) {
          if (step === 0) setProgress('Matching products and saving setup...');
          const result = await request('setup');
          setProgress(`${result.total - result.remaining} of ${result.total} items ready`);
          if (result.complete) { keepOpen = false; await onComplete(); return; }
        }
        throw new Error('Source items changed during setup. Reopen setup to resume.');
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Setup interrupted. Saved progress is retained.'); setProgress(''); }
    finally { setBusy(false); onBusy(keepOpen); }
  }
  const selected = options?.customers.find(c => c.id === customerId);
  return <section id="qbo-project-setup" className="rounded-xl border border-blue-200 bg-white p-5 space-y-4">
    <div><h3 className="font-semibold">Set up QBO project</h3><p className="mt-1 text-sm text-slate-600">Setup matches the QBO project automatically when its name has one exact match, reuses existing products, and creates missing products.</p></div>
    {blockedReason && <p className="text-sm text-amber-800">{blockedReason}</p>}
    {!options ? <button disabled={busy || !!blockedReason} onClick={() => run(false)} className="rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-50">Set up project</button> : <>
      {choosingCustomer && <><p className="text-sm text-slate-600">Choose the correct QBO project below.</p><label className="block text-sm">Find QBO customer/project<input disabled={busy || !!options.customerId} value={search} onChange={e => setSearch(e.target.value)} placeholder="Customer or project name" className="mt-1 block w-full rounded border p-2" /></label>
      <label className="block text-sm font-medium">QBO customer / project<select disabled={busy || !!options.customerId} value={customerId} onChange={e => setCustomerId(e.target.value)} className="mt-1 block w-full rounded border p-2"><option value="">Select and confirm the correct QBO project</option>{options.customers.filter(c => c.id === customerId || c.fullName.toLowerCase().includes(search.toLowerCase())).map(c => <option key={c.id} value={c.id}>{c.suggested ? 'Suggested: ' : ''}{c.fullName}</option>)}</select></label>
      </>}
      {selected && <div className="text-sm font-medium"><p>{options.customerId ? 'Saved QBO project' : choosingCustomer ? 'Selected QBO project' : 'Matched QBO project'}: {selected.fullName}</p>{!options.customerId && !choosingCustomer && <button disabled={busy} onClick={() => setChoosingCustomer(true)} className="mt-1 text-blue-700 underline">Change</button>}</div>}
      <p className="text-sm text-slate-600">Vendor: PMC Procore Direct Costs. Item class: Flatwork. Material offset: Direct Costs -. Labor offset: Labor -. Offset customer/project: blank.</p>
      <details><summary className="cursor-pointer text-sm">{options.products.length} product mappings</summary><ul className="mt-2 space-y-1 text-xs text-slate-600">{options.products.map((p, i) => <li key={i}>{p.description} - {p.name}</li>)}</ul></details>
      {!!options.otherCostItems?.length && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p>Procore labels these PO items as Other/equipment: {options.otherCostItems.join(', ')}.</p><label className="mt-3 flex gap-2"><input type="checkbox" disabled={busy} checked={otherCostsConfirmed} onChange={e => setOtherCostsConfirmed(e.target.checked)} />Use Direct Costs - for these items. Labor stays in Labor -.</label></div>}
      <button disabled={busy || !selected || (!!options.otherCostItems?.length && !otherCostsConfirmed)} onClick={() => run(true)} className="rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Setting up...' : 'Set up products'}</button>
      <button disabled={busy} onClick={() => { setOptions(null); setProgress(''); setError(''); onBusy(false); }} className="ml-3 rounded-lg border px-4 py-2 disabled:opacity-50">Close setup</button>
      <p className="text-xs text-slate-500">This saves project setup only. Create or update the bill after reviewing its costs.</p>
    </>}
    {progress && <p role="status" className="text-sm">{progress}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
