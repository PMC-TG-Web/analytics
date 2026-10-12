'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { allocationHours, allocationPercent, sameWipSource, validateWipAllocations, wipPlanStatus, type WipAllocation, type WipPlan, type WipProject } from '@/lib/wipPlanning';

type Project = WipProject & { fingerprint: string };
type History = { revision: number; source: WipPlan['source']; allocations: WipAllocation[]; notes: string; createdBy: string; createdAt: string };
const hours = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const monthLabel = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const currentMonth = () => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone: 'America/New_York' }).format(new Date()).slice(0, 7);
function addMonths(month: string, count: number) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + count);
  return date.toISOString().slice(0, 7);
}
const inputClass = 'rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
const buttonClass = 'rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50';
const planValues = (plan: WipPlan | null) => Object.fromEntries((plan?.allocations || []).map(value => [value.month, String(value.percent)]));

function ScrollableGrid({ children }: { children: ReactNode }) {
  const topRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  useEffect(() => {
    const top = topRef.current!, viewport = viewportRef.current!, table = tableRef.current!;
    const measure = () => {
      // Match scroll ranges even when the table has a vertical scrollbar.
      setScrollWidth(viewport.scrollWidth + top.clientWidth - viewport.clientWidth);
      top.scrollLeft = viewport.scrollLeft;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport); observer.observe(table);
    measure();
    return () => observer.disconnect();
  }, []);
  return <div className="overflow-hidden rounded border border-slate-200 bg-white">
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <span>Click a month to enter %. Blank or 0 clears it. Save each row at 100%.</span>
      <div className="flex shrink-0 items-center gap-2"><span>Scroll months</span>
        <button aria-label="Scroll months left" onClick={() => viewportRef.current?.scrollBy({ left: -336 })} className="rounded border border-slate-300 bg-white px-2 py-1 font-bold hover:bg-slate-100">←</button>
        <button aria-label="Scroll months right" onClick={() => viewportRef.current?.scrollBy({ left: 336 })} className="rounded border border-slate-300 bg-white px-2 py-1 font-bold hover:bg-slate-100">→</button>
      </div>
    </div>
    <div ref={topRef} role="region" aria-label="Scroll months horizontally" tabIndex={0} className="h-5 overflow-x-scroll overflow-y-hidden border-b border-slate-200 bg-slate-100 [&::-webkit-scrollbar]:h-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-track]:bg-slate-100" onScroll={event => {
      if (viewportRef.current && viewportRef.current.scrollLeft !== event.currentTarget.scrollLeft) viewportRef.current.scrollLeft = event.currentTarget.scrollLeft;
    }}><div style={{ width: scrollWidth, height: 1 }} /></div>
    <div ref={viewportRef} role="region" aria-label="WIP allocation grid" tabIndex={0} className="max-h-[60vh] overflow-auto overscroll-contain" onScroll={event => {
      if (topRef.current && topRef.current.scrollLeft !== event.currentTarget.scrollLeft) topRef.current.scrollLeft = event.currentTarget.scrollLeft;
    }}><table ref={tableRef} className="w-full border-separate border-spacing-0 text-sm">{children}</table></div>
  </div>;
}

function ProjectRow({ project, months, onDirty, onSaved, showMonth }: {
  project: Project; months: string[]; onDirty: (key: string, dirty: boolean) => void;
  onSaved: (project: Project, plan: WipPlan) => void; showMonth: (month: string) => void;
}) {
  // Keep all months in the draft, including allocations outside the visible year.
  const [values, setValues] = useState<Record<string, string>>(() => planValues(project.plan));
  const [notes, setNotes] = useState(project.plan?.notes || '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<History[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const changed = !!project.plan && !sameWipSource(project.source, project.plan.source);
  const [reviewed, setReviewed] = useState(false);
  const allocations = Object.entries(values)
    .filter(([, value]) => value.trim() !== '' && Number(value) !== 0)
    .map(([month, value]) => ({ month, percent: Number(value) }));
  const total = allocationPercent(allocations);
  const outside = allocations.filter(value => !months.includes(value.month)).sort((a, b) => a.month.localeCompare(b.month));
  const basis = dirty ? project.source.allocatableHours : project.plan?.source.allocatableHours ?? project.source.allocatableHours;
  let validation = '';
  try { validateWipAllocations(allocations); } catch (error) { validation = (error as Error).message; }
  function markDirty() { setDirty(true); onDirty(project.key, true); setError(''); }
  function cancel() {
    setValues(planValues(project.plan)); setNotes(project.plan?.notes || '');
    setDirty(false); setReviewed(false); setError(''); onDirty(project.key, false);
  }
  async function save() {
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/wip', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.projectId, revision: project.plan?.revision || 0, fingerprint: project.fingerprint, allocations: validateWipAllocations(allocations), notes }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to save the plan.');
      onSaved(project, body.plan);
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to save the plan.'); }
    finally { setSaving(false); }
  }
  async function loadHistory() {
    setHistoryLoading(true); setError('');
    try {
      const response = await fetch(`/api/wip?projectId=${encodeURIComponent(project.projectId!)}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to load history.');
      setHistory(body.history);
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to load history.'); }
    finally { setHistoryLoading(false); }
  }
  return <tr className={dirty ? 'bg-teal-50/50' : 'bg-white'} aria-label={project.projectName}>
    <td className="sticky left-0 z-10 w-72 min-w-72 max-w-72 border-b border-r border-slate-200 bg-white p-3 align-top">
      <p className="font-bold">{project.projectName}</p>
      <p className="mt-1 text-xs text-slate-500">{[project.projectNumber, project.customer].filter(Boolean).join(' · ')}</p>
      <p className="mt-1 text-xs text-slate-600">{project.projectManager}</p>
      <details className="mt-2 text-xs">
        <summary className="w-fit cursor-pointer font-semibold text-teal-800">Planning notes{notes.trim() ? ' •' : ''}</summary>
        <label className="mt-2 block"><span className="sr-only">Planning notes for {project.projectName}</span><textarea maxLength={4000} value={notes} disabled={saving || !!project.issue} onChange={event => { setNotes(event.target.value); markDirty(); }} rows={3} placeholder="Timing assumptions or PM updates…" className={`${inputClass} block w-full`} /></label>
        {project.plan && <>
          <p className="mt-2 text-slate-500">Saved {new Date(project.plan.updatedAt).toLocaleDateString()} · {project.plan.updatedBy}</p>
          <button onClick={loadHistory} disabled={historyLoading} className="mt-2 font-semibold text-teal-800 underline">{historyLoading ? 'Loading…' : 'View revision history'}</button>
        </>}
        {history && <div className="mt-2 max-h-56 space-y-2 overflow-auto"><p className="font-semibold">Latest 50 revisions</p>{history.map(item => <details key={item.revision} className="rounded border border-slate-200 p-2">
          <summary className="cursor-pointer">Revision {item.revision} · {new Date(item.createdAt).toLocaleDateString()}</summary>
          <p className="mt-1">{item.createdBy} · {hours.format(item.source.allocatableHours)} h</p>
          <ul className="mt-1 space-y-1">{item.allocations.map(value => <li key={value.month}>{monthLabel(value.month)}: {value.percent}% · {hours.format(allocationHours(item.source.allocatableHours, value.percent))} h</li>)}</ul>
          {item.notes && <p className="mt-2 whitespace-pre-wrap">{item.notes}</p>}
        </details>)}</div>}
      </details>
      {changed && !project.issue && <label className="mt-2 flex items-start gap-2 text-xs text-amber-900"><input type="checkbox" checked={reviewed} disabled={saving} onChange={event => { setReviewed(event.target.checked); markDirty(); }} /><span>Use updated estimate: {hours.format(project.source.allocatableHours)} h (saved: {hours.format(project.plan!.source.allocatableHours)} h)</span></label>}
      {dirty && <div className="mt-3 flex items-center gap-2">
        <button aria-label={`Save ${project.projectName}`} onClick={save} disabled={saving || !!validation || (changed && !reviewed) || !!project.issue} className="rounded bg-teal-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-900 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        <button aria-label={`Cancel changes for ${project.projectName}`} onClick={cancel} disabled={saving} className="px-2 py-1.5 text-xs font-semibold text-slate-600 hover:underline disabled:opacity-50">Cancel</button>
        <span className="text-xs text-amber-800">Unsaved</span>
      </div>}
      {error && <p role="alert" className="mt-2 text-xs font-semibold text-red-700">{error}</p>}
    </td>
    <td className="min-w-28 border-b border-slate-200 p-3 text-right align-top"><p className="font-bold">{hours.format(project.source.allocatableHours)}</p><p className="mt-1 text-xs text-slate-500">{hours.format(project.source.estimatedHours)} − {hours.format(project.source.projectManagementHours)} PM</p></td>
    <td className="min-w-36 border-b border-slate-200 p-3 align-top">
      <p aria-live="polite" className={`font-bold ${total === 100 && !validation ? 'text-teal-800' : 'text-amber-800'}`}>{Number.isFinite(total) ? `${total}%` : 'Invalid %'}</p>
      <p className="mt-1 text-xs text-slate-500">{dirty ? (validation ? 'Must total 100%' : 'Ready to save') : wipPlanStatus(project)}</p>
      {dirty && validation && <p className="mt-1 max-w-44 text-xs text-amber-800">{validation}</p>}
      {project.issue && <p className="mt-1 max-w-48 text-xs text-amber-800">{project.issue}</p>}
      {outside.length > 0 && <button onClick={() => showMonth(outside[0].month)} className="mt-2 text-left text-xs text-teal-800 underline">{outside.length} month(s) outside view</button>}
    </td>
    {months.map(month => {
      const value = values[month] || '';
      const percent = Number(value);
      return <td key={month} className="min-w-28 border-b border-l border-slate-100 px-2 py-3 text-right align-top">
        <div className="relative"><input aria-label={`${project.projectName}, ${monthLabel(month)} percentage`} title={`${monthLabel(month)} percentage`} inputMode="decimal" value={value} placeholder="—" disabled={saving || !!project.issue}
          onFocus={event => event.target.select()} onChange={event => { setValues(current => ({ ...current, [month]: event.target.value })); markDirty(); }}
          className="w-20 min-w-0 rounded border border-transparent bg-transparent py-2 pl-1 pr-5 text-right font-bold tabular-nums text-slate-900 hover:border-slate-300 hover:bg-white focus:border-teal-600 focus:bg-white focus:outline-2 focus:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-40" />
          <span className="pointer-events-none absolute right-1 top-2 text-slate-400">%</span>
        </div>
        <p className="mt-1 pr-1 text-xs tabular-nums text-slate-500">{value.trim() && Number.isFinite(percent) && percent > 0 ? `${hours.format(allocationHours(basis, percent))} h` : '—'}</p>
      </td>;
    })}
  </tr>;
}

export default function WipPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [manager, setManager] = useState('');
  const [status, setStatus] = useState('');
  const [start, setStart] = useState(currentMonth);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const hasChanges = dirtyKeys.size > 0;
  function onDirty(key: string, dirty: boolean) {
    setDirtyKeys(current => { const next = new Set(current); if (dirty) next.add(key); else next.delete(key); return next; });
    setNotice('');
  }
  function onSaved(project: Project, plan: WipPlan) {
    setProjects(values => values.map(value => value.key === project.key ? { ...value, plan } : value));
    onDirty(project.key, false);
    setNotice(`Saved ${project.projectName} — 100% allocated.`);
  }
  async function load() {
    setLoading(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/wip', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to load WIP.');
      setProjects(body.projects);
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to load WIP.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!hasChanges) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasChanges]);
  const months = Array.from({ length: 12 }, (_, index) => addMonths(start, index));
  const visible = projects.filter(project => (!manager || project.projectManager === manager)
    && (!status || wipPlanStatus(project) === status)
    && `${project.projectName} ${project.projectNumber} ${project.customer}`.toLowerCase().includes(search.toLowerCase()));
  const managers = [...new Set(projects.map(project => project.projectManager))].sort();
  const totalHours = visible.reduce((sum, project) => sum + (Number.isFinite(project.source.allocatableHours) ? Math.max(0, project.source.allocatableHours) : 0), 0);
  const needsAllocation = visible.filter(project => !project.plan).length;
  const needsReview = visible.filter(project => project.issue || (project.plan && !sameWipSource(project.source, project.plan.source))).length;
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-6">
    <div className="mx-auto max-w-[1800px] space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-black">WIP</h1><p className="mt-1 text-sm text-slate-600">Estimated hours excluding Project Management. Enter percentages directly in the months below.</p></div><button disabled={loading || hasChanges} onClick={load} className={buttonClass}>Refresh</button></header>
      {error && <div role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-red-800">{error} <button onClick={load} className="ml-2 underline">Retry</button></div>}
      {notice && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
      {loading ? <p className="p-8 text-slate-600" role="status">Loading estimated hours and allocations…</p> : !error && <>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">{[['In Progress jobs', visible.length], ['Estimated hours', hours.format(totalHours)], ['Needs allocation', needsAllocation], ['Needs review', needsReview]].map(([label, value]) => <p key={label}><strong className="text-slate-900">{value}</strong> {label}</p>)}</div>
        <div className="flex flex-wrap items-end gap-3"><label className="text-xs font-semibold">Find a job<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Project, number, or customer" disabled={hasChanges} className={`${inputClass} mt-1 block w-64`} /></label>
          <label className="text-xs font-semibold">Project Manager<select value={manager} onChange={event => setManager(event.target.value)} disabled={hasChanges} className={`${inputClass} mt-1 block`}><option value="">All PMs</option>{managers.map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="text-xs font-semibold">Allocation status<select value={status} onChange={event => setStatus(event.target.value)} disabled={hasChanges} className={`${inputClass} mt-1 block`}><option value="">All statuses</option>{['Needs allocation', 'Allocated', 'Estimate changed', 'Needs source review'].map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="text-xs font-semibold">12 months starting<input type="month" value={start} min="2000-01" max="2099-01" onChange={event => { if (/^20\d\d-(0[1-9]|1[0-2])$/.test(event.target.value)) setStart(event.target.value); }} className={`${inputClass} mt-1 block`} /></label>
          {hasChanges && <span className="pb-2 text-xs text-amber-800">{dirtyKeys.size} unsaved row(s) · Save or cancel to filter or refresh.</span>}
        </div>
        <ScrollableGrid>
          <thead className="text-left text-xs text-slate-600"><tr><th className="sticky left-0 top-0 z-30 min-w-72 border-b border-r border-slate-300 bg-slate-100 p-3">Project / PM</th><th className="sticky top-0 z-20 min-w-28 border-b border-slate-300 bg-slate-100 p-3 text-right">Est. hours<br />excl. PM</th><th className="sticky top-0 z-20 min-w-36 border-b border-slate-300 bg-slate-100 p-3">Allocated</th>{months.map(month => <th key={month} className="sticky top-0 z-20 min-w-28 border-b border-slate-300 bg-slate-100 p-3 text-right">{monthLabel(month)}</th>)}</tr></thead>
          <tbody>{visible.map(project => <ProjectRow key={`${project.key}:${project.plan?.revision || 0}:${project.fingerprint}`} project={project} months={months} onDirty={onDirty} onSaved={onSaved} showMonth={setStart} />)}
            {!visible.length && <tr><td colSpan={15} className="p-10 text-center text-slate-500">{projects.length ? 'No jobs match these filters.' : 'No In Progress jobs are available yet. Jobs appear here after their Bid Board status synchronizes.'}</td></tr>}
          </tbody>
          <tfoot className="bg-teal-50 font-bold"><tr><td className="sticky bottom-0 left-0 z-30 border-t-2 border-slate-300 bg-teal-50 p-3">Monthly workload · {visible.length} jobs</td><td className="sticky bottom-0 z-20 border-t-2 border-slate-300 bg-teal-50 p-3 text-right">{hours.format(totalHours)} h</td><td className="sticky bottom-0 z-20 border-t-2 border-slate-300 bg-teal-50 p-3 text-xs font-normal">Saved totals</td>{months.map(month => <td key={month} className="sticky bottom-0 z-20 border-t-2 border-slate-300 bg-teal-50 p-3 text-right">{hours.format(visible.reduce((sum, project) => sum + (project.plan ? allocationHours(project.plan.source.allocatableHours, project.plan.allocations.find(value => value.month === month)?.percent || 0) : 0), 0))} h</td>)}</tr></tfoot>
        </ScrollableGrid>
      </>}
    </div>
  </main>;
}
