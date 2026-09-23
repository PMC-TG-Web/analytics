'use client';

import { fetchBillRead, readBillResponse } from '@/lib/qboBillResponse';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { loadQboDirectCosts } from '@/lib/loadQboDirectCosts';
import type { loadQboBillReview } from '@/lib/loadQboBillReview';
import ProjectBillQueue from './ProjectBillQueue';
import BillIssue from './BillIssue';
import ProjectSetup from './ProjectSetup';
import FoodTotalInput from './FoodTotalInput';
import BillReconciliation from './BillReconciliation';
import CatalogMappingPanel from './CatalogMappingPanel';
import { billSourcePollDelay, shouldRefreshBillQueue } from '@/lib/qboBillPolling';

type Preview = Awaited<ReturnType<typeof loadQboDirectCosts>> & { review: Awaited<ReturnType<typeof loadQboBillReview>> };
const money = (n: string) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export default function DirectCostBillsPage() {
  const [companyId, setCompanyId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [month, setMonth] = useState(() => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
    return `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}`;
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [posting, setPosting] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [foodEditing, setFoodEditing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [mappingEditing, setMappingEditing] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [queueRevision, setQueueRevision] = useState(0);
  const [syncMessage, setSyncMessage] = useState('');
  const queueRequestPending = useRef(false);
  const onQueueLoading = useCallback((pending: boolean) => { queueRequestPending.current = pending; }, []);
  const live = useRef({ busy, posting: posting || settingUp || mappingEditing || reconciling || foodEditing, projectId, loadPreview });
  live.current = { busy, posting: posting || settingUp || mappingEditing || reconciling || foodEditing, projectId, loadPreview };
  useEffect(() => {
    if (!companyId || !month) return;
    let stopped = false;
    let lastQueueRefresh = Date.now();
    let hasSynced = false;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      let delay = 60_000;
      try {
        if (document.visibilityState !== 'visible' || live.current.busy || live.current.posting) return;
        setSyncMessage('Checking Procore Cost Catalog prices…');
        const response = await fetch('/api/accounting/direct-cost-bills/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, month }) });
        const result = await readBillResponse(response);
        if (stopped) return;
        if (!response.ok) throw new Error(result.error || 'Automatic refresh will retry.');
        delay = billSourcePollDelay(result.status);
        hasSynced ||= result.status === 'synced';
        setSyncMessage(result.status === 'waiting' ? 'Procore sync is busy; automatic checks will resume.' : `Automatic catalog checks active · Last check ${new Date().toLocaleTimeString()}`);
        if (!live.current.busy && !live.current.posting) {
          if (!queueRequestPending.current && shouldRefreshBillQueue(Date.now(), lastQueueRefresh, hasSynced)) {
            lastQueueRefresh = Date.now();
            hasSynced = false;
            setQueueRevision(n => n + 1);
          }
          if (result.status === 'synced' && live.current.projectId && (result.scope === 'catalog' || live.current.projectId === result.projectId)) await live.current.loadPreview(live.current.projectId, true);
        }
      } catch (e) { if (!stopped) setSyncMessage(e instanceof Error ? e.message : 'Automatic refresh will retry.'); }
      finally { if (!stopped) timer = setTimeout(check, delay); }
    }
    void check();
    return () => { stopped = true; clearTimeout(timer); };
  }, [companyId, month]);
  useEffect(() => {
    const controller = new AbortController();
    fetchBillRead('/api/accounting/direct-cost-bills', controller.signal)
      .then(async r => { const data = await readBillResponse(r); if (!r.ok) throw new Error(data.error || 'Unable to load projects.'); return data; })
      .then(data => { setCompanyId(data.companyId); })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, []);
  async function loadPreview(selectedId: string, force = false) {
    if (!force && selectedId === projectId) { setProjectId(''); setPreview(null); setError(''); return; }
    setProjectId(selectedId);
    setBusy(true); setError(''); setPreview(null);
    try {
      const response = await fetchBillRead(`/api/accounting/direct-cost-bills?${new URLSearchParams({ companyId, projectId: selectedId, month })}`);
      const data = await readBillResponse(response);
      if (!response.ok) throw new Error(data.error || 'Unable to load preview.');
      setPreview(data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load preview.'); }
    finally { setBusy(false); }
  }
  async function saveBill() {
    if (!preview?.review.canPost || !preview.review.fingerprint || posting) return;
    setPosting(true); setError(''); setSavedMessage('');
    try {
      const response = await fetch('/api/accounting/direct-cost-bills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, projectId: preview.projectId, month: preview.month, fingerprint: preview.review.fingerprint }) });
      const data = await readBillResponse(response);
      if (!response.ok) throw new Error(data.error || 'Unable to save bill. Refresh its review before retrying.');
      setSavedMessage(`${data.receipt.billNumber} ${data.receipt.alreadyCurrent ? 'is already current' : data.receipt.updated ? 'was updated' : 'was created'} in QBO.`);
      setProjectId(''); setPreview(null); setQueueRevision(n => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bill status is unknown. Refresh its review before retrying.');
      setPreview(current => current ? { ...current, review: { ...current.review, canPost: false } } : current);
    } finally { setPosting(false); }
  }
  function download() {
    if (!preview) return;
    const { review, ...draft } = preview;
    void review;
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `procore-direct-costs-${preview.projectId}-${preview.month}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const laborTotal = ((preview?.lines || []).filter(l => l.sourceType === 'timecard' || /^(labor|l)$/i.test(l.costType || '')).reduce((sum, l) => sum + Math.round(Number(l.amount) * 100), 0) / 100).toFixed(2);
  const materialTotal = ((preview?.lines || []).filter(l => (/^(materials|m)$/i.test(l.costType || '') || (/^(other|o|equipment|e|commitments|c)$/i.test(l.costType || '') && preview?.review.offsetCategories?.[l.lineKey] === 'material'))).reduce((sum, l) => sum + Math.round(Number(l.amount) * 100), 0) / 100).toFixed(2);
  const offsetsReady = !!preview?.review.offsets?.material && !!preview.review.offsets.labor && preview.review.offsets.customerAssignment === 'none' && preview.lines.every(l => l.sourceType === 'timecard' || (/^(materials|m|labor|l)$/i.test(l.costType || '') || (/^(other|o|equipment|e|commitments|c)$/i.test(l.costType || '') && preview.review.offsetCategories?.[l.lineKey] === 'material')));
  const offsetRows = preview?.review.offsetLines ?? (['material', 'labor'] as const).map(kind => ({ accountName: preview?.review.offsets?.[kind]?.accountName || 'Mapping needed', className: preview?.review.offsets?.[kind]?.className || 'Not assigned', amount: -Number(kind === 'material' ? materialTotal : laborTotal) }));
  const needsReconciliation = /Bill changed in QBO/i.test(error) || preview?.review.action === 'reconcile';
  const expandedContent = <div className="space-y-5 p-4 sm:p-6">
    {error && <div role="alert" className="text-red-700"><p>{error}</p><button disabled={posting || busy || reconciling || foodEditing} className="mt-2 rounded border px-3 py-2 text-sm" onClick={() => loadPreview(projectId, true)}>Refresh review</button></div>}
    {busy && <p role="status" className="p-8 text-center text-slate-500">Gathering synchronized daily logs and labor…</p>}
    {preview && <>
      <FoodTotalInput key={`food:${preview.projectId}:${preview.month}`} companyId={companyId} projectId={preview.projectId} month={preview.month} saved={preview.food.saved} entries={preview.food.entries} logCount={preview.food.logCount} disabled={posting || settingUp || mappingEditing || reconciling} onBusy={setFoodEditing} onComplete={async () => { await loadPreview(preview.projectId, true); setQueueRevision(n => n + 1); }} />
      {!foodEditing && !reconciling && !mappingEditing && preview.lines.length > 0 && (!preview.review.connected || preview.lines.some(line => !preview.review.products[line.lineKey]) || preview.review.issues.some(issue => /mapping|offset category/i.test(issue))) && <ProjectSetup blockedReason={preview.issues.length ? 'QBO product setup is paused until the listed items are resolved.' : undefined} key={`setup:${preview.projectId}:${preview.month}`} companyId={companyId} projectId={preview.projectId} projectName={preview.projectName} month={preview.month} onBusy={setSettingUp} onComplete={async () => { await loadPreview(preview.projectId, true); setQueueRevision(n => n + 1); }} />}
      <section id="monthly-bill-review" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-semibold">{preview.projectName}</h2><p className="text-sm text-slate-500">{preview.month} · Month-to-date review</p></div><span className="self-start rounded-full bg-slate-100 px-3 py-1 text-sm font-medium">{preview.review.action === 'current' ? 'Up to date' : preview.review.action === 'update' ? 'Update existing bill' : preview.review.action === 'create' ? 'Create first monthly bill' : preview.review.action === 'reconcile' ? 'Reconciliation needed' : 'Mapping needed'}</span></div>
      <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-3"><div><dt className="text-slate-500">Vendor</dt><dd className="mt-1 font-medium">{preview.vendorName}</dd></div><div><dt className="text-slate-500">QBO customer / project · item lines only</dt><dd className="mt-1 font-medium">{preview.review.customer || 'Not mapped on this server'}</dd></div><div><dt className="text-slate-500">Bill number</dt><dd className="mt-1 font-medium">{preview.review.billNumber || 'Assigned during review (project name + sequence)'}</dd></div></dl>
      {preview.review.lastPosted && <p className="mt-4 text-sm text-slate-500">Last saved to QBO: {new Date(preview.review.lastPosted).toLocaleString()} · Bill ID {preview.review.billId}</p>}</section>
      <div className="grid gap-4 sm:grid-cols-4">{[['Materials', money(materialTotal)], ['Labor', money(laborTotal)], ['Gross project cost', money(preview.total)], ['Net bill after offsets', offsetsReady ? '$0.00' : 'Awaiting mapping']].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p></div>)}</div>
      <p className="text-sm text-slate-600">Labor: {preview.labor.pricedHours} of {preview.labor.totalHours} hours priced. Rate priority: category → SOG → travel. Unpriced: {preview.labor.unpricedHours} hours.</p>
      {preview.labor.rows.filter(r => r.unitCost === null).map(r => <p key={r.lineKey}>{r.description}: {r.quantity} hours — rate needed</p>)}
      {(preview.issues.length > 0 || preview.review.issues.length > 0) && <div id="bill-draft-issues" className="scroll-mt-20" role="alert"><p>Resolve these items before saving the bill:</p><ul className="list-disc pl-5">{[...new Set([...preview.issues, ...preview.review.issues])].map((issue, i) => <li key={i}><BillIssue message={issue} companyId={companyId} projectId={preview.projectId} sources={preview.issueSources} /></li>)}</ul></div>}
      <CatalogMappingPanel key={`catalog-mapping:${preview.projectId}:${preview.month}`} companyId={companyId} projectId={preview.projectId} items={preview.catalogMappingItems} disabled={posting || settingUp || reconciling || foodEditing} onBusy={setMappingEditing} onComplete={async () => { await loadPreview(preview.projectId, true); setQueueRevision(n => n + 1); }} />
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="border-b p-5"><h3 className="font-semibold">Item details</h3><p className="text-sm text-slate-500">{preview.lines.length} aggregated items · Quantities replace the previous monthly totals.</p></div><div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm">
        <thead className="bg-slate-50 text-slate-600"><tr>{['Item / QBO product', 'Total used', 'Unit', 'Cost per', 'Amount'].map(h => <th key={h} className="border-b p-3">{h}</th>)}</tr></thead>
        <tbody>{preview.lines.map(line => <tr key={line.lineKey} className="hover:bg-slate-50"><td className="border-b p-3"><span className="font-medium">{line.description}</span><span className={`mt-1 block text-xs ${preview.review.products[line.lineKey] ? 'text-slate-500' : 'text-amber-700'}`}>{preview.review.products[line.lineKey] || `${line.costCode} · QBO product setup needed`}</span>{preview.review.itemClasses?.[line.lineKey] && <span className="mt-1 block text-xs text-slate-500">Class: {preview.review.itemClasses[line.lineKey]}</span>}</td><td className="border-b p-3 tabular-nums">{line.quantity}</td><td className="border-b p-3">{line.uom}</td><td className="border-b p-3 tabular-nums">${line.unitCost}{line.sourceType === 'manual_food' && <span className="block text-xs text-gray-500">Entered monthly total</span>}{'rateSelection' in line && line.rateSelection !== 'category' && <span className="block text-xs text-gray-500">{line.rateSelection}</span>}</td><td className="border-b p-3 tabular-nums">{money(line.amount)}</td></tr>)}</tbody>
        <tfoot><tr><th className="p-3" colSpan={4}>Total</th><td className="p-3 font-semibold">{money(preview.total)}</td></tr></tfoot>
      </table></div></section>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="border-b p-5"><h3 className="font-semibold">Category details · Negative offsets</h3><p className="text-sm text-slate-500">Recalculated on each run. Customer / project stays blank on these lines.</p></div>{offsetsReady ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>{['Category', 'Class', 'Customer / project', 'Amount'].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{offsetRows.map((row, index) => <tr key={index}><td className="p-3">{row.accountName}</td><td className="p-3">{row.className}</td><td className="p-3 text-slate-500">—</td><td className="p-3 tabular-nums">{money(String(row.amount))}</td></tr>)}</tbody></table></div> : <p className="p-5 text-sm text-amber-800">Offset mapping is unavailable on this server. Configure material and labor accounts and classes in the integration before posting.</p>}</section>
      {!preview.lines.length && <p>No eligible usage lines for this month.</p>}
      <details className="text-sm text-slate-600"><summary className="cursor-pointer font-medium">Source and exclusions</summary><p className="mt-2">{preview.sourceLogCount} productivity logs. Excluded: {preview.excluded.unapproved} unapproved, {preview.excluded.billingFile} billing-file, {preview.excluded.zeroUsage} zero-usage entries, {preview.excluded.concrete || 0} concrete material entries, {preview.excluded.pumpingEquipment || 0} excluded pumping-equipment entries, {preview.excluded.shopDrawings || 0} Shop Drawings vendor entries. Uses synchronized Procore data and current Cost Catalog rates. Food uses the entered monthly total once. Catalog checked: {preview.catalogCheckedAt || 'Not available'}. Latest log update: {preview.latestSourceUpdate || 'None'}.</p></details>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-5"><div><p className="font-medium">{needsReconciliation ? 'Reconciliation needed before updating' : preview.issues.length || preview.review.issues.length ? 'Resolve issues before posting' : 'Save monthly bill'}</p><p className="mt-1 text-sm text-slate-600">{needsReconciliation ? 'Use Reconcile QBO changes beside the update button to review and confirm the changes.' : preview.review.canPost ? 'Save this reviewed monthly bill through the shared QBO service.' : preview.review.action === 'current' ? 'This monthly bill is up to date.' : 'Posting requires the shared QBO service and a valid current review.'}</p></div><div className="flex flex-wrap gap-3"><button className="rounded-lg border border-slate-300 px-5 py-2 font-medium disabled:opacity-50" disabled={posting || mappingEditing || settingUp || reconciling || foodEditing || preview.issues.length > 0 || !preview.lines.length || preview.review.action === 'reconcile'} onClick={download}>Export draft</button><button disabled={posting || mappingEditing || settingUp || reconciling || foodEditing || needsReconciliation || !preview.review.canPost || preview.issues.length > 0 || preview.review.issues.length > 0} onClick={saveBill} className="rounded-lg bg-blue-700 px-5 py-2 font-medium text-white disabled:opacity-50">{posting ? 'Saving to QBO…' : preview.review.billId ? 'Update bill in QBO' : 'Create bill in QBO'}</button>{preview.review.billId && <BillReconciliation needsReconciliation={needsReconciliation} key={`reconciliation:${preview.projectId}:${preview.month}`} companyId={companyId} projectId={preview.projectId} month={preview.month} disabled={posting || settingUp || mappingEditing || foodEditing} onBusy={setReconciling} onComplete={async () => { setError(''); setSavedMessage('Reconciliation saved. Review the monthly costs, then click Update bill in QBO to apply them.'); await loadPreview(preview.projectId, true); setQueueRevision(n => n + 1); }} />}</div></div>
    </>}
  </div>;
  return <main className="mx-auto max-w-7xl space-y-6 p-4 text-slate-900 sm:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-blue-700">Accounting / Procore</p>
    <h1 className="text-3xl font-semibold tracking-tight">Direct cost bills</h1>
    <p className="mt-2 text-slate-600">Review monthly project costs for PMC Procore Direct Costs using current Cost Catalog prices and an entered monthly Food total. Concrete materials, Shop Drawings vendor charges, and the four specified pumping items under 03-300-40-30 are excluded; employee labor remains included.</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-800">One bill per project / month</span></header>
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">Daily runs use the full month-to-date quantities. The first run creates a bill; later runs replace its item lines and offsets while keeping the same bill number. Running unchanged totals again does not create another bill.</div>
    <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <label className="flex flex-col gap-1">Month<input disabled={busy || posting || settingUp || mappingEditing || reconciling || foodEditing} className="rounded border p-2" type="month" value={month} onChange={e => { setMonth(e.target.value); setProjectId(''); setPreview(null); setError(''); }} /></label>
      <p className="pb-2 text-sm text-slate-500">Select a month, then review projects that need a bill created or updated.</p>
    </div>
    {error && !projectId && <p role="alert" className="text-red-700">{error}</p>}
    {savedMessage && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">{savedMessage}</p>}
    <p role="status" className="text-sm text-slate-500">{syncMessage} Checks run while this page is visible; projects are checked in turn.</p>
    <ProjectBillQueue key={`${companyId}:${month}`} revision={queueRevision} companyId={companyId} month={month} disabled={busy || posting || settingUp || mappingEditing || reconciling || foodEditing} selectedProjectId={projectId} onReview={loadPreview} onLoading={onQueueLoading} expandedContent={expandedContent} />

  </main>;
}


