"use client";

import { useEffect, useState } from "react";
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import type { ChartData } from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

type ProjectHours = {
  projectId: string;
  projectNumber: string | null;
  projectName: string;
  customer: string | null;
  status: string | null;
  originalHours: number;
  changeHours: number;
  expectedHours: number;
  usedHours: number;
  remainingHours: number;
};

type FinancialWipProject = {
  qboCustomerId: string;
  projectName: string;
  customerName: string | null;
  procoreProjectId: string | null;
  procoreProjectNumber: string | null;
  procoreProjectName: string | null;
  procoreStatus: string | null;
  contractValue: number | null;
  contractValueSource: string;
  netBilled: number | null;
  ytdBilled: number | null;
  revenueOnly: boolean;
  billingProgressPercent: number | null;
  remainingToBill: number | null;
  unbilledDollars: number;
  overbilledDollars: number;
};

type ApiResponse = {
  success?: boolean;
  generatedAt?: string;
  error?: string;
  details?: string;
  summary?: {
    projectCount: number;
    expectedHours: number;
    usedHours: number;
    remainingHours: number;
    averageMonthlyHours: number;
    leadTimeMonths: number | null;
    averageMonthCount: number;
    averagePeriodStart: string | null;
    averagePeriodEnd: string | null;
    averageSource: string;
    averageSourceUpdatedAt: string | null;
  };
  monthly?: Array<{ month: string; usedHours: number }>;
  revenueMonthly?: Array<{
    month: string;
    actualRevenue: number;
    subRevenue: number;
    totalRevenue: number;
  }>;
  revenueSummary?: {
    averageMonthlyRevenue: number;
    averageMonthCount: number;
    averagePeriodStart: string | null;
    averagePeriodEnd: string | null;
    sourceUpdatedAt: string | null;
  };
  financialWip?: {
    summary: {
      projectCount: number;
      includedProjectCount: number;
      unavailableProjectCount: number;
      contractProjectCount: number;
      billedProjectCount: number;
      billedWithoutContractProjectCount: number;
      billedWithoutContractDollars: number;
      revenueOnlyProjectCount: number;
      revenueOnlyBilledDollars: number;
      contractValue: number;
      netBilled: number;
      contractBackedNetBilled: number;
      unbilledDollars: number;
      overbilledDollars: number;
      averageMonthlyBilled: number;
      leadTimeMonths: number | null;
      averageMonthCount: number;
      averagePeriodStart: string | null;
      averagePeriodEnd: string | null;
      averageSource: string;
      averageSourceUpdatedAt: string | null;
      qboSnapshotId: string | null;
      qboImportedAt: string | null;
      qboPeriodStart: string | null;
      qboPeriodEnd: string | null;
      billingPeriodStart: string | null;
      billingPeriodEnd: string | null;
      billingAccountingMethod: string | null;
    };
    qboIncomeReconciliation: {
      periodStart: string | null;
      periodEnd: string | null;
      accountingMethod: string | null;
      companyIncome: number;
      selectedProjectIncome: number;
      filteredProjectIncome: number;
      nonProjectIncome: number;
      reconciledTotal: number;
      difference: number;
    } | null;
    projects: FinancialWipProject[];
  };
  projects?: ProjectHours[];
};

const hours = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function monthLabel(value: string | undefined) {
  if (!value) return "—";
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" })
    .format(new Date(year, month - 1, 1));
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function monthPeriod(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(period: string, count: number) {
  const [year, month] = period.split("-").map(Number);
  return monthPeriod(new Date(year, month - 1 + count, 1));
}

export default function MonthlyHoursPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [billingPeriod, setBillingPeriod] = useState<"ytd" | "lifetime">("ytd");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/analytics/monthly-hours", { cache: "no-store" });
        const body = await response.json() as ApiResponse;
        if (!response.ok || !body.success) {
          throw new Error(body.details || body.error || "Unable to load monthly hours.");
        }
        if (active) setData(body);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  const monthly = data?.monthly || [];
  const projects = data?.projects || [];
  const currentPeriod = monthPeriod(data?.generatedAt ? new Date(data.generatedAt) : new Date());
  const projectedMonthCount = Math.ceil(data?.summary?.leadTimeMonths || 0);
  const projectionEnd = addMonths(currentPeriod, projectedMonthCount);
  const chartPeriods = [...new Set([
    ...monthly.map((row) => row.month),
    ...Array.from({ length: projectedMonthCount + 1 }, (_, index) => addMonths(currentPeriod, index)),
  ])].sort();
  const actualHoursByMonth = new Map(monthly.map((row) => [row.month, row.usedHours]));
  const averageStart = data?.summary?.averagePeriodStart || currentPeriod;
  const averageMonthlyHours = data?.summary?.averageMonthlyHours || 0;
  const chartData: ChartData<"line", Array<number | null>, string> = {
    labels: chartPeriods.map((period) => monthLabel(period)),
    datasets: [{
      label: "Hours used",
      data: chartPeriods.map((period) => actualHoursByMonth.get(period) ?? null),
      borderColor: "#0f766e",
      backgroundColor: "rgba(15, 118, 110, 0.12)",
      pointBackgroundColor: "#0f766e",
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: 3,
      fill: true,
      tension: 0.25,
    }, {
      label: `KPI YTD average (${hours.format(averageMonthlyHours)} hrs/mo)`,
      data: chartPeriods.map((period) =>
        averageMonthlyHours > 0 && period >= averageStart && period <= projectionEnd
          ? averageMonthlyHours
          : null,
      ),
      borderColor: "#c2410c",
      backgroundColor: "#c2410c",
      pointRadius: 0,
      pointHoverRadius: 4,
      borderWidth: 2,
      borderDash: [8, 6],
      fill: false,
      tension: 0,
      spanGaps: true,
    }],
  };
  const revenueMonthly = data?.revenueMonthly || [];
  const revenueSummary = data?.revenueSummary;
  const financialWip = data?.financialWip;
  const showYtdBilling = billingPeriod === "ytd" && financialWip?.qboIncomeReconciliation != null;
  const displayedBilled = showYtdBilling
    ? financialWip.qboIncomeReconciliation!.selectedProjectIncome
    : financialWip?.summary.netBilled || 0;
  const financialLeadTimeMonths = financialWip?.summary.leadTimeMonths;
  const financialProjectedMonthCount = Math.ceil(financialLeadTimeMonths || 0);
  const financialProjectionEnd = addMonths(currentPeriod, financialProjectedMonthCount);
  const revenuePeriods = [...new Set([
    ...revenueMonthly.map((row) => row.month),
    ...Array.from({ length: financialProjectedMonthCount + 1 }, (_, index) => addMonths(currentPeriod, index)),
  ])].sort();
  const revenueByMonth = new Map(revenueMonthly.map((row) => [row.month, row.totalRevenue]));
  const averageMonthlyRevenue = revenueSummary?.averageMonthlyRevenue || 0;
  const revenueAverageStart = revenueSummary?.averagePeriodStart || currentPeriod;
  const revenueChartData: ChartData<"line", Array<number | null>, string> = {
    labels: revenuePeriods.map((period) => monthLabel(period)),
    datasets: [{
      label: "Combined actual revenue",
      data: revenuePeriods.map((period) => revenueByMonth.get(period) ?? null),
      borderColor: "#0369a1",
      backgroundColor: "rgba(3, 105, 161, 0.12)",
      pointBackgroundColor: "#0369a1",
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: 3,
      fill: true,
      tension: 0.25,
    }, {
      label: `KPI YTD average (${money.format(averageMonthlyRevenue)}/mo)`,
      data: revenuePeriods.map((period) =>
        averageMonthlyRevenue > 0 && period >= revenueAverageStart && period <= financialProjectionEnd
          ? averageMonthlyRevenue
          : null,
      ),
      borderColor: "#c2410c",
      backgroundColor: "#c2410c",
      pointRadius: 0,
      pointHoverRadius: 4,
      borderWidth: 2,
      borderDash: [8, 6],
      fill: false,
      tension: 0,
      spanGaps: true,
    }],
  };
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="border-b border-slate-300 pb-5">
          <p className="text-xs font-black uppercase tracking-widest text-teal-700">Analytics / Labor</p>
          <h1 className="mt-1 text-3xl font-black">Monthly Hours &amp; Revenue</h1>
          <p className="mt-1 text-sm text-slate-600">Monthly labor, billing history, and sold contract backlog for projects currently in progress.</p>
        </header>

        {loading && <div className="border border-slate-200 bg-white p-8 text-sm font-bold text-slate-500">Loading monthly hours...</div>}
        {error && <div className="border border-red-200 bg-red-50 p-5 text-sm font-bold text-red-800">{error}</div>}

        {!loading && !error && data?.summary && (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["In-progress projects", data.summary.projectCount],
                ["Expected hours", hours.format(data.summary.expectedHours)],
                ["Hours used", hours.format(data.summary.usedHours)],
                ["Hours left", hours.format(data.summary.remainingHours)],
                ["YTD revenue hours average", hours.format(data.summary.averageMonthlyHours)],
                [
                  "Labor lead time",
                  data.summary.leadTimeMonths === null
                    ? "—"
                    : `${hours.format(data.summary.leadTimeMonths)} months`,
                ],
              ].map(([label, value]) => (
                <div key={label} className="border border-slate-200 bg-white px-5 py-4 shadow-sm">
                  <p className="text-xs font-black uppercase text-slate-500">{label}</p>
                  <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
                  {label === "YTD revenue hours average" && (
                    <p className="mt-1 text-xs text-slate-500">
                      {data.summary.averageSource} · {monthLabel(data.summary.averagePeriodStart || undefined)} through {monthLabel(data.summary.averagePeriodEnd || undefined)} · {data.summary.averageMonthCount} months
                    </p>
                  )}
                </div>
              ))}
            </section>

            {financialWip && (
              <section className="overflow-hidden border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 bg-slate-900 px-5 py-5 text-white">
                  <p className="text-xs font-black uppercase tracking-widest text-emerald-300">WIP (Work In Progress)</p>
                  <h2 className="mt-1 text-xl font-black">Sold contract backlog and financial lead time</h2>
                  <p className="mt-1 text-xs text-slate-300">
                    Positive unbilled dollars ÷ KPI average billed YTD per month. Overbilling is reported separately and does not reduce WIP.
                  </p>
                  <div className="mt-4 inline-flex overflow-hidden border border-slate-600 text-xs font-black uppercase">
                    <button type="button" onClick={() => setBillingPeriod("ytd")} className={`px-4 py-2 ${billingPeriod === "ytd" ? "bg-emerald-300 text-slate-950" : "bg-slate-800 text-white hover:bg-slate-700"}`}>YTD</button>
                    <button type="button" onClick={() => setBillingPeriod("lifetime")} className={`border-l border-slate-600 px-4 py-2 ${billingPeriod === "lifetime" ? "bg-emerald-300 text-slate-950" : "bg-slate-800 text-white hover:bg-slate-700"}`}>Lifetime</button>
                  </div>
                </div>
                <div className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["Contract value", money.format(financialWip.summary.contractValue), `${financialWip.summary.contractProjectCount} of ${financialWip.summary.projectCount} projects have contract values`],
                    [showYtdBilling ? "YTD revenue" : "Lifetime billed", money.format(displayedBilled), showYtdBilling ? `${dateLabel(financialWip.qboIncomeReconciliation?.periodStart)} through ${dateLabel(financialWip.qboIncomeReconciliation?.periodEnd)}` : `QBO P&L Income · ${financialWip.summary.billedProjectCount} of ${financialWip.summary.projectCount} projects`],
                    ["WIP", money.format(financialWip.summary.unbilledDollars), `Uses ${money.format(financialWip.summary.contractBackedNetBilled)} lifetime billed across ${financialWip.summary.includedProjectCount} contract-backed projects`],
                    ["Average billed YTD / month", money.format(financialWip.summary.averageMonthlyBilled), `${monthLabel(financialWip.summary.averagePeriodStart || undefined)} through ${monthLabel(financialWip.summary.averagePeriodEnd || undefined)}`],
                    ["Financial lead time", financialLeadTimeMonths === null ? "—" : `${hours.format(financialLeadTimeMonths)} months`, financialLeadTimeMonths === null ? "KPI billed average unavailable" : `WIP horizon through ${monthLabel(financialProjectionEnd)}`],
                    ["Overbilled", money.format(financialWip.summary.overbilledDollars), "Shown separately from WIP"],
                  ].map(([label, value, detail]) => (
                    <div key={label} className="bg-white px-5 py-4">
                      <p className="text-xs font-black uppercase text-slate-500">{label}</p>
                      <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
                      <p className="mt-1 text-xs text-slate-500">{detail}</p>
                    </div>
                  ))}
                </div>
                <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
                  Viewing {showYtdBilling ? "YTD revenue" : "lifetime billed"} for {financialWip.summary.billedProjectCount} of {financialWip.summary.projectCount} selected projects
                  {` · Contract WIP always uses ${financialWip.summary.billingAccountingMethod || "QBO"} lifetime billing from ${dateLabel(financialWip.summary.billingPeriodStart)} through ${dateLabel(financialWip.summary.billingPeriodEnd)}`}
                  {financialWip.summary.qboImportedAt && ` · QBO imported ${new Date(financialWip.summary.qboImportedAt).toLocaleString()}`}
                </div>
                {financialWip.summary.revenueOnlyProjectCount > 0 && (
                  <div className="border-t border-sky-200 bg-sky-50 px-5 py-3 text-sm text-sky-950">
                    <span className="font-black">Revenue-only work:</span>{" "}
                    {financialWip.summary.revenueOnlyProjectCount} Screeding projects have {money.format(financialWip.summary.revenueOnlyBilledDollars)} lifetime revenue. They are included in revenue totals and intentionally excluded from contract WIP.
                  </div>
                )}
                {financialWip.summary.billedWithoutContractProjectCount > 0 && (
                  <div className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
                    <span className="font-black">Contract coverage exception:</span>{" "}
                    {financialWip.summary.billedWithoutContractProjectCount} non-Screeding projects have {money.format(financialWip.summary.billedWithoutContractDollars)} billed but no contract value. Their billing is included in revenue, but no WIP balance can be calculated until a contract value is available.
                  </div>
                )}
                {financialWip.qboIncomeReconciliation && (
                  <div className="border-t border-slate-200 bg-sky-50 px-5 py-4">
                    <div className="mb-3">
                      <p className="text-xs font-black uppercase tracking-widest text-sky-800">QBO P&amp;L reconciliation</p>
                      <p className="text-xs text-slate-600">
                        {financialWip.qboIncomeReconciliation.accountingMethod || "QBO"} basis · {dateLabel(financialWip.qboIncomeReconciliation.periodStart)} through {dateLabel(financialWip.qboIncomeReconciliation.periodEnd)}
                      </p>
                    </div>
                    <div className="overflow-hidden border border-sky-200 bg-white">
                      {[
                        ["Selected WIP projects", financialWip.qboIncomeReconciliation.selectedProjectIncome],
                        ["Filtered/completed projects", financialWip.qboIncomeReconciliation.filteredProjectIncome],
                        ["Customer-level and non-project income", financialWip.qboIncomeReconciliation.nonProjectIncome],
                        ["QBO Total Income", financialWip.qboIncomeReconciliation.companyIncome],
                      ].map(([label, value], index) => (
                        <div key={label} className={`flex items-center justify-between px-4 py-2 text-sm ${index > 0 ? "border-t border-slate-100" : ""} ${label === "QBO Total Income" ? "font-black text-slate-950" : ""}`}>
                          <span>{label}</span>
                          <span className="font-semibold">{money.format(Number(value))}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      Reconciliation difference: {money.format(financialWip.qboIncomeReconciliation.difference)}. The company total should match the same QBO Profit and Loss period and accounting basis.
                    </p>
                  </div>
                )}
                <details>
                  <summary className="cursor-pointer border-t border-slate-200 px-5 py-4 hover:bg-slate-50">
                    <span className="font-black">WIP by project</span>
                    <span className="ml-2 text-xs text-slate-500">Contract, billed, and remaining balances</span>
                  </summary>
                  <div className="max-h-[680px] overflow-auto border-t border-slate-200">
                    <table className="w-full min-w-[1050px] text-sm">
                      <thead className="sticky top-0 bg-slate-100 text-xs font-black uppercase text-slate-600">
                        <tr>
                          <th className="px-4 py-3 text-left">Project</th>
                          <th className="px-4 py-3 text-left">Status</th>
                          <th className="px-4 py-3 text-left">Contract source</th>
                          <th className="px-4 py-3 text-right">Contract</th>
                          <th className="px-4 py-3 text-right">{showYtdBilling ? "YTD revenue" : "Lifetime billed"}</th>
                          <th className="px-4 py-3 text-right">Balance</th>
                          <th className="px-4 py-3 text-right">Billed %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {financialWip.projects.map((project) => (
                          <tr key={project.qboCustomerId} className="border-t border-slate-100 hover:bg-slate-50">
                            <td className="px-4 py-3">
                              <div className="font-bold">{project.projectName}</div>
                              <div className="text-xs text-slate-500">
                                {[project.customerName, project.procoreProjectNumber].filter(Boolean).join(" · ") || project.qboCustomerId}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-slate-600">{project.procoreStatus || "QBO only"}</td>
                            <td className="px-4 py-3 text-slate-600">
                              {project.revenueOnly ? "Revenue only" : project.contractValueSource === "procore" ? "Procore" : project.contractValueSource === "qbo-estimates" ? "QBO estimate" : "Unavailable"}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold">{project.contractValue === null ? "—" : money.format(project.contractValue)}</td>
                            <td className="px-4 py-3 text-right">{showYtdBilling ? (project.ytdBilled === null ? "—" : money.format(project.ytdBilled)) : (project.netBilled === null ? "—" : money.format(project.netBilled))}</td>
                            <td className={`px-4 py-3 text-right font-black ${project.remainingToBill !== null && project.remainingToBill < 0 ? "text-amber-700" : "text-emerald-700"}`}>
                              {project.remainingToBill === null ? "—" : money.format(project.remainingToBill)}
                            </td>
                            <td className="px-4 py-3 text-right">{project.billingProgressPercent === null ? "—" : `${percent.format(project.billingProgressPercent)}%`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </section>
            )}

            <section className="min-w-0 overflow-hidden border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <h2 className="text-lg font-black">Hours used by month</h2>
                <p className="text-xs text-slate-500">
                  Actual timecard and recognized PM closeout hours. The dashed KPI average extends through {monthLabel(projectionEnd)} ({hours.format(data.summary.leadTimeMonths || 0)} months).
                </p>
              </div>
              <div className="h-[360px] min-w-0 overflow-hidden">
                <Line
                  data={chartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { intersect: false, mode: "index" },
                    plugins: {
                      legend: {
                        display: true,
                        position: "bottom",
                        labels: { usePointStyle: true, boxWidth: 10 },
                      },
                    },
                    scales: {
                      x: { grid: { display: false } },
                      y: { beginAtZero: true, title: { display: true, text: "Hours" } },
                    },
                  }}
                />
              </div>
            </section>

            <details className="overflow-hidden border border-slate-200 bg-white shadow-sm">
              <summary className="cursor-pointer border-b border-slate-200 px-5 py-4 hover:bg-slate-50">
                <h2 className="text-lg font-black">Hours remaining by project</h2>
                <p className="text-xs text-slate-500">Original labor budget plus approved changes, less hours used.</p>
              </summary>
              <div className="max-h-[620px] overflow-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="sticky top-0 bg-slate-100 text-xs font-black uppercase text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left">Project</th>
                      <th className="px-4 py-3 text-left">Customer</th>
                      <th className="px-4 py-3 text-right">Original</th>
                      <th className="px-4 py-3 text-right">Changes</th>
                      <th className="px-4 py-3 text-right">Expected</th>
                      <th className="px-4 py-3 text-right">Used</th>
                      <th className="px-4 py-3 text-right">Hours left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((project) => (
                      <tr key={project.projectId} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-bold">{project.projectName}</div>
                          <div className="text-xs text-slate-500">{project.projectNumber || project.projectId}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{project.customer || "Unknown"}</td>
                        <td className="px-4 py-3 text-right">{hours.format(project.originalHours)}</td>
                        <td className="px-4 py-3 text-right">{hours.format(project.changeHours)}</td>
                        <td className="px-4 py-3 text-right font-semibold">{hours.format(project.expectedHours)}</td>
                        <td className="px-4 py-3 text-right">{hours.format(project.usedHours)}</td>
                        <td className={`px-4 py-3 text-right font-black ${project.remainingHours < 0 ? "text-red-700" : "text-teal-700"}`}>
                          {hours.format(project.remainingHours)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            {revenueSummary && (
              <section className="min-w-0 overflow-hidden border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4">
                  <p className="text-xs font-black uppercase tracking-widest text-sky-700">Revenue</p>
                  <h2 className="text-lg font-black">Revenue by month</h2>
                  <p className="text-xs text-slate-500">
                    Monthly Actual Revenue excluding subcontracted plus Monthly Sub Actual Revenue Billed. The dashed YTD average is a billing run-rate reference through the WIP horizon of {monthLabel(financialProjectionEnd)}.
                  </p>
                </div>
                <div className="mb-5 grid gap-3 sm:grid-cols-3">
                  <div className="border border-slate-200 px-4 py-3">
                    <p className="text-xs font-black uppercase text-slate-500">YTD monthly average</p>
                    <p className="mt-1 text-xl font-black">{money.format(revenueSummary.averageMonthlyRevenue)}</p>
                    <p className="text-xs text-slate-500">{monthLabel(revenueSummary.averagePeriodStart || undefined)} through {monthLabel(revenueSummary.averagePeriodEnd || undefined)}</p>
                  </div>
                  <div className="border border-slate-200 px-4 py-3">
                    <p className="text-xs font-black uppercase text-slate-500">WIP (Work In Progress)</p>
                    <p className="mt-1 text-xl font-black">{financialWip ? money.format(financialWip.summary.unbilledDollars) : "—"}</p>
                    <p className="text-xs text-slate-500">Sold contract balance</p>
                  </div>
                  <div className="border border-slate-200 px-4 py-3">
                    <p className="text-xs font-black uppercase text-slate-500">Financial lead time</p>
                    <p className="mt-1 text-xl font-black">{financialLeadTimeMonths === null || financialLeadTimeMonths === undefined ? "—" : `${hours.format(financialLeadTimeMonths)} months`}</p>
                    <p className="text-xs text-slate-500">WIP ÷ YTD monthly average</p>
                  </div>
                </div>
                <div className="h-[360px] min-w-0 overflow-hidden">
                  <Line
                    data={revenueChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      interaction: { intersect: false, mode: "index" },
                      plugins: {
                        legend: {
                          display: true,
                          position: "bottom",
                          labels: { usePointStyle: true, boxWidth: 10 },
                        },
                        tooltip: {
                          callbacks: {
                            label: (context) => `${context.dataset.label}: ${money.format(Number(context.parsed.y || 0))}`,
                          },
                        },
                      },
                      scales: {
                        x: { grid: { display: false } },
                        y: {
                          beginAtZero: true,
                          title: { display: true, text: "Revenue" },
                          ticks: { callback: (value) => money.format(Number(value)) },
                        },
                      },
                    }}
                  />
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
