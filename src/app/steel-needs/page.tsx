'use client';

import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { aggregateSteelNeeds, filterSteelProjects, steelNeedsCsv, steelOrderedDate, type SteelItem, type SteelProject, type SteelReport } from '@/lib/steelNeeds';

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
const month = (value: string | null) => value ? new Date(`${value}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Unscheduled';
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
const button = 'rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40';
const td = 'px-4 py-3';
const th = 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500';
function Status({ project }: { project: SteelProject }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${project.started === null ? 'bg-amber-100 text-amber-900' : project.started ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'}`}>{project.started === null ? 'Unlinked' : project.started ? 'Started' : 'Not started'}</span>;
}

function OrderedCheck({ item, project, disabled, saving, onChange }: { item: SteelItem; project: SteelProject; disabled: boolean; saving: boolean; onChange: (ordered: boolean) => void }) {
  return <div className="min-w-32 text-left"><label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium"><input
    type="checkbox" className="h-4 w-4 accent-sky-800" aria-label={`Ordered ${item.description} for ${project.projectName}`}
    checked={!!item.order?.orderedAt} disabled={disabled || !project.projectId} onChange={event => onChange(event.target.checked)} />Ordered</label>
    {saving ? <p role="status" className="text-xs text-slate-500">Saving…</p> : item.order?.orderedAt && <p className="mt-1 text-xs text-slate-500">{steelOrderedDate(item.order.orderedAt)}</p>}
    {item.order?.orderedAt && item.order.quantity !== item.quantity && <p className="mt-1 max-w-44 text-xs text-amber-800">Estimate changed since marked. Review, then uncheck/recheck to confirm.</p>}
  </div>;
}

export default function SteelNeedsPage() {
  const [report, setReport] = useState<SteelReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const [saveError, setSaveError] = useState('');
  const [view, setView] = useState<'materials' | 'projects'>('materials');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState('');
  const [through, setThrough] = useState('');
  const [timing, setTiming] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  async function reload() {
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
  async function markOrdered(project: SteelProject, item: SteelItem, ordered: boolean) {
    if (saving || !project.projectId) return;
    setSaving(JSON.stringify([project.key, item.key])); setSaveError('');
    try {
      const response = await fetch('/api/steel-needs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        projectId: project.projectId, itemKey: item.key, quantity: item.quantity, ordered, revision: item.order?.revision || 0,
      }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to save the order mark.');
      setReport(previous => previous ? { ...previous, projects: previous.projects.map(row => row.key === project.key ? {
        ...row, items: row.items.map(material => material.key === item.key ? { ...material, order: body.order } : material),
      } : row) } : previous);
    } catch (err) { setSaveError(err instanceof Error ? err.message : 'Unable to save the order mark. Refresh saved data before retrying.'); }
    finally { setSaving(''); }
  }
  const orderedCheck = (project: SteelProject, item: SteelItem) => <OrderedCheck item={item} project={project} disabled={loading || !!saving}
    saving={saving === JSON.stringify([project.key, item.key])} onChange={ordered => void markOrdered(project, item, ordered)} />;
  const projects = filterSteelProjects(report?.projects || [], { status, kind, query, projectId, through, timing });
  const totals = aggregateSteelNeeds(projects);
  const withSteel = projects.filter(project => project.items.length);
  const needsReview = projects.filter(project => project.issues.length);
  const currentMonth = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', timeZone: 'America/New_York' }).format(new Date());
  const toggle = (key: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  function download() {
    const url = URL.createObjectURL(new Blob([steelNeedsCsv(projects)], { type: 'text/csv;charset=utf-8;' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'steel-needs-estimated-quantities.csv'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="mx-auto max-w-[1600px] space-y-6 p-4 text-slate-900 sm:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-sky-700">Material planning</p><h1 className="text-3xl font-bold tracking-tight">Steel needs</h1><p className="mt-2 max-w-3xl text-sm text-slate-600">Full estimated rebar and wire quantities for In Progress WIP projects, grouped by description and unit.</p></div>
      <div className="flex flex-wrap gap-2"><Link href="/help/steel-needs" className={button}>Info / Help</Link><button className={button} onClick={() => void reload()} disabled={loading || !!saving}>{loading ? 'Loading…' : 'Refresh saved data'}</button><button className="rounded-lg bg-sky-800 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-900 disabled:opacity-40" disabled={loading || !!saving || !!error || !totals.length} onClick={download}>Export order worksheet</button></div>
    </header>
    <div className="rounded-xl border border-sky-200 bg-sky-50 px-5 py-4 text-sm text-sky-950"><strong>Planning basis: full estimate.</strong> Quantities are not reduced by daily logs, deliveries, previous orders or stock on hand. Confirm those before ordering. Started means at least one saved daily-log or timesheet entry; planned start is the first saved WIP allocation month. Check Ordered beside a project’s material to save a shared date stamp; uncheck to clear it.</div>
    {report?.localOnly && <p role="status" className="rounded-lg bg-amber-100 p-3 text-sm">WIP dates are from this computer’s local planning file.</p>}
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>}
    {saveError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{saveError}</div>}
    <section aria-label="Steel needs filters" className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2 lg:grid-cols-6">
      <label className="text-xs font-semibold text-slate-600 lg:col-span-2">Search description or project<input aria-label="Search description or project" className={`${input} mt-1`} value={query} onChange={event => setQuery(event.target.value)} placeholder="Rebar size, wire gauge, project…" /></label>
      <label className="text-xs font-semibold text-slate-600">Project status<select aria-label="Project status" className={`${input} mt-1`} value={status} onChange={event => setStatus(event.target.value)}><option value="">Started + not started</option><option value="not-started">Not started</option><option value="started">Started</option></select></label>
      <label className="text-xs font-semibold text-slate-600">Material<select aria-label="Material" className={`${input} mt-1`} value={kind} onChange={event => setKind(event.target.value)}><option value="">Rebar + wire</option><option>Rebar</option><option>Wire</option></select></label>
      <label className="text-xs font-semibold text-slate-600 lg:col-span-2">Project<select aria-label="Project" className={`${input} mt-1`} value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">All WIP projects</option>{report?.projects.map(project => <option key={project.key} value={project.key}>{project.projectNumber ? `${project.projectNumber} · ` : ''}{project.projectName}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-600">Planned start through<input aria-label="Planned start through" type="month" className={`${input} mt-1`} value={through} disabled={timing === 'unscheduled'} onChange={event => setThrough(event.target.value)} /></label>
      <label className="text-xs font-semibold text-slate-600">WIP timing<select aria-label="WIP timing" className={`${input} mt-1`} value={timing} onChange={event => { setTiming(event.target.value); if (event.target.value === 'unscheduled') setThrough(''); }}><option value="">All timing</option><option value="unscheduled">Unscheduled only</option></select></label>
      <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4"><button className={button} onClick={() => { setStatus('not-started'); setThrough(currentMonth); setTiming(''); }}>Not started · due by this month</button><button className={button} onClick={() => { setStatus(''); setKind(''); setQuery(''); setProjectId(''); setThrough(''); setTiming(''); }}>Clear filters</button><span className="pb-2 text-xs text-slate-500">A start-month cutoff excludes unscheduled projects.</span></div>
    </section>
    {loading ? <p role="status" className="py-10 text-center text-slate-600">Loading estimates, WIP plans and field entries…</p> : !error && <>
      <section aria-label="Filtered summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
        ['Material descriptions / units', totals.length], ['Projects with steel', withSteel.length], ['Not started with steel', withSteel.filter(p => p.started === false).length], ['Started with steel', withSteel.filter(p => p.started === true).length],
      ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white px-5 py-4"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-3xl font-bold tabular-nums">{value}</p></div>)}</section>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4"><div className="flex rounded-lg bg-slate-100 p-1" aria-label="Report view">{(['materials', 'projects'] as const).map(value => <button key={value} aria-pressed={view === value} onClick={() => setView(value)} className={`rounded-md px-4 py-2 text-sm font-semibold ${view === value ? 'bg-white text-sky-900 shadow-sm' : 'text-slate-500'}`}>{value === 'materials' ? 'By description' : 'By project'}</button>)}</div><p className="text-xs text-slate-500">Full estimate quantities · units stay separate</p></div>
        {view === 'materials' ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm" aria-label="Steel totals by description"><thead className="bg-slate-50"><tr><th className={th}>Description</th><th className={th}>Unit</th><th className={`${th} text-right`}>Not started</th><th className={`${th} text-right`}>Started</th><th className={`${th} text-right`}>Total estimate</th><th className={`${th} text-right`}>Projects</th><th className={th}>Ordered</th></tr></thead><tbody>{totals.map(item => <Fragment key={item.key}><tr className="border-t border-slate-100 hover:bg-slate-50"><td className={td}><button aria-expanded={expanded.has(item.key)} className="text-left font-semibold text-sky-900 hover:underline" onClick={() => toggle(item.key)}>{expanded.has(item.key) ? '▾' : '▸'} {item.description}</button><p className="mt-1 pl-4 text-xs text-slate-500">{item.kind}</p></td><td className={td}>{item.unit}</td><td className={`${td} text-right tabular-nums`}>{number.format(item.notStartedQuantity)}</td><td className={`${td} text-right tabular-nums`}>{number.format(item.startedQuantity)}</td><td className={`${td} text-right font-bold tabular-nums`}>{number.format(item.quantity)}</td><td className={`${td} text-right`}>{item.projects.length}</td><td className={td}><span className={item.projects.every(row => row.order?.orderedAt) ? "font-semibold text-emerald-700" : "text-slate-500"}>{item.projects.filter(row => row.order?.orderedAt).length} / {item.projects.length} projects</span></td></tr>{expanded.has(item.key) && <tr><td colSpan={7} className="bg-slate-50 p-4"><table className="w-full text-sm" aria-label={`Projects for ${item.description}`}><thead><tr><th className={th}>Project</th><th className={th}>Status</th><th className={th}>WIP start</th><th className={`${th} text-right`}>Estimated quantity</th><th className={th}>Ordered / date</th></tr></thead><tbody>{item.projects.map(row => <tr key={row.project.key} className="border-t border-slate-200"><td className={td}><p className="font-medium">{row.project.projectName}</p><p className="text-xs text-slate-500">{row.project.projectNumber} · {row.project.customer}</p></td><td className={td}><Status project={row.project} /></td><td className={td}>{month(row.project.plannedStart)}{row.project.planChanged && <span className="block text-xs text-amber-800">Review WIP basis</span>}</td><td className={`${td} text-right font-semibold tabular-nums`}>{number.format(row.quantity)} {row.unit}</td><td className={td}>{orderedCheck(row.project, row)}</td></tr>)}</tbody></table></td></tr>}</Fragment>)}</tbody></table>{!totals.length && <p className="p-10 text-center text-slate-500">No steel quantities match these filters. Check project source issues below.</p>}</div> : <div className="divide-y divide-slate-200">{projects.map(project => <details key={project.key} className="group p-4"><summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3"><div><span className="mr-2 text-slate-400 group-open:hidden">▸</span><span className="mr-2 hidden text-slate-400 group-open:inline">▾</span><span className="font-semibold">{project.projectName}</span><p className="mt-1 text-xs text-slate-500">{project.projectNumber} · {project.customer}</p></div><div className="flex flex-wrap items-center gap-4 text-sm"><Status project={project} /><span>WIP start: <strong>{month(project.plannedStart)}</strong></span><span className="text-slate-500">{project.items.length} items</span></div></summary><div className="mt-4 space-y-3"><p className="text-xs text-slate-600">{project.dailyLogs} daily-log entries · {project.timesheets} timesheet entries · First field entry: {project.firstActivity || 'None'} · Estimate synchronized: {project.estimateSyncedAt ? new Date(project.estimateSyncedAt).toLocaleString() : 'Unavailable'}</p>{project.started === false && project.plannedStart && project.plannedStart < currentMonth && <p className="text-sm text-amber-800">Planned start is in the past with no field entries. Review the WIP plan or source sync.</p>}{project.issues.map(issue => <p key={issue} className="text-sm text-amber-800">{issue}</p>)}<div className="overflow-x-auto"><table className="w-full text-sm" aria-label={`Steel for ${project.projectName}`}><thead className="bg-slate-50"><tr><th className={th}>Description</th><th className={th}>Unit</th><th className={`${th} text-right`}>Full estimate</th><th className={th}>Ordered / date</th></tr></thead><tbody>{project.items.map(item => <tr key={item.key} className="border-t border-slate-100"><td className={td}>{item.description}</td><td className={td}>{item.unit}</td><td className={`${td} text-right font-semibold tabular-nums`}>{number.format(item.quantity)}</td><td className={td}>{orderedCheck(project, item)}</td></tr>)}</tbody></table></div>{!project.items.length && <p className="text-sm text-slate-500">No matching steel quantities available. Review any source issues above.</p>}</div></details>)}{!projects.length && <p className="p-10 text-center text-slate-500">No projects match these filters.</p>}</div>}
      </section>
      {needsReview.length > 0 && <details className="rounded-xl border border-amber-200 bg-amber-50 p-4"><summary className="cursor-pointer text-sm font-semibold text-amber-950">Planning / source review · {needsReview.length} projects</summary><ul className="mt-3 space-y-2 text-sm text-amber-900">{needsReview.map(project => <li key={project.key}><strong>{project.projectName}:</strong> {project.issues.join(' ')}</li>)}</ul></details>}
      <p className="text-xs text-slate-500">Read from saved data {report && new Date(report.loadedAt).toLocaleString()}. Refresh rereads the database; it does not sync Procore. Uses the same selected estimate and active project list as WIP. Change-order estimates are not added. See Info / Help for grouping and source rules.</p>
    </>}
  </main>;
}
