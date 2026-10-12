'use client';

import { Fragment, useEffect, useState } from 'react';
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

function PlanEditor({ project, onSaved, onCancel }: { project: Project; onSaved: (plan: WipPlan) => void; onCancel: () => void }) {
  const [allocations, setAllocations] = useState<WipAllocation[]>(project.plan?.allocations || [{ month: currentMonth(), percent: 100 }]);
  const [notes, setNotes] = useState(project.plan?.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<History[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const changed = project.plan && !sameWipSource(project.source, project.plan.source);
  const [reviewed, setReviewed] = useState(!changed);
  const total = allocationPercent(allocations);
  let validation = '';
  try { validateWipAllocations(allocations); } catch (error) { validation = (error as Error).message; }

  async function save() {
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/wip', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.projectId, revision: project.plan?.revision || 0, fingerprint: project.fingerprint, allocations, notes }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to save the plan.');
      onSaved(body.plan);
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
  return <section className="max-w-3xl space-y-4 p-5" aria-label={`Allocate ${project.projectName}`}>
    <div><h2 className="text-lg font-bold">{project.projectName}</h2>
      <p className="text-sm text-slate-600">{hours.format(project.source.estimatedHours)} estimated − {hours.format(project.source.projectManagementHours)} Project Management = <strong>{hours.format(project.source.allocatableHours)} hours to allocate</strong></p>
    </div>
    {changed && <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p>The estimate changed. The saved plan uses {hours.format(project.plan!.source.allocatableHours)} hours; saving now will use {hours.format(project.source.allocatableHours)} hours.</p>
      <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={saving} />I reviewed the current estimate and monthly allocation.</label>
    </div>}
    <fieldset disabled={saving} className="space-y-3">
      <legend className="mb-2 text-sm font-semibold">Monthly distribution</legend>
      {allocations.map((allocation, index) => <div key={index} className="flex flex-wrap items-center gap-3">
        <input aria-label={`Month ${index + 1}`} type="month" min="2000-01" max="2099-12" value={allocation.month} onChange={event => setAllocations(values => values.map((value, i) => i === index ? { ...value, month: event.target.value } : value))} className={inputClass} />
        <label className="flex items-center gap-1"><input aria-label={`Percentage ${index + 1}`} type="number" min="0.01" max="100" step="0.01" value={Number.isFinite(allocation.percent) ? allocation.percent : ''} onChange={event => setAllocations(values => values.map((value, i) => i === index ? { ...value, percent: event.target.value === '' ? NaN : Number(event.target.value) } : value))} className={`${inputClass} w-24`} />%</label>
        <span className="w-28 text-right text-sm font-semibold">{Number.isFinite(allocation.percent) ? hours.format(allocationHours(project.source.allocatableHours, allocation.percent)) : '—'} h</span>
        <button className={buttonClass} onClick={() => setAllocations(values => values.filter((_, i) => i !== index))} aria-label={`Remove month ${index + 1}`}>Remove</button>
      </div>)}
      <button className={buttonClass} disabled={allocations.length >= 120} onClick={() => {
        const last = allocations.map(value => value.month).filter(value => /^20\d\d-(0[1-9]|1[0-2])$/.test(value)).sort().at(-1);
        setAllocations(values => [...values, { month: last ? addMonths(last, 1) : currentMonth(), percent: Math.max(0, 100 - (Number.isFinite(total) ? total : 0)) }]);
      }}>+ Add month</button>
      <p className={`text-sm font-semibold ${validation ? 'text-amber-800' : 'text-emerald-800'}`} aria-live="polite">{Number.isFinite(total) ? `${total}% allocated` : 'Enter a percentage for every month'}{validation ? ` · ${validation}` : ' · Ready to save'}</p>
      <label className="block text-sm font-semibold">Planning notes<textarea maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} rows={3} placeholder="Timing assumptions, PM updates, or reasons for moving work…" className={`${inputClass} mt-1 block w-full font-normal`} /></label>
    </fieldset>
    {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button onClick={save} disabled={saving || !!validation || !reviewed} className="rounded bg-teal-800 px-4 py-2 text-sm font-bold text-white hover:bg-teal-900 disabled:opacity-50">{saving ? 'Saving…' : 'Save allocation'}</button>
      <button onClick={onCancel} disabled={saving} className={buttonClass}>Cancel</button>
      {project.plan && <button onClick={loadHistory} disabled={historyLoading} className={buttonClass}>{historyLoading ? 'Loading…' : 'View revision history'}</button>}
    </div>
    {history && <div className="space-y-2 border-t border-slate-200 pt-3"><h3 className="text-sm font-bold">Latest 50 revisions</h3>{history.map(item => <details key={item.revision} className="rounded border border-slate-200 bg-white p-3 text-sm">
      <summary className="cursor-pointer">Revision {item.revision} · {new Date(item.createdAt).toLocaleString()} · {item.createdBy}</summary>
      <p className="mt-2">{hours.format(item.source.allocatableHours)} estimated hours excluding Project Management</p>
      <ul className="mt-1 list-inside list-disc">{item.allocations.map(value => <li key={value.month}>{monthLabel(value.month)}: {value.percent}% · {hours.format(allocationHours(item.source.allocatableHours, value.percent))} h</li>)}</ul>
      {item.notes && <p className="mt-2 whitespace-pre-wrap">{item.notes}</p>}
    </details>)}</div>}
  </section>;
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
  const [editing, setEditing] = useState<string | null>(null);
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
    if (!editing) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editing]);
  const months = Array.from({ length: 12 }, (_, index) => addMonths(start, index));
  const visible = projects.filter(project => (!manager || project.projectManager === manager)
    && (!status || wipPlanStatus(project) === status)
    && `${project.projectName} ${project.projectNumber} ${project.customer}`.toLowerCase().includes(search.toLowerCase()));
  const managers = [...new Set(projects.map(project => project.projectManager))].sort();
  const totalHours = visible.reduce((sum, project) => sum + (Number.isFinite(project.source.allocatableHours) ? Math.max(0, project.source.allocatableHours) : 0), 0);
  const needsAllocation = visible.filter(project => !project.plan).length;
  const needsReview = visible.filter(project => project.issue || (project.plan && !sameWipSource(project.source, project.plan.source))).length;
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-6">
    <div className="mx-auto max-w-[1800px] space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-teal-800">Project planning</p><h1 className="mt-1 text-3xl font-black">WIP</h1><p className="mt-2 text-sm text-slate-600">Allocate 100% of each In Progress job’s estimated hours, excluding Project Management, across its work months.</p></div><button disabled={loading || !!editing} onClick={load} className={buttonClass}>Refresh</button></header>
      {error && <div role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-red-800">{error} <button onClick={load} className="ml-2 underline">Retry</button></div>}
      {notice && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
      {loading ? <p className="p-8 text-slate-600" role="status">Loading estimated hours and allocations…</p> : !error && <>
        <div className="grid gap-3 sm:grid-cols-4">{[['In Progress jobs', visible.length], ['Estimated hours to allocate', hours.format(totalHours)], ['Needs allocation', needsAllocation], ['Needs review', needsReview]].map(([label, value]) => <div key={label} className="rounded border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase text-slate-500">{label}</p><p className="mt-2 text-2xl font-black">{value}</p></div>)}</div>
        <div className="flex flex-wrap items-end gap-3"><label className="text-xs font-semibold">Find a job<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Project, number, or customer" disabled={!!editing} className={`${inputClass} mt-1 block w-64`} /></label>
          <label className="text-xs font-semibold">Project Manager<select value={manager} onChange={event => setManager(event.target.value)} disabled={!!editing} className={`${inputClass} mt-1 block`}><option value="">All PMs</option>{managers.map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="text-xs font-semibold">Allocation status<select value={status} onChange={event => setStatus(event.target.value)} disabled={!!editing} className={`${inputClass} mt-1 block`}><option value="">All statuses</option>{['Needs allocation', 'Allocated', 'Estimate changed', 'Needs source review'].map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="text-xs font-semibold">12 months starting<input type="month" value={start} min="2000-01" max="2099-01" onChange={event => { if (/^20\d\d-(0[1-9]|1[0-2])$/.test(event.target.value)) setStart(event.target.value); }} className={`${inputClass} mt-1 block`} /></label>
        </div>
        <div className="overflow-x-auto rounded border border-slate-200 bg-white"><table className="w-full text-sm">
          <caption className="p-3 text-left text-xs text-slate-500">Saved monthly estimates for the filtered jobs. Allocation totals include all months, including those outside this view.</caption>
          <thead className="bg-slate-100 text-left text-xs text-slate-600"><tr><th className="sticky left-0 z-10 min-w-72 bg-slate-100 p-3">Project / PM</th><th className="min-w-36 p-3 text-right">Estimated hours<br />excluding PM</th><th className="min-w-48 p-3">Allocation</th>{months.map(month => <th key={month} className="min-w-28 p-3 text-right">{monthLabel(month)}</th>)}</tr></thead>
          <tbody>{visible.map(project => {
            const plan = project.plan;
            const outside = plan?.allocations.filter(value => !months.includes(value.month)).length || 0;
            return <Fragment key={project.key}><tr className="border-t border-slate-200 align-top hover:bg-slate-50">
              <td className="sticky left-0 z-10 bg-white p-3"><p className="font-bold">{project.projectName}</p><p className="mt-1 text-xs text-slate-500">{[project.projectNumber, project.customer].filter(Boolean).join(' · ')}</p><p className="mt-1 text-xs text-slate-600">{project.projectManager}</p></td>
              <td className="p-3 text-right"><p className="font-bold">{hours.format(project.source.allocatableHours)}</p><p className="mt-1 text-xs text-slate-500">{hours.format(project.source.estimatedHours)} − {hours.format(project.source.projectManagementHours)} PM</p>{plan && !sameWipSource(project.source, plan.source) && <p className="mt-2 text-xs text-amber-800">Saved plan: {hours.format(plan.source.allocatableHours)} h</p>}</td>
              <td className="p-3"><p className={`font-semibold ${wipPlanStatus(project) === 'Allocated' ? 'text-teal-800' : 'text-amber-800'}`}>{wipPlanStatus(project)}</p>{project.issue && <p className="mt-1 max-w-64 text-xs text-amber-800">{project.issue}</p>}{plan && <><p className="mt-1 text-xs">{allocationPercent(plan.allocations)}% allocated</p>{outside > 0 && <p className="mt-1 text-xs text-slate-500">{outside} month(s) outside view</p>}<p className="mt-1 text-xs text-slate-500">{new Date(plan.updatedAt).toLocaleDateString()} · {plan.updatedBy}</p></>}
                {!project.issue && <button onClick={() => { setEditing(project.key); setNotice(''); }} disabled={!!editing} className={`${buttonClass} mt-3`}>{plan ? 'Edit allocation' : 'Allocate months'}</button>}</td>
              {months.map(month => { const allocation = plan?.allocations.find(value => value.month === month); return <td key={month} className="p-3 text-right">{allocation ? <><p className="font-bold">{hours.format(allocationHours(plan!.source.allocatableHours, allocation.percent))} h</p><p className="mt-1 text-xs text-slate-500">{allocation.percent}%</p></> : <span className="text-slate-300">—</span>}</td>; })}
            </tr>{editing === project.key && <tr className="border-t border-teal-200 bg-teal-50/50"><td colSpan={15}><PlanEditor project={project} onCancel={() => setEditing(null)} onSaved={saved => { setProjects(values => values.map(value => value.key === project.key ? { ...value, plan: saved } : value)); setEditing(null); setNotice(`Saved ${project.projectName} — 100% allocated.`); }} /></td></tr>}</Fragment>;
          })}{!visible.length && <tr><td colSpan={15} className="p-10 text-center text-slate-500">{projects.length ? 'No jobs match these filters.' : 'No In Progress jobs are available yet. Jobs appear here after their Bid Board status synchronizes.'}</td></tr>}</tbody>
          <tfoot className="border-t-2 border-slate-300 bg-teal-50 font-bold"><tr><td className="sticky left-0 bg-teal-50 p-3">Monthly workload · {visible.length} jobs</td><td className="p-3 text-right">{hours.format(totalHours)} h</td><td className="p-3 text-xs font-normal">Saved allocations only</td>{months.map(month => <td key={month} className="p-3 text-right">{hours.format(visible.reduce((sum, project) => sum + (project.plan ? allocationHours(project.plan.source.allocatableHours, project.plan.allocations.find(value => value.month === month)?.percent || 0) : 0), 0))} h</td>)}</tr></tfoot>
        </table></div>
      </>}
    </div>
  </main>;
}
