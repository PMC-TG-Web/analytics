'use client';

import { useState } from 'react';
import type { loadQboCatalogMapping } from '@/lib/loadQboCatalogMapping';

type Choices = Awaited<ReturnType<typeof loadQboCatalogMapping>>;
type Item = { lineItemId: string; description: string; costCode: string | null; uom: string | null; issue: string | null; catalogName: string | null; manual: boolean; projectPrice?: boolean };
export default function CatalogMappingPanel({ companyId, projectId, items, disabled, onBusy, onComplete }: { companyId: string; projectId: string; items: Item[]; disabled: boolean; onBusy: (busy: boolean) => void; onComplete: () => Promise<void> }) {
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState('');
  const [choices, setChoices] = useState<Choices | null>(null);
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unresolved = items.filter(item => item.issue);
  async function open(lineItemId: string) {
    setEditing(lineItemId); setChoices(null); setSelected(''); setSearch(''); setError(''); setBusy(true); onBusy(true);
    try {
      const response = await fetch(`/api/accounting/direct-cost-bills/catalog-mapping?${new URLSearchParams({ companyId, projectId, lineItemId })}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load catalog items.');
      setChoices(result); setSelected(result.selectedItemId || '');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load catalog items.'); }
    finally { setBusy(false); }
  }
  function close() { setEditing(''); setChoices(null); setError(''); onBusy(false); }
  async function save(clear = false) {
    if (!choices) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/accounting/direct-cost-bills/catalog-mapping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, projectId, lineItemId: editing, catalogItemId: clear ? null : selected, sourceSignature: choices.sourceSignature, revision: choices.revision }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save pricing source.');
      await onComplete(); close();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save pricing source.'); }
    finally { setBusy(false); }
  }
  if (!items.length) return null;
  const selectedItem = choices?.candidates.find(item => item.itemId === selected);
  return <section id="bill-catalog-mappings" className="scroll-mt-20 rounded-xl border border-blue-200 bg-white p-5 space-y-3">
    <div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-semibold">Confirm pricing source</h3><p className="text-sm text-slate-600">Confirm which Procore catalog item supplies the current price. Saved choices apply to future runs. QBO product setup is handled separately.</p></div><button disabled={disabled || busy || !!editing} onClick={() => setShowAll(value => !value)} className="text-sm text-blue-700 underline disabled:opacity-50">{showAll ? 'Show issues only' : `View / change all ${items.length} pricing sources`}</button></div>
    {!showAll && !unresolved.length && <p className="text-sm text-slate-500">All items have a pricing source.</p>}
    {(showAll ? items : unresolved).map(item => <div key={item.lineItemId} className="rounded-lg border border-slate-200 p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-medium">{item.description}</p><p className="text-xs text-slate-500">{item.costCode} · {item.uom || 'Unit missing'}{item.projectPrice ? ' · Project-specific price' : item.catalogName ? ` · ${item.manual ? 'Saved' : 'Automatic'} match: ${item.catalogName}` : ''}</p></div><button disabled={disabled || busy || (!!editing && editing !== item.lineItemId)} onClick={() => open(item.lineItemId)} className="rounded border border-blue-300 px-3 py-1 text-sm text-blue-800 disabled:opacity-50">{item.issue ? 'Confirm pricing source' : 'Change pricing source'}</button></div>
      {item.issue && <p className="text-sm text-amber-800">{item.issue.startsWith(`${item.description}: `) ? item.issue.slice(item.description.length + 2) : item.issue}</p>}
      {editing === item.lineItemId && <div className="space-y-3 border-t pt-3">
        {busy && !choices && <p role="status" className="text-sm">Loading current catalog…</p>}
        {choices && <>
          <label className="block text-sm">Search catalog<input value={search} onChange={e => setSearch(e.target.value)} disabled={busy} placeholder="Item name or cost code" className="mt-1 w-full rounded border p-2" /></label>
          <label className="block text-sm">Catalog item<select value={selected} onChange={e => setSelected(e.target.value)} disabled={busy} className="mt-1 w-full rounded border p-2"><option value="">Choose an item…</option>{choices.candidates.filter(candidate => candidate.itemId === selected || `${candidate.name} ${candidate.description} ${candidate.costCode}`.toLowerCase().includes(search.toLowerCase())).map(candidate => <option key={candidate.itemId} value={candidate.itemId}>{candidate.name} · ${candidate.unitCost}/{candidate.uom} · {candidate.costCode} · #{candidate.itemId}</option>)}</select></label>
          <p className="text-xs text-slate-500">Only catalog items with a compatible unit and a positive current price are listed.</p>
          {selectedItem && <div className="rounded bg-blue-50 p-3 text-sm"><p className="font-medium">{selectedItem.name} — ${selectedItem.unitCost} per {selectedItem.uom}</p>{selectedItem.description && <p>{selectedItem.description}</p>}{!selectedItem.sameCostCode && <p className="mt-1">Catalog cost code: {selectedItem.costCode}. The bill keeps this PO line’s cost code, {choices.source.costCode}.</p>}</div>}
          <p className="text-xs text-slate-500">This saves the pricing match for this project’s PO line. Save the reviewed bill separately to update QBO.</p>
          <button disabled={busy || !selectedItem} onClick={() => save()} className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Saving…' : 'Confirm pricing source & refresh'}</button>
          {choices.selectedItemId && <button disabled={busy} onClick={() => save(true)} className="ml-3 text-sm text-blue-700 underline disabled:opacity-50">Use automatic matching</button>}
        </>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button disabled={busy} onClick={close} className="block text-sm text-slate-600 underline disabled:opacity-50">Close</button>
      </div>}
    </div>)}
  </section>;
}
