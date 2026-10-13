'use client';

import { useEffect, useMemo, useState } from 'react';
import { billingHoursCsv, type BillingHourRow } from '@/lib/billingAnalytics';
import { groupBillingYear } from '@/lib/billingDistribution';
import { downloadCsv, fieldClass, hours } from './billingAnalyticsUi';
import BillingMonth from './BillingMonth';

type Report = { rows: BillingHourRow[]; loadedAt: string; warnings: Record<string, number> };

export default function BillingAnalytics({ initialMonth }: { initialMonth: string }) {
  const currentYear = Number(initialMonth.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [refresh, setRefresh] = useState(0);
  const requestKey = `${year}|${refresh}`;
  const [result, setResult] = useState<{ key: string; report: Report | null; error: string } | null>(null);
  const report = result?.key === requestKey ? result.report : null;
  const error = result?.key === requestKey ? result.error : '';
  const loading = result?.key !== requestKey;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/accounting/billing-analytics?${new URLSearchParams({ from: `${year}-01`, through: `${year}-12` })}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load billing hours.');
        if (!controller.signal.aborted) setResult({ key: requestKey, report: data, error: '' });
      })
      .catch(reason => { if (!controller.signal.aborted) setResult({ key: requestKey, report: null, error: reason instanceof Error ? reason.message : 'Unable to load billing hours.' }); });
    return () => controller.abort();
  }, [year, requestKey]);

  const months = useMemo(() => groupBillingYear(report?.rows || [], year), [report, year]);
  const totals = (report?.rows || []).reduce((sum, row) => ({ timesheet: sum.timesheet + row.timesheetHours, productivity: sum.productivity + row.productivityHours, total: sum.total + row.totalHours }), { timesheet: 0, productivity: 0, total: 0 });

  return <main className="mx-auto max-w-[1600px] space-y-6 p-4 text-slate-900 md:p-8">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-teal-700">Billing • Vendor invoice distribution</p>
        <h1 className="mt-2 text-3xl font-bold">Billing analytics</h1>
        <p className="mt-2 text-sm text-slate-600">Choose a year and month, then distribute a vendor invoice across projects and cost codes using subcontractor hours.</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs font-semibold">Year<select className={fieldClass} value={year} onChange={event => setYear(Number(event.target.value))}>{Array.from({ length: currentYear - 2000 + 2 }, (_, index) => currentYear + 1 - index).map(value => <option key={value}>{value}</option>)}</select></label>
        <button className={fieldClass} onClick={() => setRefresh(value => value + 1)} disabled={loading}>Reload report</button>
        <button className={fieldClass} onClick={() => downloadCsv(billingHoursCsv(months.flatMap(month => month.projects.flatMap(project => project.rows))), `subcontractor-hours-${year}.csv`)} disabled={loading || !report?.rows.length}>Export year hours</button>
      </div>
    </div>
    <div className="grid gap-4 sm:grid-cols-3">{[['Timesheet hours', totals.timesheet], ['Productivity hours', totals.productivity], ['Combined hours', totals.total]].map(([label, value]) =>
      <div key={label} className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-600">{year} · {label}</p><p className="mt-2 text-3xl font-bold tabular-nums">{loading || error ? '—' : hours(Number(value))}</p></div>)}</div>
    <div className="rounded-lg border border-teal-100 bg-teal-50 p-4 text-sm leading-relaxed text-teal-950">
      Open a month, select the projects covered by the invoice, and enter its total. Each code receives <strong>its share of the selected hours × the invoice amount</strong>. Percent of project shows the split within each job; percent of invoice shows the split across all selected jobs.
      <p className="mt-1">Hours combine <strong>Sub Contractor</strong> timesheets and approved <strong>Subcontractor Hours</strong> productivity entries. Worksheet amounts are temporary; export before reloading or changing years. Enter the resulting amounts in QuickBooks yourself.</p>
    </div>
    {report && Object.values(report.warnings).some(Boolean) && <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
      {report.warnings.missingCostCode > 0 && <p>{report.warnings.missingCostCode} entries have no unique cost code; their hours appear under Unassigned and block allocation for the affected projects.</p>}
      {report.warnings.missingProject > 0 && <p>{report.warnings.missingProject} entries are excluded because their Procore project ID is missing. Review these before allocating an invoice.</p>}
      {report.warnings.invalidHours > 0 && <p>{report.warnings.invalidHours} entries are excluded because their hours are missing or invalid. Review these before allocating an invoice.</p>}
      {report.warnings.unapprovedProductivity > 0 && <p>{report.warnings.unapprovedProductivity} productivity entries await approval and are excluded.</p>}
    </div>}
    {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-800">{error}</div> : loading ? <p role="status" className="py-10 text-center text-slate-500">Loading {year} subcontractor hours…</p> :
      <section aria-label={`${year} months`} className="space-y-3" key={requestKey}>
        <h2 className="text-xl font-bold">{year} by month</h2>
        {months.map(month => <BillingMonth key={month.month} month={month} initiallyOpen={month.month === initialMonth} />)}
      </section>}
    {report && <p className="text-xs text-slate-500">Read from synced records · Report loaded {new Date(report.loadedAt).toLocaleString()} · Reload checks the latest saved data.</p>}
  </main>;
}
