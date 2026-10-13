'use client';

import { useEffect, useRef, useState } from 'react';
import { subcontractBudgetOptions, allocationBudgetPlan, allocationEligible, allocationTotals, allocationGroupCheck, toggleSubcontractAllocation, money, validateAllocationChanges, type AllocationSource, type AllocationChanges } from '@/lib/subcontractAllocation';
import styles from './page.module.css';

type Project = { id: string; number: string; name: string };
type Draft = { revision: number; changes: AllocationChanges; source: AllocationSource; sourceFingerprint: string; updatedAt: string; updatedBy: string };
type Loaded = { source: AllocationSource; fingerprint: string; draft: Draft | null };
const empty = (): AllocationChanges => ({ allocations: [], budgets: [], purchaseOrders: [], reason: '' });
const dollars = (n: number | null) => n === null ? 'Unavailable' : !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const qty = (n: number | null) => n === null ? 'Unavailable' : !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 4 });

function Check({ checked, partial, label, disabled, onChange }: { checked: boolean; partial?: boolean; label: string; disabled?: boolean; onChange: (checked: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!partial; }, [partial]);
  return <input ref={ref} type="checkbox" checked={checked} disabled={disabled} aria-label={label} onChange={e => onChange(e.target.checked)} />;
}

export default function SubcontractAllocationPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [changes, setChanges] = useState<AllocationChanges>(empty);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [review, setReview] = useState(false);
  const [useCurrent, setUseCurrent] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/procore/commitments-live/maker/projects', { cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Unable to load projects.'); return body; })
      .then(setProjects).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  async function load(id: string) {
    const sequence = ++generation.current;
    setProjectId(id); setLoaded(null); setError(''); setMessage(''); setReview(false); setUseCurrent(false); setDirty(false);
    if (!id) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/procore/commitments-live/allocation?projectId=${encodeURIComponent(id)}`, { cache: 'no-store' });
      let body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to load allocation.');
      if (body.missingGroupNames && sequence === generation.current) {
        try {
          const syncResponse = await fetch('/api/procore/commitments-live/allocation/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: id }) });
          const sync = await syncResponse.json();
          if (syncResponse.ok && sync.synced) {
            const refreshed = await fetch(`/api/procore/commitments-live/allocation?projectId=${encodeURIComponent(id)}`, { cache: 'no-store' });
            if (refreshed.ok) body = await refreshed.json();
          } else if (sequence === generation.current) setMessage(sync.message || sync.error || 'Some group names are unavailable. Use Reload to retry.');
        } catch { if (sequence === generation.current) setMessage('Some group names are unavailable. Use Reload to retry.'); }
      }
      if (sequence !== generation.current) return;
      setLoaded(body); setChanges(body.draft?.changes || empty());
    } catch (e) { if (sequence === generation.current) setError(e instanceof Error ? e.message : 'Unable to load allocation.'); }
    finally { if (sequence === generation.current) setBusy(false); }
  }
  const stale = !!loaded?.draft && loaded.draft.sourceFingerprint !== loaded.fingerprint && !useCurrent;
  const source = stale ? loaded!.draft!.source : loaded?.source;
  const locked = busy || stale || review;
  const totals = source ? allocationTotals(source, changes) : null;
  const budgetPlan = source ? allocationBudgetPlan(source, changes) : null;
  const groups = new Map<string, NonNullable<typeof source>['lines']>();
  for (const line of source?.lines || []) {
    const key = line.groupId || `ungrouped:${line.groupName}`;
    groups.set(key, [...(groups.get(key) || []), line]);
  }
  const pos = new Map<string, NonNullable<typeof source>['poLines']>();
  for (const line of source?.poLines || []) pos.set(line.poId, [...(pos.get(line.poId) || []), line]);
  function edit(next: AllocationChanges) { setChanges(next); setDirty(true); setMessage(''); setError(''); }
  function allocation(lineId: string, quantity: number) {
    edit({ ...changes, allocations: [...changes.allocations.filter(row => row.lineId !== lineId), { lineId, quantity }] });
  }
  function toggle(ids: string[], checked: boolean) {
    edit(toggleSubcontractAllocation(source!, changes, ids, checked));
  }
  function mapBudget(lineId: string, fromBudgetId: string, toBudgetId: string) {
    edit({ ...changes, budgetMappings: [...(changes.budgetMappings || []).filter(row => row.lineId !== lineId), { lineId, fromBudgetId, toBudgetId }] });
  }
  function mapGroupBudget(groupId: string, toBudgetId: string) {
    const targets = budgetPlan!.rows.filter(row => row.line.groupId === groupId && row.needsTransfer);
    edit({ ...changes, budgetMappings: [
      ...(changes.budgetMappings || []).filter(mapping => !targets.some(row => row.line.id === mapping.lineId)),
      ...targets.map(row => ({ lineId: row.line.id, fromBudgetId: row.fromBudgetId === toBudgetId ? '' : row.fromBudgetId, toBudgetId })),
    ] });
  }
  function prepareReview() {
    try { setChanges(validateAllocationChanges(source!, changes)); setError(''); setReview(true); }
    catch (e) { setError(e instanceof Error ? e.message : 'Check your entries.'); }
  }
  async function save() {
    if (!loaded || !source || stale) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/procore/commitments-live/allocation', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, revision: loaded.draft?.revision || 0, fingerprint: loaded.fingerprint, changes }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to save draft.');
      setLoaded({ ...loaded, draft: { ...body, changes, source, sourceFingerprint: loaded.fingerprint } });
      setDirty(false); setReview(false); setMessage(`Review draft saved (revision ${body.revision}).${budgetPlan?.pending ? ` ${budgetPlan.pending} budget transfers still need budget lines selected.` : ''}`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save draft.'); }
    finally { setBusy(false); }
  }

  return <main className={styles.page}>
    <header><p className={styles.eyebrow}>COMMITMENTS / REVIEW DRAFT</p><h1>Subcontract allocation</h1>
      <p>Choose the estimate quantities you want to subcontract.</p>
      <p className={styles.muted}>Saving stores a shared review draft. It does not update Procore budgets or purchase orders.</p>
    </header>
    <div className={styles.toolbar}>
      <label>Project<select value={projectId} disabled={busy} onChange={e => { if (!dirty || window.confirm('Discard unsaved changes and switch projects?')) void load(e.target.value); }}>
        <option value="">Select a project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.number} · {project.name}</option>)}
      </select></label>
      <button disabled={!projectId || busy} onClick={() => { if (!dirty || window.confirm('Discard unsaved changes and reload?')) void load(projectId); }}>Reload</button>
      <span className={styles.muted}>{dirty ? 'Unsaved changes' : loaded?.draft ? `Saved revision ${loaded.draft.revision} · ${loaded.draft.updatedBy}` : 'New draft'}</span>
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {message && <p role="status" className={styles.success}>{message}</p>}
    {busy && <p role="status">{loaded ? 'Saving draft…' : 'Loading project…'}</p>}
    {source && <>
      <div className={styles.source}><strong>{source.proposalName}</strong><span>Estimate synchronized {new Date(source.syncedAt).toLocaleString()}</span></div>
      {stale && <div className={styles.warning}><strong>The source changed since this draft was saved.</strong><p>You are viewing the saved estimate, budget, and PO quantities. Start a new revision to review current source data. The saved revision remains in history.</p>
        <button onClick={() => { if (window.confirm('Start from current source data with empty proposed changes? The previous saved revision is retained in history.')) { setUseCurrent(true); edit(empty()); } }}>Start new revision from current data</button></div>}
      <div className={styles.cards}>
        <div><span>Subcontract allocation</span><strong>{dollars(totals!.subcontract)}</strong></div>
        <div><span>Budget value to transfer</span><strong>{dollars(budgetPlan!.transferAmount)}</strong></div>
        <div><span>Revenue to transfer</span><strong>{dollars(budgetPlan!.transferRevenue)}</strong></div>
      </div>
      <section><h2>Estimate scope</h2><p>Check a group or line to subcontract its full estimate quantity. Uncheck to clear it. For a partial amount, type directly in Subcontract qty.</p>
        <p className={styles.muted}>Retained qty is the quantity left for us. Unit cost includes estimate item and labor cost. Lines with missing costs or nonpositive quantities cannot be allocated.</p>
        {[...groups].map(([key, lines]) => {
          const eligible = lines.filter(allocationEligible).map(line => line.id);
          const check = allocationGroupCheck(lines, changes);
          return <div className={styles.group} key={key}><div className={styles.groupTitle}>
            <Check label={`Subcontract group ${lines[0].groupName}`} checked={check.checked} partial={check.partial} disabled={locked || !eligible.length} onChange={checked => toggle(eligible, checked)} />
            <strong>{lines[0].groupName}</strong><span>{lines.length} lines</span></div>
            <div className={styles.scroll}><table><thead><tr><th>Subcontract</th><th>Estimate line / cost code</th><th>Unit</th><th>Estimate qty</th><th>Unit cost</th><th>Retained qty</th><th>Subcontract qty</th><th>Subcontract amount</th></tr></thead><tbody>
              {lines.map(line => { const allocated = changes.allocations.find(row => row.lineId === line.id)?.quantity ?? 0; return <tr key={line.id}>
                <td><Check label={`Subcontract ${line.name}`} checked={allocated > 0} disabled={locked || !allocationEligible(line)} onChange={checked => toggle([line.id], checked)} /></td>
                <td><strong>{line.name}</strong><small>{line.costCode || 'No cost code'}</small></td><td>{line.uom}</td><td>{qty(line.quantity)}</td><td>{dollars(line.unitCost)}</td><td>{qty(line.quantity === null ? null : line.quantity - allocated)}</td>
                <td><input aria-label={`Subcontract quantity for ${line.name}`} type="number" step="0.0001" min="0" max={line.quantity ?? 0} disabled={locked || !allocationEligible(line)} value={Number.isNaN(allocated) ? '' : allocated} onChange={e => allocation(line.id, e.target.value === '' ? NaN : Number(e.target.value))} /></td>
                <td>{dollars(line.unitCost === null ? null : money(allocated * line.unitCost))}</td>
              </tr>; })}
            </tbody></table></div></div>;
        })}
      </section>
      <section><h2>Budget transfer review</h2>
        <p>The estimate lines selected above are automatically the source, with the same descriptions, quantities, cost and revenue. Choose only the subcontractor destination. Each transfer keeps both project totals unchanged.</p>
        {!budgetPlan!.rows.length ? <p>Check an estimate group or line to see its budget impact here.</p> : <>
          {[...groups].filter(([, lines]) => budgetPlan!.rows.some(row => row.needsTransfer && lines.some(line => line.id === row.line.id))).map(([key, lines]) => {
            const rows = budgetPlan!.rows.filter(row => row.line.groupId === lines[0].groupId && row.needsTransfer);
            const destination = rows.every(row => row.toBudgetId === rows[0].toBudgetId) ? rows[0].toBudgetId : '';
            return <div className={styles.toolbar} key={key}><label>Subcontractor budget for {lines[0].groupName}<select disabled={locked} value={destination} onChange={e => mapGroupBudget(lines[0].groupId, e.target.value)}>
              <option value="">Choose destination for this group</option>{subcontractBudgetOptions(source).map(line => <option key={line.id} value={line.id}>{line.costCode} · {line.name}{line.proposed ? ' (new budget code)' : ''}</option>)}
            </select></label></div>;
          })}
          {budgetPlan!.pending > 0 && <p className={styles.warning}>{budgetPlan!.pending} transfers still need attention below. You can save these as an incomplete review draft.</p>}
          <div className={styles.scroll}><table><thead><tr><th>Estimate scope</th><th>Subcontract qty</th><th>Cost to move</th><th>Revenue to move</th><th>Original cost code</th><th>Increase subcontract budget</th><th>Status</th></tr></thead><tbody>
            {budgetPlan!.rows.map(row => <tr key={row.line.id}><td><strong>{row.line.name}</strong><small>{row.line.groupName}</small><small>{row.line.costCode || row.line.budgetCode || 'Estimate budget code unavailable'}</small></td><td>{qty(row.quantity)} {row.line.uom}</td><td>{dollars(row.amount)}</td><td>{dollars(row.revenue)}</td>
              <td>{row.line.costCode || row.fromBudgetCode || 'No cost code'}</td>
              <td>{row.needsTransfer ? <select aria-label={`Subcontract budget for ${row.line.name}`} disabled={locked} value={row.toBudgetId} onChange={e => mapBudget(row.line.id, row.fromBudgetId, e.target.value)}>
                <option value="">Choose subcontract budget</option>{subcontractBudgetOptions(source).map(line => <option key={line.id} value={line.id}>{line.costCode} · {line.name}{line.proposed ? ' (new budget code)' : ''}</option>)}
              </select> : '—'}</td><td>{row.status}</td></tr>)}
          </tbody></table></div>
          <p><strong>{dollars(budgetPlan!.readyAmount)}</strong> in matched cost transfers ready for review. Net cost budget change: <strong>{dollars(totals!.budgetChange)}</strong>. Net revenue transfer change: <strong>{dollars(0)}</strong>.</p>
          <p className={styles.muted}>Revenue transfers use the selected share of estimate sales. Current revenue balances are not available in the synchronized budget data.</p>
          {!!budgetPlan!.adjustments.length && <div className={styles.scroll}><table><thead><tr><th>Budget line</th><th>Cost change</th><th>Revenue change</th></tr></thead><tbody>
            {budgetPlan!.adjustments.map(line => <tr key={line.id}><td>{line.costCode}<small>{line.name}</small></td><td>{dollars(line.change)}</td><td>{dollars(line.revenueChange)}</td></tr>)}
          </tbody></table></div>}
        </>}
      </section>
      <details className={styles.group} open={review || changes.budgets.some(row => row.change !== 0) || changes.purchaseOrders.some(row => row.quantity !== source.poLines.find(line => line.id === row.lineId)?.quantity) || undefined}>
      <summary>Additional budget and PO adjustments (optional)</summary>
      <div className={styles.cards}>
        <div><span>Proposed budget change</span><strong>{dollars(totals!.budgetChange)}</strong></div>
        <div><span>Proposed PO change</span><strong>{dollars(totals!.poChange)}</strong></div>
      </div>
      <section><h2>Additional budget changes</h2><p className={styles.muted}>These signed adjustments are added to the transfers above. Do not enter the same transfer twice.</p>
        {!source.budgets.length ? <p>No synchronized budget lines are available.</p> : <div className={styles.scroll}><table><thead><tr><th>Budget line</th><th>Current amount</th><th>Proposed change (+/−)</th><th>Proposed amount</th></tr></thead><tbody>
          {source.budgets.map(line => { const change = changes.budgets.find(row => row.lineId === line.id)?.change ?? 0; return <tr key={line.id}><td><strong>{line.name}</strong><small>{line.costCode}</small></td><td>{dollars(line.amount)}</td>
            <td><input aria-label={`Budget change for ${line.name}`} type="number" step="0.01" disabled={locked || line.amount === null} value={Number.isNaN(change) ? '' : change} onChange={e => edit({ ...changes, budgets: [...changes.budgets.filter(row => row.lineId !== line.id), { lineId: line.id, change: e.target.value === '' ? NaN : Number(e.target.value) }] })} /></td><td>{dollars(line.amount === null ? null : money(line.amount + change))}</td></tr>; })}
        </tbody></table></div>}
      </section>
      <section><h2>Existing commitment POs</h2><p className={styles.muted}>Enter the proposed total quantity for each PO line. Each commitment stays separate; prices remain at their synchronized values.</p>
        {!pos.size && <p>No synchronized PO lines are available.</p>}
        {[...pos].map(([id, lines]) => <details className={styles.group} key={id} open={review || undefined}><summary>{lines[0].poName || id} · {lines.length} lines{changes.purchaseOrders.some(row => lines.some(line => line.id === row.lineId)) ? ' · Proposed changes' : ''}</summary>
          <div className={styles.scroll}><table><thead><tr><th>PO line</th><th>Unit</th><th>Current qty</th><th>Unit price</th><th>Proposed qty</th><th>Amount change</th></tr></thead><tbody>
            {lines.map(line => { const value = changes.purchaseOrders.find(row => row.lineId === line.id)?.quantity ?? line.quantity; return <tr key={line.id}><td><strong>{line.name}</strong><small>{line.costCode}</small></td><td>{line.uom}</td><td>{qty(line.quantity)}</td><td>{dollars(line.unitCost)}</td>
              <td><input aria-label={`Proposed PO quantity for ${line.poName}: ${line.name}`} type="number" step="0.0001" min="0" disabled={locked || line.quantity === null || line.unitCost === null} value={value === null || Number.isNaN(value) ? '' : value} onChange={e => edit({ ...changes, purchaseOrders: [...changes.purchaseOrders.filter(row => row.lineId !== line.id), { lineId: line.id, quantity: e.target.value === '' ? NaN : Number(e.target.value) }] })} /></td>
              <td>{dollars(value === null || line.quantity === null || line.unitCost === null ? null : money(value * line.unitCost) - money(line.quantity * line.unitCost))}</td></tr>; })}
          </tbody></table></div></details>)}
      </section>
      </details>
      <footer className={styles.footer}>
        {review ? <><strong>Review proposed changes above before saving.</strong><button disabled={busy} onClick={() => setReview(false)}>Back to editing</button><button className={styles.primary} disabled={busy} onClick={() => void save()}>Save review draft</button></>
          : <><span>{changes.allocations.filter(row => row.quantity > 0).length} allocated lines · {dirty ? 'Unsaved' : 'Saved state'}</span><button className={styles.primary} disabled={busy || stale} onClick={prepareReview}>Review changes</button></>}
      </footer>
    </>}
  </main>;
}
