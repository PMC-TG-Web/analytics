"use client";
import React, { useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/firebase";
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
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

type Schedule = {
  id: string;
  jobKey: string;
  customer?: string;
  projectNumber?: string;
  projectName?: string;
  totalHours: number;
  allocations: Array<{ month: string; percent: number }>;
  status?: string;
};

type Project = {
  id: string;
  projectNumber?: string;
  projectName?: string;
  customer?: string;
  status?: string;
  sales?: number;
  cost?: number;
  hours?: number;
  dateCreated?: any;
  dateUpdated?: any;
  projectArchived?: boolean;
  estimator?: string;
};

function parseDateValue(value: any) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && typeof value.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  return null;
}

export default function KPIPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState<string>("");

  useEffect(() => {
    async function fetchData() {
      try {
        const projectsSnapshot = await getDocs(collection(db, "projects"));
        const projectsData = projectsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Project[];
        setProjects(projectsData);

        const schedulesRes = await fetch("/api/scheduling");
        const schedulesJson = await schedulesRes.json();
        const schedulesData = schedulesJson.schedules || [];

        const schedulesWithStatus = schedulesData.map((schedule: any) => {
          const matchingProject = projectsData.find((p: any) => {
            const scheduleKey = `${schedule.customer || ""}|${schedule.projectNumber || ""}|${schedule.projectName || ""}`;
            const projectKey = `${p.customer || ""}|${p.projectNumber || ""}|${p.projectName || ""}`;
            return scheduleKey === projectKey;
          });
          return {
            ...schedule,
            status: matchingProject?.status || "Unknown",
          };
        });

        setSchedules(schedulesWithStatus);
        setLoading(false);
      } catch (error) {
        console.error("Error loading data:", error);
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const getProjectKey = (customer?: string, projectNumber?: string, projectName?: string) => {
    return `${customer ?? ""}|${projectNumber ?? ""}|${projectName ?? ""}`;
  };

  const qualifyingStatuses = ["In Progress", "Accepted"];

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      if (p.projectArchived) return false;
      const customer = (p.customer ?? "").toString().toLowerCase();
      if (customer.includes("sop inc")) return false;
      const projectName = (p.projectName ?? "").toString().toLowerCase();
      if (projectName === "pmc operations") return false;
      if (projectName === "pmc shop time") return false;
      if (projectName === "pmc test project") return false;
      if (projectName.includes("sandbox")) return false;
      if (projectName.includes("raymond king")) return false;
      if (projectName === "alexander drive addition latest") return false;
      const estimator = (p.estimator ?? "").toString().trim();
      if (!estimator) return false;
      if (estimator.toLowerCase() === "todd gilmore") return false;
      const projectNumber = (p.projectNumber ?? "").toString().toLowerCase();
      if (projectNumber === "701 poplar church rd") return false;
      return true;
    });
  }, [projects]);

  const { aggregated: aggregatedProjects, dedupedByCustomer } = useMemo(() => {
    const activeProjects = filteredProjects;
    
    const projectIdentifierMap = new Map<string, Project[]>();
    activeProjects.forEach((project) => {
      const identifier = (project.projectNumber ?? project.projectName ?? "").toString().trim();
      if (!identifier) return;
      
      if (!projectIdentifierMap.has(identifier)) {
        projectIdentifierMap.set(identifier, []);
      }
      projectIdentifierMap.get(identifier)!.push(project);
    });
    
    const dedupedByCustomer: Project[] = [];
    projectIdentifierMap.forEach((projectList) => {
      const customerMap = new Map<string, Project[]>();
      projectList.forEach(p => {
        const customer = (p.customer ?? "").toString().trim();
        if (!customerMap.has(customer)) {
          customerMap.set(customer, []);
        }
        customerMap.get(customer)!.push(p);
      });
      
      if (customerMap.size > 1) {
        const priorityStatuses = ["Accepted", "In Progress", "Complete"];
        let selectedCustomer: string = "";
        let selectedProjects: Project[] = [];
        
        let foundPriorityCustomer = false;
        customerMap.forEach((projs, customer) => {
          const hasPriorityStatus = projs.some(p => priorityStatuses.includes(p.status || ""));
          if (hasPriorityStatus && !foundPriorityCustomer) {
            selectedCustomer = customer;
            selectedProjects = projs;
            foundPriorityCustomer = true;
          }
        });
        
        if (!foundPriorityCustomer) {
          let latestCustomer: string = "";
          let latestDate: Date | null = null;
          
          customerMap.forEach((projs, customer) => {
            const mostRecentProj = projs.reduce((latest, current) => {
              const currentDate = parseDateValue(current.dateCreated);
              const latestDateVal = parseDateValue(latest.dateCreated);
              if (!currentDate) return latest;
              if (!latestDateVal) return current;
              return currentDate > latestDateVal ? current : latest;
            }, projs[0]);
            
            const projDate = parseDateValue(mostRecentProj.dateCreated);
            if (projDate && (!latestDate || projDate > latestDate)) {
              latestDate = projDate;
              latestCustomer = customer;
            }
          });
          
          selectedCustomer = latestCustomer;
          selectedProjects = customerMap.get(latestCustomer) || [];
        }
        
        dedupedByCustomer.push(...selectedProjects);
      } else {
        projectList.forEach(p => dedupedByCustomer.push(p));
      }
    });
    
    const keyGroupMap = new Map<string, Project[]>();
    dedupedByCustomer.forEach((project) => {
      const key = getProjectKey(project.customer, project.projectNumber, project.projectName);
      if (!keyGroupMap.has(key)) {
        keyGroupMap.set(key, []);
      }
      keyGroupMap.get(key)!.push(project);
    });
    
    const map = new Map<string, Project>();
    keyGroupMap.forEach((projects, key) => {
      const sortedProjects = projects.sort((a, b) => {
        const nameA = (a.projectName ?? "").toString().toLowerCase();
        const nameB = (b.projectName ?? "").toString().toLowerCase();
        return nameA.localeCompare(nameB);
      });
      
      const baseProject = { ...sortedProjects[0] };
      
      baseProject.sales = sortedProjects.reduce((sum, p) => sum + (p.sales ?? 0), 0);
      baseProject.cost = sortedProjects.reduce((sum, p) => sum + (p.cost ?? 0), 0);
      baseProject.hours = sortedProjects.reduce((sum, p) => sum + (p.hours ?? 0), 0);
      
      map.set(key, baseProject);
    });
    return { aggregated: Array.from(map.values()), dedupedByCustomer };
  }, [filteredProjects]);

  const bidSubmittedSalesByMonth: Record<string, number> = {};
  dedupedByCustomer.forEach((project) => {
    if ((project.status || "") !== "Bid Submitted") return;
    const projectDate = parseDateValue(project.dateCreated);
    if (!projectDate) return;
    const monthKey = `${projectDate.getFullYear()}-${String(projectDate.getMonth() + 1).padStart(2, "0")}`;
    const sales = Number(project.sales ?? 0);
    if (!Number.isFinite(sales)) return;
    bidSubmittedSalesByMonth[monthKey] = (bidSubmittedSalesByMonth[monthKey] || 0) + sales;
  });
  const bidSubmittedSalesMonths = Object.keys(bidSubmittedSalesByMonth).sort();
  const bidSubmittedSalesYearMonthMap: Record<string, Record<number, number>> = {};
  bidSubmittedSalesMonths.forEach((month) => {
    const [year, m] = month.split("-");
    if (!bidSubmittedSalesYearMonthMap[year]) {
      bidSubmittedSalesYearMonthMap[year] = {};
    }
    bidSubmittedSalesYearMonthMap[year][Number(m)] = bidSubmittedSalesByMonth[month];
  });
  const bidSubmittedSalesYears = Object.keys(bidSubmittedSalesYearMonthMap).sort();

  const scheduledSalesByMonth: Record<string, number> = {};
  
  const scheduleSalesMap = new Map<string, number>();
  projects.forEach((project) => {
    if (!qualifyingStatuses.includes(project.status || "")) return;
    
    const key = getProjectKey(project.customer, project.projectNumber, project.projectName);
    const sales = Number(project.sales ?? 0);
    if (!Number.isFinite(sales)) return;
    
    const currentTotal = scheduleSalesMap.get(key) || 0;
    scheduleSalesMap.set(key, currentTotal + sales);
  });

  schedules.forEach((schedule) => {
    if (schedule.status === 'Complete') return;
    
    const key = schedule.jobKey || getProjectKey(schedule.customer, schedule.projectNumber, schedule.projectName);
    const projectSales = scheduleSalesMap.get(key);
    
    if (!projectSales) return;

    schedule.allocations.forEach((alloc) => {
      const percent = Number(alloc.percent ?? 0);
      if (!Number.isFinite(percent) || percent <= 0) return;
      const monthKey = alloc.month;
      const monthlySales = projectSales * (percent / 100);
      scheduledSalesByMonth[monthKey] = (scheduledSalesByMonth[monthKey] || 0) + monthlySales;
    });
  });

  const scheduledSalesMonths = Object.keys(scheduledSalesByMonth).sort();
  const scheduledSalesYearMonthMap: Record<string, Record<number, number>> = {};
  scheduledSalesMonths.forEach((month) => {
    const [year, m] = month.split("-");
    if (!scheduledSalesYearMonthMap[year]) {
      scheduledSalesYearMonthMap[year] = {};
    }
    scheduledSalesYearMonthMap[year][Number(m)] = scheduledSalesByMonth[month];
  });
  const scheduledSalesYears = Object.keys(scheduledSalesYearMonthMap).sort();

  const combinedSalesYears = Array.from(new Set([...scheduledSalesYears, ...bidSubmittedSalesYears]))
    .filter(year => year !== "2024")
    .sort();

  const filteredBidSubmittedSalesByMonth: Record<string, number> = {};
  const filteredBidSubmittedSalesMonths = bidSubmittedSalesMonths.filter(month => {
    if (yearFilter) {
      const [year] = month.split("-");
      if (year !== yearFilter) return false;
    }
    filteredBidSubmittedSalesByMonth[month] = bidSubmittedSalesByMonth[month];
    return true;
  });

  const filteredScheduledSalesByMonth: Record<string, number> = {};
  const filteredScheduledSalesMonths = scheduledSalesMonths.filter(month => {
    if (yearFilter) {
      const [year] = month.split("-");
      if (year !== yearFilter) return false;
    }
    filteredScheduledSalesByMonth[month] = scheduledSalesByMonth[month];
    return true;
  });

  const filteredCombinedSalesYears = yearFilter 
    ? combinedSalesYears.filter(year => year === yearFilter) 
    : combinedSalesYears;

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  if (loading) {
    return (
      <main className="p-8" style={{ background: "#f5f5f5", minHeight: "100vh", color: "#222" }}>
        <div>Loading...</div>
      </main>
    );
  }

  return (
    <main className="p-8" style={{ fontFamily: "sans-serif", background: "#f5f5f5", minHeight: "100vh", color: "#222" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ color: "#003DA5", fontSize: 32, margin: 0 }}>KPI Dashboard</h1>
        <div style={{ display: "flex", gap: 12 }}>
          <a href="/dashboard" style={{ padding: "8px 16px", background: "#003DA5", color: "#fff", borderRadius: 8, textDecoration: "none", fontWeight: 700 }}>
            Dashboard
          </a>
          <a href="/wip" style={{ padding: "8px 16px", background: "#0066CC", color: "#fff", borderRadius: 8, textDecoration: "none", fontWeight: 700 }}>
            WIP Report
          </a>
          <a href="/scheduling" style={{ padding: "8px 16px", background: "#10b981", color: "#fff", borderRadius: 8, textDecoration: "none", fontWeight: 700 }}>
            Scheduling
          </a>
          <a href="/long-term-schedule" style={{ padding: "8px 16px", background: "#8b5cf6", color: "#fff", borderRadius: 8, textDecoration: "none", fontWeight: 700 }}>
            Long-Term Schedule
          </a>
        </div>
      </div>

      {/* Year Filter */}
      <div style={{ 
        background: "#ffffff", 
        borderRadius: 12, 
        padding: "16px 24px", 
        marginBottom: 32,
        border: "1px solid #ddd",
        display: "flex",
        alignItems: "center",
        gap: 20
      }}>
        <div style={{ color: "#666", fontWeight: 600 }}>Filter by Year:</div>
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          style={{
            padding: "8px 12px",
            background: "#fff",
            color: "#222",
            border: "1px solid #ddd",
            borderRadius: 6,
            fontSize: 14,
          }}
        >
          <option value="">All Years</option>
          {combinedSalesYears.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
        {yearFilter && (
          <button
            onClick={() => setYearFilter("")}
            style={{
              padding: "6px 12px",
              background: "transparent",
              border: "1px solid #ddd",
              color: "#666",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Clear Filter
          </button>
        )}
      </div>

      {/* Combined Sales Line Chart */}
      {(filteredScheduledSalesMonths.length > 0 || filteredBidSubmittedSalesMonths.length > 0) && (
        <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd", marginBottom: 32 }}>
          <h2 style={{ color: "#003DA5", marginBottom: 16 }}>Scheduled vs Bid Submitted Sales</h2>
          <div style={{ height: 400 }}>
            <CombinedSalesLineChart
              scheduledMonths={filteredScheduledSalesMonths}
              scheduledSalesByMonth={filteredScheduledSalesByMonth}
              bidSubmittedMonths={filteredBidSubmittedSalesMonths}
              bidSubmittedSalesByMonth={filteredBidSubmittedSalesByMonth}
            />
          </div>
        </div>
      )}

      {/* Combined Sales by Month Table */}
      {filteredCombinedSalesYears.length > 0 && (
        <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd", marginBottom: 32 }}>
          <h2 style={{ color: "#003DA5", marginBottom: 16 }}>Scheduled + Bid Submitted Sales by Month</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #ddd" }}>
                  <th style={{ padding: "12px", textAlign: "left", color: "#666", fontWeight: 600 }}>Year</th>
                  <th style={{ padding: "12px", textAlign: "left", color: "#666", fontWeight: 600 }}>Type</th>
                  {monthNames.map((name, idx) => (
                    <th key={idx} style={{ padding: "12px", textAlign: "center", color: "#666", fontWeight: 600 }}>
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredCombinedSalesYears.map((year) => (
                  <React.Fragment key={year}>
                    <tr style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "12px", color: "#222", fontWeight: 700 }}>{year}</td>
                      <td style={{ padding: "12px", color: "#FF9500", fontWeight: 700 }}>Scheduled</td>
                      {monthNames.map((_, idx) => {
                        const sales = scheduledSalesYearMonthMap[year]?.[idx + 1] || 0;
                        return (
                          <td key={idx} style={{ padding: "12px", textAlign: "center", color: sales > 0 ? "#FF9500" : "#999", fontWeight: sales > 0 ? 700 : 400 }}>
                            {sales > 0 ? `$${sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                          </td>
                        );
                      })}
                    </tr>
                    <tr style={{ borderBottom: "1px solid #ddd" }}>
                      <td style={{ padding: "12px", color: "#222", fontWeight: 700 }}></td>
                      <td style={{ padding: "12px", color: "#0066CC", fontWeight: 700 }}>Bid Submitted</td>
                      {monthNames.map((_, idx) => {
                        const sales = bidSubmittedSalesYearMonthMap[year]?.[idx + 1] || 0;
                        return (
                          <td key={idx} style={{ padding: "12px", textAlign: "center", color: sales > 0 ? "#0066CC" : "#999", fontWeight: sales > 0 ? 700 : 400 }}>
                            {sales > 0 ? `$${sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}

function CombinedSalesLineChart({
  scheduledMonths,
  scheduledSalesByMonth,
  bidSubmittedMonths,
  bidSubmittedSalesByMonth,
}: {
  scheduledMonths: string[];
  scheduledSalesByMonth: Record<string, number>;
  bidSubmittedMonths: string[];
  bidSubmittedSalesByMonth: Record<string, number>;
}) {
  const monthSet = new Set<string>([...scheduledMonths, ...bidSubmittedMonths]);
  const sortedMonths = Array.from(monthSet).filter(month => !month.startsWith("2024")).sort();

  const scheduledSales = sortedMonths.map(month => scheduledSalesByMonth[month] || 0);
  const bidSubmittedSales = sortedMonths.map(month => bidSubmittedSalesByMonth[month] || 0);

  const labels = sortedMonths.map(month => {
    const [year, m] = month.split("-");
    const date = new Date(Number(year), Number(m) - 1, 1);
    return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  });

  const maxScheduledSales = Math.max(...scheduledSales, 0);
  const maxBidSubmittedSales = Math.max(...bidSubmittedSales, 0);

  const chartData = {
    labels,
    datasets: [
      {
        label: "Scheduled Sales",
        data: scheduledSales,
        borderColor: "#FF9500",
        backgroundColor: "rgba(255, 149, 0, 0.1)",
        tension: 0.3,
        fill: true,
        pointBackgroundColor: "#FF9500",
        pointBorderColor: "#fff",
        pointBorderWidth: 2,
        pointRadius: 4,
        yAxisID: "y",
      },
      {
        label: "Bid Submitted Sales",
        data: bidSubmittedSales,
        borderColor: "#0066CC",
        backgroundColor: "rgba(0, 102, 204, 0.1)",
        tension: 0.3,
        fill: true,
        pointBackgroundColor: "#0066CC",
        pointBorderColor: "#fff",
        pointBorderWidth: 2,
        pointRadius: 4,
        yAxisID: "y1",
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
          color: "#111827",
          boxWidth: 12,
        },
      },
      tooltip: {
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        titleColor: "#fff",
        bodyColor: "#e5e7eb",
        borderColor: "#ddd",
        borderWidth: 1,
        callbacks: {
          label: (context) => {
            const value = context.parsed.y || 0;
            return `${context.dataset.label}: $${value.toLocaleString()}`;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        max: maxScheduledSales ? maxScheduledSales * 1.1 : undefined,
        ticks: {
          color: "#FF9500",
          callback: function(value) {
            return `$${Math.round(value as number).toLocaleString()}`;
          },
        },
        grid: {
          color: "#e5e7eb",
        },
        title: {
          display: true,
          text: "Scheduled Sales",
          color: "#FF9500",
          font: { weight: "bold" },
        },
      },
      y1: {
        beginAtZero: true,
        max: maxBidSubmittedSales ? maxBidSubmittedSales * 1.1 : undefined,
        position: "right",
        grid: {
          drawOnChartArea: false,
        },
        ticks: {
          color: "#0066CC",
          callback: function(value) {
            return `$${Math.round(value as number).toLocaleString()}`;
          },
        },
        title: {
          display: true,
          text: "Bid Submitted Sales",
          color: "#0066CC",
          font: { weight: "bold" },
        },
      },
      x: {
        ticks: {
          color: "#111827",
        },
        grid: {
          color: "#f0f0f0",
        },
      },
    },
  };

  return <Line data={chartData} options={options} />;
}
