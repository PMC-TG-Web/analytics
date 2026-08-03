'use client';

import { useEffect, useMemo, useState } from 'react';

type Snapshot = {
  id: string;
  sourceGeneratedAt: string;
  startDate: string;
  endDate: string;
  accountingMethod: string;
  readOnly: boolean;
  importedAt: string;
  rowCount: number;
  summary: Record<string, number>;
  sourceCounts: Record<string, number>;
};

type ProfitabilityRow = {
  id: string;
  qboCustomerId: string;
  recordType: string;
  projectName: string;
  fullyQualifiedName: string;
  active: boolean;
  procoreProjectId: string | null;
  procoreProjectNumber: string | null;
  procoreProjectName: string | null;
  procoreMatchMethod: string;
  sales: number;
  costOfGoodsSold: number;
  operatingExpenses: number;
  otherIncome: number;
  otherExpenses: number;
  actualCost: number;
  profit: number;
  marginPercent: number | null;
  reportedNetIncome: number;
  reconciliationDifference: number;
};

type ApiResponse = {
  success: boolean;
  selectedSnapshotId: string | null;
  snapshots: Snapshot[];
  rows: ProfitabilityRow[];
  error?: string;
};

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

function csvCell(value: unknown) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function QboProjectProfitabilityPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [recordType, setRecordType] = useState('project');
  const [matchFilter, setMatchFilter] = useState('all');
  const [selectedRow, setSelectedRow] = useState<ProfitabilityRow | null>(null);

  async function load(snapshotId?: string) {
    setLoading(true);
    setError('');
    setSelectedRow(null);
    try {
      const query = snapshotId ? `?snapshotId=${encodeURIComponent(snapshotId)}` : '';
      const response = await fetch(`/api/accounting/project-profitability${query}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const body = await response.json() as ApiResponse;
      if (!response.ok || !body.success) throw new Error(body.error || 'Unable to load the report.');
      setData(body);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the report.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const selectedSnapshot = data?.snapshots.find((snapshot) => snapshot.id === data.selectedSnapshotId) || null;
  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.rows || []).filter((row) => {
      if (recordType !== 'all' && row.recordType !== recordType) return false;
      if (matchFilter === 'matched' && !row.procoreProjectId) return false;
      if (matchFilter === 'unmatched' && row.procoreProjectId) return false;
      if (!term) return true;
      return [row.fullyQualifiedName, row.procoreProjectName, row.procoreProjectNumber]
        .some((value) => String(value || '').toLowerCase().includes(term));
    });
  }, [data, search, recordType, matchFilter]);

  const filteredTotals = useMemo(() => filteredRows.reduce(
    (totals, row) => ({
      sales: totals.sales + row.sales,
      cost: totals.cost + row.actualCost,
      profit: totals.profit + row.profit,
    }),
    { sales: 0, cost: 0, profit: 0 },
  ), [filteredRows]);

  function exportCsv() {
    const headers = ['QBO Project', 'Procore Number', 'Procore Project', 'Match', 'Sales', 'Actual Cost', 'Profit', 'Margin %'];
    const rows = filteredRows.map((row) => [
      row.fullyQualifiedName,
      row.procoreProjectNumber,
      row.procoreProjectName,
      row.procoreMatchMethod,
      row.sales,
      row.actualCost,
      row.profit,
      row.marginPercent,
    ]);
    const blob = new Blob([[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `qbo-project-profitability-${selectedSnapshot?.startDate || 'export'}-to-${selectedSnapshot?.endDate || 'latest'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-gradient-to-r from-teal-950 via-teal-900 to-slate-900 px-6 py-6 text-white">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-teal-100">
                  <span>Accounting</span>
                  <span className="rounded-full border border-emerald-300/50 bg-emerald-400/15 px-2.5 py-1 text-emerald-100">Read only</span>
                  <span className="rounded-full border border-white/30 px-2.5 py-1">Admin</span>
                </div>
                <h1 className="text-3xl font-black tracking-tight sm:text-4xl">QBO Project Profitability</h1>
                <p className="mt-2 max-w-3xl text-sm text-teal-50/85">
                  Actual QuickBooks income and project-assigned costs, matched conservatively to Procore projects.
                </p>
              </div>
              {selectedSnapshot && (
                <div className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm backdrop-blur">
                  <div className="font-bold">{formatDate(selectedSnapshot.startDate)} – {formatDate(selectedSnapshot.endDate)}</div>
                  <div className="mt-1 text-xs text-teal-100">{selectedSnapshot.accountingMethod} basis · imported {new Date(selectedSnapshot.importedAt).toLocaleString()}</div>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Sales', filteredTotals.sales, 'text-teal-800'],
              ['Actual cost', filteredTotals.cost, 'text-amber-700'],
              ['Profit', filteredTotals.profit, filteredTotals.profit >= 0 ? 'text-emerald-700' : 'text-red-700'],
              ['Rows in view', filteredRows.length, 'text-slate-800'],
            ].map(([label, value, color]) => (
              <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</div>
                <div className={`mt-1 text-2xl font-black ${color}`}>{label === 'Rows in view' ? Number(value).toLocaleString() : money.format(Number(value))}</div>
              </div>
            ))}
          </div>
        </section>

        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-semibold text-red-800">{error}</div>}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_220px_220px_260px_auto]">
            <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
              Search projects
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="QBO name, Procore name, or number" className="mt-1 block h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm" />
            </label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
              Record type
              <select value={recordType} onChange={(event) => setRecordType(event.target.value)} className="mt-1 block h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm">
                <option value="project">Projects</option>
                <option value="customer-only">Customer-only review</option>
                <option value="all">All records</option>
              </select>
            </label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
              Procore match
              <select value={matchFilter} onChange={(event) => setMatchFilter(event.target.value)} className="mt-1 block h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm">
                <option value="all">All</option>
                <option value="matched">Matched</option>
                <option value="unmatched">Needs review</option>
              </select>
            </label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
              Imported snapshot
              <select value={data?.selectedSnapshotId || ''} onChange={(event) => load(event.target.value)} disabled={!data?.snapshots.length} className="mt-1 block h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm disabled:bg-slate-100">
                {(data?.snapshots || []).map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.startDate} → {snapshot.endDate} · {snapshot.accountingMethod}</option>)}
              </select>
            </label>
            <button type="button" onClick={exportCsv} disabled={!filteredRows.length} className="self-end rounded-lg bg-teal-800 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300">Export view</button>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="p-12 text-center font-semibold text-slate-500">Loading profitability snapshot…</div>
          ) : !selectedSnapshot ? (
            <div className="p-12 text-center">
              <h2 className="text-xl font-black text-slate-800">No profitability snapshot has been imported</h2>
              <p className="mt-2 text-sm text-slate-600">Run the read-only QBO report, then run the manual Analytics import command.</p>
            </div>
          ) : (
            <div className="max-h-[62vh] overflow-auto">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs font-black uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="border-b border-slate-300 px-4 py-3">QuickBooks project</th>
                    <th className="border-b border-slate-300 px-4 py-3">Procore match</th>
                    <th className="border-b border-slate-300 px-4 py-3 text-right">Sales</th>
                    <th className="border-b border-slate-300 px-4 py-3 text-right">Actual cost</th>
                    <th className="border-b border-slate-300 px-4 py-3 text-right">Profit</th>
                    <th className="border-b border-slate-300 px-4 py-3 text-right">Margin</th>
                    <th className="border-b border-slate-300 px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id} className={`cursor-pointer border-b border-slate-100 hover:bg-teal-50 ${selectedRow?.id === row.id ? 'bg-teal-50' : ''}`} onClick={() => setSelectedRow(row)}>
                      <td className="border-b border-slate-100 px-4 py-3">
                        <button type="button" className="text-left font-bold text-slate-900 hover:text-teal-800" onClick={() => setSelectedRow(row)}>{row.fullyQualifiedName}</button>
                        {!row.active && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600">Inactive</span>}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        <div className="font-semibold text-slate-800">{row.procoreProjectName || '—'}</div>
                        <div className="text-xs text-slate-500">{row.procoreProjectNumber || ''}</div>
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3 text-right font-semibold tabular-nums">{money.format(row.sales)}</td>
                      <td className="border-b border-slate-100 px-4 py-3 text-right tabular-nums text-amber-800">{money.format(row.actualCost)}</td>
                      <td className={`border-b border-slate-100 px-4 py-3 text-right font-bold tabular-nums ${row.profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{money.format(row.profit)}</td>
                      <td className="border-b border-slate-100 px-4 py-3 text-right tabular-nums">{row.marginPercent == null ? '—' : `${row.marginPercent.toFixed(1)}%`}</td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide ${row.procoreProjectId ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{row.procoreProjectId ? 'Matched' : 'Review'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredRows.length && <div className="p-10 text-center text-sm font-semibold text-slate-500">No rows match the current filters.</div>}
            </div>
          )}
        </section>

        {selectedRow && (
          <section className="rounded-2xl border border-teal-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-widest text-teal-700">Selected record</div>
                <h2 className="mt-1 text-xl font-black text-slate-900">{selectedRow.fullyQualifiedName}</h2>
                <p className="mt-1 text-sm text-slate-500">QBO ID {selectedRow.qboCustomerId} · match method: {selectedRow.procoreMatchMethod}</p>
              </div>
              <button type="button" onClick={() => setSelectedRow(null)} className="text-sm font-bold text-slate-500 hover:text-slate-900">Close</button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                ['COGS', selectedRow.costOfGoodsSold],
                ['Operating expenses', selectedRow.operatingExpenses],
                ['Other income', selectedRow.otherIncome],
                ['Other expenses', selectedRow.otherExpenses],
                ['Reported net income', selectedRow.reportedNetIncome],
              ].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-slate-50 p-3"><div className="text-xs font-bold uppercase text-slate-500">{label}</div><div className="mt-1 font-black text-slate-900">{money.format(Number(value))}</div></div>)}
            </div>
          </section>
        )}

        <p className="px-1 pb-4 text-xs leading-5 text-slate-500">
          Sales are QuickBooks Income assigned to the project. Actual cost is assigned COGS, operating expenses, and other expenses. Profit also includes assigned other income. Uncertain Procore matches remain flagged for review rather than being guessed.
        </p>
      </div>
    </main>
  );
}
