'use client';

import { useMemo, useState } from 'react';
import { emptyHoursFilters, filterHourEntries, hoursReportCsv, hoursTotals, type HourEntry, type HoursReport } from '@/lib/hoursReport';
import { usagePeriod } from '@/lib/projectUsageReport';

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 4 });
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const button = 'rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-40';
const PAGE_SIZE = 100;

function EntryTable({ entries, review = false }: { entries: HourEntry[]; review?: boolean }) {
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm">
    <thead className="bg-slate-50 text-xs text-slate-600"><tr>{['Work date', 'Source', 'Project', 'Description / notes', 'Worker', 'Cost code', review ? 'Recorded quantity' : 'Hours', 'Status'].map(label => <th key={label} className="whitespace-nowrap px-4 py-3">{label}</th>)}</tr></thead>
    <tbody>{entries.map(row => <tr key={row.key} className="border-t border-slate-100 align-top">
      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{row.date}</td>
      <td className="px-4 py-3"><span className={`inline-block rounded-full px-2 py-1 text-xs font-semibold ${row.source === 'Timecard' ? 'bg-blue-50 text-blue-800' : 'bg-teal-50 text-teal-800'}`}>{row.source}</span><p className="mt-1 text-xs text-slate-500">{row.laborType}</p></td>
      <td className="min-w-44 px-4 py-3"><p className="font-medium">{row.projectName}</p><p className="mt-1 text-xs text-slate-500">{row.projectNumber || row.projectId || 'Unassigned'}</p></td>
      <td className="min-w-64 max-w-md whitespace-pre-wrap break-words px-4 py-3"><p className="font-medium">{row.description || 'No description'}</p>
        {row.logDescription && row.logDescription !== row.description && <p className="mt-1 text-xs text-slate-500">Daily log: {row.logDescription}</p>}
        {row.notes && <p className="mt-1 text-slate-600">{row.notes}</p>}{row.note && <p className="mt-1 text-xs text-amber-800">{row.note}</p>}
      </td>
      <td className="px-4 py-3">{row.worker || '—'}</td><td className="whitespace-nowrap px-4 py-3">{row.costCode || 'Unassigned'}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{review ? `${row.quantity == null ? 'Unknown' : number(row.quantity)} ${row.unit}` : number(row.hours!)}</td>
      <td className="px-4 py-3">{row.status}<p className="mt-1 text-xs text-slate-500">ID: {row.sourceId}</p></td>
    </tr>)}</tbody>
  </table></div>;
}

export default function HoursReportPage() {
  const [from, setFrom] = useState('');
  const [through, setThrough] = useState('');
  const [report, setReport] = useState<HoursReport | null>(null);
  const [filters, setFilters] = useState(emptyHoursFilters);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const entries = useMemo(() => filterHourEntries(report?.entries || [], filters), [report, filters]);
  const review = useMemo(() => filterHourEntries(report?.review || [], filters), [report, filters]);
  const totals = useMemo(() => hoursTotals(entries), [entries]);
  const projects = useMemo(() => [...new Map([...(report?.entries || []), ...(report?.review || [])].filter(row => row.projectId)
    .map(row => [row.projectId, { id: row.projectId, name: row.projectName, number: row.projectNumber }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)), [report]);
  const changed = !!report && (from !== report.from || through !== report.through);
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));

  async function run() {
    setError('');
    try { usagePeriod(from, through); } catch (e) { setError((e as Error).message); return; }
    setLoading(true); setReport(null); setPage(0);
    try {
      const response = await fetch(`/api/reporting/hours?${new URLSearchParams({ from, through })}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to load hours. Please retry.');
      setReport(body);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load hours. Please retry.'); }
    finally { setLoading(false); }
  }
  function download(rows: HourEntry[], name: string) {
    const url = URL.createObjectURL(new Blob(['\uFEFF', hoursReportCsv(rows)], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `${name}-${report?.from || 'all'}-${report?.through || 'dates'}.csv`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <main className="mx-auto max-w-[1600px] space-y-6 p-4 text-slate-900 sm:p-8">
    <header><p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Reporting</p>
      <h1 className="mt-1 text-3xl font-bold">All Hours</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">Timecard and productivity labor hours in one report. Filter work dates and descriptions, inspect individual entries, and export the matching rows.</p>
    </header>
    <section aria-label="Report filters" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <form onSubmit={e => { e.preventDefault(); void run(); }} className="flex flex-wrap items-end gap-4">
        <label className="block text-sm font-medium">From work date<input type="date" value={from} disabled={loading} onChange={e => setFrom(e.target.value)} className={`${field} mt-1`} /></label>
        <label className="block text-sm font-medium">Through work date<input type="date" value={through} disabled={loading} onChange={e => setThrough(e.target.value)} className={`${field} mt-1`} /></label>
        <button type="button" disabled={loading} onClick={() => { setFrom(''); setThrough(''); }} className={button}>All dates</button>
        <button type="submit" disabled={loading} className="rounded-lg bg-blue-700 px-5 py-2 font-semibold text-white hover:bg-blue-800 disabled:opacity-50">{loading ? 'Loading report…' : 'Run report'}</button>
      </form>
      <div className="mt-5 grid gap-4 border-t border-slate-100 pt-4 md:grid-cols-[2fr_2fr_1fr]">
        <label className="min-w-0 text-sm font-medium">Description or notes<input type="search" value={filters.description} onChange={e => { setFilters({ ...filters, description: e.target.value }); setPage(0); }} placeholder="e.g. foundations, project management" className={`${field} mt-1`} /></label>
        <div className="min-w-0 text-sm font-medium"><label htmlFor="hours-project">Project</label><select id="hours-project" value={filters.projectId} onChange={e => { setFilters({ ...filters, projectId: e.target.value }); setPage(0); }} className={`${field} mt-1`}><option value="">All projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.number || p.id})</option>)}{filters.projectId && !projects.some(p => p.id === filters.projectId) && <option value={filters.projectId}>Project {filters.projectId} (no entries)</option>}</select></div>
        <div className="text-sm font-medium"><label htmlFor="hours-source">Source</label><select id="hours-source" value={filters.source} onChange={e => { setFilters({ ...filters, source: e.target.value }); setPage(0); }} className={`${field} mt-1`}><option value="">Both sources</option><option>Timecard</option><option>Productivity</option></select></div>
      </div>
      <p className="mt-3 text-xs text-slate-500">Dates include both endpoints; leave blank for all saved history. Description searches cost-code/item descriptions and entry notes without matching case. Description, project, and source filters update totals and exports immediately.</p>
      {changed && <p role="status" className="mt-3 text-sm font-medium text-amber-800">Dates changed. Run report to update the results and enable downloads.</p>}
    </section>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
    {loading && <p role="status" className="p-8 text-center text-slate-600">Reading saved timecards and productivity entries…</p>}
    {!report && !loading && <p className="rounded-xl border border-dashed border-slate-300 p-8 text-slate-600">Choose any filters, then run the report to see all matching saved hours.</p>}
    {report && <>
      <section aria-label="Filtered totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
        ['Combined hours', number(totals.combined)], ['Timecard hours', number(totals.timecard)], ['Productivity hours', number(totals.productivity)], ['Matching entries', number(totals.count)],
      ].map(([label, value]) => <article key={label} className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-600">{label}</p><strong className="mt-2 block text-2xl">{value}</strong></article>)}</section>
      <p className="text-sm text-slate-600">Combined hours adds both recorded sources, including subcontractors and all non-deleted statuses. The same work may be recorded in both sources; review entries before treating the total as unique worked hours.</p>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5"><div><h2 className="font-semibold">Hour entries</h2>
          <p className="mt-1 text-xs text-slate-500">{report.from || 'All saved dates'} through {report.through || 'latest saved date'} · Loaded {new Date(report.loadedAt).toLocaleString()}</p></div>
          <button onClick={() => download(entries, 'all-hours')} disabled={changed || !entries.length} className={button}>Download CSV</button>
        </div>
        <EntryTable entries={entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)} />
        {!entries.length && <p className="p-8 text-center text-slate-500">No hours match these filters.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-sm text-slate-600"><span>{number(entries.length)} matching entries · Page {page + 1} of {pageCount} · CSV includes all matching entries</span><div className="flex gap-2"><button onClick={() => setPage(page - 1)} disabled={page === 0} className={button}>Previous</button><button onClick={() => setPage(page + 1)} disabled={page + 1 >= pageCount} className={button}>Next</button></div></div>
      </section>
      {review.length > 0 && <details className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50">
        <summary className="cursor-pointer p-5 font-semibold text-amber-900">Needs review: {number(review.length)} {review.length === 1 ? 'entry' : 'entries'} excluded from hours</summary>
        <div className="px-5 pb-4 text-sm text-amber-900"><p>Missing or ambiguous coding, project identity, units, or quantities prevent these entries from being counted as hours. The same description, project, and source filters apply.</p><button onClick={() => download(review, 'hours-review')} disabled={changed} className={`${button} mt-3`}>Download review CSV</button></div>
        <EntryTable entries={review.slice(0, PAGE_SIZE)} review />
        {review.length > PAGE_SIZE && <p className="p-4 text-sm text-amber-900">Showing the first {PAGE_SIZE} review entries. Download review CSV for all {number(review.length)}.</p>}
      </details>}
      <p className="text-xs text-slate-500">Reads saved synchronized data. Run report reloads saved entries; it does not start a Procore sync. For the loaded date range, excluded {number(report.excluded.deleted)} deleted/void entries, {number(report.excluded.billingLogs)} Billing File logs, and {number(report.excluded.nonLabor)} material/equipment/other quantities.</p>
    </>}
  </main>;
}
