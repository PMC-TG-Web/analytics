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
    projectedRevenue: number | null;
    sourceUpdatedAt: string | null;
  };
  projects?: ProjectHours[];
};

const hours = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function monthLabel(value: string | undefined) {
  if (!value) return "—";
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" })
    .format(new Date(year, month - 1, 1));
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
  const revenuePeriods = [...new Set([
    ...revenueMonthly.map((row) => row.month),
    ...Array.from({ length: projectedMonthCount + 1 }, (_, index) => addMonths(currentPeriod, index)),
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
        averageMonthlyRevenue > 0 && period >= revenueAverageStart && period <= projectionEnd
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
          <p className="mt-1 text-sm text-slate-600">Monthly labor and revenue projections for projects currently in progress.</p>
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
                  "Lead time remaining",
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
                    Monthly Actual Revenue excluding subcontracted plus Monthly Sub Actual Revenue Billed. The dashed YTD average extends through {monthLabel(projectionEnd)}.
                  </p>
                </div>
                <div className="mb-5 grid gap-3 sm:grid-cols-3">
                  <div className="border border-slate-200 px-4 py-3">
                    <p className="text-xs font-black uppercase text-slate-500">YTD monthly average</p>
                    <p className="mt-1 text-xl font-black">{money.format(revenueSummary.averageMonthlyRevenue)}</p>
                    <p className="text-xs text-slate-500">{monthLabel(revenueSummary.averagePeriodStart || undefined)} through {monthLabel(revenueSummary.averagePeriodEnd || undefined)}</p>
                  </div>
                  <div className="border border-slate-200 px-4 py-3">
                    <p className="text-xs font-black uppercase text-slate-500">Lead-time horizon</p>
                    <p className="mt-1 text-xl font-black">{hours.format(data.summary.leadTimeMonths || 0)} months</p>
                    <p className="text-xs text-slate-500">Through {monthLabel(projectionEnd)}</p>
                  </div>
                  <div className="border border-slate-200 px-4 py-3">
                    <p className="text-xs font-black uppercase text-slate-500">Projected revenue</p>
                    <p className="mt-1 text-xl font-black">{revenueSummary.projectedRevenue === null ? "—" : money.format(revenueSummary.projectedRevenue)}</p>
                    <p className="text-xs text-slate-500">YTD average × lead time</p>
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