"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

type MonthlyMetric = {
  period: string;
  year: number;
  month: number;
  costCode: string;
  costCodeName: string | null;
  reportingGroup: string;
  topLevelGroup: string;
  sales: number;
  cost: number;
  profit: number;
  marginPercent: number | null;
  projectCount: number;
  lineCount: number;
};

type ProjectMetric = {
  period: string;
  costCode: string;
  costCodeName: string | null;
  reportingGroup: string;
  topLevelGroup: string;
  projectId: string;
  projectName: string;
  projectNumber: string | null;
  customer: string | null;
  proposalName: string | null;
  sales: number;
  cost: number;
  profit: number;
  marginPercent: number | null;
  lineCount: number;
};

type ApiResponse = {
  success: boolean;
  generatedAt: string;
  years: number[];
  topLevelGroups: string[];
  monthly: MonthlyMetric[];
  projectBreakdown: ProjectMetric[];
  unassignedItems: UnassignedItem[];
  error?: string;
};

type UnassignedItem = {
  period: string;
  costItemId: string;
  itemName: string;
  sales: number;
  cost: number;
  profit: number;
  projectIds: string[];
  projectCount: number;
  lineCount: number;
};

type CostCodeTotal = {
  costCode: string;
  costCodeName: string | null;
  reportingGroup: string;
  topLevelGroup: string;
  sales: number;
  cost: number;
  profit: number;
  marginPercent: number | null;
  projectCount: number;
  lineCount: number;
};

type CostNameTotal = {
  selectionKey: string;
  costName: string;
  topLevelGroup: string;
  sales: number;
  cost: number;
  profit: number;
  marginPercent: number | null;
  projectCount: number;
  lineCount: number;
  codeCount: number;
};

type TopLevelTotal = {
  topLevelGroup: string;
  sales: number;
  cost: number;
  profit: number;
  marginPercent: number | null;
  projectCount: number;
  lineCount: number;
  reportingGroupCount: number;
  codeCount: number;
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const monthNames = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date(2020, index, 1)),
);

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function canonicalTopLevelGroup(value: string) {
  return value.trim().toLowerCase() === "job cost" ? "Job Cost" : value.trim();
}

export default function CostCodeSalesPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [year, setYear] = useState<number | "all">("all");
  const [month, setMonth] = useState<number | "all">("all");
  const [selectedTopLevel, setSelectedTopLevel] = useState<string>("all");
  const [selectedName, setSelectedName] = useState<string>("all");
  const [selectedCode, setSelectedCode] = useState<string>("all");
  const [projectSearch, setProjectSearch] = useState("");
  const [unassignedSearch, setUnassignedSearch] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/analytics/cost-code-sales", { cache: "no-store" });
        const body = await response.json() as ApiResponse;
        if (!response.ok || !body.success) throw new Error(body.error || "Unable to load cost-code analytics.");
        if (!active) return;
        setData(body);
        setYear(body.years[0] ?? "all");
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load cost-code analytics.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  const periodRows = useMemo(() => (data?.monthly || []).filter((row) =>
    (year === "all" || row.year === year) && (month === "all" || row.month === month),
  ), [data, year, month]);

  const costCodeTotals = useMemo(() => {
    const totals = new Map<string, CostCodeTotal>();
    for (const row of periodRows) {
      const topLevelGroup = canonicalTopLevelGroup(row.topLevelGroup);
      const key = `${topLevelGroup}|${row.reportingGroup}|${row.costCode}`;
      const current = totals.get(key) ?? {
        costCode: row.costCode,
        costCodeName: row.costCodeName,
        reportingGroup: row.reportingGroup,
        topLevelGroup,
        sales: 0,
        cost: 0,
        profit: 0,
        marginPercent: null,
        projectCount: 0,
        lineCount: 0,
      };
      current.sales += row.sales;
      current.cost += row.cost;
      current.profit += row.profit;
      current.lineCount += row.lineCount;
      current.projectCount += row.projectCount;
      totals.set(key, current);
    }
    return [...totals.values()]
      .map((row) => ({
        ...row,
        marginPercent: row.sales ? (row.profit / row.sales) * 100 : null,
      }))
      .sort((left, right) => right.sales - left.sales);
  }, [periodRows]);

  const costNameTotals = useMemo(() => {
    const totals = new Map<string, CostNameTotal>();
    for (const row of costCodeTotals) {
      const costName = row.reportingGroup;
      const selectionKey = `${row.topLevelGroup}|${costName}`;
      const current = totals.get(selectionKey) ?? {
        selectionKey,
        costName,
        topLevelGroup: row.topLevelGroup,
        sales: 0,
        cost: 0,
        profit: 0,
        marginPercent: null,
        projectCount: 0,
        lineCount: 0,
        codeCount: 0,
      };
      current.sales += row.sales;
      current.cost += row.cost;
      current.profit += row.profit;
      current.projectCount += row.projectCount;
      current.lineCount += row.lineCount;
      current.codeCount += 1;
      totals.set(selectionKey, current);
    }
    return [...totals.values()]
      .map((row) => ({
        ...row,
        marginPercent: row.sales ? (row.profit / row.sales) * 100 : null,
      }))
      .sort((left, right) => right.sales - left.sales);
  }, [costCodeTotals]);

  const topLevelTotals = useMemo(() => {
    const totals = new Map<string, TopLevelTotal>((data?.topLevelGroups || []).map((topLevelGroup) => [
      topLevelGroup,
      {
        topLevelGroup,
        sales: 0,
        cost: 0,
        profit: 0,
        marginPercent: null,
        projectCount: 0,
        lineCount: 0,
        reportingGroupCount: 0,
        codeCount: 0,
      },
    ]));
    for (const row of costNameTotals) {
      const current = totals.get(row.topLevelGroup) ?? {
        topLevelGroup: row.topLevelGroup,
        sales: 0,
        cost: 0,
        profit: 0,
        marginPercent: null,
        projectCount: 0,
        lineCount: 0,
        reportingGroupCount: 0,
        codeCount: 0,
      };
      current.sales += row.sales;
      current.cost += row.cost;
      current.profit += row.profit;
      current.projectCount += row.projectCount;
      current.lineCount += row.lineCount;
      current.reportingGroupCount += 1;
      current.codeCount += row.codeCount;
      totals.set(row.topLevelGroup, current);
    }
    return [...totals.values()]
      .map((row) => ({
        ...row,
        marginPercent: row.sales ? (row.profit / row.sales) * 100 : null,
      }))
      .sort((left, right) => right.sales - left.sales);
  }, [costNameTotals, data]);

  const drilledReportingGroups = useMemo(() => selectedTopLevel === "all"
    ? []
    : costNameTotals.filter((row) => row.topLevelGroup === selectedTopLevel),
  [costNameTotals, selectedTopLevel]);

  const drilledCostCodes = useMemo(() => selectedName === "all"
    ? []
    : costCodeTotals.filter((row) => `${row.topLevelGroup}|${row.reportingGroup}` === selectedName),
  [costCodeTotals, selectedName]);

  const visibleUnassignedItems = useMemo(() => {
    const term = unassignedSearch.trim().toLowerCase();
    const groups = new Map<string, UnassignedItem>();
    for (const row of data?.unassignedItems || []) {
      const [rowYear, rowMonth] = row.period.split("-").map(Number);
      if (year !== "all" && rowYear !== year) continue;
      if (month !== "all" && rowMonth !== month) continue;
      if (term && ![row.itemName, row.costItemId].some((value) => value.toLowerCase().includes(term))) continue;
      const key = `${row.costItemId}:${row.itemName}`;
      const group = groups.get(key) ?? { ...row, period: "filtered" };
      if (groups.has(key)) {
        group.sales += row.sales;
        group.cost += row.cost;
        group.profit += row.profit;
        group.projectIds = [...new Set([...group.projectIds, ...row.projectIds])];
        group.projectCount = group.projectIds.length;
        group.lineCount += row.lineCount;
      }
      groups.set(key, group);
    }
    return [...groups.values()].sort((left, right) => right.sales - left.sales || left.itemName.localeCompare(right.itemName));
  }, [data, month, unassignedSearch, year]);

  const visibleProjects = useMemo(() => {
    const term = projectSearch.trim().toLowerCase();
    return (data?.projectBreakdown || []).filter((row) => {
      const [rowYear, rowMonth] = row.period.split("-").map(Number);
      if (year !== "all" && rowYear !== year) return false;
      if (month !== "all" && rowMonth !== month) return false;
      if (selectedTopLevel !== "all" && canonicalTopLevelGroup(row.topLevelGroup) !== selectedTopLevel) return false;
      if (selectedName !== "all" && `${canonicalTopLevelGroup(row.topLevelGroup)}|${row.reportingGroup}` !== selectedName) return false;
      if (selectedCode !== "all" && row.costCode !== selectedCode) return false;
      return !term || [row.projectName, row.projectNumber, row.customer]
        .some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [data, month, projectSearch, selectedCode, selectedName, selectedTopLevel, year]);

  const totals = useMemo(() => costCodeTotals.reduce((sum, row) => ({
    sales: sum.sales + row.sales,
    cost: sum.cost + row.cost,
    profit: sum.profit + row.profit,
  }), { sales: 0, cost: 0, profit: 0 }), [costCodeTotals]);

  const chartRows = topLevelTotals;
  const chartData = {
    labels: chartRows.map((row) => row.topLevelGroup),
    datasets: [
      { label: "Estimated sales", data: chartRows.map((row) => row.sales), backgroundColor: "#0f766e" },
      { label: "Estimated cost", data: chartRows.map((row) => row.cost), backgroundColor: "#d97706" },
    ],
  };

  function exportCsv() {
    const rows = visibleProjects.map((row) => [
      row.period,
      row.topLevelGroup,
      row.reportingGroup,
      row.costCode,
      row.costCodeName,
      row.projectNumber,
      row.projectName,
      row.customer,
      row.sales,
      row.cost,
      row.profit,
      row.marginPercent,
      row.lineCount,
    ]);
    const headers = ["Period", "Top-level Group", "Reporting Group", "Cost Code", "Cost Name", "Project Number", "Project", "Customer", "Sales", "Cost", "Profit", "Margin %", "Line Count"];
    const blob = new Blob([[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cost-code-profitability-${year}-${month}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportUnassignedCsv() {
    const headers = ["Cost Item ID", "Item Name", "Projects", "Estimate Lines", "Sales", "Cost", "Profit"];
    const rows = visibleUnassignedItems.map((row) => [
      row.costItemId,
      row.itemName,
      row.projectCount,
      row.lineCount,
      row.sales,
      row.cost,
      row.profit,
    ]);
    const blob = new Blob([[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `unassigned-cost-items-${year}-${month}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const periodLabel = year === "all"
    ? "All bid years"
    : month === "all"
      ? String(year)
      : `${monthNames[month - 1]} ${year}`;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1700px] space-y-5">
        <header className="border-b-4 border-teal-700 bg-white px-5 py-6 shadow-sm sm:px-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.2em] text-teal-700">Advanced analytics</div>
              <h1 className="mt-2 text-3xl font-black text-slate-950 sm:text-4xl">Sales & Cost by Cost Group</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Selected Procore primary estimates grouped by bid-created year and month. Use QBO P&amp;L for booked accounting revenue.
              </p>
            </div>
            {data?.generatedAt && <div className="text-xs font-semibold text-slate-500">Updated {new Date(data.generatedAt).toLocaleString()}</div>}
          </div>
        </header>

        {error && <div role="alert" className="border border-red-300 bg-red-50 px-4 py-3 font-semibold text-red-800">{error}</div>}

        <section className="border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[220px_220px_1fr_auto]">
            <label className="text-xs font-black uppercase text-slate-600">
              Year
              <select value={year} onChange={(event) => { setYear(event.target.value === "all" ? "all" : Number(event.target.value)); setMonth("all"); setSelectedTopLevel("all"); setSelectedName("all"); setSelectedCode("all"); }} className="mt-1 h-11 w-full border border-slate-300 bg-white px-3 text-sm">
                <option value="all">All years</option>
                {(data?.years || []).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="text-xs font-black uppercase text-slate-600">
              Month
              <select value={month} onChange={(event) => { setMonth(event.target.value === "all" ? "all" : Number(event.target.value)); setSelectedTopLevel("all"); setSelectedName("all"); setSelectedCode("all"); }} className="mt-1 h-11 w-full border border-slate-300 bg-white px-3 text-sm">
                <option value="all">All months</option>
                {monthNames.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
              </select>
            </label>
            <div className="self-end text-sm text-slate-600">
              <span className="font-black text-slate-900">{periodLabel}</span> · {topLevelTotals.length.toLocaleString()} top-level groups · {costNameTotals.length.toLocaleString()} reporting groups
            </div>
            <button type="button" onClick={exportCsv} disabled={!visibleProjects.length} className="h-11 self-end bg-teal-800 px-5 text-sm font-black text-white hover:bg-teal-700 disabled:bg-slate-300">Export CSV</button>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Estimated sales", totals.sales, "text-teal-800"],
            ["Estimated cost", totals.cost, "text-amber-700"],
            ["Gross profit", totals.profit, totals.profit >= 0 ? "text-emerald-700" : "text-red-700"],
            ["Margin", totals.sales ? (totals.profit / totals.sales) * 100 : null, "text-slate-900"],
          ].map(([label, value, color]) => (
            <div key={String(label)} className="border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <div className="text-xs font-black uppercase text-slate-500">{label}</div>
              <div className={`mt-1 text-2xl font-black ${color}`}>{label === "Margin" ? `${percent.format(Number(value || 0))}%` : money.format(Number(value || 0))}</div>
            </div>
          ))}
        </section>

        <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(520px,0.9fr)]">
          <div className="min-w-0 border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-black">Top-level groups</h2>
              <p className="text-xs text-slate-500">All authoritative groups ranked by estimated sales</p>
            </div>
            <div className="h-[430px]">
              {loading ? <div className="grid h-full place-items-center font-semibold text-slate-500">Loading analytics…</div> : <Bar data={chartData} options={{ indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { x: { beginAtZero: true, ticks: { callback: (value) => `$${Number(value).toLocaleString()}` } }, y: { ticks: { autoSkip: false, font: { size: 10 } } } } }} />}
            </div>
          </div>

          <div className="min-w-0 overflow-hidden border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-black">Top-level performance</h2>
              <p className="text-xs text-slate-500">Select a top-level group to view its reporting groups</p>
            </div>
            <div className="max-h-[430px] max-w-full overflow-auto">
              <table className="min-w-[720px] text-sm">
                <thead className="sticky top-0 bg-slate-100 text-xs font-black uppercase text-slate-600">
                  <tr><th className="px-4 py-3 text-left">Top-level group</th><th className="px-4 py-3 text-right">Groups</th><th className="px-4 py-3 text-right">Sales</th><th className="px-4 py-3 text-right">Cost</th><th className="px-4 py-3 text-right">Profit</th><th className="px-4 py-3 text-right">Margin</th></tr>
                </thead>
                <tbody>
                  {topLevelTotals.map((row) => (
                    <tr key={row.topLevelGroup} onClick={() => { setSelectedTopLevel(selectedTopLevel === row.topLevelGroup ? "all" : row.topLevelGroup); setSelectedName("all"); setSelectedCode("all"); }} className={`cursor-pointer border-t border-slate-100 hover:bg-teal-50 ${selectedTopLevel === row.topLevelGroup ? "bg-teal-50" : ""}`}>
                      <td className="px-4 py-3 font-black text-slate-800">{row.topLevelGroup}</td>
                      <td className="px-4 py-3 text-right">{row.reportingGroupCount.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-semibold">{money.format(row.sales)}</td>
                      <td className="px-4 py-3 text-right">{money.format(row.cost)}</td>
                      <td className={`px-4 py-3 text-right font-bold ${row.profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{money.format(row.profit)}</td>
                      <td className="px-4 py-3 text-right">{row.marginPercent == null ? "—" : `${percent.format(row.marginPercent)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {selectedTopLevel !== "all" && (
          <section className="min-w-0 overflow-hidden border border-teal-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-teal-200 bg-teal-50 px-5 py-4">
              <div>
                <h2 className="text-lg font-black">Reporting-group drill through</h2>
                <p className="text-xs font-semibold text-teal-800">{selectedTopLevel} · {drilledReportingGroups.length.toLocaleString()} reporting groups</p>
              </div>
              <button type="button" onClick={() => { setSelectedTopLevel("all"); setSelectedName("all"); setSelectedCode("all"); }} className="border border-teal-700 px-3 py-2 text-xs font-black text-teal-800 hover:bg-white">Clear drill through</button>
            </div>
            <div className="max-h-[430px] max-w-full overflow-auto">
              <table className="min-w-[760px] text-sm">
                <thead className="sticky top-0 bg-slate-100 text-xs font-black uppercase text-slate-600">
                  <tr><th className="px-4 py-3 text-left">Reporting group</th><th className="px-4 py-3 text-right">Codes</th><th className="px-4 py-3 text-right">Sales</th><th className="px-4 py-3 text-right">Cost</th><th className="px-4 py-3 text-right">Profit</th><th className="px-4 py-3 text-right">Margin</th></tr>
                </thead>
                <tbody>
                  {drilledReportingGroups.map((row) => (
                    <tr key={row.selectionKey} onClick={() => { setSelectedName(selectedName === row.selectionKey ? "all" : row.selectionKey); setSelectedCode("all"); }} className={`cursor-pointer border-t border-slate-100 hover:bg-teal-50 ${selectedName === row.selectionKey ? "bg-teal-100" : ""}`}>
                      <td className="px-4 py-3 font-black text-slate-800">{row.costName}</td>
                      <td className="px-4 py-3 text-right">{row.codeCount.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-semibold">{money.format(row.sales)}</td>
                      <td className="px-4 py-3 text-right">{money.format(row.cost)}</td>
                      <td className={`px-4 py-3 text-right font-bold ${row.profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{money.format(row.profit)}</td>
                      <td className="px-4 py-3 text-right">{row.marginPercent == null ? "—" : `${percent.format(row.marginPercent)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {selectedName !== "all" && (
          <section className="min-w-0 overflow-hidden border border-teal-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-teal-200 bg-teal-50 px-5 py-4">
              <div>
                <h2 className="text-lg font-black">Cost-code drill through</h2>
                <p className="text-xs font-semibold text-teal-800">{selectedName.replace("|", " · ")} · {drilledCostCodes.length.toLocaleString()} codes</p>
              </div>
              <button type="button" onClick={() => { setSelectedName("all"); setSelectedCode("all"); }} className="border border-teal-700 px-3 py-2 text-xs font-black text-teal-800 hover:bg-white">Back to reporting groups</button>
            </div>
            <div className="max-h-[360px] max-w-full overflow-auto">
              <table className="min-w-[760px] text-sm">
                <thead className="sticky top-0 bg-slate-100 text-xs font-black uppercase text-slate-600">
                  <tr><th className="px-4 py-3 text-left">Cost code</th><th className="px-4 py-3 text-right">Sales</th><th className="px-4 py-3 text-right">Cost</th><th className="px-4 py-3 text-right">Profit</th><th className="px-4 py-3 text-right">Margin</th></tr>
                </thead>
                <tbody>
                  {drilledCostCodes.map((row) => (
                    <tr key={`${row.topLevelGroup}:${row.reportingGroup}:${row.costCode}`} onClick={() => setSelectedCode(selectedCode === row.costCode ? "all" : row.costCode)} className={`cursor-pointer border-t border-slate-100 hover:bg-teal-50 ${selectedCode === row.costCode ? "bg-teal-100" : ""}`}>
                      <td className="px-4 py-3 font-black text-slate-800">{row.costCode}</td>
                      <td className="px-4 py-3 text-right font-semibold">{money.format(row.sales)}</td>
                      <td className="px-4 py-3 text-right">{money.format(row.cost)}</td>
                      <td className={`px-4 py-3 text-right font-bold ${row.profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{money.format(row.profit)}</td>
                      <td className="px-4 py-3 text-right">{row.marginPercent == null ? "—" : `${percent.format(row.marginPercent)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {selectedName === "Unassigned|Unmapped cost items" && (
          <section className="min-w-0 overflow-hidden border border-amber-300 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-amber-300 bg-amber-50 px-5 py-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-lg font-black">Unassigned item list</h2>
                <p className="text-xs font-semibold text-amber-900">Distinct estimate catalog items with no cost-code mapping</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="text-xs font-black uppercase text-slate-600">
                  Search items
                  <input value={unassignedSearch} onChange={(event) => setUnassignedSearch(event.target.value)} placeholder="Item name or ID" className="mt-1 h-10 w-full min-w-[240px] border border-slate-300 bg-white px-3 text-sm font-normal normal-case" />
                </label>
                <button type="button" onClick={exportUnassignedCsv} disabled={!visibleUnassignedItems.length} className="h-10 bg-amber-700 px-4 text-sm font-black text-white hover:bg-amber-600 disabled:bg-slate-300">Export unassigned</button>
              </div>
            </div>
            <div className="max-h-[460px] max-w-full overflow-auto">
              <table className="min-w-[900px] text-sm">
                <thead className="sticky top-0 bg-slate-100 text-xs font-black uppercase text-slate-600">
                  <tr><th className="px-4 py-3 text-left">Item ID</th><th className="px-4 py-3 text-left">Item name</th><th className="px-4 py-3 text-right">Projects</th><th className="px-4 py-3 text-right">Lines</th><th className="px-4 py-3 text-right">Sales</th><th className="px-4 py-3 text-right">Cost</th><th className="px-4 py-3 text-right">Profit</th></tr>
                </thead>
                <tbody>
                  {visibleUnassignedItems.map((row) => (
                    <tr key={`${row.costItemId}:${row.itemName}`} className="border-t border-slate-100 hover:bg-amber-50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-bold text-slate-700">{row.costItemId}</td>
                      <td className="px-4 py-3 font-bold text-slate-900">{row.itemName}</td>
                      <td className="px-4 py-3 text-right">{row.projectCount.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">{row.lineCount.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-semibold">{money.format(row.sales)}</td>
                      <td className="px-4 py-3 text-right">{money.format(row.cost)}</td>
                      <td className={`px-4 py-3 text-right font-bold ${row.profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{money.format(row.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="min-w-0 overflow-hidden border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-black">Project breakdown</h2>
              <p className="text-xs text-slate-500">{selectedTopLevel === "all" ? "All top-level groups" : selectedTopLevel}{selectedName === "all" ? "" : ` · ${selectedName.split("|")[1]}`}{selectedCode === "all" ? "" : ` · ${selectedCode}`} · {visibleProjects.length.toLocaleString()} project groups</p>
            </div>
            <label className="text-xs font-black uppercase text-slate-600">
              Search projects
              <input value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="Project, number, or customer" className="mt-1 h-10 w-full min-w-[300px] border border-slate-300 px-3 text-sm font-normal normal-case" />
            </label>
          </div>
          <div className="max-h-[560px] max-w-full overflow-auto">
            <table className="min-w-[1050px] text-sm">
              <thead className="sticky top-0 bg-slate-100 text-xs font-black uppercase text-slate-600">
                <tr><th className="px-4 py-3 text-left">Period</th><th className="px-4 py-3 text-left">Cost code</th><th className="px-4 py-3 text-left">Project</th><th className="px-4 py-3 text-left">Customer</th><th className="px-4 py-3 text-right">Sales</th><th className="px-4 py-3 text-right">Cost</th><th className="px-4 py-3 text-right">Profit</th><th className="px-4 py-3 text-right">Margin</th></tr>
              </thead>
              <tbody>
                {visibleProjects.map((row) => (
                  <tr key={`${row.period}:${row.topLevelGroup}:${row.reportingGroup}:${row.costCode}:${row.projectId}`} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3">{monthNames[Number(row.period.slice(5, 7)) - 1].slice(0, 3)} {row.period.slice(0, 4)}</td>
                    <td className="px-4 py-3">
                      <div className="whitespace-nowrap font-bold">{row.costCode}</div>
                      <div className="whitespace-nowrap text-xs font-semibold text-slate-500">{row.reportingGroup}</div>
                    </td>
                    <td className="px-4 py-3"><div className="font-bold text-slate-900">{row.projectName}</div><div className="text-xs text-slate-500">{row.projectNumber || row.proposalName || "No project number"}</div></td>
                    <td className="px-4 py-3 text-slate-600">{row.customer || "Unknown"}</td>
                    <td className="px-4 py-3 text-right font-semibold">{money.format(row.sales)}</td>
                    <td className="px-4 py-3 text-right">{money.format(row.cost)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${row.profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{money.format(row.profit)}</td>
                    <td className="px-4 py-3 text-right">{row.marginPercent == null ? "—" : `${percent.format(row.marginPercent)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}