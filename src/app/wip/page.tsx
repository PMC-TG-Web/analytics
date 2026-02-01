"use client";
import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { db } from "@/firebase";
import { collection, getDocs } from "firebase/firestore";
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
  status?: string;
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
  const [customerFilter, setCustomerFilter] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("wipCustomerFilter") || "";
    }
    return "";
  });
  const [projectFilter, setProjectFilter] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("wipProjectFilter") || "";
    }
    return "";
  });
  const [monthFilter, setMonthFilter] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("wipMonthFilter") || "";
    }
    return "";
  });
  const [yearFilter, setYearFilter] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("wipYearFilter") || "";
    }
    return "";
  });

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch projects directly from Firestore
        const projectsSnapshot = await getDocs(collection(db, "projects"));
        const projectsData = projectsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as any[];
        setProjects(projectsData);
        console.log("Projects loaded from Firestore:", projectsData.length);
        
        // Fetch schedules from API
        const schedulesRes = await fetch("/api/scheduling");
        const schedulesJson = await schedulesRes.json();
        const schedulesData = schedulesJson.data || [];
        
        // Match schedules with projects to get their current status
        const schedulesWithStatus = schedulesData.map((schedule: any) => {
          const jobKey = schedule.jobKey || '';
          // Find matching project by jobKey
          const matchingProject = projectsData.find((p: any) => {
            const projectKey = `${p.customer || ''}|${p.projectNumber || ''}|${p.projectName || ''}`;
            return projectKey === jobKey;
          });
          
          return {
            ...schedule,
            status: matchingProject?.status || 'Unknown'
          };
        });
        
        // Debug: Count schedules by status
        const statusCounts = schedulesWithStatus.reduce((acc: any, s: any) => {
          acc[s.status] = (acc[s.status] || 0) + 1;
          return acc;
        }, {});
        console.log("Schedules by status:", statusCounts);
        
        setSchedules(schedulesWithStatus);
        console.log("Schedules loaded from API:", schedulesWithStatus.length);
      } catch (error) {
        console.error("Failed to load data:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Save filters to localStorage whenever they change
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("wipCustomerFilter", customerFilter);
      localStorage.setItem("wipProjectFilter", projectFilter);
      localStorage.setItem("wipMonthFilter", monthFilter);
      localStorage.setItem("wipYearFilter", yearFilter);
    }
  }, [customerFilter, projectFilter, monthFilter, yearFilter]);

  // Aggregate hours by month (excluding management and Complete status)
  const monthlyData: Record<string, MonthlyWIP> = {};

  schedules.forEach((schedule) => {
    // Skip Complete status jobs
    if (schedule.status === 'Complete') return;
    
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

  // Ensure 2025 has all 12 months
  if (!yearMonthMap["2025"]) {
    yearMonthMap["2025"] = {};
  }
  for (let i = 1; i <= 12; i++) {
    if (yearMonthMap["2025"][i] === undefined) {
      yearMonthMap["2025"][i] = 0;
    }
  }

  let years = Object.keys(yearMonthMap).filter(year => year !== "2024").sort((a, b) => Number(a) - Number(b));
  // Ensure 2025 is in the years array
  if (!years.includes("2025")) {
    years = ["2025", ...years];
  }
  
  // Apply year filter to years array
  const filteredYears = yearFilter ? years.filter(year => year === yearFilter) : years;
  
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Get unique customers and projects for filters
  const uniqueCustomers = Array.from(new Set(schedules.map(s => s.customer || "Unknown"))).sort();
  const uniqueProjects = Array.from(new Set(schedules.map(s => s.projectName || "Unnamed"))).sort();

  // Filter monthly data based on selected filters
  const filteredMonthlyData: Record<string, MonthlyWIP> = {};
  months.forEach((month) => {
    // Apply year filter
    if (yearFilter) {
      const [year] = month.split("-");
      if (year !== yearFilter) return;
    }
    
    const originalData = monthlyData[month];
    const filteredJobs = originalData.jobs.filter((job) => {
      const customerMatch = !customerFilter || job.customer === customerFilter;
      const projectMatch = !projectFilter || job.projectName === projectFilter;
      return customerMatch && projectMatch;
    });

    if (filteredJobs.length > 0) {
      const filteredHours = filteredJobs.reduce((sum, job) => sum + (job.hours ?? 0), 0);
      filteredMonthlyData[month] = {
        month,
        hours: filteredHours,
        jobs: filteredJobs,
      };
    }
  });

  const filteredMonths = Object.keys(filteredMonthlyData).sort();

  // Calculate unscheduled hours from ALL qualifying projects with filters
  const qualifyingStatuses = ["In Progress"];
  const priorityStatuses = ["Accepted", "In Progress", "Complete"];
  
  function parseDateValue(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'object' && value.toDate) return value.toDate();
    if (typeof value === 'string') {
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date;
    }
    return null;
  }
  
  // Step 1: Filter active projects with exclusions
  const activeProjects: any[] = [];
  projects.forEach((p: any) => {
    if (p.projectArchived) return;
    if (p.pmcgroup) return;
    const customer = (p.customer ?? "").toString().toLowerCase();
    if (customer.includes("sop inc")) return;
    const projectName = (p.projectName ?? "").toString().toLowerCase();
    if (projectName === "pmc operations") return;
    if (projectName === "pmc shop time") return;
    if (projectName === "pmc test project") return;
    if (projectName.includes("sandbox")) return;
    if (projectName.includes("raymond king")) return;
    if (projectName === "alexander drive addition latest") return;
    const estimator = (p.estimator ?? "").toString().trim();
    if (!estimator) return;
    if (estimator.toLowerCase() === "todd gilmore") return;
    const projectNumber = (p.projectNumber ?? "").toString().toLowerCase();
    if (projectNumber === "701 poplar church rd") return;
    activeProjects.push(p);
  });
  
  // Step 2: Group by project identifier to find duplicates with different customers
  const projectIdentifierMap = new Map<string, typeof activeProjects>();
  activeProjects.forEach((project) => {
    const identifier = (project.projectNumber ?? project.projectName ?? "").toString().trim();
    if (!identifier) return;
    if (!projectIdentifierMap.has(identifier)) {
      projectIdentifierMap.set(identifier, []);
    }
    projectIdentifierMap.get(identifier)!.push(project);
  });
  
  // Step 3: Deduplicate by customer
  const dedupedByCustomer: typeof activeProjects = [];
  projectIdentifierMap.forEach((projectList) => {
    const customerMap = new Map<string, typeof projectList>();
    projectList.forEach(p => {
      const customer = (p.customer ?? "").toString().trim();
      if (!customerMap.has(customer)) {
        customerMap.set(customer, []);
      }
      customerMap.get(customer)!.push(p);
    });
    
    if (customerMap.size > 1) {
      let selectedCustomer = "";
      let selectedProjects: typeof projectList = [];
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
        let latestCustomer = "";
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
  
  // Step 4: Filter by qualifying statuses
  const filteredByStatus = dedupedByCustomer.filter(p => qualifyingStatuses.includes(p.status || ""));
  
  // Step 5: Group by key
  const keyMap = new Map<string, typeof filteredByStatus>();
  filteredByStatus.forEach((p) => {
    const key = `${p.customer ?? ""}|${p.projectNumber ?? ""}|${p.projectName ?? ""}`;
    if (!keyMap.has(key)) {
      keyMap.set(key, []);
    }
    keyMap.get(key)!.push(p);
  });
  
  // Step 6: Apply alphabetic tiebreaker and aggregate
  const qualifyingProjectsMap = new Map<string, { customer: string; projectName: string; totalHours: number }>();
  keyMap.forEach((projectGroup, key) => {
    const sorted = projectGroup.sort((a, b) => {
      const nameA = (a.projectName ?? "").toString().toLowerCase();
      const nameB = (b.projectName ?? "").toString().toLowerCase();
      return nameA.localeCompare(nameB);
    });
    
    const representative = sorted[0];
    const totalHours = projectGroup.reduce((sum, p) => sum + (p.hours ?? 0), 0);
    
    qualifyingProjectsMap.set(key, {
      customer: representative.customer ?? "Unknown",
      projectName: representative.projectName ?? "Unnamed",
      totalHours,
    });
  });
  
  // Calculate total hours from all qualifying projects
  let totalQualifyingHours = 0;
  qualifyingProjectsMap.forEach(project => {
    totalQualifyingHours += project.totalHours;
  });
  
  console.log("=== UNSCHEDULED HOURS DEBUG ===");
  console.log("Qualifying projects (In Progress status):", qualifyingProjectsMap.size);
  console.log("Total qualifying hours:", totalQualifyingHours.toFixed(1));
  
  // Calculate total scheduled hours from schedules (excluding Complete status)
  let totalScheduledHours = 0;
  let excludedCompleteHours = 0;
  schedules.forEach(schedule => {
    // Skip Complete status jobs
    if (schedule.status === 'Complete') {
      const projectHours = schedule.totalHours || 0;
      const scheduledHours = schedule.allocations.reduce((sum: number, alloc: any) => {
        return sum + (projectHours * (alloc.percent / 100));
      }, 0);
      excludedCompleteHours += scheduledHours;
      return;
    }
    
    const projectHours = schedule.totalHours || 0;
    const scheduledHours = schedule.allocations.reduce((sum: number, alloc: any) => {
      return sum + (projectHours * (alloc.percent / 100));
    }, 0);
    totalScheduledHours += scheduledHours;
  });
  
  console.log("Total scheduled hours (In Progress only):", totalScheduledHours.toFixed(1));
  console.log("Excluded scheduled hours (Complete status):", excludedCompleteHours.toFixed(1));
  console.log("Unscheduled hours calculation:", `${totalQualifyingHours.toFixed(1)} - ${totalScheduledHours.toFixed(1)} = ${(totalQualifyingHours - totalScheduledHours).toFixed(1)}`);
  
  const unscheduledHours = totalQualifyingHours - totalScheduledHours;

  const projectKeyForSchedule = (customer?: string, projectNumber?: string, projectName?: string) => {
    return `${customer ?? ""}|${projectNumber ?? ""}|${projectName ?? ""}`;
  };

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
  
  // Apply year filter to bid submitted sales
  const filteredBidSubmittedSalesByMonth: Record<string, number> = {};
  const filteredBidSubmittedSalesMonths = bidSubmittedSalesMonths.filter(month => {
    if (yearFilter) {
      const [year] = month.split("-");
      if (year !== yearFilter) return false;
    }
    filteredBidSubmittedSalesByMonth[month] = bidSubmittedSalesByMonth[month];
    return true;
  });

  const scheduledSalesByMonth: Record<string, number> = {};
  
  // Build a map of schedule keys to TOTAL project sales (sum of all matching projects)
  // Note: Each project key might have multiple projects, we need to sum them all
  const scheduleSalesMap = new Map<string, number>();
  projects.forEach((project) => {
    // Only include qualifying projects
    if (!qualifyingStatuses.includes(project.status || "")) return;
    
    const key = projectKeyForSchedule(project.customer, project.projectNumber, project.projectName);
    const sales = Number(project.sales ?? 0);
    if (!Number.isFinite(sales)) return;
    
    // Add to existing or create new entry
    const currentTotal = scheduleSalesMap.get(key) || 0;
    scheduleSalesMap.set(key, currentTotal + sales);
  });
  
  console.log("=== SCHEDULED SALES DEBUG ===");
  console.log("Schedules:", schedules.length);
  console.log("Unique project keys with qualifying status:", scheduleSalesMap.size);
  console.log("Total qualifying sales:", Array.from(scheduleSalesMap.values()).reduce((sum, val) => sum + val, 0));
  
  let matchedCount = 0;
  let unmatchedCount = 0;
  
  // For each schedule, distribute sales across months based on allocation percentages
  schedules.forEach((schedule) => {
    // Skip Complete status jobs
    if (schedule.status === 'Complete') return;
    
    const key = schedule.jobKey || projectKeyForSchedule(schedule.customer, schedule.projectNumber, schedule.projectName);
    const projectSales = scheduleSalesMap.get(key);
    
    if (!projectSales) {
      unmatchedCount++;
      return;
    }

    matchedCount++;

    schedule.allocations.forEach((alloc) => {
      const percent = Number(alloc.percent ?? 0);
      if (!Number.isFinite(percent) || percent <= 0) return;
      const monthKey = alloc.month;
      const monthlySales = projectSales * (percent / 100);
      scheduledSalesByMonth[monthKey] = (scheduledSalesByMonth[monthKey] || 0) + monthlySales;
    });
  });
  
  console.log("Matched schedules:", matchedCount);
  console.log("Unmatched schedules:", unmatchedCount);
  console.log("Scheduled sales by month:", scheduledSalesByMonth);

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
  
  // Apply year filter to scheduled sales
  const filteredScheduledSalesByMonth: Record<string, number> = {};
  const filteredScheduledSalesMonths = scheduledSalesMonths.filter(month => {
    if (yearFilter) {
      const [year] = month.split("-");
      if (year !== yearFilter) return false;
    }
    filteredScheduledSalesByMonth[month] = scheduledSalesByMonth[month];
    return true;
  });
  
  const combinedSalesYears = Array.from(new Set([...scheduledSalesYears, ...bidSubmittedSalesYears])).filter(year => year !== "2024").sort();
  
  // Apply year filter to combined years
  const filteredCombinedSalesYears = yearFilter ? combinedSalesYears.filter(year => year === yearFilter) : combinedSalesYears;

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
        <h1 style={{ color: "#003DA5", fontSize: 32, margin: 0 }}>WIP Report</h1>
        <div style={{ display: "flex", gap: 12 }}>
          <a href="/dashboard" style={{ padding: "8px 16px", background: "#003DA5", color: "#fff", borderRadius: 8, textDecoration: "none", fontWeight: 700 }}>
            Dashboard
          </a>
          <a href="/scheduling" style={{ padding: "8px 16px", background: "#0066CC", color: "#fff", borderRadius: 8, textDecoration: "none", fontWeight: 700 }}>
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
      {filteredMonths.length > 0 && (
        <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd", marginBottom: 32 }}>
          <h2 style={{ color: "#003DA5", marginBottom: 16 }}>Scheduled Hours Trend</h2>
          <div style={{ width: "100%", minHeight: 50 }}>
            <HoursLineChart months={filteredMonths} monthlyData={filteredMonthlyData} />
          </div>
        </div>
      )}

      {/* Combined Sales Line Chart */}
      {(filteredScheduledSalesMonths.length > 0 || filteredBidSubmittedSalesMonths.length > 0) && (
        <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd", marginBottom: 32 }}>
          <h2 style={{ color: "#003DA5", marginBottom: 16 }}>Scheduled vs Bid Submitted Sales</h2>
          <div style={{ width: "100%", minHeight: 50 }}>
            <CombinedSalesLineChart
              scheduledMonths={filteredScheduledSalesMonths}
              scheduledSalesByMonth={filteredScheduledSalesByMonth}
              bidSubmittedMonths={filteredBidSubmittedSalesMonths}
              bidSubmittedSalesByMonth={filteredBidSubmittedSalesByMonth}
            />
          </div>
        </div>
      )}

      {/* Year/Month Matrix Table */}
      {filteredYears.length > 0 && (
        <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd", marginBottom: 32 }}>
          <h2 style={{ color: "#003DA5", marginBottom: 16 }}>Hours by Month</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #3a3d42" }}>
                  <th style={{ padding: "12px", textAlign: "left", color: "#666", fontWeight: 600 }}>Year</th>
                  {monthNames.map((name, idx) => (
                    <th key={idx} style={{ padding: "12px", textAlign: "center", color: "#666", fontWeight: 600 }}>
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredYears.map((year) => (
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

      {/* Combined Sales by Month */}
      {filteredCombinedSalesYears.length > 0 && (
        <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd", marginBottom: 32 }}>
          <h2 style={{ color: "#003DA5", marginBottom: 16 }}>Scheduled + Bid Submitted Sales by Month</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #3a3d42" }}>
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
                    <tr style={{ borderBottom: "1px solid #3a3d42" }}>
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
                    <tr style={{ borderBottom: "1px solid #3a3d42" }}>
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

      {/* Summary Cards */}
      {months.length > 0 ? (
        <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h2 style={{ color: "#fff", margin: 0 }}>Monthly Breakdown</h2>
            <button
              onClick={() => {
                setCustomerFilter("");
                setProjectFilter("");
                setMonthFilter("");
                setYearFilter("");
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
            <div>
              <label style={{ fontSize: 12, color: "#9ca3af", display: "block", marginBottom: 6 }}>Year</label>
              <select
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  background: "#1a1d23",
                  color: "#e5e7eb",
                  border: "1px solid #3a3d42",
                  borderRadius: 6,
                }}
              >
                <option value="">All Years</option>
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
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
                <div key={month} style={{ background: "#ffffff", borderRadius: 12, border: "1px solid #ddd", padding: 24, marginBottom: 24 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
                    <h3 style={{ color: "#003DA5", fontSize: 20, margin: 0 }}>{formatMonthLabel(month)}</h3>
                    <div style={{ color: "#0066CC", fontWeight: 700, fontSize: 18 }}>
                      {data.hours.toFixed(1)} hours
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, fontSize: 12, color: "#666", marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #ddd", fontWeight: 600 }}>
                    <div>Customer</div>
                    <div>Project</div>
                    <div style={{ textAlign: "right" }}>Hours</div>
                  </div>
                  {data.jobs.length > 0 ? (
                    data.jobs.filter((job) => (job.hours ?? 0) > 0).map((job, idx) => (
                      <div key={idx} style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, fontSize: 13, color: "#222", marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid #f0f0f0" }}>
                        <div>{job.customer}</div>
                        <div>{job.projectName}</div>
                        <div style={{ textAlign: "right", color: "#0066CC", fontWeight: 600 }}>{job.hours.toFixed(1)}</div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: "#999", padding: 12, textAlign: "center" }}>No jobs scheduled for this month</div>
                  )}
                </div>
              );
            }).filter(Boolean)
          ) : (
            <div style={{ color: "#999", textAlign: "center", padding: 20 }}>
              No data matches the selected filters.
            </div>
          )}
        </div>
      ) : (
        <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd", textAlign: "center", color: "#666" }}>
          No schedules created yet. Go to{" "}
          <a href="/scheduling" style={{ color: "#0066CC", textDecoration: "underline" }}>
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

  // Calculate forecast for next 3 months using linear regression
  const numForecastMonths = 3;
  const forecastData: (number | null)[] = [];
  const actualData: (number | null)[] = [];
  
  // Calculate simple linear trend from last 6 months (or all available data)
  const trendPeriod = Math.min(6, hours.length);
  const recentHours = hours.slice(-trendPeriod);
  
  if (recentHours.length >= 2) {
    // Calculate average change per month
    const changes = [];
    for (let i = 1; i < recentHours.length; i++) {
      changes.push(recentHours[i] - recentHours[i - 1]);
    }
    const avgChange = changes.reduce((sum, val) => sum + val, 0) / changes.length;
    const lastValue = hours[hours.length - 1];
    
    // Create actual data (fill with nulls, then add last actual value as connection point)
    actualData.push(...Array(hours.length).fill(null));
    
    // Create forecast data (start from last actual value)
    forecastData.push(...Array(hours.length - 1).fill(null));
    forecastData.push(lastValue); // Connection point
    
    // Generate forecast months
    const forecastLabels = [];
    const lastMonthParts = sortedMonths[sortedMonths.length - 1].split("-");
    let forecastYear = Number(lastMonthParts[0]);
    let forecastMonth = Number(lastMonthParts[1]);
    
    for (let i = 0; i < numForecastMonths; i++) {
      forecastMonth++;
      if (forecastMonth > 12) {
        forecastMonth = 1;
        forecastYear++;
      }
      const forecastValue = lastValue + avgChange * (i + 1);
      forecastData.push(Math.max(0, forecastValue));
      
      const date = new Date(forecastYear, forecastMonth - 1, 1);
      forecastLabels.push(date.toLocaleDateString(undefined, { month: "short", year: "2-digit" }));
    }
    
    labels.push(...forecastLabels);
    actualData.push(...Array(numForecastMonths).fill(null));
  }

  const maxHours = Math.max(...hours, 4800, ...forecastData.filter((v): v is number => v !== null));

  const chartData = {
    labels,
    datasets: [
      {
        label: "Scheduled Hours",
        data: hours.concat(Array(numForecastMonths).fill(null)),
        borderColor: "#0066CC",
        backgroundColor: "rgba(0, 102, 204, 0.1)",
        tension: 0.3,
        fill: true,
        pointBackgroundColor: "#0066CC",
        pointBorderColor: "#fff",
        pointBorderWidth: 2,
        pointRadius: 5,
        datalabels: {
          display: true,
          color: "#0066CC",
          font: { weight: "bold", size: 14 },
          formatter: (value: any) => {
            if (value === null) return "";
            const percent = ((value / 3900) * 100).toFixed(0);
            return `${percent}%`;
          },
        },
      },
      {
        label: "Forecast",
        data: forecastData,
        borderColor: "#8b5cf6",
        backgroundColor: "rgba(139, 92, 246, 0.05)",
        borderDash: [8, 4],
        borderWidth: 2,
        tension: 0.3,
        fill: false,
        pointBackgroundColor: "#8b5cf6",
        pointBorderColor: "#fff",
        pointBorderWidth: 2,
        pointRadius: 4,
        datalabels: {
          display: false,
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
          color: "#111827",
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
