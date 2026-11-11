'use client';

import { useRef, useState, useEffect } from 'react';
import { steelOrderQuantities, steelOrderedDate, type SteelItem, type SteelProject } from '@/lib/steelNeeds';

export default function OrderEntry({ item, project, disabled, pending, onSave }: {
  item: SteelItem; project: SteelProject; disabled: boolean; pending?: number; onSave: (quantity: number) => Promise<boolean>;
}) {
  const saved = steelOrderQuantities(item);
  const [draft, setDraft] = useState(String(saved.orderedQuantity));
  const checkbox = useRef<HTMLInputElement>(null);
  const amount = pending ?? saved.orderedQuantity;
  const partial = amount > 0 && amount < item.quantity;
  const saving = pending !== undefined;
  const label = item.unit === 'EA' ? 'Ordered pieces' : `Ordered (${item.unit})`;
  const value = Number(draft);
  const valid = draft.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 1e12 && (item.unit === 'EA' ? Number.isInteger(value) : Number(value.toFixed(4)) === value);
  const locked = disabled || saving || !project.projectId;
  useEffect(() => { if (checkbox.current) checkbox.current.indeterminate = partial; }, [partial]);
  return <div className="min-w-48 max-w-64 text-left">
    <form onSubmit={event => { event.preventDefault(); if (valid && !locked) void onSave(value).then(ok => { if (ok) setDraft(String(value)); }); }}>
      <label className="block text-xs font-semibold text-slate-600">{label}<span className="mt-1 flex gap-2">
        <input aria-label={`${label} for ${item.description} for ${project.projectName}`} type="number" min="0" max="1000000000000" step={item.unit === 'EA' ? '1' : '0.0001'} value={draft} onChange={event => setDraft(event.target.value)} disabled={locked}
          className="w-28 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal text-slate-900" />
        <button type="submit" disabled={locked || !valid || (value === saved.orderedQuantity && !saved.changed)} className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-sky-900 disabled:opacity-40" aria-label={`Save ordered quantity for ${item.description} for ${project.projectName}`}>Save</button>
      </span></label>
      <p className="mt-1 text-xs text-slate-500">Total ordered so far. Use 0 to clear.</p>
    </form>
    <label className="mt-2 inline-flex items-center gap-2 text-xs font-medium"><input ref={checkbox} type="checkbox" className="h-4 w-4 accent-sky-800"
      aria-label={`Ordered ${item.description} for ${project.projectName}`} checked={amount >= item.quantity} disabled={locked}
      onChange={event => { const next = event.target.checked ? (item.unit === 'EA' ? Math.ceil(item.quantity) : item.quantity) : 0; void onSave(next).then(ok => { if (ok) setDraft(String(next)); }); }} />Fully ordered</label>
    {saving ? <p role="status" className="text-xs text-slate-500">Saving…</p> : <>
      {partial && <p className="text-xs font-semibold text-amber-800">Partially ordered · {new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(saved.toOrderQuantity)} {item.unit === 'EA' ? 'pieces' : item.unit} still needed</p>}
      {item.order?.orderedAt && <p className="mt-1 text-xs text-slate-500">Updated {steelOrderedDate(item.order.orderedAt)}</p>}
      {saved.changed && <p className="mt-1 text-xs text-amber-800">Estimate changed since the last update. Review ordered pieces, then save to confirm.</p>}
    </>}
  </div>;
}
