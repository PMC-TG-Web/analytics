'use client';
import { useEffect, useRef, useState } from 'react';
import { validateFoodEntry, type FoodEntry, type FoodEntryInput, type FoodTotalRecord } from '@/lib/qboFoodTotal';
const money = (value: string | number) => Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export default function FoodTotalInput({ companyId, projectId, month, saved, entries, logCount, disabled, onBusy, onComplete }: { companyId: string; projectId: string; month: string; saved: FoodTotalRecord | null; entries: FoodEntry[]; logCount: number; disabled: boolean; onBusy: (value: boolean) => void; onComplete: () => Promise<void> }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const defaultDate = today.startsWith(month) ? today : `${month}-01`;
  const storageKey = `qbo-food-entry:${companyId}:${projectId}:${month}`;
  const [amount, setAmount] = useState('');
  const [spentOn, setSpentOn] = useState(defaultDate);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<FoodEntryInput | null>(null);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (!stored) return;
      const request = validateFoodEntry(JSON.parse(stored));
      if (request.companyId !== companyId || request.projectId !== projectId || request.month !== month) return;
      setPending(request); setAmount(request.amount); setSpentOn(request.spentOn); setNote(request.note); setEditing(true); onBusy(true);
    } catch { /* The form still works when no recoverable pending entry is stored. */ }
  }, [storageKey, companyId, projectId, month, onBusy]);
  function begin() { setEditing(true); onBusy(true); }
  async function save() {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const request = pending || validateFoodEntry({ entryId: crypto.randomUUID(), companyId, projectId, month, amount, spentOn, note });
      // Retain the same request after timeouts or page reloads, so retries cannot add twice.
      sessionStorage.setItem(storageKey, JSON.stringify(request)); setPending(request);
      const response = await fetch('/api/accounting/direct-cost-bills/food-total', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, operation: 'add' }) });
      const data = await response.json();
      if (!response.ok) {
        if ([400, 401, 403].includes(response.status)) { sessionStorage.removeItem(storageKey); setPending(null); }
        throw new Error(data.error || 'Unable to add Food expense.');
      }
      sessionStorage.removeItem(storageKey); setPending(null); setAmount(''); setNote(''); setEditing(false); onBusy(false); await onComplete();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to add Food expense.'); }
    finally { setSaving(false); savingRef.current = false; }
  }
  let runningCents = 0;
  return <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
    <div className="flex flex-wrap justify-between gap-3"><h3 className="font-semibold">Food ledger · {month}</h3><p className="font-semibold">Month total: {money(saved?.amount || '0')}</p></div>
    <p className="text-sm text-slate-600">Enter each new Food expense. It is added to this project’s total for the selected month. The bill uses that monthly total once under 01-300-10-80.M.</p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Date<input type="date" value={spentOn} min={`${month}-01`} disabled={disabled || saving || !!pending} onFocus={begin} onChange={e => { setSpentOn(e.target.value); begin(); }} className="mt-1 block rounded border p-2" /></label>
      <label className="text-sm">New Food expense ($)<input type="text" inputMode="decimal" value={amount} placeholder="0.00" disabled={disabled || saving || !!pending} onFocus={begin} onChange={e => { setAmount(e.target.value); begin(); }} className="mt-1 block rounded border p-2" /></label>
      <label className="text-sm">Note (optional)<input value={note} maxLength={200} disabled={disabled || saving || !!pending} onFocus={begin} onChange={e => { setNote(e.target.value); begin(); }} className="mt-1 block rounded border p-2" placeholder="Lunch, receipt, or other detail" /></label>
      <button disabled={disabled || saving || !amount.trim()} onClick={save} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50">{saving ? 'Adding…' : pending ? 'Retry / confirm this expense' : 'Add Food expense'}</button>
      {editing && !pending && <button disabled={saving} className="rounded border px-4 py-2" onClick={() => { setAmount(''); setNote(''); setSpentOn(defaultDate); setEditing(false); setError(''); onBusy(false); }}>Cancel</button>}
    </div>
    {pending && !saving && <p className="text-sm text-amber-800">This entry may already have saved. Retry to confirm it safely; the same entry will not be added twice.</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Date', 'Note', 'Expense', 'Running total'].map(label => <th key={label} className="border-b p-2">{label}</th>)}</tr></thead><tbody>{entries.map(entry => { runningCents += Math.round(Number(entry.amount) * 100); return <tr key={entry.id}><td className="border-b p-2">{entry.spentOn}</td><td className="border-b p-2">{entry.note || 'Food'}</td><td className="border-b p-2 tabular-nums">{money(entry.amount)}</td><td className="border-b p-2 tabular-nums">{money(runningCents / 100)}</td></tr>; })}{!entries.length && <tr><td colSpan={4} className="p-3 text-slate-500">No Food expenses entered for this project and month.</td></tr>}</tbody></table></div>
    <p className="text-sm text-slate-500">{!saved && logCount ? 'Food appears in daily logs. Add its expenses, or enter $0 if none should be included. ' : ''}Adding an expense saves the ledger. Save or update the bill separately to send the monthly total to QBO.</p>
  </section>;
}
