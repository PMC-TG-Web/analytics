'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { filterSteelProjects, steelOrderQuantities, type SteelItem, type SteelProject, type SteelReport } from '@/lib/steelNeeds';
import { steelEasternDay, steelOrdersCsv, steelOrdersInRange } from '@/lib/steelOrderExport';
import BuyingList from './BuyingList';
import JobList from './JobList';
import OrderEntry, { type SteelOrderChange } from './OrderEntry';
import { month } from './format';

// 16px fields on phones stop iOS from zooming in when one is tapped.
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 sm:text-sm';
const button = 'rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-center text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40 sm:py-2';
const label = 'text-xs font-semibold text-slate-600';

export default function SteelNeedsPage() {
  const [report, setReport] = useState<SteelReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Set<string>>(new Set());
  const pendingKeys = useRef(new Set<string>());
  const saving = pending.size > 0;
  const [saveError, setSaveError] = useState('');
  const [view, setView] = useState<'jobs' | 'buying'>('jobs');
  const [hideOrdered, setHideOrdered] = useState(false);
  // Phones fold every filter except search behind this; wider screens fold only the three less-used ones.
  const [showFilters, setShowFilters] = useState(false);
  // The export covers orders recorded in this Eastern date range; it opens on today.
  const today = () => steelEasternDay(new Date());
  const [orderFrom, setOrderFrom] = useState(today);
  const [orderTo, setOrderTo] = useState(today);
  // Jobs start collapsed to their one-line summary; only the ones opened here show their materials.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const expandJobs = (keys: string[], expand: boolean) => setExpanded(previous => {
    const next = new Set(previous);
    for (const key of keys) { if (expand) next.add(key); else next.delete(key); }
    return next;
  });
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState('');
  const [through, setThrough] = useState('');
  const [timing, setTiming] = useState('');
  async function reload() {
    if (pendingKeys.current.size) return;
    setLoading(true); setError(''); setSaveError('');
    try {
      const response = await fetch('/api/steel-needs', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to load Steel needs.');
      setReport(body);
    } catch (err) { setReport(null); setError(err instanceof Error ? err.message : 'Unable to load Steel needs.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);
  async function saveOrder(project: SteelProject, item: SteelItem, change: SteelOrderChange) {
    const key = JSON.stringify([project.key, item.key]);
    if (pendingKeys.current.has(key) || !project.projectId) return false;
    pendingKeys.current.add(key);
    setPending(previous => new Set(previous).add(key)); setSaveError('');
    try {
      const response = await fetch('/api/steel-needs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        projectId: project.projectId, itemKey: item.key, quantity: item.quantity, revision: item.order?.revision || 0, orderSnapshot: item.orderSnapshot,
        ...('orderedQuantity' in change ? { ...change, ordered: change.orderedQuantity > 0 } : change),
      }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to save the order.');
      // Only a confirmed save changes totals, the log and exports.
      setReport(previous => previous ? { ...previous, projects: previous.projects.map(row => row.key === project.key ? {
        ...row, items: row.items.map(material => material.key === item.key ? { ...material, order: body.order, log: body.log || [] } : material),
      } : row) } : previous);
      return true;
    } catch (err) {
      setSaveError(`${project.projectName} · ${item.description}: ${err instanceof Error ? err.message : 'Unable to save the order. Refresh saved data before retrying.'}`);
      return false;
    } finally {
      pendingKeys.current.delete(key);
      setPending(previous => { const next = new Set(previous); next.delete(key); return next; });
    }
  }
  const orderEntry = (project: SteelProject, item: SteelItem) => <OrderEntry key={JSON.stringify([project.key, item.key])} item={item} project={project} disabled={loading}
    saving={pending.has(JSON.stringify([project.key, item.key]))} onSave={change => saveOrder(project, item, change)} />;
  const projects = filterSteelProjects(report?.projects || [], { status, kind, query, projectId, through, timing });
  // The export follows the job filters but never Hide fully ordered: a fully ordered material is exactly what was just ordered.
  const filtered = [status, kind, query, projectId, through, timing].some(Boolean);
  const orderRange = { from: orderFrom, to: orderTo }, ordered = steelOrdersInRange(projects, orderRange);
  const exportNote = !ordered.valid ? 'The first date is after the second.' : !ordered.orders ? `No orders recorded in these dates${filtered ? ' for the filtered jobs' : ''}.`
    : `${ordered.orders} ${ordered.orders === 1 ? 'order' : 'orders'} from ${ordered.jobs} ${ordered.jobs === 1 ? 'job' : 'jobs'}${filtered ? ', within the filters below' : ''}.`;
  const withSteel = projects.filter(project => project.items.length);
  const withLeft = withSteel.filter(project => project.items.some(item => steelOrderQuantities(item).toOrderQuantity > 0));
  const needsReview = projects.filter(project => project.issues.length);
  const currentMonth = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', timeZone: 'America/New_York' }).format(new Date());
  const moreFilters = [status, kind, timing].filter(Boolean).length, phoneFilters = moreFilters + [projectId, through].filter(Boolean).length;
  const folded = showFilters ? '' : 'hidden sm:block';
  function download() {
    if (pendingKeys.current.size || !ordered.orders) return;
    const csv = steelOrdersCsv(projects, orderRange);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const span = [orderFrom || 'earliest', orderTo || 'latest'];
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `steel-orders-${span[0] === span[1] ? span[0] : span.join('_to_')}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="mx-auto max-w-[1600px] space-y-4 p-3 text-slate-900 sm:space-y-6 sm:p-8">
    <header className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
      <div><p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-sky-700">Material planning</p><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Steel needs</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600 sm:mt-2">What each In Progress job needs in rebar and wire, what has been ordered, and what is left to order.</p></div>
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap"><Link href="/help/steel-needs" className={button}>Info / Help</Link>
        <button className={button} onClick={() => void reload()} disabled={loading || saving}>{loading ? 'Loading…' : 'Refresh saved data'}</button></div>
    </header>
    <section aria-label="Export orders" className="grid grid-cols-2 items-end gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex sm:flex-wrap sm:px-5 sm:py-4">
      <div className="col-span-2 min-w-0 sm:flex-1"><h2 className="text-sm font-bold">Export what was ordered</h2><p role="status" className="text-xs text-slate-500">{exportNote}</p></div>
      <label className={label}>Orders from<input aria-label="Orders from" type="date" className={`${input} mt-1`} value={orderFrom} onChange={event => setOrderFrom(event.target.value)} /></label>
      <label className={label}>Through<input aria-label="Orders through" type="date" className={`${input} mt-1`} value={orderTo} onChange={event => setOrderTo(event.target.value)} /></label>
      <button className={button} onClick={() => { setOrderFrom(today()); setOrderTo(today()); }}>Today</button>
      <button className="rounded-lg bg-sky-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-900 disabled:opacity-40 sm:py-2" disabled={loading || saving || !!error || !ordered.orders} onClick={download}>Export orders{ordered.orders > 0 && ` (${ordered.orders})`}</button>
    </section>
    <p className="hidden rounded-xl border border-sky-200 bg-sky-50 px-5 py-3 text-sm text-sky-950 sm:block"><strong>Needed</strong> is the full estimate. <strong>Ordered</strong> is every order recorded here. <strong>Left to order</strong> is the difference, job by job. Steel used, delivered or in stock is not deducted.</p>
    {report?.localOnly && <p role="status" className="rounded-lg bg-amber-100 p-3 text-sm">WIP dates are from this computer’s local planning file.</p>}
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>}
    {saveError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{saveError}</div>}
    <section aria-label="Steel needs filters" className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 sm:space-y-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-6">
        <label className={`${label} lg:col-span-2`}>Search material or job<input aria-label="Search material or job" className={`${input} mt-1`} value={query} onChange={event => setQuery(event.target.value)} placeholder="Rebar size, wire gauge, job…" /></label>
        <label className={`${label} lg:col-span-2 ${folded}`}>Job<select aria-label="Job" className={`${input} mt-1`} value={projectId} onChange={event => { setProjectId(event.target.value); if (event.target.value) expandJobs([event.target.value], true); }}><option value="">All In Progress jobs</option>{report?.projects.map(project => <option key={project.key} value={project.key}>{project.projectNumber ? `${project.projectNumber} · ` : ''}{project.projectName}</option>)}</select></label>
        <label className={`${label} ${folded}`}>Starting by<input aria-label="Starting by" type="month" className={`${input} mt-1`} value={through} disabled={timing === 'unscheduled'} onChange={event => setThrough(event.target.value)} /></label>
        <label className="flex items-center gap-2 py-1 text-sm font-semibold text-slate-800 sm:self-end sm:pb-2"><input type="checkbox" className="h-5 w-5 accent-sky-800 sm:h-4 sm:w-4" checked={hideOrdered} onChange={event => setHideOrdered(event.target.checked)} />Hide fully ordered</label>
      </div>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <button type="button" aria-expanded={showFilters} onClick={() => setShowFilters(value => !value)} className="flex items-center gap-2 py-2.5 text-sm font-semibold text-sky-900 sm:py-0">
            <span aria-hidden="true">{showFilters ? '▾' : '▸'}</span>
            <span className="sm:hidden">Filters{phoneFilters > 0 && ` (${phoneFilters} on)`}</span>
            <span className="hidden sm:inline">More filters{moreFilters > 0 && ` (${moreFilters} on)`}</span>
          </button>
          {showFilters && <>
            <div className="mt-3 grid gap-3 sm:grid-cols-3 sm:gap-4">
              <label className={label}>Field work<select aria-label="Field work" className={`${input} mt-1`} value={status} onChange={event => setStatus(event.target.value)}><option value="">Started + not started</option><option value="not-started">Not started</option><option value="started">Started</option></select></label>
              <label className={label}>Material<select aria-label="Material" className={`${input} mt-1`} value={kind} onChange={event => setKind(event.target.value)}><option value="">Rebar + wire</option><option>Rebar</option><option>Wire</option></select></label>
              <label className={label}>WIP plan<select aria-label="WIP plan" className={`${input} mt-1`} value={timing} onChange={event => { setTiming(event.target.value); if (event.target.value === 'unscheduled') setThrough(''); }}><option value="">All jobs</option><option value="unscheduled">No start month only</option></select></label>
            </div>
            <p className="mt-2 text-xs text-slate-500">Starting by leaves out jobs with no start month.</p>
          </>}
        </div>
        <button className={button} onClick={() => { setStatus(''); setKind(''); setQuery(''); setProjectId(''); setThrough(''); setTiming(''); setHideOrdered(false); }}>Clear filters</button>
      </div>
    </section>
    {loading ? <p role="status" className="py-10 text-center text-slate-600">Loading estimates, WIP plans and field entries…</p> : !error && <>
      <section aria-label="Filtered summary" className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">{([
        ['Jobs with steel', withSteel.length], ['Jobs with steel left to order', withLeft.length],
        [`Left to order · starting by ${month(currentMonth)}`, withLeft.filter(project => project.plannedStart && project.plannedStart <= currentMonth).length],
        ['Jobs fully ordered', withSteel.length - withLeft.length],
      ] as const).map(([name, value]) => <div key={name} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 sm:block sm:px-5 sm:py-4"><p className="text-xs font-medium text-slate-500">{name}</p><p className="text-xl font-bold tabular-nums sm:mt-1 sm:text-3xl">{value}</p></div>)}</section>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-3 sm:gap-3 sm:p-4">
          <div className="flex w-full rounded-lg bg-slate-100 p-1 sm:w-auto" aria-label="Report view">{(['jobs', 'buying'] as const).map(value => <button key={value} aria-pressed={view === value} onClick={() => setView(value)} className={`flex-1 rounded-md px-4 py-2.5 text-sm font-semibold sm:flex-none sm:py-2 ${view === value ? 'bg-white text-sky-900 shadow-sm' : 'text-slate-500'}`}>{value === 'jobs' ? 'By job' : 'Buying list'}</button>)}</div>
          <p className="text-xs text-slate-500">{saving ? 'Saving… totals update when confirmed.' : view === 'jobs' ? 'Soonest planned start first. Record orders here.' : 'One line per material and unit, added up across the listed jobs.'}</p>
        </div>
        {view === 'jobs' ? <JobList projects={withSteel} hideOrdered={hideOrdered} currentMonth={currentMonth} expanded={expanded} onExpand={expandJobs} renderEntry={orderEntry} /> : <BuyingList projects={projects} hideOrdered={hideOrdered} />}
      </section>
      {needsReview.length > 0 && <details className="rounded-xl border border-amber-200 bg-amber-50 p-4"><summary className="cursor-pointer text-sm font-semibold text-amber-950">Planning / source review · {needsReview.length} jobs</summary><ul className="mt-3 space-y-2 text-sm text-amber-900">{needsReview.map(project => <li key={project.key}><strong>{project.projectName}:</strong> {project.issues.join(' ')}</li>)}</ul></details>}
      <p className="text-xs text-slate-500">Read from saved data {report && new Date(report.loadedAt).toLocaleString()}. Refresh rereads the database; it does not sync Procore. Uses the same selected estimate and job list as WIP. See Info / Help for grouping and source rules.</p>
    </>}
  </main>;
}
