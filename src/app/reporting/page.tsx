'use client';

import { useState } from 'react';
import { usagePeriod, type ProjectUsageReport } from '@/lib/projectUsageReport';

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 4 });

export default function ReportingPage() {
  const [from, setFrom] = useState('');
  const [through, setThrough] = useState('');
  const [report, setReport] = useState<ProjectUsageReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const changed = report && (report.from !== from || report.through !== through);
  const projects = report?.projects.filter(p => `${p.projectName} ${p.projectNumber} ${p.customer} ${p.projectId}`.toLowerCase().includes(search.toLowerCase())) || [];

  async function run() {
    setError('');
    try { usagePeriod(from, through); } catch (e) { setError((e as Error).message); return; }
    setLoading(true); setReport(null); setSelected(null);
    try {
      const response = await fetch(`/api/reporting/project-usage?${new URLSearchParams({ from, through })}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load the report. Please retry.');
      setReport(data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load the report. Please retry.'); }
    finally { setLoading(false); }
  }
  async function download() {
    if (!report || changed) return;
    setDownloading(true); setError('');
    try { (await import('@/lib/projectUsageWorkbook')).downloadProjectUsageWorkbook(report); }
    catch { setError('Unable to create the Excel file. Please try again.'); }
    finally { setDownloading(false); }
  }

  return <main className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-8">
    <header>
      <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Reporting</p>
      <h1 className="mt-1 text-3xl font-bold text-slate-900">Project labor &amp; materials</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">Actual labor hours and material quantities used across all projects. Preview the saved records, then download an Excel workbook with project totals and item details.</p>
    </header>
    <section aria-label="Report settings" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end gap-4">
        <div><label htmlFor="report-from" className="mb-1 block text-sm font-medium">From work date</label><input id="report-from" type="date" value={from} disabled={loading} onChange={e => setFrom(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" /></div>
        <div><label htmlFor="report-through" className="mb-1 block text-sm font-medium">Through work date</label><input id="report-through" type="date" value={through} disabled={loading} onChange={e => setThrough(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" /></div>
        <button onClick={() => { setFrom(''); setThrough(''); }} disabled={loading} className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">All dates</button>
        <button onClick={run} disabled={loading} className="rounded-lg bg-blue-700 px-5 py-2 font-semibold text-white hover:bg-blue-800 disabled:opacity-50">{loading ? 'Loading report…' : 'Run report'}</button>
        <button onClick={download} disabled={!report || !!changed || loading || downloading} className="rounded-lg bg-emerald-700 px-5 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-40">{downloading ? 'Creating Excel…' : 'Download Excel'}</button>
      </div>
      <p className="mt-3 text-sm text-slate-500">All projects are included. Leave dates blank for all saved history. Downloads include every project, regardless of the preview search.</p>
      {changed && <p role="status" className="mt-3 text-sm font-medium text-amber-800">Dates changed. Run the report again before downloading.</p>}
    </section>
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>}
    {loading && <p role="status" className="p-8 text-center text-slate-600">Reading saved timecards and material usage…</p>}
    {!report && !loading && <section className="rounded-xl border border-dashed border-slate-300 p-8 text-slate-600">
      <h2 className="font-semibold text-slate-900">One workbook for all projects</h2>
      <p className="mt-2 text-sm">Projects, Labor, Materials, Other quantities, Review, and Report notes. Material rows retain their individual items and units. Run the report to get started.</p>
    </section>}
    {report && <>
      <section className="grid gap-4 sm:grid-cols-3" aria-label="Report totals">
        {[
          ['Projects', number(report.projects.length)],
          ['Timecard hours', number(report.projects.reduce((n, p) => n + p.timecardHours, 0))],
          ['Daily-log labor hours', number(report.projects.reduce((n, p) => n + p.dailyLogHours, 0))],
        ].map(([label, value]) => <article key={label} className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-600">{label}</p><strong className="mt-2 block text-2xl text-slate-900">{value}</strong></article>)}
      </section>
      <p className="text-sm text-slate-600">Timecard and daily-log hours may overlap. Subcontractor hours are included and identified in the workbook. Material quantities remain separate by item and unit.</p>
      {report.review.length > 0 && <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{number(report.review.length)} grouped items need review because their project, quantity, coding, or units are unresolved. See the Review sheet in Excel; these items are excluded from labor and material totals.</p>}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
          <div><h2 className="font-semibold text-slate-900">Projects</h2><p className="mt-1 text-xs text-slate-500">{report.from || 'All saved dates'} through {report.through || 'latest saved date'} · Loaded {new Date(report.loadedAt).toLocaleString()}</p></div>
          <label className="text-sm text-slate-600">Search preview<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Project, number, or customer" className="ml-2 max-w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600"><tr>{['Project', 'Status', 'Timecard hours', 'Daily-log hours', 'Material items', 'Review'].map(label => <th key={label} className="whitespace-nowrap px-5 py-3">{label}</th>)}</tr></thead>
          <tbody>{projects.map(p => <tr key={p.projectId} className="border-t border-slate-100 hover:bg-slate-50">
            <td className="px-5 py-3"><button onClick={() => setSelected(selected === p.projectId ? null : p.projectId)} className="text-left font-semibold text-blue-700 hover:underline" aria-expanded={selected === p.projectId}>{p.projectName}</button><p className="mt-1 text-xs text-slate-500">{[p.projectNumber, p.customer].filter(Boolean).join(' · ')}</p></td>
            <td className="px-5 py-3 text-slate-600">{p.status || '—'}</td>
            <td className="px-5 py-3 tabular-nums">{number(p.timecardHours)}</td><td className="px-5 py-3 tabular-nums">{number(p.dailyLogHours)}</td>
            <td className="px-5 py-3 tabular-nums">{p.materialLines}</td><td className="px-5 py-3 tabular-nums">{p.reviewLines || '—'}</td>
          </tr>)}</tbody>
        </table></div>
        {projects.length === 0 && <p className="p-8 text-center text-slate-500">{report.projects.length ? 'No projects match your search.' : 'No saved projects or usage records were found.'}</p>}
      </section>
      {selected !== null && <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">{report.projects.find(p => p.projectId === selected)?.projectName}: usage details</h2>
        {(['labor', 'materials', 'other', 'review'] as const).map(kind => {
          const lines = report[kind].filter(row => row.projectId === selected);
          return <div key={kind} className="mt-5"><h3 className="mb-2 font-medium">{{ labor: 'Labor hours', materials: 'Material quantities used', other: 'Other quantities', review: 'Items to review' }[kind]}</h3>
            {!lines.length ? <p className="text-sm text-slate-500">No included records.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left"><tr>{['Item / worker', 'Cost code', 'Source', 'Quantity', 'Unit', 'Note'].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{lines.map((r, i) => <tr key={i} className="border-t border-slate-100"><td className="p-3">{[r.description, r.worker].filter(Boolean).join(' / ') || 'Unassigned'}</td><td className="whitespace-nowrap p-3">{r.costCode || '—'}</td><td className="whitespace-nowrap p-3">{r.source}</td><td className="p-3 tabular-nums">{r.note === 'Missing or invalid quantity.' ? '—' : number(r.quantity)}</td><td className="p-3">{r.unit || '—'}</td><td className="p-3 text-slate-600">{r.note || r.laborType}</td></tr>)}</tbody></table></div>}
          </div>;
        })}
      </section>}
      <p className="text-xs text-slate-500">Saved data only. A zero does not confirm that no work occurred or that synchronization is complete. Deleted records and Billing File logs are excluded.</p>
    </>}
  </main>;
}
