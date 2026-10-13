'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { billingHoursCsv, type BillingHourRow } from '@/lib/billingAnalytics';

type Report = { rows: BillingHourRow[]; loadedAt: string; warnings: Record<string, number> };
const hours = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const monthLabel = (value: string) => new Date(`${value}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const fieldClass = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

export default function BillingAnalytics({ initialMonth }: { initialMonth: string }) {
  const [from, setFrom] = useState(`${initialMonth.slice(0, 4)}-01`);
  const [through, setThrough] = useState(initialMonth);
  const [projectId, setProjectId] = useState('');
  const [search, setSearch] = useState('');
  const [refresh, setRefresh] = useState(0);
  const requestKey = `${from}|${through}|${refresh}`;
  const [result, setResult] = useState<{ key: string; report: Report | null; error: string } | null>(null);
  const report = result?.key === requestKey ? result.report : null;
  const error = result?.key === requestKey ? result.error : '';
  const loading = result?.key !== requestKey;
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/accounting/billing-analytics?${new URLSearchParams({ from, through })}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load billing hours.');
        if (!controller.signal.aborted) setResult({ key: requestKey, report: data, error: '' });
      })
      .catch(reason => { if (!controller.signal.aborted) setResult({ key: requestKey, report: null, error: reason instanceof Error ? reason.message : 'Unable to load billing hours.' }); });
    return () => controller.abort();
  }, [from, through, requestKey]);

  const projects = useMemo(() => [...new Map((report?.rows || []).map(row => [row.projectId, { id: row.projectId, name: row.projectName, number: row.projectNumber }])).values()], [report]);
  const rows = useMemo(() => (report?.rows || []).filter(row => (!projectId || row.projectId === projectId)
    && `${row.projectName} ${row.projectNumber} ${row.costCode} ${row.costCodeName}`.toLowerCase().includes(search.trim().toLowerCase())), [report, projectId, search]);
  const totals = rows.reduce((sum, row) => ({ timesheet: sum.timesheet + row.timesheetHours, productivity: sum.productivity + row.productivityHours, total: sum.total + row.totalHours }), { timesheet: 0, productivity: 0, total: 0 });

  function exportCsv() {
    const url = URL.createObjectURL(new Blob(['\uFEFF', billingHoursCsv(rows)], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = `billing-subcontractor-hours-${from}-to-${through}.csv`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <main className="mx-auto max-w-[1600px] space-y-6 p-4 text-slate-900 md:p-8">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-teal-700">Billing • Subcontractor labor</p>
        <h1 className="mt-2 text-3xl font-bold">Billing analytics</h1>
        <p className="mt-2 text-sm text-slate-600">Subcontractor hours by project, month, and cost code.</p></div>
      <div className="flex gap-2">
        <button className={fieldClass} onClick={() => setRefresh(value => value + 1)} disabled={loading}>Reload report</button>
        <button className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" onClick={exportCsv} disabled={loading || !rows.length}>Export CSV</button>
      </div>
    </div>
    <section aria-label="Report filters" className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <label className="grid gap-1 text-xs font-semibold">From month<input className={fieldClass} type="month" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label className="grid gap-1 text-xs font-semibold">Through month<input className={fieldClass} type="month" value={through} onChange={e => setThrough(e.target.value)} /></label>
      <label className="grid min-w-60 gap-1 text-xs font-semibold">Project<select className={fieldClass} value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">All projects</option>{projects.map(project => <option key={project.id} value={project.id}>{project.number ? `${project.number} · ` : ''}{project.name}</option>)}{projectId && !projects.some(p => p.id === projectId) && <option value={projectId}>Selected project (no hours in range)</option>}</select></label>
      <label className="grid min-w-60 flex-1 gap-1 text-xs font-semibold">Search<input className={fieldClass} placeholder="Project or cost code…" value={search} onChange={e => setSearch(e.target.value)} /></label>
    </section>
    <div className="grid gap-4 sm:grid-cols-3">{[['Timesheet hours', totals.timesheet], ['Productivity hours', totals.productivity], ['Combined hours', totals.total]].map(([label, value]) =>
      <div key={label} className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-600">{label}</p><p className="mt-2 text-3xl font-bold tabular-nums">{loading || error ? '—' : hours(Number(value))}</p></div>)}</div>
    <div className="rounded-lg border border-teal-100 bg-teal-50 p-4 text-sm leading-relaxed text-teal-950">
      Timesheets include the worker <strong>Sub Contractor</strong>. Productivity includes approved <strong>Subcontractor Hours</strong> quantities, including the legacy lump-sum line. The combined column adds both sources. Expand a row to review dates, status, and source entries before billing.
    </div>
    {report && Object.values(report.warnings).some(Boolean) && <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
      {report.warnings.missingCostCode > 0 && <p>{report.warnings.missingCostCode} entries have no unique cost code; their hours appear under Unassigned.</p>}
      {report.warnings.missingProject > 0 && <p>{report.warnings.missingProject} entries are excluded because their Procore project ID is missing.</p>}
      {report.warnings.invalidHours > 0 && <p>{report.warnings.invalidHours} entries are excluded because their hours are missing or invalid.</p>}
      {report.warnings.unapprovedProductivity > 0 && <p>{report.warnings.unapprovedProductivity} productivity entries await approval and are excluded.</p>}
    </div>}
    {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-800">{error}</div> : loading ? <p role="status" className="py-10 text-center text-slate-500">Loading subcontractor hours…</p> : <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap justify-between gap-2 border-b border-slate-200 px-5 py-3 text-sm"><span className="font-semibold">{new Set(rows.map(row => row.projectId)).size} projects · {rows.length} monthly cost-code rows</span><span className="text-slate-500">Click a row to review entries</span></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-600"><tr>{['Project', 'Month', 'Cost code', 'Timesheet hours', 'Productivity hours', 'Combined hours'].map(label => <th key={label} className={`px-4 py-3 ${label.endsWith('hours') ? 'text-right' : ''}`} scope="col">{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <Fragment key={row.key}>
          <tr className="border-t border-slate-100 hover:bg-slate-50"><td className="px-4 py-3"><button className="text-left font-semibold text-teal-800" aria-expanded={expanded === row.key} onClick={() => setExpanded(expanded === row.key ? null : row.key)}><span aria-hidden="true">{expanded === row.key ? '▾' : '▸'} </span>{row.projectName}<span className="mt-1 block text-xs font-normal text-slate-500">{row.projectNumber || row.projectId}</span></button></td>
            <td className="whitespace-nowrap px-4 py-3">{monthLabel(row.month)}</td><td className="px-4 py-3"><span className="whitespace-nowrap font-medium">{row.costCode}</span><span className="block text-xs text-slate-500">{row.costCodeName}</span></td>
            <td className="px-4 py-3 text-right tabular-nums">{hours(row.timesheetHours)}</td><td className="px-4 py-3 text-right tabular-nums">{hours(row.productivityHours)}</td><td className="px-4 py-3 text-right font-bold tabular-nums">{hours(row.totalHours)}</td></tr>
          {expanded === row.key && <tr><td colSpan={6} className="bg-slate-50 p-4"><table className="w-full text-xs"><caption className="mb-3 text-left font-semibold">Source entries · {row.projectName} · {monthLabel(row.month)} · {row.costCode}</caption><thead><tr>{['Date', 'Source', 'Description / notes', 'Status', 'Hours'].map(label => <th scope="col" key={label} className="border-b border-slate-200 p-2">{label}</th>)}</tr></thead><tbody>{row.entries.map(entry => <tr key={`${entry.source}:${entry.id}`}><td className="whitespace-nowrap p-2">{entry.date}</td><td className="p-2">{entry.source === 'timesheet' ? 'Timesheet' : 'Productivity'}<span className="block text-slate-500">#{entry.id}</span></td><td className="p-2">{entry.description}{entry.notes && entry.notes !== entry.description && <span className="block text-slate-500">{entry.notes}</span>}{entry.source === 'productivity' && <span className="block text-slate-500">Recorded unit: {entry.uom || 'Not recorded'}</span>}</td><td className="p-2">{entry.status}</td><td className="p-2 text-right font-semibold tabular-nums">{hours(entry.hours)}</td></tr>)}</tbody></table></td></tr>}
        </Fragment>)}</tbody>
        {!!rows.length && <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold"><tr><td colSpan={3} className="px-4 py-4">Filtered total</td><td className="px-4 py-4 text-right tabular-nums">{hours(totals.timesheet)}</td><td className="px-4 py-4 text-right tabular-nums">{hours(totals.productivity)}</td><td className="px-4 py-4 text-right tabular-nums">{hours(totals.total)}</td></tr></tfoot>}
      </table></div>{!rows.length && <p className="p-10 text-center text-slate-500">No subcontractor hours match these filters.</p>}
    </section>}
    {report && <p className="text-xs text-slate-500">Read from synced records · Report loaded {new Date(report.loadedAt).toLocaleString()} · Reload checks the latest saved data.</p>}
  </main>;
}
