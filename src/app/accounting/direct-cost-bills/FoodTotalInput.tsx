'use client';
import { useState } from 'react';
import type { FoodTotalRecord } from '@/lib/qboFoodTotal';
export default function FoodTotalInput({ companyId, projectId, month, saved, logCount, disabled, onBusy, onComplete }: { companyId: string; projectId: string; month: string; saved: FoodTotalRecord | null; logCount: number; disabled: boolean; onBusy: (value: boolean) => void; onComplete: () => Promise<void> }) {
  const [amount, setAmount] = useState(saved?.amount || '');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/accounting/direct-cost-bills/food-total', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, projectId, month, amount, revision: saved?.revision || 0 }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to save Food total.');
      setEditing(false); onBusy(false); await onComplete();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save Food total.'); }
    finally { setSaving(false); }
  }
  return <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
    <h3 className="font-semibold">Food · monthly total</h3>
    <p className="text-sm text-slate-600">Enter the total spent on Food for {month}. This replaces the previous monthly Food amount; it is not added to it. Daily-log quantities and PO prices are not multiplied. Uses 01-300-10-80.M.</p>
    <div className="flex flex-wrap items-end gap-3"><label className="text-sm">Total Food cost ($)<input type="text" inputMode="decimal" value={amount} placeholder="0.00" disabled={disabled || saving} onFocus={() => { setEditing(true); onBusy(true); }} onChange={e => { setAmount(e.target.value); setEditing(true); onBusy(true); }} className="mt-1 block rounded border p-2" /></label>
      <button disabled={disabled || saving || !editing || !amount.trim()} onClick={save} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save Food total'}</button>
      {editing && <button disabled={saving} className="rounded border px-4 py-2" onClick={() => { setAmount(saved?.amount || ''); setEditing(false); setError(''); onBusy(false); }}>Cancel</button>}
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <p className="text-sm text-slate-500">{saved ? `Saved total: $${saved.amount}.` : logCount ? 'Food appears in the daily logs. Enter its monthly total, or save $0 if none should be included.' : 'Optional. Leave blank when there is no Food expense.'} Saving updates the review; use the bill save button to write it to QBO.</p>
  </section>;
}
