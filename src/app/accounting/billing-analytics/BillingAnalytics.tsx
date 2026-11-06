'use client';

import { useEffect, useMemo, useState } from 'react';
import { billingDateRange, billingHoursCsv, type BillingHourRow } from '@/lib/billingAnalytics';
import { groupBillingRange } from '@/lib/billingDistribution';
import { downloadCsv, fieldClass, hours } from './billingAnalyticsUi';
import BillingMonth from './BillingMonth';

type Report = { rows: BillingHourRow[]; loadedAt: string; warnings: Record<string, number> };

export default function BillingAnalytics({ initialMonth }: { initialMonth: string }) {
  const currentYear = Number(initialMonth.slice(0, 4));
  const [range, setRange] = useState({ from: `${currentYear}-01-01`, through: `${currentYear}-12-31` });
  const { from, through } = range;
  const year = from.endsWith('-01-01') && through === `${from.slice(0, 4)}-12-31` ? from.slice(0, 4) : '';
  let rangeError = '';
  try { billingDateRange(from, through); } catch (reason) { rangeError = (reason as Error).message; }
  const dateLabel = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const rangeLabel = rangeError ? 'Selected dates' : `${dateLabel(from)} – ${dateLabel(through)}`;
  const [refresh, setRefresh] = useState(0);
  const requestKey = `${from}|${through}|${refresh}`;
  const [result, setResult] = useState<{ key: string; report: Report | null; error: string } | null>(null);
  const report = result?.key === requestKey ? result.report : null;
  const error = rangeError || (result?.key === requestKey ? result.error : '');
  const loading = !rangeError && result?.key !== requestKey;

  useEffect(() => {
    if (rangeError) return;
    const controller = new AbortController();
    fetch(`/api/accounting/billing-analytics?${new URLSearchParams({ from, through })}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load billing hours.');
        if (!controller.signal.aborted) setResult({ key: requestKey, report: data, error: '' });
      })
      .catch(reason => { if (!controller.signal.aborted) setResult({ key: requestKey, report: null, error: reason instanceof Error ? reason.message : 'Unable to load billing hours.' }); });
    return () => controller.abort();
  }, [from, through, rangeError, requestKey]);

  const months = useMemo(() => rangeError ? [] : groupBillingRange(report?.rows || [], from, through), [report, from, through, rangeError]);
  const totals = (report?.rows || []).reduce((sum, row) => ({ timesheet: sum.timesheet + row.timesheetHours, productivity: sum.productivity + row.productivityHours, total: sum.total + row.totalHours }), { timesheet: 0, productivity: 0, total: 0 });

  return <main className="mx-auto max-w-[1600px] space-y-6 p-4 text-slate-900 md:p-8">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-teal-700">Billing • Vendor invoice distribution</p>
        <h1 className="mt-2 text-3xl font-bold">Billing analytics</h1>
        <p className="mt-2 text-sm text-slate-600">Choose a date range, then distribute a vendor invoice across projects and cost codes using subcontractor hours.</p></div>
    </div>
    <section aria-label="Date range filter" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-semibold">Year<select aria-label="Year" className={fieldClass} value={year} onChange={event => setRange({ from: `${event.target.value}-01-01`, through: `${event.target.value}-12-31` })}><option value="" disabled>Custom range</option>{Array.from({ length: currentYear - 2000 + 2 }, (_, index) => currentYear + 1 - index).map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-semibold">Start date<input className={fieldClass} type="date" min="2000-01-01" max="2100-12-31" value={from} onChange={event => setRange(previous => ({ ...previous, from: event.target.value }))} /></label>
        <label className="grid gap-1 text-xs font-semibold">End date<input className={fieldClass} type="date" min="2000-01-01" max="2100-12-31" value={through} onChange={event => setRange(previous => ({ ...previous, through: event.target.value }))} /></label>
        <button className={fieldClass} onClick={() => setRefresh(value => value + 1)} disabled={loading || !!rangeError}>Reload report</button>
        <button className={fieldClass} onClick={() => downloadCsv(billingHoursCsv(months.flatMap(month => month.projects.flatMap(project => project.rows)), range), `subcontractor-hours-${from}-through-${through}.csv`)} disabled={loading || !!error || !report?.rows.length}>Export range hours</button>
      </div>
      <p className="text-xs text-slate-600">Both dates are included. Changes update the report automatically. Select up to 24 months; Year resets the range to a full year.</p>
    </section>
    <div className="grid gap-4 sm:grid-cols-3">{[['Timesheet hours', totals.timesheet], ['Productivity hours', totals.productivity], ['Combined hours', totals.total]].map(([label, value]) =>
      <div key={label} className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-600">{label}</p><p className="mt-2 text-3xl font-bold tabular-nums">{loading || error ? '—' : hours(Number(value))}</p><p className="mt-2 text-xs text-slate-500">{rangeLabel}</p></div>)}</div>
    <div className="rounded-lg border border-teal-100 bg-teal-50 p-4 text-sm leading-relaxed text-teal-950">
      Open a month, select the projects covered by the invoice, and enter its total. Each code receives <strong>its share of the selected hours × the invoice amount</strong>. Percent of project shows the split within each job; percent of invoice shows the split across all selected jobs.
      <p className="mt-1">Hours combine <strong>Sub Contractor</strong> timesheets and approved <strong>Subcontractor Hours</strong> productivity entries within the selected dates. Invoice allocations use only those hours, including partial months. Worksheet amounts are temporary; export before reloading or changing dates. Enter the resulting amounts in QuickBooks yourself.</p>
    </div>
    {report && Object.values(report.warnings).some(Boolean) && <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
      {report.warnings.missingCostCode > 0 && <p>{report.warnings.missingCostCode} entries have no unique cost code; their hours appear under Unassigned and block allocation for the affected projects.</p>}
      {report.warnings.missingProject > 0 && <p>{report.warnings.missingProject} entries are excluded because their Procore project ID is missing. Review these before allocating an invoice.</p>}
      {report.warnings.invalidHours > 0 && <p>{report.warnings.invalidHours} entries are excluded because their hours are missing or invalid. Review these before allocating an invoice.</p>}
      {report.warnings.unapprovedProductivity > 0 && <p>{report.warnings.unapprovedProductivity} productivity entries await approval and are excluded.</p>}
    </div>}
    {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-800">{error}</div> : loading ? <p role="status" className="py-10 text-center text-slate-500">Loading subcontractor hours…</p> :
      <section aria-label="Hours by month" className="space-y-3" key={requestKey}>
        <h2 className="text-xl font-bold">{rangeLabel} by month</h2>
        {months.map(month => <BillingMonth key={month.month} month={month} range={range} initiallyOpen={month.month === initialMonth || months.length === 1} />)}
      </section>}
    {report && <p className="text-xs text-slate-500">Read from synced records · Report loaded {new Date(report.loadedAt).toLocaleString()} · Reload checks the latest saved data.</p>}
  </main>;
}
