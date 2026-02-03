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

function getProjectDate(project: any) {
  const updated = parseDateValue(project.dateUpdated);
  const created = parseDateValue(project.dateCreated);
  if (updated && created) return updated > created ? updated : created;
  return updated || created || null;
}

export default function KPIPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [kpiData, setKpiData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState<string>("");
  const [monthFilter, setMonthFilter] = useState<number>(new Date().getMonth() + 1);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // Load year filter from localStorage on mount
  useEffect(() => {
    const savedYear = localStorage.getItem("kpi-year-filter");
    if (savedYear) {
      setYearFilter(savedYear);
    }
  }, []);

  // Save year filter to localStorage when it changes
  useEffect(() => {
    localStorage.setItem("kpi-year-filter", yearFilter);
  }, [yearFilter]);

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
        const schedulesData = schedulesJson.data || schedulesJson.schedules || [];

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

        // Load KPI data for current year
        const currentYear = yearFilter || new Date().getFullYear().toString();
        const kpiRes = await fetch(`/api/kpi?year=${currentYear}`);
        const kpiJson = await kpiRes.json();
        setKpiData(kpiJson.data || []);

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

  const qualifyingStatuses = ["In Progress"];

  const { aggregated: aggregatedProjects, dedupedByCustomer } = useMemo(() => {
    const activeProjects = projects;
    
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
  }, [projects]);

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

  const bidSubmittedHoursByMonth: Record<string, number> = {};
  
  // Filter projects first (like dashboard does), then deduplicate
  const filteredProjects = projects.filter(p => {
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
  
  // Deduplicate by project, selecting one customer per project, then sum hours
  const projectIdentifierMap = new Map<string, Project[]>();
  filteredProjects.forEach((project) => {
    const identifier = (project.projectNumber ?? project.projectName ?? "").toString().trim();
    if (!identifier) return;
    if (!projectIdentifierMap.has(identifier)) {
      projectIdentifierMap.set(identifier, []);
    }
    projectIdentifierMap.get(identifier)!.push(project);
  });
  
  projectIdentifierMap.forEach((projectList) => {
    // Group by customer
    const customerMap = new Map<string, Project[]>();
    projectList.forEach(p => {
      const customer = (p.customer ?? "").toString().trim();
      if (!customerMap.has(customer)) {
        customerMap.set(customer, []);
      }
      customerMap.get(customer)!.push(p);
    });
    
    // Pick one customer
    let chosenCustomer: string = "";
    let chosenProjects: Project[] = [];
    
    if (customerMap.size > 1) {
      const priorityStatuses = ["Accepted", "In Progress", "Complete"];
      let foundPriority = false;
      
      // First try to find a customer with priority status
      customerMap.forEach((projs, customer) => {
        if (!foundPriority && projs.some(p => priorityStatuses.includes(p.status || ""))) {
          chosenCustomer = customer;
          chosenProjects = projs;
          foundPriority = true;
        }
      });
      
      // If no priority status, pick the most recent, then alphabetical
      if (!foundPriority) {
        let latestCustomer = "";
        let latestDate: Date | null = null;
        const customerDates: Array<[string, Date | null]> = [];
        
        customerMap.forEach((projs, customer) => {
          const mostRecent = projs.reduce((latest, current) => {
            const currentDate = parseDateValue(current.dateCreated);
            const latestDateVal = parseDateValue(latest.dateCreated);
            if (!currentDate) return latest;
            if (!latestDateVal) return current;
            return currentDate > latestDateVal ? current : latest;
          }, projs[0]);
          
          const projDate = parseDateValue(mostRecent.dateCreated);
          customerDates.push([customer, projDate]);
        });
        
        // Sort by date descending, then by customer name ascending (alphabetical)
        customerDates.sort((a, b) => {
          if (a[1] && b[1]) {
            if (a[1] !== b[1]) return b[1].getTime() - a[1].getTime();
          }
          return a[0].localeCompare(b[0]);
        });
        
        chosenCustomer = customerDates[0][0];
        chosenProjects = customerMap.get(chosenCustomer) || [];
      }
    } else {
      // Only one customer, take all their entries
      customerMap.forEach((projs) => {
        chosenProjects = projs;
      });
    }
    
    // Sum hours for chosen customer's entries
    chosenProjects.forEach((project) => {
      if ((project.status || "") !== "Bid Submitted") return;
      
      const projectDate = parseDateValue(project.dateCreated);
      if (!projectDate) return;
      
      // Apply date range filter
      if (startDate || endDate) {
        if (startDate) {
          const start = new Date(startDate);
          start.setHours(0, 0, 0, 0);
          if (projectDate < start) return;
        }
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          if (projectDate > end) return;
        }
      }
      
      const monthKey = `${projectDate.getFullYear()}-${String(projectDate.getMonth() + 1).padStart(2, "0")}`;
      const hours = Number(project.hours ?? 0);
      if (!Number.isFinite(hours)) return;
      bidSubmittedHoursByMonth[monthKey] = (bidSubmittedHoursByMonth[monthKey] || 0) + hours;
    });
  });
  const bidSubmittedHoursYearMonthMap: Record<string, Record<number, number>> = {};
  Object.keys(bidSubmittedHoursByMonth).forEach((month) => {
    const [year, m] = month.split("-");
    if (!bidSubmittedHoursYearMonthMap[year]) {
      bidSubmittedHoursYearMonthMap[year] = {};
    }
    bidSubmittedHoursYearMonthMap[year][Number(m)] = bidSubmittedHoursByMonth[month];
  });

  // In Progress hours calculation
  const inProgressHoursByMonth: Record<string, number> = {};
  projectIdentifierMap.forEach((projectList) => {
    const customerMap = new Map<string, Project[]>();
    projectList.forEach(p => {
      const customer = (p.customer ?? "").toString().trim();
      if (!customerMap.has(customer)) {
        customerMap.set(customer, []);
      }
      customerMap.get(customer)!.push(p);
    });
    
    let chosenProjects: Project[] = [];
    if (customerMap.size > 1) {
      const priorityStatuses = ["Accepted", "In Progress", "Complete"];
      let foundPriority = false;
      customerMap.forEach((projs, customer) => {
        if (!foundPriority && projs.some(p => priorityStatuses.includes(p.status || ""))) {
          chosenProjects = projs;
          foundPriority = true;
        }
      });
      if (!foundPriority) {
        const customerDates: Array<[string, Date | null]> = [];
        customerMap.forEach((projs, customer) => {
          const mostRecent = projs.reduce((latest, current) => {
            const currentDate = parseDateValue(current.dateCreated);
            const latestDateVal = parseDateValue(latest.dateCreated);
            if (!currentDate) return latest;
            if (!latestDateVal) return current;
            return currentDate > latestDateVal ? current : latest;
          }, projs[0]);
          const projDate = parseDateValue(mostRecent.dateCreated);
          customerDates.push([customer, projDate]);
        });
        customerDates.sort((a, b) => {
          if (a[1] && b[1]) {
            if (a[1] !== b[1]) return b[1].getTime() - a[1].getTime();
          }
          return a[0].localeCompare(b[0]);
        });
        chosenProjects = customerMap.get(customerDates[0][0]) || [];
      }
    } else {
      customerMap.forEach((projs) => {
        chosenProjects = projs;
      });
    }
    
    chosenProjects.forEach((project) => {
      if ((project.status || "") !== "In Progress") return;
      
      const projectDate = parseDateValue(project.dateCreated);
      if (!projectDate) return;
      
      if (startDate || endDate) {
        if (startDate) {
          const start = new Date(startDate);
          start.setHours(0, 0, 0, 0);
          if (projectDate < start) return;
        }
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          if (projectDate > end) return;
        }
      }
      
      const monthKey = `${projectDate.getFullYear()}-${String(projectDate.getMonth() + 1).padStart(2, "0")}`;
      const hours = Number(project.hours ?? 0);
      if (!Number.isFinite(hours)) return;
      inProgressHoursByMonth[monthKey] = (inProgressHoursByMonth[monthKey] || 0) + hours;
    });
  });
  
  const inProgressHoursYearMonthMap: Record<string, Record<number, number>> = {};
  Object.keys(inProgressHoursByMonth).forEach((month) => {
    const [year, m] = month.split("-");
    if (!inProgressHoursYearMonthMap[year]) {
      inProgressHoursYearMonthMap[year] = {};
    }
    inProgressHoursYearMonthMap[year][Number(m)] = inProgressHoursByMonth[month];
  });

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
          <a href="/kpi-management" style={{ padding: "8px 16px", background: "#f59e0b", color: "#fff", borderRadius: 8, textDecoration: "none", fontWeight: 700 }}>
            KPI Management
          </a>
        </div>
      </div>

      {/* Year Filter Only */}
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
              marginLeft: "auto",
            }}
          >
            Clear Filter
          </button>
        )}
      </div>

      {/* Date Range Filter */}
      <div style={{
        background: "#f9f9f9",
        borderRadius: 12,
        padding: 16,
        marginBottom: 24,
        border: "1px solid #ddd",
        display: "flex",
        alignItems: "center",
        gap: 20
      }}>
        <div style={{ color: "#666", fontWeight: 600 }}>Date Range:</div>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          style={{
            padding: "8px 12px",
            background: "#fff",
            color: "#222",
            border: "1px solid #ddd",
            borderRadius: 6,
            fontSize: 14,
          }}
        />
        <span style={{ color: "#999" }}>to</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          style={{
            padding: "8px 12px",
            background: "#fff",
            color: "#222",
            border: "1px solid #ddd",
            borderRadius: 6,
            fontSize: 14,
          }}
        />
        {(startDate || endDate) && (
          <button
            onClick={() => {
              setStartDate("");
              setEndDate("");
            }}
            style={{
              padding: "6px 12px",
              background: "transparent",
              border: "1px solid #ddd",
              color: "#666",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
              marginLeft: "auto",
            }}
          >
            Clear Dates
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

      {/* KPI Monthly Data Tables */}
      <div style={{ display: "space-y", gap: 24 }}>
        {/* Estimates Table - using Bid Submitted data */}
        <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd", marginBottom: 24 }}>
          <h3 style={{ color: "#003DA5", marginBottom: 16, fontSize: 18, fontWeight: 700 }}>Estimates by Month</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #ddd" }}>
                  <th style={{ padding: "12px", textAlign: "left", color: "#666", fontWeight: 600, minWidth: "120px" }}>Year</th>
                  {monthNames.map((name, idx) => (
                    <th key={idx} style={{ padding: "12px", textAlign: "center", color: "#666", fontWeight: 600, minWidth: "100px" }}>
                      {name.substring(0, 3)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bidSubmittedSalesYears.filter(year => !yearFilter || year === yearFilter).map((year) => (
                  <tr key={year} style={{ borderBottom: "1px solid #ddd" }}>
                    <td style={{ padding: "12px", color: "#222", fontWeight: 700 }}>Bids Submitted</td>
                    {monthNames.map((_, idx) => {
                      const value = bidSubmittedSalesYearMonthMap[year]?.[idx + 1] || 0;
                      return (
                        <td key={idx} style={{ padding: "12px", textAlign: "center", color: value > 0 ? "#003DA5" : "#999", fontWeight: value > 0 ? 700 : 400 }}>
                          {value > 0 ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr key="goal" style={{ borderBottom: "1px solid #ddd", backgroundColor: "#f9f9f9" }}>
                  <td style={{ padding: "12px", color: "#222", fontWeight: 700 }}>Goal</td>
                  {monthNames.map((_, idx) => (
                    <td key={idx} style={{ padding: "12px", textAlign: "center", color: "#28a745", fontWeight: 700 }}>
                      $6,700,000
                    </td>
                  ))}
                </tr>
                <tr key="actual-hours" style={{ borderBottom: "1px solid #ddd" }}>
                  <td style={{ padding: "12px", color: "#222", fontWeight: 700 }}>Actual Hours</td>
                  {monthNames.map((_, idx) => {
                    let hours = 0;
                    if (yearFilter) {
                      hours = bidSubmittedHoursYearMonthMap[yearFilter]?.[idx + 1] || 0;
                    } else {
                      hours = Object.values(bidSubmittedHoursYearMonthMap).reduce((sum, yearData) => sum + (yearData[idx + 1] || 0), 0);
                    }
                    return (
                      <td key={idx} style={{ padding: "12px", textAlign: "center", color: hours > 0 ? "#003DA5" : "#999", fontWeight: hours > 0 ? 700 : 400 }}>
                        {hours > 0 ? hours.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                      </td>
                    );
                  })}
                </tr>
                <tr key="goal-hours" style={{ borderBottom: "1px solid #ddd", backgroundColor: "#f9f9f9" }}>
                  <td style={{ padding: "12px", color: "#222", fontWeight: 700 }}>Goal Hours</td>
                  {monthNames.map((_, idx) => (
                    <td key={idx} style={{ padding: "12px", textAlign: "center", color: "#28a745", fontWeight: 700 }}>
                      29,000
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Sales Table */}
        <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd", marginBottom: 24 }}>
          <h3 style={{ color: "#FF9500", marginBottom: 16, fontSize: 18, fontWeight: 700 }}>Sales by Month</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #ddd" }}>
                  <th style={{ padding: "12px", textAlign: "left", color: "#666", fontWeight: 600, minWidth: "120px" }}>Year</th>
                  {monthNames.map((name, idx) => (
                    <th key={idx} style={{ padding: "12px", textAlign: "center", color: "#666", fontWeight: 600, minWidth: "100px" }}>
                      {name.substring(0, 3)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from(new Set(kpiData.map(k => k.year))).sort().filter(year => !yearFilter || year === yearFilter).map((year) => (
                  <tr key={year} style={{ borderBottom: "1px solid #ddd" }}>
                    <td style={{ padding: "12px", color: "#222", fontWeight: 700 }}>{year}</td>
                    {monthNames.map((_, idx) => {
                      const value = kpiData.find(k => k.year === year && k.month === idx + 1)?.scheduledSales || 0;
                      return (
                        <td key={idx} style={{ padding: "12px", textAlign: "center", color: value > 0 ? "#FF9500" : "#999", fontWeight: value > 0 ? 700 : 400 }}>
                          {value > 0 ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr key="goal" style={{ borderBottom: "1px solid #ddd", backgroundColor: "#f9f9f9" }}>
                  <td style={{ padding: "12px", color: "#222", fontWeight: 700 }}>Goal</td>
                  {monthNames.map((_, idx) => (
                    <td key={idx} style={{ padding: "12px", textAlign: "center", color: "#28a745", fontWeight: 700 }}>
                      $1,000,000
                    </td>
                  ))}
                </tr>
                <tr key="actual-hours" style={{ borderBottom: "1px solid #ddd" }}>
                  <td style={{ padding: "12px", color: "#222", fontWeight: 700 }}>Actual Hours</td>
                  {monthNames.map((_, idx) => {
                    let hours = 0;
                    if (yearFilter) {
                      hours = inProgressHoursYearMonthMap[yearFilter]?.[idx + 1] || 0;
                    } else {
                      hours = Object.values(inProgressHoursYearMonthMap).reduce((sum, yearData) => sum + (yearData[idx + 1] || 0), 0);
                    }
                    return (
                      <td key={idx} style={{ padding: "12px", textAlign: "center", color: hours > 0 ? "#FF9500" : "#999", fontWeight: hours > 0 ? 700 : 400 }}>
                        {hours > 0 ? hours.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                      </td>
                    );
                  })}
                </tr>
                <tr key="goal-hours" style={{ borderBottom: "1px solid #ddd", backgroundColor: "#f9f9f9" }}>
                  <td style={{ padding: "12px", color: "#222", fontWeight: 700 }}>Goal Hours</td>
                  {monthNames.map((_, idx) => (
                    <td key={idx} style={{ padding: "12px", textAlign: "center", color: "#28a745", fontWeight: 700 }}>
                      4,331
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Revenue Table */}
        <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd", marginBottom: 24 }}>
          <h3 style={{ color: "#0066CC", marginBottom: 16, fontSize: 18, fontWeight: 700 }}>Revenue by Month</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #ddd" }}>
                  <th style={{ padding: "12px", textAlign: "left", color: "#666", fontWeight: 600, minWidth: "120px" }}>Year</th>
                  {monthNames.map((name, idx) => (
                    <th key={idx} style={{ padding: "12px", textAlign: "center", color: "#666", fontWeight: 600, minWidth: "100px" }}>
                      {name.substring(0, 3)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from(new Set(kpiData.map(k => k.year))).sort().filter(year => !yearFilter || year === yearFilter).map((year) => (
                  <tr key={year} style={{ borderBottom: "1px solid #ddd" }}>
                    <td style={{ padding: "12px", color: "#222", fontWeight: 700 }}>{year}</td>
                    {monthNames.map((_, idx) => {
                      const value = kpiData.find(k => k.year === year && k.month === idx + 1)?.bidSubmittedSales || 0;
                      return (
                        <td key={idx} style={{ padding: "12px", textAlign: "center", color: value > 0 ? "#0066CC" : "#999", fontWeight: value > 0 ? 700 : 400 }}>
                          {value > 0 ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Subs Table */}
        <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd", marginBottom: 24 }}>
          <h3 style={{ color: "#10b981", marginBottom: 16, fontSize: 18, fontWeight: 700 }}>Subs by Month</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #ddd" }}>
                  <th style={{ padding: "12px", textAlign: "left", color: "#666", fontWeight: 600, minWidth: "120px" }}>Year</th>
                  {monthNames.map((name, idx) => (
                    <th key={idx} style={{ padding: "12px", textAlign: "center", color: "#666", fontWeight: 600, minWidth: "80px" }}>
                      {name.substring(0, 3)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from(new Set(kpiData.map(k => k.year))).sort().filter(year => !yearFilter || year === yearFilter).map((year) => (
                  <tr key={year} style={{ borderBottom: "1px solid #ddd" }}>
                    <td style={{ padding: "12px", color: "#222", fontWeight: 700 }}>{year}</td>
                    {monthNames.map((_, idx) => {
                      const value = kpiData.find(k => k.year === year && k.month === idx + 1)?.subs || 0;
                      return (
                        <td key={idx} style={{ padding: "12px", textAlign: "center", color: value > 0 ? "#10b981" : "#999", fontWeight: value > 0 ? 700 : 400 }}>
                          {value > 0 ? value.toLocaleString() : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Revenue Hours Table */}
        <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd", marginBottom: 24 }}>
          <h3 style={{ color: "#8b5cf6", marginBottom: 16, fontSize: 18, fontWeight: 700 }}>Revenue Hours by Month</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #ddd" }}>
                  <th style={{ padding: "12px", textAlign: "left", color: "#666", fontWeight: 600, minWidth: "120px" }}>Year</th>
                  {monthNames.map((name, idx) => (
                    <th key={idx} style={{ padding: "12px", textAlign: "center", color: "#666", fontWeight: 600, minWidth: "80px" }}>
                      {name.substring(0, 3)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from(new Set(kpiData.map(k => k.year))).sort().filter(year => !yearFilter || year === yearFilter).map((year) => (
                  <tr key={year} style={{ borderBottom: "1px solid #ddd" }}>
                    <td style={{ padding: "12px", color: "#222", fontWeight: 700 }}>{year}</td>
                    {monthNames.map((_, idx) => {
                      const value = kpiData.find(k => k.year === year && k.month === idx + 1)?.scheduledHours || 0;
                      return (
                        <td key={idx} style={{ padding: "12px", textAlign: "center", color: value > 0 ? "#8b5cf6" : "#999", fontWeight: value > 0 ? 700 : 400 }}>
                          {value > 0 ? value.toLocaleString() : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Gross Profit Table */}
        <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd", marginBottom: 24 }}>
          <h3 style={{ color: "#f59e0b", marginBottom: 16, fontSize: 18, fontWeight: 700 }}>Gross Profit by Month</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #ddd" }}>
                  <th style={{ padding: "12px", textAlign: "left", color: "#666", fontWeight: 600, minWidth: "120px" }}>Year</th>
                  {monthNames.map((name, idx) => (
                    <th key={idx} style={{ padding: "12px", textAlign: "center", color: "#666", fontWeight: 600, minWidth: "100px" }}>
                      {name.substring(0, 3)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from(new Set(kpiData.map(k => k.year))).sort().filter(year => !yearFilter || year === yearFilter).map((year) => (
                  <tr key={year} style={{ borderBottom: "1px solid #ddd" }}>
                    <td style={{ padding: "12px", color: "#222", fontWeight: 700 }}>{year}</td>
                    {monthNames.map((_, idx) => {
                      const value = kpiData.find(k => k.year === year && k.month === idx + 1)?.grossProfit || 0;
                      return (
                        <td key={idx} style={{ padding: "12px", textAlign: "center", color: value > 0 ? "#f59e0b" : "#999", fontWeight: value > 0 ? 700 : 400 }}>
                          {value > 0 ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Profit Table */}
        <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd", marginBottom: 24 }}>
          <h3 style={{ color: "#06b6d4", marginBottom: 16, fontSize: 18, fontWeight: 700 }}>Profit by Month</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #ddd" }}>
                  <th style={{ padding: "12px", textAlign: "left", color: "#666", fontWeight: 600, minWidth: "120px" }}>Year</th>
                  {monthNames.map((name, idx) => (
                    <th key={idx} style={{ padding: "12px", textAlign: "center", color: "#666", fontWeight: 600, minWidth: "100px" }}>
                      {name.substring(0, 3)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from(new Set(kpiData.map(k => k.year))).sort().filter(year => !yearFilter || year === yearFilter).map((year) => (
                  <tr key={year} style={{ borderBottom: "1px solid #ddd" }}>
                    <td style={{ padding: "12px", color: "#222", fontWeight: 700 }}>{year}</td>
                    {monthNames.map((_, idx) => {
                      const value = kpiData.find(k => k.year === year && k.month === idx + 1)?.cost || 0;
                      return (
                        <td key={idx} style={{ padding: "12px", textAlign: "center", color: value > 0 ? "#06b6d4" : "#999", fontWeight: value > 0 ? 700 : 400 }}>
                          {value > 0 ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Leadtimes Table */}
        <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd", marginBottom: 24 }}>
          <h3 style={{ color: "#ec4899", marginBottom: 16, fontSize: 18, fontWeight: 700 }}>Leadtimes by Month</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #ddd" }}>
                  <th style={{ padding: "12px", textAlign: "left", color: "#666", fontWeight: 600, minWidth: "120px" }}>Year</th>
                  {monthNames.map((name, idx) => (
                    <th key={idx} style={{ padding: "12px", textAlign: "center", color: "#666", fontWeight: 600, minWidth: "80px" }}>
                      {name.substring(0, 3)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from(new Set(kpiData.map(k => k.year))).sort().filter(year => !yearFilter || year === yearFilter).map((year) => (
                  <tr key={year} style={{ borderBottom: "1px solid #ddd" }}>
                    <td style={{ padding: "12px", color: "#222", fontWeight: 700 }}>{year}</td>
                    {monthNames.map((_, idx) => {
                      const value = kpiData.find(k => k.year === year && k.month === idx + 1)?.leadtimes || 0;
                      return (
                        <td key={idx} style={{ padding: "12px", textAlign: "center", color: value > 0 ? "#ec4899" : "#999", fontWeight: value > 0 ? 700 : 400 }}>
                          {value > 0 ? value.toLocaleString() : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
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
