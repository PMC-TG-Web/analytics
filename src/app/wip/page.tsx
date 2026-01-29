"use client";
import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
const Line = dynamic(() => import('react-chartjs-2').then(mod => mod.Line), { ssr: false });
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
  Plugin,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

// Custom plugin to draw data labels on points
const dataLabelsPlugin: Plugin = {
  id: 'datalabels',
  afterDatasetsDraw(chart) {
    const { ctx, data } = chart;
    data.datasets.forEach((dataset: any, datasetIndex) => {
      if (!dataset.datalabels?.display) return;

      const meta = chart.getDatasetMeta(datasetIndex);
      meta.data.forEach((datapoint: any, index) => {
        const { x, y } = datapoint.getProps(['x', 'y']);
        const value = dataset.data[index];
        const label = dataset.datalabels.formatter(value);

        ctx.font = `${dataset.datalabels.font?.weight || 'normal'} ${dataset.datalabels.font?.size || 12}px Arial`;
        ctx.fillStyle = dataset.datalabels.color || '#000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, x, y - 10);
      });
    });
  },
};

ChartJS.register(dataLabelsPlugin);

type Schedule = {
  id: string;
  jobKey: string;
  customer?: string;
  projectNumber?: string;
  projectName?: string;
  totalHours: number;
  allocations: Array<{ month: string; percent: number }>;
};

type MonthlyWIP = {
  month: string;
  hours: number;
  jobs: Array<{
    customer: string;
    projectNumber: string;
    projectName: string;
    hours: number;
  }>;
};

function formatMonthLabel(month: string) {
  const [year, m] = month.split("-");
  const date = new Date(Number(year), Number(m) - 1, 1);
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export default function WIPReportPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [customerFilter, setCustomerFilter] = useState<string>("");
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [monthFilter, setMonthFilter] = useState<string>("");

  useEffect(() => {
    async function fetchData() {
      try {
        const [schedulesRes, projectsRes] = await Promise.all([
          fetch("/api/scheduling"),
          fetch("/api/projects") // We'll need to create this endpoint
            .catch(() => ({ json: async () => ({ data: [] }) }))
        ]);
        
        const schedulesJson = await schedulesRes.json();
        setSchedules(schedulesJson.data || []);
        
        const projectsJson = await projectsRes.json();
        setProjects(projectsJson.data || []);
      } catch (error) {
        console.error("Failed to load data:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Aggregate hours by month (excluding management)
  const monthlyData: Record<string, MonthlyWIP> = {};

  schedules.forEach((schedule) => {
    schedule.allocations.forEach((alloc) => {
      if (!monthlyData[alloc.month]) {
        monthlyData[alloc.month] = { month: alloc.month, hours: 0, jobs: [] };
      }

      const allocatedHours = schedule.totalHours * (alloc.percent / 100);
      monthlyData[alloc.month].hours += allocatedHours;
      monthlyData[alloc.month].jobs.push({
        customer: schedule.customer || "Unknown",
        projectNumber: schedule.projectNumber || "N/A",
        projectName: schedule.projectName || "Unnamed",
        hours: allocatedHours,
      });
    });
  });

  const months = Object.keys(monthlyData).sort();
  const totalHours = Object.values(monthlyData).reduce((sum, m) => sum + m.hours, 0);
  const avgHours = months.length > 0 ? totalHours / months.length : 0;

  // Build year/month matrix for table view
  const yearMonthMap: Record<string, Record<number, number>> = {};
  months.forEach((month) => {
    const [year, m] = month.split("-");
    if (!yearMonthMap[year]) {
      yearMonthMap[year] = {};
    }
    yearMonthMap[year][Number(m)] = monthlyData[month].hours;
  });

  const years = Object.keys(yearMonthMap).sort();
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Get unique customers and projects for filters
  const uniqueCustomers = Array.from(new Set(schedules.map(s => s.customer || "Unknown"))).sort();
  const uniqueProjects = Array.from(new Set(schedules.map(s => s.projectName || "Unnamed"))).sort();

  // Filter monthly data based on selected filters
  const filteredMonthlyData: Record<string, MonthlyWIP> = {};
  months.forEach((month) => {
    const originalData = monthlyData[month];
    const filteredJobs = originalData.jobs.filter((job) => {
      const customerMatch = !customerFilter || job.customer === customerFilter;
      const projectMatch = !projectFilter || job.projectName === projectFilter;
      return customerMatch && projectMatch;
    });

    if (filteredJobs.length > 0) {
      filteredMonthlyData[month] = {
        month,
        hours: filteredJobs.reduce((sum, j) => sum + j.hours, 0),
        jobs: filteredJobs,
      };
    }
  });

  const filteredMonths = Object.keys(filteredMonthlyData).sort();

  // Calculate unscheduled hours from schedules (which already filters for qualifying statuses)
  let totalQualifyingHours = 0;
  let totalScheduledHours = 0;
  
  schedules.forEach(schedule => {
    const projectHours = schedule.totalHours || 0;
    totalQualifyingHours += projectHours;
    
    const scheduledHours = schedule.allocations.reduce((sum: number, alloc: any) => {
      return sum + (projectHours * (alloc.percent / 100));
    }, 0);
    totalScheduledHours += scheduledHours;
  });
  
  const unscheduledHours = totalQualifyingHours - totalScheduledHours;
  const qualifyingStatuses = ["Accepted", "In Progress", "Delayed"];

  if (loading) {
    return (
      <main className="p-8" style={{ background: "#f3f4f6", minHeight: "100vh", color: "#111827" }}>
        <div>Loading...</div>
      </main>
    );
  }

  return (
    <main className="p-8" style={{ fontFamily: "sans-serif", background: "#f3f4f6", minHeight: "100vh", color: "#111827" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, background: "#111827", padding: "16px 20px", borderRadius: 10 }}>
        <h1 style={{ color: "#fff", fontSize: 28, margin: 0 }}>Work in Progress (WIP) Report</h1>
        <div style={{ display: "flex", gap: 12 }}>
          <a href="/dashboard" style={{ padding: "8px 16px", background: "#374151", color: "#fff", borderRadius: 6, textDecoration: "none", fontWeight: 700 }}>
            Dashboard
          </a>
          <a href="/scheduling" style={{ padding: "8px 16px", background: "#f97316", color: "#fff", borderRadius: 6, textDecoration: "none", fontWeight: 700 }}>
            Scheduling
          </a>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
        <SummaryCard label="Total Scheduled Hours" value={totalHours.toFixed(1)} />
        <SummaryCard label="Average Monthly Hours" value={avgHours.toFixed(1)} />
        <SummaryCard label="Months Scheduled" value={months.length} />
        <SummaryCard label="Scheduled Jobs" value={schedules.length} />
      </div>

      {/* Unscheduled Hours Container */}
      <div style={{ background: "#ef4444", borderRadius: 12, padding: 24, border: "1px solid #dc2626", marginBottom: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Unscheduled Hours</div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.7)" }}>
              {qualifyingStatuses.join(", ")} Jobs
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
              {unscheduledHours.toFixed(1)}
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)" }}>
              of {totalQualifyingHours.toFixed(1)} total hours
            </div>
          </div>
        </div>
        {unscheduledHours > 0 && (
          <div style={{ marginTop: 12, fontSize: 12, color: "rgba(255,255,255,0.8)" }}>
            {((unscheduledHours / totalQualifyingHours) * 100).toFixed(0)}% remaining to schedule
          </div>
        )}
      </div>

      {/* Hours Line Chart */}
      {months.length > 0 && (
        <div style={{ background: "#2b2d31", borderRadius: 12, padding: 24, border: "1px solid #3a3d42", marginBottom: 32 }}>
          <h2 style={{ color: "#fff", marginBottom: 16 }}>Scheduled Hours Trend</h2>
          <div style={{ width: "100%", minHeight: 50 }}>
            <HoursLineChart months={months} monthlyData={filteredMonthlyData} />
          </div>
        </div>
      )}

      {/* Year/Month Matrix Table */}
      {months.length > 0 && (
        <div style={{ background: "#2b2d31", borderRadius: 12, padding: 24, border: "1px solid #3a3d42", marginBottom: 32 }}>
          <h2 style={{ color: "#fff", marginBottom: 16 }}>Hours by Month</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #3a3d42" }}>
                  <th style={{ padding: "12px", textAlign: "left", color: "#9ca3af", fontWeight: 600 }}>Year</th>
                  {monthNames.map((name, idx) => (
                    <th key={idx} style={{ padding: "12px", textAlign: "center", color: "#9ca3af", fontWeight: 600 }}>
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {years.map((year) => (
                  <tr key={year} style={{ borderBottom: "1px solid #3a3d42" }}>
                    <td style={{ padding: "12px", color: "#e5e7eb", fontWeight: 700 }}>{year}</td>
                    {monthNames.map((_, idx) => {
                      const hours = yearMonthMap[year][idx + 1] || 0;
                      return (
                        <td key={idx} style={{ padding: "12px", textAlign: "center", color: hours > 0 ? "#22c55e" : "#6b7280", fontWeight: hours > 0 ? 700 : 400 }}>
                          {hours > 0 ? hours.toFixed(0) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {months.length > 0 ? (
        <div style={{ background: "#2b2d31", borderRadius: 12, padding: 24, border: "1px solid #3a3d42" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h2 style={{ color: "#fff", margin: 0 }}>Monthly Breakdown</h2>
            <button
              onClick={() => {
                setCustomerFilter("");
                setProjectFilter("");
                setMonthFilter("");
              }}
              style={{
                padding: "6px 12px",
                background: "transparent",
                border: "1px solid #3a3d42",
                color: "#9ca3af",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Clear Filters
            </button>
          </div>

          {/* Filters */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
            <div>
              <label style={{ fontSize: 12, color: "#9ca3af", display: "block", marginBottom: 6 }}>Customer</label>
              <select
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  background: "#1a1d23",
                  color: "#e5e7eb",
                  border: "1px solid #3a3d42",
                  borderRadius: 6,
                }}
              >
                <option value="">All Customers</option>
                {uniqueCustomers.map((customer) => (
                  <option key={customer} value={customer}>
                    {customer}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#9ca3af", display: "block", marginBottom: 6 }}>Project</label>
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  background: "#1a1d23",
                  color: "#e5e7eb",
                  border: "1px solid #3a3d42",
                  borderRadius: 6,
                }}
              >
                <option value="">All Projects</option>
                {uniqueProjects.map((project) => (
                  <option key={project} value={project}>
                    {project}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#9ca3af", display: "block", marginBottom: 6 }}>Month</label>
              <select
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  background: "#1a1d23",
                  color: "#e5e7eb",
                  border: "1px solid #3a3d42",
                  borderRadius: 6,
                }}
              >
                <option value="">All Months</option>
                {filteredMonths.map((month) => (
                  <option key={month} value={month}>
                    {formatMonthLabel(month)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {filteredMonths.length > 0 ? (
            filteredMonths.map((month) => {
              // Apply month filter
              if (monthFilter && month !== monthFilter) return null;
              
              const data = filteredMonthlyData[month];
              return (
                <div key={month} style={{ marginBottom: 24, paddingBottom: 24, borderBottom: "1px solid #3a3d42" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
                    <h3 style={{ color: "#fff", fontSize: 18 }}>{formatMonthLabel(month)}</h3>
                    <div style={{ color: "#22c55e", fontWeight: 700, fontSize: 18 }}>
                      {data.hours.toFixed(1)} hours
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, fontSize: 12, color: "#9ca3af", marginBottom: 8 }}>
                    <div>Customer</div>
                    <div>Project</div>
                    <div style={{ textAlign: "right" }}>Hours</div>
                  </div>

                  {data.jobs.map((job, idx) => (
                    <div key={idx} style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, fontSize: 13, color: "#e5e7eb", marginBottom: 6 }}>
                      <div>{job.customer}</div>
                      <div>{job.projectName}</div>
                      <div style={{ textAlign: "right", color: "#22c55e" }}>{job.hours.toFixed(1)}</div>
                    </div>
                  ))}
                </div>
              );
            }).filter(Boolean)
          ) : (
            <div style={{ color: "#9ca3af", textAlign: "center", padding: 20 }}>
              No data matches the selected filters.
            </div>
          )}
        </div>
      ) : (
        <div style={{ background: "#2b2d31", borderRadius: 12, padding: 24, border: "1px solid #3a3d42", textAlign: "center", color: "#9ca3af" }}>
          No schedules created yet. Go to{" "}
          <a href="/scheduling" style={{ color: "#3b82f6", textDecoration: "underline" }}>
            Scheduling
          </a>{" "}
          to create a schedule.
        </div>
      )}
    </main>
  );
}

function HoursLineChart({ months, monthlyData }: { months: string[]; monthlyData: Record<string, any> }) {
  const sortedMonths = months.sort();
  const hours = sortedMonths.map(month => monthlyData[month]?.hours || 0);
  const labels = sortedMonths.map(month => {
    const [year, m] = month.split("-");
    const date = new Date(Number(year), Number(m) - 1, 1);
    return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  });

  const maxHours = Math.max(...hours, 4800);

  const chartData = {
    labels,
    datasets: [
      {
        label: "Scheduled Hours",
        data: hours,
        borderColor: "#22c55e",
        backgroundColor: "rgba(34, 197, 94, 0.1)",
        tension: 0.3,
        fill: true,
        pointBackgroundColor: "#22c55e",
        pointBorderColor: "#fff",
        pointBorderWidth: 2,
        pointRadius: 5,
        datalabels: {
          display: true,
          color: "#22c55e",
          font: { weight: "bold", size: 10 },
          formatter: (value) => {
            const percent = ((value / 3900) * 100).toFixed(0);
            return `${percent}%`;
          },
        },
      },
      {
        label: "Target (4,800 hours)",
        data: Array(labels.length).fill(4800),
        borderColor: "#f59e0b",
        borderDash: [5, 5],
        borderWidth: 2,
        fill: false,
        pointRadius: 0,
        pointHoverRadius: 0,
      },
    ],
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top" as const,
        labels: {
          color: "#e5e7eb",
          boxWidth: 12,
        },
      },
      tooltip: {
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        titleColor: "#fff",
        bodyColor: "#e5e7eb",
        borderColor: "#3a3d42",
        borderWidth: 1,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        max: maxHours * 1.1,
        ticks: {
          color: "#9ca3af",
          callback: function(value) {
            return (value as number).toLocaleString();
          },
        },
        grid: {
          color: "#3a3d42",
        },
      },
      x: {
        ticks: {
          color: "#9ca3af",
        },
        grid: {
          color: "#3a3d42",
        },
      },
    },
  };

  return <Line data={chartData} options={options} />;
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{
      background: "#ffffff",
      borderRadius: 12,
      padding: "16px 20px",
      border: "1px solid #e5e7eb",
      boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
    }}>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: "#111827" }}>{value}</div>
    </div>
  );
}
