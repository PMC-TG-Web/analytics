'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchBillRead, readBillResponse } from '@/lib/qboBillResponse';
import BillIssue from './BillIssue';
import type { getBillBatch } from '@/lib/qboBillBatchStore';
import type { DirectCostIssueSource } from '@/lib/qboDirectCosts';

type Run = NonNullable<Awaited<ReturnType<typeof getBillBatch>>>;
const labels: Record<string, string> = { queued: 'In progress', waiting: 'Waiting', created: 'Created', updated: 'Updated', current: 'Already current', empty: 'No eligible costs', skipped: 'Skipped', needs_attention: 'Needs attention' };
export default function MonthlyBillBatch({ companyId, month, disabled, refreshing = false, visibleProjectIds, onRunning, onComplete, onReview }: {
  companyId: string; month: string; disabled: boolean; refreshing?: boolean; visibleProjectIds: string[] | null; onRunning: (running: boolean) => void; onComplete: () => void; onReview: (id: string) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [activeMonth, setActiveMonth] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [starting, setStarting] = useState(false);
  const [projects, setProjects] = useState<{ procoreProjectId: string; projectName: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [maxProjects, setMaxProjects] = useState(1);
  const [revision, setRevision] = useState(0);
  const completed = useRef('');
  const requestKey = useRef<string | null>(null);
  useEffect(() => { requestKey.current = null; setSelected([]); setMessage(''); }, [companyId, month]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let pollAgain = true;
    async function poll() {
      try {
        const response = await fetchBillRead(`/api/accounting/direct-cost-bills/batch?${new URLSearchParams({ companyId, month })}`, controller.signal);
        const data = await readBillResponse(response);
        if (!response.ok) throw new Error(data.error || 'Unable to load batch progress.');
        if (controller.signal.aborted) return;
        setEnabled(data.enabled); setRun(data.run); setActiveMonth(data.activeMonth || null);
        setProjects(data.projects || []); setMaxProjects(data.maxProjects || 1);
        pollAgain = data.enabled === true;
        onRunning(!!data.activeMonth); setError('');
        if (data.run?.status === 'complete' && completed.current !== data.run.id) { completed.current = data.run.id; onComplete(); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load batch progress.'); }
      finally { if (!controller.signal.aborted && pollAgain) timer = setTimeout(poll, 10_000); }
    }
    if (companyId) void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [companyId, month, revision, onRunning, onComplete]);
  const shownProjects = useMemo(() => projects.filter(p => visibleProjectIds?.includes(p.procoreProjectId) && p.projectName.toLowerCase().includes(search.trim().toLowerCase())), [projects, visibleProjectIds, search]);
  const shownIds = useMemo(() => shownProjects.map(p => p.procoreProjectId), [shownProjects]);
  const selectedShown = selected.filter(id => shownIds.includes(id));
  useEffect(() => {
    if (visibleProjectIds === null) return;
    setSelected(current => {
      const next = current.filter(id => shownIds.includes(id));
      return next.length === current.length ? current : next;
    });
  }, [shownIds, visibleProjectIds]);
  async function start(retry = false) {
    if (starting || activeMonth || (!retry && (!selectedShown.length || selectedShown.length > maxProjects))) return;
    setStarting(true); setError('');
    // Reuse after a lost response so retrying the button cannot create a second run.
    requestKey.current ||= crypto.randomUUID();
    try {
      const response = await fetch('/api/accounting/direct-cost-bills/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, month, requestKey: requestKey.current, ...(retry && run ? { retryOf: run.id } : { projectIds: selectedShown }) }) });
      const data = await readBillResponse(response);
      if (!response.ok) throw new Error(data.error || 'Unable to start the monthly update.');
      requestKey.current = null; setMessage(data.message); setActiveMonth(data.month); onRunning(true); setRevision(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : 'Check saved progress before trying again.'); }
    finally { setStarting(false); }
  }
  if (!enabled && !error) return null;
  const problems = run?.projects.filter(p => p.status === 'needs_attention') || [];
  const visible = run?.projects.filter(p => p.status !== 'empty') || [];
  const allShownSelected = shownIds.every(id => selectedShown.includes(id));
  return <section className="space-y-4 rounded-xl border border-blue-200 bg-white p-5" aria-label="Monthly bill updates">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Monthly bill updates</h2><p className="text-sm text-slate-600">Refresh sources, add missing cost codes and products, and save complete bills. You can close this page while the run continues.</p></div>
      <button disabled={!enabled || disabled || starting || !!activeMonth || !selectedShown.length || selectedShown.length > maxProjects} onClick={() => start()} className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{starting ? 'Starting…' : `Update selected bills for ${month}`}</button></div>
    {enabled && <fieldset disabled={disabled || starting || !!activeMonth} className="space-y-2">
      <legend className="text-sm font-semibold">Projects to update · {selectedShown.length} selected · Limit {maxProjects} per run</legend>
      <p className="text-xs text-slate-600">Only available projects shown in the Project bills table below are listed. Its search and status filters control this list; projects with no eligible costs are excluded.</p>
      <input aria-label="Find projects to update" type="search" placeholder="Find a project" value={search} onChange={e => setSearch(e.target.value)} className="w-full rounded border p-2 text-sm" />
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <button type="button" disabled={!shownIds.length || allShownSelected || shownIds.length > maxProjects} onClick={() => setSelected(shownIds)} className="text-blue-700 underline disabled:opacity-50">Select all shown</button>
        <button type="button" disabled={!selected.length} onClick={() => setSelected([])} className="text-blue-700 underline disabled:opacity-50">Clear selection</button>
        <span className="text-slate-500">{visibleProjectIds === null ? 'Loading available projects…' : refreshing ? `Refreshing status… ${shownProjects.length} verified projects remain shown` : `${shownProjects.length} available projects shown`}</span>
      </div>
      {shownIds.length > maxProjects && <p className="text-xs text-slate-600">Narrow your search or select projects individually to stay within the {maxProjects}-project limit.</p>}
      <div className="max-h-40 overflow-auto rounded border p-2">{shownProjects.map(p => <label key={p.procoreProjectId} className="flex items-center gap-2 p-1 text-sm">
        <input type="checkbox" checked={selectedShown.includes(p.procoreProjectId)} disabled={!selectedShown.includes(p.procoreProjectId) && selectedShown.length >= maxProjects} onChange={e => setSelected(current => e.target.checked ? [...current, p.procoreProjectId] : current.filter(id => id !== p.procoreProjectId))} />{p.projectName}
      </label>)}</div>
      <p className="text-xs text-slate-600">Selected projects process one step at a time. API limits pause the run automatically; each project keeps its own result and any issues.</p>
    </fieldset>}
    {activeMonth && <p role="status">A monthly update is running for {activeMonth}. Saved progress will resume automatically after interruptions.</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {run && <><p role="status" className="text-sm font-semibold">{run.finished} of {run.total} projects checked · {problems.length} need attention{run.status === 'complete' ? ' · Run complete' : ''}</p>
      <p className="text-xs text-slate-500">Started by {run.requestedBy} · {new Date(run.createdAt).toLocaleString()} · {run.projects.filter(p => p.status === 'empty').length} empty projects skipped</p>
      <div className="max-h-[420px] overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{['Project', 'Result', 'Details', ''].map((label, i) => <th key={i} className="border-b p-2">{label}</th>)}</tr></thead><tbody>{visible.map(p => <tr key={p.projectId}><td className="border-b p-2 font-medium">{p.projectName}{p.billNumber && <span className="block text-xs font-normal">{p.billNumber}</span>}</td><td className="border-b p-2">{labels[p.status] || p.status}</td><td className="border-b p-2">{p.status === 'needs_attention' ? <ul className="list-disc pl-4">{(p.issues as string[]).map((issue, i) => <li key={i}><BillIssue message={issue} companyId={companyId} projectId={p.projectId} sources={p.issueSources as unknown as DirectCostIssueSource[]} /></li>)}</ul> : p.message}</td><td className="border-b p-2">{p.status === 'needs_attention' && <button disabled={disabled || !!activeMonth} className="text-blue-700 underline disabled:opacity-50" onClick={() => onReview(p.projectId)}>Open review</button>}</td></tr>)}</tbody></table></div>
      {run.status === 'complete' && problems.length > 0 && <><button disabled={disabled || starting || !!activeMonth || problems.length > maxProjects} onClick={() => start(true)} className="rounded-lg border border-blue-300 px-4 py-2 text-blue-800 disabled:opacity-50">Retry unresolved projects</button>{problems.length > maxProjects && <p className="text-sm">Select a smaller group above to retry within the {maxProjects}-project limit.</p>}</>}
    </>}
  </section>;
}
