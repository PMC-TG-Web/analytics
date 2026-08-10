'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';

type Snapshot = {
  id: string;
  sourceGeneratedAt: string;
  startDate: string;
  endDate: string;
  accountingMethod: string;
  readOnly: boolean;
  importedAt: string;
  rowCount: number;
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
  procoreDirectCost: number | null;
  procoreDirectCostLineCount: number;
  procoreDirectCostStatus: string | null;
  qboMinusProcoreDirectCost: number | null;
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

type LineItemDetail = {
  id: string;
  sectionPath: string[];
  date: string | null;
  txnType: string | null;
  docNum: string | null;
  name: string | null;
  className: string | null;
  memo: string | null;
  splitAccount: string | null;
  amount: number;
};

type ApiResponse = {
  success: boolean;
  selectedSnapshotId: string | null;
  snapshots: Snapshot[];
  rows: ProfitabilityRow[];
  error?: string;
};

type ProcoreStatusesResponse = {
  success: boolean;
  statuses: string[];
  byProjectId: Record<string, string>;
  error?: string;
};

type LineItemResponse = {
  success: boolean;
  projectId: string;
  count: number;
  breakdown: Array<{ section: string; amount: number }>;
  items: LineItemDetail[];
  error?: string;
};

type RefreshResponse = {
  success: boolean;
  selectedSnapshotId: string | null;
  importedAt: string | null;
  rowCount: number;
  refreshMode?: 'local' | 'remote';
  requestId?: string;
  refreshStatus?: string;
  message?: string;
  error?: string;
};

type RefreshStatusResponse = {
  success: boolean;
  refresh?: {
    configured: boolean;
    status?: string;
    requestId?: string;
    completedAt?: string;
    message?: string;
  };
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

function formatMoney(value: number | null | undefined) {
  return value == null ? '—' : money.format(value);
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export default function QboProjectProfitabilityPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [recordType, setRecordType] = useState('project');
  const [matchFilter, setMatchFilter] = useState('all');
  const [procoreStatusFilter, setProcoreStatusFilter] = useState('all');
  const [procoreStatuses, setProcoreStatuses] = useState<string[]>([]);
  const [procoreStatusByProjectId, setProcoreStatusByProjectId] = useState<Record<string, string>>({});
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [lineItemsByProject, setLineItemsByProject] = useState<Record<string, LineItemDetail[]>>({});
  const [lineItemBreakdownByProject, setLineItemBreakdownByProject] = useState<Record<string, Array<{ section: string; amount: number }>>>({});
  const [lineItemsLoading, setLineItemsLoading] = useState<Record<string, boolean>>({});
  const [lineItemsError, setLineItemsError] = useState<Record<string, string>>({});

  async function load(snapshotId?: string) {
    setLoading(true);
    setError('');
    setExpandedRows({});
    setLineItemsByProject({});
    setLineItemBreakdownByProject({});
    setLineItemsLoading({});
    setLineItemsError({});
    try {
      const query = snapshotId ? `?snapshotId=${encodeURIComponent(snapshotId)}` : '';
      const response = await fetch(`/api/accounting/project-profitability${query}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const body = await response.json() as ApiResponse;
      if (!response.ok || !body.success) throw new Error(body.error || 'Unable to load the report.');
      setData(body);

      try {
        const statusResponse = await fetch('/api/accounting/project-profitability/procore-statuses', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        const statusBody = await statusResponse.json() as ProcoreStatusesResponse;
        if (statusResponse.ok && statusBody.success) {
          setProcoreStatuses(statusBody.statuses);
          setProcoreStatusByProjectId(statusBody.byProjectId);
        }
      } catch (statusError) {
        console.error('Unable to load Procore status filters:', statusError);
      }
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
      const procoreStatus = row.procoreProjectId
        ? procoreStatusByProjectId[row.procoreProjectId] || ''
        : '';
      if (procoreStatusFilter === 'none' && procoreStatus) return false;
      if (procoreStatusFilter !== 'all' && procoreStatusFilter !== 'none' && procoreStatus !== procoreStatusFilter) return false;
      if (!term) return true;
      return [row.fullyQualifiedName, row.procoreProjectName, row.procoreProjectNumber, procoreStatus]
        .some((value) => String(value || '').toLowerCase().includes(term));
    });
  }, [data, search, recordType, matchFilter, procoreStatusFilter, procoreStatusByProjectId]);

  const filteredTotals = useMemo(() => filteredRows.reduce(
    (totals, row) => ({
      sales: totals.sales + row.sales,
      cost: totals.cost + row.actualCost,
      profit: totals.profit + row.profit,
      procoreDirectCost: totals.procoreDirectCost + (row.procoreDirectCost || 0),
      costVariance: totals.costVariance + (
        row.qboMinusProcoreDirectCost || 0
      ),
    }),
    { sales: 0, cost: 0, profit: 0, procoreDirectCost: 0, costVariance: 0 },
  ), [filteredRows]);

  async function loadLineItemsForRow(row: ProfitabilityRow) {
    if (lineItemsByProject[row.qboCustomerId] || lineItemsLoading[row.qboCustomerId]) {
      return;
    }

    setLineItemsLoading((current) => ({ ...current, [row.qboCustomerId]: true }));
    setLineItemsError((current) => ({ ...current, [row.qboCustomerId]: '' }));
    try {
      const response = await fetch(
        `/api/accounting/project-profitability/qbo-details?snapshotId=${encodeURIComponent(data?.selectedSnapshotId || '')}&qboCustomerId=${encodeURIComponent(row.qboCustomerId)}`,
        { credentials: 'same-origin', cache: 'no-store' },
      );
      const body = await response.json() as LineItemResponse;
      if (!response.ok || !body.success) {
        throw new Error(body.error || 'Unable to load QBO details.');
      }
      setLineItemsByProject((current) => ({ ...current, [row.qboCustomerId]: body.items }));
      setLineItemBreakdownByProject((current) => ({ ...current, [row.qboCustomerId]: body.breakdown }));
    } catch (loadError) {
      setLineItemsError((current) => ({
        ...current,
        [row.qboCustomerId]: loadError instanceof Error ? loadError.message : 'Unable to load QBO details.',
      }));
    } finally {
      setLineItemsLoading((current) => ({ ...current, [row.qboCustomerId]: false }));
    }
  }

  async function toggleRowExpansion(row: ProfitabilityRow) {
    const willExpand = !expandedRows[row.id];
    setExpandedRows((current) => ({ ...current, [row.id]: willExpand }));
    if (willExpand) {
      await loadLineItemsForRow(row);
    }
  }

  async function refreshProfitability() {
    const previousSnapshotId = data?.snapshots[0]?.id || data?.selectedSnapshotId || null;
    setRefreshing(true);
    setError('');
    setNotice('');
    setExpandedRows({});
    setLineItemsByProject({});
    setLineItemBreakdownByProject({});
    try {
      const response = await fetch('/api/accounting/project-profitability', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const body = await response.json() as RefreshResponse;
      if (!response.ok || !body.success) {
        throw new Error(body.error || 'Unable to refresh QuickBooks and Procore data.');
      }

      if (body.refreshMode !== 'remote') {
        setNotice(body.message || 'Refreshed QuickBooks and Procore data.');
        await load(body.selectedSnapshotId || undefined);
        return;
      }

      setNotice('Refresh queued. Waiting for the integration machine to finish reading QuickBooks and Procore…');
      const requestId = String(body.requestId || '');
      const maxStatusChecks = 540;
      for (let attempt = 0; attempt < maxStatusChecks; attempt += 1) {
        await delay(5_000);
        const statusResponse = await fetch('/api/accounting/project-profitability?refreshStatus=1', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        const statusBody = await statusResponse.json() as RefreshStatusResponse;
        if (!statusResponse.ok || !statusBody.success) {
          throw new Error(statusBody.error || 'Unable to check refresh status.');
        }

        const refreshStatus = String(statusBody.refresh?.status || 'idle');
        const statusRequestId = String(statusBody.refresh?.requestId || '');
        if (requestId && statusRequestId && requestId !== statusRequestId) {
          continue;
        }
        if (refreshStatus === 'failed') {
          throw new Error(statusBody.refresh?.message || 'The integration-machine refresh failed.');
        }
        if (refreshStatus === 'succeeded') {
          setNotice('Refresh completed. Loading the new profitability snapshot…');
          await load();
          return;
        }

        setNotice(refreshStatus === 'running'
          ? 'Reading current QuickBooks activity and Procore direct costs…'
          : 'Refresh queued. Waiting for the integration machine to start…');
      }

      throw new Error(
        `The refresh did not complete within 45 minutes. The previous snapshot ${previousSnapshotId ? 'remains available' : 'was not replaced'}.`,
      );
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Unable to refresh QuickBooks and Procore data.');
    } finally {
      setRefreshing(false);
    }
  }

  function exportCsv() {
    const headers = ['QBO Project', 'Procore Number', 'Procore Project', 'Procore Status', 'Match', 'Sales', 'QBO Actual Cost', 'Procore Direct Cost', 'QBO Minus Procore Direct Cost', 'Profit', 'Margin %'];
    const rows = filteredRows.map((row) => [
      row.fullyQualifiedName,
      row.procoreProjectNumber,
      row.procoreProjectName,
      row.procoreProjectId ? procoreStatusByProjectId[row.procoreProjectId] || '' : '',
      row.procoreMatchMethod,
      row.sales,
      row.actualCost,
      row.procoreDirectCost,
      row.qboMinusProcoreDirectCost,
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

          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-6">
            {[
              ['Sales', filteredTotals.sales, 'text-teal-800'],
              ['QBO actual cost', filteredTotals.cost, 'text-amber-700'],
              ['Procore direct cost', filteredTotals.procoreDirectCost, 'text-indigo-700'],
              ['Matched QBO minus Procore', filteredTotals.costVariance, filteredTotals.costVariance > 0 ? 'text-red-700' : 'text-emerald-700'],
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
        {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-semibold text-emerald-800">{notice}</div>}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_180px_180px_200px_240px_auto]">
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
              Procore status
              <select value={procoreStatusFilter} onChange={(event) => setProcoreStatusFilter(event.target.value)} className="mt-1 block h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm">
                <option value="all">All statuses</option>
                {procoreStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                <option value="none">No Procore status</option>
              </select>
            </label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
              Imported snapshot
              <select value={data?.selectedSnapshotId || ''} onChange={(event) => load(event.target.value)} disabled={!data?.snapshots.length} className="mt-1 block h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm disabled:bg-slate-100">
                {(data?.snapshots || []).map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.startDate} → {snapshot.endDate} · {snapshot.accountingMethod}</option>)}
              </select>
            </label>
            <div className="self-end flex gap-2">
              <button
                type="button"
                onClick={() => void refreshProfitability()}
                disabled={refreshing}
                className="rounded-lg bg-emerald-700 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {refreshing ? 'Refreshing…' : 'Refresh costs'}
              </button>
              <button type="button" onClick={exportCsv} disabled={!filteredRows.length || refreshing} className="rounded-lg bg-teal-800 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300">Export view</button>
            </div>
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
                    <th className="border-b border-slate-300 px-4 py-3 text-right">QBO actual cost</th>
                    <th className="border-b border-slate-300 px-4 py-3 text-right">Procore direct cost</th>
                    <th className="border-b border-slate-300 px-4 py-3 text-right">QBO − Procore</th>
                    <th className="border-b border-slate-300 px-4 py-3 text-right">Profit</th>
                    <th className="border-b border-slate-300 px-4 py-3 text-right">Margin</th>
                    <th className="border-b border-slate-300 px-4 py-3">Status</th>
                    <th className="border-b border-slate-300 px-4 py-3 text-right">Drill through</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <Fragment key={row.id}>
                    <tr
                      key={row.id}
                      className={`cursor-pointer border-b border-slate-100 hover:bg-teal-50 ${expandedRows[row.id] ? 'bg-teal-50' : ''}`}
                      onClick={() => { void toggleRowExpansion(row); }}
                    >
                      <td className="border-b border-slate-100 px-4 py-3">
                        <button type="button" className="text-left font-bold text-slate-900 hover:text-teal-800" onClick={() => { void toggleRowExpansion(row); }}>{row.fullyQualifiedName}</button>
                        {!row.active && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600">Inactive</span>}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        <div className="font-semibold text-slate-800">{row.procoreProjectName || '—'}</div>
                        <div className="text-xs text-slate-500">{row.procoreProjectNumber || ''}</div>
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3 text-right font-semibold tabular-nums">{money.format(row.sales)}</td>
                      <td className="border-b border-slate-100 px-4 py-3 text-right tabular-nums text-amber-800">{money.format(row.actualCost)}</td>
                      <td className="border-b border-slate-100 px-4 py-3 text-right tabular-nums text-indigo-700">{row.procoreDirectCost == null ? '—' : money.format(row.procoreDirectCost)}</td>
                      <td className={`border-b border-slate-100 px-4 py-3 text-right font-bold tabular-nums ${row.qboMinusProcoreDirectCost == null ? 'text-slate-400' : row.qboMinusProcoreDirectCost > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                        {row.qboMinusProcoreDirectCost == null ? '—' : money.format(row.qboMinusProcoreDirectCost)}
                      </td>
                      <td className={`border-b border-slate-100 px-4 py-3 text-right font-bold tabular-nums ${row.profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{money.format(row.profit)}</td>
                      <td className="border-b border-slate-100 px-4 py-3 text-right tabular-nums">{row.marginPercent == null ? '—' : `${row.marginPercent.toFixed(1)}%`}</td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide ${row.procoreProjectId ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
                          {row.procoreProjectId
                            ? procoreStatusByProjectId[row.procoreProjectId] || 'Status unavailable'
                            : 'No Procore match'}
                        </span>
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void toggleRowExpansion(row);
                          }}
                          className="rounded-md border border-teal-700 px-3 py-2 text-xs font-black uppercase tracking-wide text-teal-800 transition hover:bg-teal-50"
                        >
                          {expandedRows[row.id] ? 'Close' : 'Open'}
                        </button>
                      </td>
                    </tr>
                    {expandedRows[row.id] && (
                      <>
                        {lineItemsLoading[row.qboCustomerId] && (
                          <tr className="bg-slate-50">
                            <td colSpan={10} className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-500">
                              Loading QBO line item details...
                            </td>
                          </tr>
                        )}

                        {lineItemsError[row.qboCustomerId] && (
                          <tr className="bg-red-50">
                            <td colSpan={10} className="border-b border-red-100 px-4 py-3 text-sm font-semibold text-red-700">
                              {lineItemsError[row.qboCustomerId]}
                            </td>
                          </tr>
                        )}

                        {!lineItemsLoading[row.qboCustomerId] && !lineItemsError[row.qboCustomerId] && !(lineItemsByProject[row.qboCustomerId] || []).length && (
                          <tr className="bg-slate-50">
                            <td colSpan={10} className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-500">
                              No QBO line item details were found for this project.
                            </td>
                          </tr>
                        )}

                        {(lineItemsByProject[row.qboCustomerId] || []).map((item, itemIndex) => (
                          <tr key={`${item.id}-${itemIndex}`} className="bg-slate-50/70 text-xs">
                            <td className="border-b border-slate-100 px-4 py-2">
                              <div className="font-semibold text-slate-800">{item.name || 'QBO detail line'}</div>
                              <div className="text-[11px] text-slate-500">{item.date || '—'} · {item.txnType || '—'} · {item.docNum || '—'}</div>
                            </td>
                            <td className="border-b border-slate-100 px-4 py-2 text-slate-700">
                              <div>{item.sectionPath.join(' / ') || 'Uncategorized'}</div>
                              <div className="text-[11px] text-slate-500">{item.className || item.splitAccount || ''}</div>
                            </td>
                            <td className="border-b border-slate-100 px-4 py-2 text-right text-slate-400">—</td>
                            <td className="border-b border-slate-100 px-4 py-2 text-right font-bold tabular-nums text-amber-800">{formatMoney(item.amount)}</td>
                            <td className="border-b border-slate-100 px-4 py-2 text-right text-slate-400">—</td>
                            <td className="border-b border-slate-100 px-4 py-2 text-right text-slate-400">—</td>
                            <td className="border-b border-slate-100 px-4 py-2 text-right text-slate-400">—</td>
                            <td className="border-b border-slate-100 px-4 py-2 text-right text-slate-400">—</td>
                            <td className="border-b border-slate-100 px-4 py-2">
                              <span className="inline-flex rounded-full bg-slate-200 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-700">
                                {item.txnType || 'Detail'}
                              </span>
                            </td>
                            <td className="border-b border-slate-100 px-4 py-2 text-right text-slate-400">—</td>
                          </tr>
                        ))}

                        {!!lineItemBreakdownByProject[row.qboCustomerId]?.length && (
                          <tr className="bg-slate-100/80 text-xs">
                            <td className="border-b border-slate-200 px-4 py-2 font-black text-slate-700">QBO cost section totals</td>
                            <td className="border-b border-slate-200 px-4 py-2 text-slate-400">—</td>
                            <td className="border-b border-slate-200 px-4 py-2 text-right text-slate-400">—</td>
                            <td className="border-b border-slate-200 px-4 py-2 text-right text-slate-400">—</td>
                            <td className="border-b border-slate-200 px-4 py-2 text-right text-slate-400">—</td>
                            <td className="border-b border-slate-200 px-4 py-2 text-right text-slate-400">—</td>
                            <td className="border-b border-slate-200 px-4 py-2 text-right text-slate-400">—</td>
                            <td className="border-b border-slate-200 px-4 py-2 text-right text-slate-400">—</td>
                            <td className="border-b border-slate-200 px-4 py-2">
                              {lineItemBreakdownByProject[row.qboCustomerId].map((section) => (
                                <div key={section.section} className="flex items-center justify-between gap-2 py-0.5 text-[11px]">
                                  <span className="font-semibold text-slate-700">{section.section}</span>
                                  <span className="font-bold tabular-nums text-slate-900">{formatMoney(section.amount)}</span>
                                </div>
                              ))}
                            </td>
                            <td className="border-b border-slate-200 px-4 py-2 text-right text-slate-400">—</td>
                          </tr>
                        )}
                      </>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {!filteredRows.length && <div className="p-10 text-center text-sm font-semibold text-slate-500">No rows match the current filters.</div>}
            </div>
          )}
        </section>

        <p className="px-1 pb-4 text-xs leading-5 text-slate-500">
          Sales are QuickBooks Income assigned to the project. Expand a row to see the QuickBooks Profit and Loss drill-through lines for that project, grouped by cost section. Procore Direct Cost is the sum of the matched project&apos;s Direct Cost line-item amounts returned by Procore. The difference is QBO actual cost minus Procore Direct Cost; a positive amount means QBO contains more cost. Profit also includes assigned other income. Uncertain Procore matches remain flagged for review rather than being guessed.
        </p>
      </div>
    </main>
  );
}
