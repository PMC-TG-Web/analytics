'use client';

import { useState } from 'react';
import { steelOrderLog, steelOrderQuantities, steelOrderedDate, type SteelItem, type SteelProject } from '@/lib/steelNeeds';
import { number, unitLabel } from './format';

export type SteelOrderChange = { addQuantity: number } | { orderedQuantity: number } | { undoEntryId: string };

const field = 'w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal text-slate-900 disabled:opacity-50';
const quiet = 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40';
const signed = (value: number) => `${value > 0 ? '+' : '−'}${number.format(Math.abs(value))}`;

/** Record orders one at a time. The saved running total and the log both come back from each confirmed save. */
export default function OrderEntry({ item, project, disabled, saving, onSave }: {
  item: SteelItem; project: SteelProject; disabled: boolean; saving: boolean; onSave: (change: SteelOrderChange) => Promise<boolean>;
}) {
  const saved = steelOrderQuantities(item);
  const { entries, orders, unlogged } = steelOrderLog(item);
  const [draft, setDraft] = useState('');
  // null shows the saved total, so the field follows confirmed saves without remounting and closing the log.
  const [totalDraft, setTotalDraft] = useState<string | null>(null);
  const total = totalDraft ?? String(saved.orderedQuantity);
  const save = (change: SteelOrderChange) => void onSave(change).then(ok => { if (ok) { setDraft(''); setTotalDraft(null); } });
  const pieces = item.unit === 'EA', unit = unitLabel(item.unit), name = `${item.description} for ${project.projectName}`;
  const parse = (text: string) => {
    const value = Number(text);
    return text.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 1e12 && (pieces ? Number.isInteger(value) : Number(value.toFixed(4)) === value) ? value : null;
  };
  const add = parse(draft), corrected = parse(total);
  const locked = disabled || saving || !project.projectId;
  const rest = pieces ? Math.ceil(saved.toOrderQuantity) : saved.toOrderQuantity;
  const step = pieces ? '1' : '0.0001';
  const hasHistory = entries.length > 0 || saved.orderedQuantity > 0;
  return <div className="text-left">
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (add && !locked) save({ addQuantity: add }); }}>
      <label className="text-xs font-semibold text-slate-600">Add an order ({unit})
        <input aria-label={`Order quantity for ${name}`} type="number" min="0" max="1000000000000" step={step} placeholder="Qty" value={draft}
          onChange={event => setDraft(event.target.value)} disabled={locked} className={`${field} mt-1 block`} /></label>
      <button type="submit" disabled={locked || !add} aria-label={`Add order for ${name}`}
        className="rounded-lg bg-sky-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-900 disabled:opacity-40">Add order</button>
      {rest > 0 && <button type="button" disabled={locked} className={quiet} aria-label={`Order the rest of ${name}`}
        onClick={() => save({ addQuantity: rest })}>Order the rest ({number.format(rest)})</button>}
    </form>
    {saving && <p role="status" className="mt-1 text-xs text-slate-500">Saving…</p>}
    {!saving && saved.changed && <p className="mt-2 text-xs text-amber-800">The estimate changed since the last order. Left to order uses the new estimate.{' '}
      <button type="button" disabled={locked} className="font-semibold underline disabled:opacity-40" aria-label={`Confirm changed estimate for ${name}`}
        onClick={() => save({ orderedQuantity: saved.orderedQuantity })}>Mark reviewed</button></p>}
    {hasHistory && <details className="mt-2 text-xs text-slate-600">
      <summary className="cursor-pointer font-semibold text-sky-900">Order log · {orders ? `${orders} ${orders === 1 ? 'order' : 'orders'}` : unlogged ? 'earlier total only' : 'no orders now'}
        {item.order?.orderedAt && ` · last change ${steelOrderedDate(item.order.orderedAt)}`}</summary>
      <ul aria-label={`Order log for ${name}`} className="mt-2 space-y-1">
        {unlogged !== 0 && <li className="rounded bg-slate-50 px-2 py-1.5">Recorded before the order log · {signed(unlogged)} {unit}</li>}
        {entries.map(entry => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1.5">
          <span className={entry.voidedAt ? 'text-slate-400 line-through' : ''}>{steelOrderedDate(entry.createdAt)} · {entry.kind === 'correction' ? `Total corrected ${signed(entry.quantity)}` : `Ordered ${number.format(entry.quantity)}`} {unit} · {entry.createdBy}</span>
          {entry.voidedAt ? <span className="text-slate-500">Undone {steelOrderedDate(entry.voidedAt)}{entry.voidedBy ? ` · ${entry.voidedBy}` : ''}</span>
            : <button type="button" disabled={locked} className="font-semibold text-sky-900 underline disabled:opacity-40"
              aria-label={`Undo ${entry.kind === 'correction' ? 'correction' : 'order'} of ${number.format(entry.quantity)} from ${steelOrderedDate(entry.createdAt)} for ${name}`}
              onClick={() => save({ undoEntryId: entry.id })}>Undo</button>}
        </li>)}
      </ul>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (corrected !== null && !locked) save({ orderedQuantity: corrected }); }}>
        <label className="font-semibold">Fix the total ordered ({unit})
          <input aria-label={`Total ordered for ${name}`} type="number" min="0" max="1000000000000" step={step} value={total}
            onChange={event => setTotalDraft(event.target.value)} disabled={locked} className={`${field} mt-1 block`} /></label>
        <button type="submit" className={quiet} disabled={locked || corrected === null || corrected === saved.orderedQuantity} aria-label={`Set total ordered for ${name}`}>Set total</button>
        <p className="basis-full text-slate-500">Only to fix a mistake. This replaces the total and is noted in the log. Set 0 to clear.</p>
      </form>
    </details>}
  </div>;
}
