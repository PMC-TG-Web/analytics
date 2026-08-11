"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
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
  status: string;
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
  status: string;
  costCode: string;
  costCodeName: string | null;
  reportingGroup: string;
  topLevelGroup: string;
  projectId: string;
  procoreProjectId: string | null;
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

type ProjectTotal = {
  projectKey: string;
  projectName: string;
  projectNumber: string | null;
  procoreProjectId: string | null;
  status: string;
  customers: Set<string>;
  proposalName: string | null;
  sales: number;
  cost: number;
  profit: number;
  marginPercent: number | null;
  qboActualProfit: number | null;
  qboActualMarginPercent: number | null;
  qboActualCost: number | null;
  costVariance: number | null;
  qboProjectName: string | null;
  details: ProjectMetric[];
};

type QboSnapshot = {
  id: string;
  startDate: string;
  endDate: string;
  accountingMethod: string;
  sourceGeneratedAt: string;
  importedAt: string;
};

type QboProjectActual = {
  procoreProjectId: string;
  qboProjectName: string | null;
  matchMethod: string | null;
  sales: number;
  actualCost: number;
  profit: number;
  marginPercent: number | null;
  rowCount: number;
};

type ApiResponse = {
  success: boolean;
  generatedAt: string;
  years: number[];
  statuses: string[];
  qboSnapshot: QboSnapshot | null;
  qboActuals: QboProjectActual[];
  topLevelGroups: string[];
  monthly: MonthlyMetric[];
  projectBreakdown: ProjectMetric[];
  unassignedItems: UnassignedItem[];
  error?: string;
};

type UnassignedItem = {
  period: string;
  status: string;
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

function formatSnapshotDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

export default function CostCodeSalesPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [year, setYear] = useState<number | "all">("all");
  const [month, setMonth] = useState<number | "all">("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedTopLevel, setSelectedTopLevel] = useState<string>("all");
  const [selectedName, setSelectedName] = useState<string>("all");
  const [selectedCode, setSelectedCode] = useState<string>("all");
  const [projectSearch, setProjectSearch] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());
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
    (year === "all" || row.year === year)
    && (month === "all" || row.month === month)
    && (selectedStatus === "all" || row.status === selectedStatus),
  ), [data, year, month, selectedStatus]);

  const qboActualsByProject = useMemo(() => new Map(
    (data?.qboActuals || []).map((actual) => [actual.procoreProjectId, actual]),
  ), [data]);

  const qboComparison = useMemo(() => {
    const projects = new Map<string, { procoreProjectId: string | null; estimatedCost: number }>();
    for (const row of data?.projectBreakdown || []) {
      const [rowYear, rowMonth] = row.period.split("-").map(Number);
      if (year !== "all" && rowYear !== year) continue;
      if (month !== "all" && rowMonth !== month) continue;
      if (selectedStatus !== "all" && row.status !== selectedStatus) continue;
      const project = projects.get(row.projectId) ?? {
        procoreProjectId: row.procoreProjectId,
        estimatedCost: 0,
      };
      project.estimatedCost += row.cost;
      projects.set(row.projectId, project);
    }
    const matchedProcoreIds = new Set<string>();
    let matchedProjectCount = 0;
    let matchedEstimatedCost = 0;
    for (const { procoreProjectId, estimatedCost } of projects.values()) {
      if (!procoreProjectId || !qboActualsByProject.has(procoreProjectId)) continue;
      matchedProjectCount += 1;
      matchedEstimatedCost += estimatedCost;
      matchedProcoreIds.add(procoreProjectId);
    }
    const actualCost = [...matchedProcoreIds].reduce(
      (sum, procoreProjectId) => sum + (qboActualsByProject.get(procoreProjectId)?.actualCost || 0),
      0,
    );
    return {
      actualCost,
      matchedEstimatedCost,
      projectCount: projects.size,
      matchedProjectCount,
    };
  }, [data, month, qboActualsByProject, selectedStatus, year]);

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
      if (selectedStatus !== "all" && row.status !== selectedStatus) continue;
      if (term && ![row.itemName, row.costItemId].some((value) => value.toLowerCase().includes(term))) continue;
      const key = `${row.status}:${row.costItemId}:${row.itemName}`;
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
  }, [data, month, selectedStatus, unassignedSearch, year]);

  const visibleProjects = useMemo(() => {
    const term = projectSearch.trim().toLowerCase();
    return (data?.projectBreakdown || []).filter((row) => {
      const [rowYear, rowMonth] = row.period.split("-").map(Number);
      if (year !== "all" && rowYear !== year) return false;
      if (month !== "all" && rowMonth !== month) return false;
      if (selectedStatus !== "all" && row.status !== selectedStatus) return false;
      if (selectedTopLevel !== "all" && canonicalTopLevelGroup(row.topLevelGroup) !== selectedTopLevel) return false;
      if (selectedName !== "all" && `${canonicalTopLevelGroup(row.topLevelGroup)}|${row.reportingGroup}` !== selectedName) return false;
      if (selectedCode !== "all" && row.costCode !== selectedCode) return false;
      return !term || [row.projectName, row.projectNumber, row.customer]
        .some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [data, month, projectSearch, selectedCode, selectedName, selectedStatus, selectedTopLevel, year]);

  const showProjectCostComparison = selectedTopLevel === "all"
    && selectedName === "all"
    && selectedCode === "all";

  const projectTotals = useMemo(() => {
    const projects = new Map<string, ProjectTotal>();
    for (const row of visibleProjects) {
      const projectKey = row.procoreProjectId
        || String(row.projectNumber || row.projectName).trim().toLowerCase();
      const current = projects.get(projectKey) ?? {
        projectKey,
        projectName: row.projectName,
        projectNumber: row.projectNumber,
        procoreProjectId: row.procoreProjectId,
        status: row.status,
        customers: new Set<string>(),
        proposalName: row.proposalName,
        sales: 0,
        cost: 0,
        profit: 0,
        marginPercent: null,
        qboActualProfit: row.procoreProjectId
          ? qboActualsByProject.get(row.procoreProjectId)?.profit ?? null
          : null,
        qboActualMarginPercent: row.procoreProjectId
          ? qboActualsByProject.get(row.procoreProjectId)?.marginPercent ?? null
          : null,
        qboActualCost: row.procoreProjectId
          ? qboActualsByProject.get(row.procoreProjectId)?.actualCost ?? null
          : null,
        costVariance: null,
        qboProjectName: row.procoreProjectId
          ? qboActualsByProject.get(row.procoreProjectId)?.qboProjectName ?? null
          : null,
        details: [],
      };
      current.sales += row.sales;
      current.cost += row.cost;
      current.profit += row.profit;
      if (row.customer) current.customers.add(row.customer);
      current.details.push(row);
      projects.set(projectKey, current);
    }
    return [...projects.values()]
      .map((project) => ({
        ...project,
        marginPercent: project.sales ? (project.profit / project.sales) * 100 : null,
        costVariance: !showProjectCostComparison || project.qboActualCost == null
          ? null
          : project.cost - project.qboActualCost,
        details: project.details.sort((left, right) =>
          left.period.localeCompare(right.period)
          || left.topLevelGroup.localeCompare(right.topLevelGroup)
          || left.reportingGroup.localeCompare(right.reportingGroup)
          || left.costCode.localeCompare(right.costCode)),
      }))
      .sort((left, right) => right.sales - left.sales || left.projectName.localeCompare(right.projectName));
  }, [qboActualsByProject, showProjectCostComparison, visibleProjects]);

  function toggleProject(projectKey: string) {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectKey)) next.delete(projectKey);
      else next.add(projectKey);
      return next;
    });
  }

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
      row.status,
      row.sales,
      row.cost,
      row.profit,
      row.marginPercent,
      row.lineCount,
    ]);
    const headers = ["Period", "Top-level Group", "Reporting Group", "Cost Code", "Cost Name", "Project Number", "Project", "Customer", "Procore Status", "Sales", "Cost", "Profit", "Margin %", "Line Count"];
    const blob = new Blob([[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cost-code-profitability-${year}-${month}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportUnassignedCsv() {
    const headers = ["Procore Status", "Cost Item ID", "Item Name", "Projects", "Estimate Lines", "Sales", "Cost", "Profit"];
    const rows = visibleUnassignedItems.map((row) => [
      row.status,
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[190px_190px_220px_1fr_auto]">
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
            <label className="text-xs font-black uppercase text-slate-600">
              Procore status
              <select value={selectedStatus} onChange={(event) => { setSelectedStatus(event.target.value); setSelectedTopLevel("all"); setSelectedName("all"); setSelectedCode("all"); }} className="mt-1 h-11 w-full border border-slate-300 bg-white px-3 text-sm">
                <option value="all">All statuses</option>
                {(data?.statuses || []).map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </label>
            <div className="self-end text-sm text-slate-600">
              <span className="font-black text-slate-900">{periodLabel}</span> · {selectedStatus === "all" ? "All Procore statuses" : selectedStatus} · {topLevelTotals.length.toLocaleString()} top-level groups · {costNameTotals.length.toLocaleString()} reporting groups
            </div>
            <button type="button" onClick={exportCsv} disabled={!visibleProjects.length} className="h-11 self-end bg-teal-800 px-5 text-sm font-black text-white hover:bg-teal-700 disabled:bg-slate-300">Export CSV</button>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
          {[
            ["Estimated sales", totals.sales, "text-teal-800"],
            ["Estimated cost", totals.cost, "text-amber-700"],
            ["Gross profit", totals.profit, totals.profit >= 0 ? "text-emerald-700" : "text-red-700"],
            ["Margin", totals.sales ? (totals.profit / totals.sales) * 100 : null, "text-slate-900"],
            ["Matched estimated cost", data?.qboSnapshot ? qboComparison.matchedEstimatedCost : null, "text-amber-700"],
            ["Matched QB actual cost", data?.qboSnapshot ? qboComparison.actualCost : null, "text-sky-800"],
            ["Matched cost variance", data?.qboSnapshot ? qboComparison.matchedEstimatedCost - qboComparison.actualCost : null, qboComparison.matchedEstimatedCost - qboComparison.actualCost >= 0 ? "text-emerald-700" : "text-red-700"],
          ].map(([label, value, color]) => (
            <div key={String(label)} className="border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <div className="text-xs font-black uppercase text-slate-500">{label}</div>
              <div className={`mt-1 text-2xl font-black ${color}`}>{value == null ? "—" : label === "Margin" ? `${percent.format(Number(value))}%` : money.format(Number(value))}</div>
            </div>
          ))}
        </section>

        <section className="border border-sky-200 bg-sky-50 px-5 py-4 text-sm text-sky-950 shadow-sm">
          {data?.qboSnapshot ? (
            <div className="flex flex-col gap-1 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
              <div className="font-bold">
                QuickBooks actual cost · {formatSnapshotDate(data.qboSnapshot.startDate)} to {formatSnapshotDate(data.qboSnapshot.endDate)} · {data.qboSnapshot.accountingMethod} basis
              </div>
              <div className="text-xs font-semibold text-sky-800">
                {qboComparison.matchedProjectCount.toLocaleString()} of {qboComparison.projectCount.toLocaleString()} filtered estimate projects matched · imported {new Date(data.qboSnapshot.importedAt).toLocaleString()}
              </div>
            </div>
          ) : (
            <div className="font-bold">No QuickBooks profitability snapshot is available.</div>
          )}
          <p className="mt-1 text-xs text-sky-800">QuickBooks actuals are project-level totals for the snapshot period. Matched variance uses only matched projects; cost-group drill-through values remain estimate-only.</p>
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
              <table className="min-w-[1000px] text-sm">
                <thead className="sticky top-0 bg-slate-100 text-xs font-black uppercase text-slate-600">
                  <tr><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Item ID</th><th className="px-4 py-3 text-left">Item name</th><th className="px-4 py-3 text-right">Projects</th><th className="px-4 py-3 text-right">Lines</th><th className="px-4 py-3 text-right">Sales</th><th className="px-4 py-3 text-right">Cost</th><th className="px-4 py-3 text-right">Profit</th></tr>
                </thead>
                <tbody>
                  {visibleUnassignedItems.map((row) => (
                    <tr key={`${row.status}:${row.costItemId}:${row.itemName}`} className="border-t border-slate-100 hover:bg-amber-50">
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-700">{row.status}</td>
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
              <p className="text-xs text-slate-500">{selectedTopLevel === "all" ? "All top-level groups" : selectedTopLevel}{selectedName === "all" ? "" : ` · ${selectedName.split("|")[1]}`}{selectedCode === "all" ? "" : ` · ${selectedCode}`} · {projectTotals.length.toLocaleString()} projects · {projectTotals.filter((project) => project.qboActualCost != null).length.toLocaleString()} QB matches</p>
            </div>
            <label className="text-xs font-black uppercase text-slate-600">
              Search projects
              <input value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="Project, number, or customer" className="mt-1 h-10 w-full min-w-[300px] border border-slate-300 px-3 text-sm font-normal normal-case" />
            </label>
          </div>
          <div className="max-h-[560px] max-w-full overflow-auto">
            <table className="min-w-[1660px] text-sm">
              <thead className="sticky top-0 bg-slate-100 text-xs font-black uppercase text-slate-600">
                <tr><th className="w-12 px-4 py-3"><span className="sr-only">Expand</span></th><th className="px-4 py-3 text-left">Project</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Customer</th><th className="px-4 py-3 text-right">Details</th><th className="px-4 py-3 text-right">Sales</th><th className="px-4 py-3 text-right">Estimated cost</th><th className="px-4 py-3 text-right">QB actual cost</th><th className="px-4 py-3 text-right">Cost variance</th><th className="px-4 py-3 text-right">Estimated profit</th><th className="px-4 py-3 text-right">Actual profit</th><th className="px-4 py-3 text-right">Estimated margin</th><th className="px-4 py-3 text-right">Actual margin</th></tr>
              </thead>
              <tbody>
                {projectTotals.map((project) => {
                  const expanded = expandedProjects.has(project.projectKey);
                  return (
                    <Fragment key={project.projectKey}>
                      <tr className={`border-t border-slate-200 hover:bg-slate-50 ${expanded ? "bg-slate-50" : ""}`}>
                        <td className="px-4 py-3 text-center">
                          <button type="button" onClick={() => toggleProject(project.projectKey)} aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} ${project.projectName}`} className="h-8 w-8 border border-slate-300 bg-white text-lg font-black text-slate-700 hover:border-teal-600 hover:text-teal-800">{expanded ? "-" : "+"}</button>
                        </td>
                        <td className="px-4 py-3"><div className="font-bold text-slate-900">{project.projectName}</div><div className="text-xs text-slate-500">{project.projectNumber || project.proposalName || "No project number"}</div></td>
                        <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-700">{project.status}</td>
                        <td className="px-4 py-3 text-slate-600">{[...project.customers].join(", ") || "Unknown"}</td>
                        <td className="px-4 py-3 text-right">{project.details.length.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-semibold">{money.format(project.sales)}</td>
                        <td className="px-4 py-3 text-right">{money.format(project.cost)}</td>
                        <td className="px-4 py-3 text-right" title={project.qboProjectName || undefined}>{project.qboActualCost == null ? "—" : money.format(project.qboActualCost)}</td>
                        <td className={`px-4 py-3 text-right font-bold ${project.costVariance == null ? "text-slate-400" : project.costVariance >= 0 ? "text-emerald-700" : "text-red-700"}`}>{project.costVariance == null ? "—" : money.format(project.costVariance)}</td>
                        <td className={`px-4 py-3 text-right font-bold ${project.profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{money.format(project.profit)}</td>
                        <td className={`px-4 py-3 text-right font-bold ${project.qboActualProfit == null ? "text-slate-400" : project.qboActualProfit >= 0 ? "text-emerald-700" : "text-red-700"}`} title={project.qboProjectName || undefined}>{project.qboActualProfit == null ? "—" : money.format(project.qboActualProfit)}</td>
                        <td className="px-4 py-3 text-right">{project.marginPercent == null ? "—" : `${percent.format(project.marginPercent)}%`}</td>
                        <td className="px-4 py-3 text-right" title={project.qboProjectName || undefined}>{project.qboActualMarginPercent == null ? "—" : `${percent.format(project.qboActualMarginPercent)}%`}</td>
                      </tr>
                      {expanded && (
                        <tr className="bg-slate-50">
                          <td colSpan={13} className="px-4 pb-4 pl-16">
                            <div className="overflow-auto border border-slate-200 bg-white">
                              <table className="min-w-[1050px] text-xs">
                                <thead className="bg-slate-100 font-black uppercase text-slate-600">
                                  <tr><th className="px-3 py-2 text-left">Period</th><th className="px-3 py-2 text-left">Customer</th><th className="px-3 py-2 text-left">Top level</th><th className="px-3 py-2 text-left">Reporting group</th><th className="px-3 py-2 text-left">Cost code</th><th className="px-3 py-2 text-right">Sales</th><th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-right">Profit</th><th className="px-3 py-2 text-right">Margin</th></tr>
                                </thead>
                                <tbody>
                                  {project.details.map((row) => (
                                    <tr key={`${row.projectId}:${row.period}:${row.topLevelGroup}:${row.reportingGroup}:${row.costCode}`} className="border-t border-slate-100">
                                      <td className="whitespace-nowrap px-3 py-2">{monthNames[Number(row.period.slice(5, 7)) - 1].slice(0, 3)} {row.period.slice(0, 4)}</td>
                                      <td className="whitespace-nowrap px-3 py-2">{row.customer || "Unknown"}</td>
                                      <td className="whitespace-nowrap px-3 py-2">{canonicalTopLevelGroup(row.topLevelGroup)}</td>
                                      <td className="whitespace-nowrap px-3 py-2 font-semibold">{row.reportingGroup}</td>
                                      <td className="whitespace-nowrap px-3 py-2 font-mono font-bold">{row.costCode}</td>
                                      <td className="px-3 py-2 text-right font-semibold">{money.format(row.sales)}</td>
                                      <td className="px-3 py-2 text-right">{money.format(row.cost)}</td>
                                      <td className={`px-3 py-2 text-right font-bold ${row.profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{money.format(row.profit)}</td>
                                      <td className="px-3 py-2 text-right">{row.marginPercent == null ? "—" : `${percent.format(row.marginPercent)}%`}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}