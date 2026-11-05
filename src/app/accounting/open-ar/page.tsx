'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AR_BUCKET_LABELS, AR_BUCKETS, arBucket, arReconciliationDifference, arTotals,
  filterArInvoices, isOpenArStale, openArCsv, parseOpenArHealth, parseOpenArReport, type ArAmounts, type OpenArHealth, type OpenArReport,
} from '@/lib/qboOpenAr';

const button = 'rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50';
const PAGE_SIZE = 100;

export default function OpenArPage() {
  const [report, setReport] = useState<OpenArReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<'exclude' | 'include'>('exclude');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [refreshStatus, setRefreshStatus] = useState('');
  const [health, setHealth] = useState<OpenArHealth | null>(null);
  const [checkedAt, setCheckedAt] = useState(Date.now);
  const refreshController = useRef<AbortController | null>(null);

  async function load(refresh = false, signal?: AbortSignal, quiet = false) {
    if (!quiet) { setLoading(true); setError(''); }
    if (refresh) {
      refreshController.current = new AbortController();
      signal = refreshController.current.signal;
      setRefreshStatus('Queueing a read-only QBO refresh...');
    }
    try {
      const response = await fetch('/api/accounting/open-ar', { method: refresh ? 'POST' : 'GET', cache: 'no-store', signal });
      let data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Unable to load Open A/R.');
      if (refresh) {
        const id = data.refresh?.id;
        if (typeof id !== 'string') throw new Error('The QBO host did not return a refresh ID.');
        const deadline = Date.now() + 310_000;
        while (data.refresh?.state !== 'succeeded') {
          if (!['queued', 'processing'].includes(data.refresh?.state)) throw new Error('The QBO refresh returned an invalid status. The previous report was retained.');
          if (Date.now() > deadline) throw new Error('The QBO refresh is taking too long. Retry Refresh from QBO. The previous report was retained.');
          if (signal?.aborted) return;
          setRefreshStatus(data.refresh?.state === 'processing' ? 'Reading QBO invoices, classes and aging. The previous snapshot remains displayed.' : 'Waiting for the QBO host. The previous snapshot remains displayed.');
          await new Promise(resolve => setTimeout(resolve, 1500));
          const progress = await fetch(`/api/accounting/open-ar?refreshId=${encodeURIComponent(id)}`, { cache: 'no-store', signal });
          data = await progress.json();
          if (!progress.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Unable to check the QBO refresh.');
        }
        if (!data.report) throw new Error('The completed QBO refresh did not contain a report. The previous report was retained.');
      }
      const next = data.report == null ? null : parseOpenArReport(data.report);
      const nextHealth = data.health == null ? null : parseOpenArHealth(data.health);
      if (!signal?.aborted) {
        setReport(next); setHealth(nextHealth); setError('');
        if (!quiet) setPage(0);
      }
    } catch (error) {
      if (!signal?.aborted) setError(error instanceof Error ? error.message : 'Unable to load Open A/R.');
    } finally {
      if (!signal?.aborted) {
        setCheckedAt(Date.now());
        if (!quiet) { setLoading(false); setRefreshStatus(''); }
      }
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => { controller.abort(); refreshController.current?.abort(); };
  }, []);
  useEffect(() => {
    if (loading) return;
    const controller = new AbortController();
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void load(false, controller.signal, true).finally(() => { pending = false; });
    }, 60_000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [loading]);

  const invalidFilter = report && selected.some(id => !report.classes.some(row => row.id === id));
  const rows = useMemo(() => report && !invalidFilter ? filterArInvoices(report, selected, mode, search) : [], [report, selected, mode, search, invalidFilter]);
  const totals = useMemo(() => arTotals(rows, report?.asOfDate || '2000-01-01'), [rows, report]);
  const classNames = useMemo(() => new Map(report?.classes.map(row => [row.id, row.name]) || []), [report]);
  const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: report?.currency || 'USD' }).format(cents / 100);
  const mixedCount = report?.invoices.filter(row => row.classIds.length > 1).length || 0;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visiblePage = Math.min(page, pages - 1);
  const visible = rows.slice(visiblePage * PAGE_SIZE, (visiblePage + 1) * PAGE_SIZE);
  const difference = report ? arReconciliationDifference(report) : 0;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  function clearFilters() { setSelected([]); setMode('exclude'); setSearch(''); setPage(0); }
  function download() {
    if (!report || invalidFilter) return;
    const url = URL.createObjectURL(new Blob(['\uFEFF', openArCsv(report, rows)], { type: 'text/csv;charset=utf-8;' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `open-ar-${report.asOfDate}.csv`; anchor.click();
    URL.revokeObjectURL(url);
  }
  function amountCells(amounts: ArAmounts) {
    return [...AR_BUCKETS, 'total' as const].map(key => <td key={key} className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(amounts[key])}</td>);
  }

  return <main className="min-w-0 bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-[1800px] space-y-5">
      <header className="rounded-2xl bg-teal-950 p-6 text-white">
        <p className="text-xs font-bold uppercase tracking-widest text-teal-200">QuickBooks Online · Read only</p>
        <h1 className="mt-2 text-3xl font-bold">Open A/R</h1>
        <p className="mt-2 text-teal-50">Open invoices aged by due date, with class filters. No invoices or payments are changed in QBO.</p>
        {report && <p className="mt-3 text-sm text-teal-100">As of {report.asOfDate} (Eastern) · Refreshed {new Date(report.generatedAt).toLocaleString()} · {report.currency} · {report.environment}</p>}
        <p className="mt-2 text-sm text-teal-100">Automatic QBO refresh: every hour, on the hour. This page checks saved data every minute without resetting your filters.</p>
        <Link href="/help/qbo-open-ar" className="mt-3 inline-block underline underline-offset-4">Info / Help</Link>
      </header>

      <div className="flex flex-wrap gap-3">
        <button className={button} disabled={loading} onClick={() => void load(true)}>{loading ? 'Loading...' : 'Refresh from QBO'}</button>
        <button className={button} disabled={loading} onClick={() => void load(false)}>Reload saved report</button>
        <button className={button} disabled={loading || !report || !rows.length || !!invalidFilter} onClick={download}>Download CSV</button>
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-900">{error}{report && ' The previous saved snapshot remains displayed; it has not been refreshed.'}</div>}
      {refreshStatus && <p role="status" className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-teal-900">{refreshStatus}</p>}
      {health && !health.hostOnline && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4">The QBO host is offline or not responding. Automatic refresh requires that computer to be on and signed in. The last saved report is retained.</p>}
      {health?.latestRefresh && ['failed', 'expired'].includes(health.latestRefresh.state) && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4">The latest A/R refresh ({new Date(health.latestRefresh.requestedAt).toLocaleString()}) {health.latestRefresh.state === 'failed' ? 'failed' : 'did not finish in time'}. The last good snapshot is still displayed. Check the QBO host and retry Refresh from QBO.</p>}
      {health?.latestRefresh && ['queued', 'processing'].includes(health.latestRefresh.state) && !refreshStatus && <p role="status" className="rounded-lg border border-teal-200 bg-teal-50 p-4">An A/R refresh is {health.latestRefresh.state}. The completed snapshot will appear automatically.</p>}
      {!loading && !report && !error && <p className="rounded-lg border bg-white p-6">No A/R snapshot has been saved yet. Select Refresh from QBO to build the report.</p>}
      {report && <>
        {isOpenArStale(report.generatedAt, checkedAt) && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4">A/R data is stale: the last successful refresh is more than 75 minutes old. Values below are the last good snapshot, not live balances.</p>}
        {report.asOfDate !== today && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4">This is a saved report for {report.asOfDate}, not today. Refresh from QBO to update balances and aging.</p>}
        {difference !== 0 && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4">Reconciliation needs review: open invoices less unapplied payments and credits differ from QBO net A/R by {money(difference)}. Other A/R transactions or changes during refresh may explain the difference. Do not treat the invoice subtotal as net A/R.</p>}
        <section aria-label="Report filters" className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-end gap-4">
            <label className="min-w-56 flex-1 text-sm font-semibold">Customer / project or invoice
              <input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" placeholder="Search customer, project or invoice" />
            </label>
            <label className="text-sm font-semibold">Class filter mode
              <select value={mode} onChange={event => { setMode(event.target.value === 'include' ? 'include' : 'exclude'); setPage(0); }} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 font-normal">
                <option value="exclude">Exclude selected classes</option><option value="include">Only selected classes</option>
              </select>
            </label>
            <button className={button} onClick={clearFilters} disabled={!selected.length && !search && mode === 'exclude'}>Clear filters</button>
          </div>
          <details className="mt-4 rounded-lg border border-slate-200 p-3">
            <summary className="cursor-pointer font-semibold">Classes ({selected.length} selected{!selected.length ? ' - all included' : ''})</summary>
            <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {report.classes.map(row => <label key={row.id} className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-slate-50">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={selected.includes(row.id)} onChange={event => { setSelected(previous => event.target.checked ? [...previous, row.id] : previous.filter(id => id !== row.id)); setPage(0); }} />
                <span>{row.name}{!row.active && ' (inactive)'}</span>
              </label>)}
            </div>
          </details>
          <p className="mt-3 text-sm text-slate-600">Filters match whole invoices, including partially paid invoices. Selecting a parent class also matches its subclasses. Exclude removes an invoice if any line matches; Only selected includes it if any line matches. No selection includes all invoices.</p>
          {mixedCount > 0 && <p className="mt-2 text-sm font-semibold text-amber-800">{mixedCount} mixed-class invoices in the snapshot. Their full unpaid balance is included or excluded; amounts are not split between classes.</p>}
          {invalidFilter && <p role="alert" className="mt-2 text-red-700">A selected class is no longer available. Clear filters before viewing or exporting totals.</p>}
        </section>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['Open invoices in view', invalidFilter ? 'Unavailable' : money(totals.total), `${rows.length} matching invoices`],
            ['Past due in view', invalidFilter ? 'Unavailable' : money(totals.days1To30 + totals.days31To60 + totals.days61To90 + totals.daysOver90), 'Due date before the snapshot date'],
            ['Unapplied payments / credits', money(report.unappliedPaymentCents + report.remainingCreditCents), 'All classes; not allocated to filtered invoices'],
            ['QBO net A/R - all classes', money(report.qboAging.total), 'QBO aging control; unaffected by filters'],
          ].map(([label, amount, note]) => <article key={label} className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-600">{label}</h2><strong className="mt-2 block text-2xl tabular-nums">{amount}</strong><p className="mt-2 text-xs text-slate-500">{note}</p>
          </article>)}
        </div>

        {!invalidFilter && <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div><h2 className="text-lg font-bold">Open invoices</h2><p className="text-sm text-slate-600">{rows.length} matching invoices · Page {visiblePage + 1} of {pages}. Totals and CSV include all matching pages.</p></div>
            <div className="flex gap-2"><button className={button} disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>Previous</button><button className={button} disabled={visiblePage + 1 >= pages} onClick={() => setPage(visiblePage + 1)}>Next</button></div>
          </div>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs text-slate-700"><tr>{['Customer / project', 'Invoice', 'Invoice date', 'Due date', 'Classes', ...AR_BUCKETS.map(key => AR_BUCKET_LABELS[key]), 'Open balance'].map(label => <th scope="col" key={label} className="whitespace-nowrap px-4 py-3">{label}</th>)}</tr></thead>
            <tbody>{visible.map(row => {
              const bucket = arBucket(row.dueDate, report.asOfDate);
              return <tr key={row.id} className="border-t border-slate-100 align-top">
                <td className="min-w-56 px-4 py-3 font-medium">{row.customerName}</td>
                <td className="px-4 py-3">{row.number}{row.balanceCents < row.totalCents && <p className="mt-1 text-xs text-slate-500">Partially paid</p>}</td>
                <td className="whitespace-nowrap px-4 py-3">{row.invoiceDate}</td><td className="whitespace-nowrap px-4 py-3">{row.dueDate || 'Needs review'}</td>
                <td className="min-w-44 px-4 py-3">{row.classIds.map(id => classNames.get(id)).join('; ')}{row.classIds.length > 1 && <p className="mt-1 text-xs font-semibold text-amber-800">Mixed class</p>}</td>
                {AR_BUCKETS.map(key => <td key={key} className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{key === bucket ? money(row.balanceCents) : '-'}</td>)}
                <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{money(row.balanceCents)}</td>
              </tr>;
            })}</tbody>
            <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-bold"><tr><th colSpan={5} scope="row" className="px-4 py-3">Filtered open invoice subtotal</th>{amountCells(totals)}</tr></tfoot>
          </table></div>
          {!rows.length && <p className="p-6 text-center text-slate-600">No open invoices match these filters.</p>}
        </section>}

        <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-bold">QBO aging control - all classes</h2>
          <p className="mt-1 text-sm text-slate-600">This unfiltered QBO report includes credits, unapplied payments and other A/R entries. It is not the filtered invoice subtotal above.</p>
          <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr>{[...AR_BUCKETS.map(key => AR_BUCKET_LABELS[key]), 'Net A/R'].map(label => <th key={label} className="whitespace-nowrap px-4 py-2 text-right">{label}</th>)}</tr></thead><tbody><tr>{amountCells(report.qboAging)}</tr></tbody></table></div>
          <p className="mt-3 text-sm text-slate-600">All open invoices {money(arTotals(report.invoices, report.asOfDate).total)} less {report.unappliedPaymentCount} unapplied payments ({money(report.unappliedPaymentCents)}) and {report.remainingCreditCount} remaining credits ({money(report.remainingCreditCents)}).
            {difference === 0 ? ' Reconciles exactly to QBO net A/R.' : ` Difference: ${money(difference)}.`}</p>
        </section>
      </>}
    </div>
  </main>;
}
