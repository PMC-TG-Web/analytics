"use client";
import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Navigation from "@/components/Navigation";
import { ProjectScopesModal } from "../project-schedule/components/ProjectScopesModal";
import { ProjectInfo, Scope, Project } from "@/types";
import { getEnrichedScopes } from "@/utils/projectUtils";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  Plugin,
  ChartOptions
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

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

type Allocation = {
  month: string;
  percent: number;
};

type Schedule = {
  id: string;
  jobKey: string;
  customer?: string;
  projectNumber?: string;
  projectName?: string;
  totalHours: number;
  allocations: Allocation[] | Record<string, number>;
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

function normalizeAllocations(allocations: Schedule["allocations"] | null | undefined): Allocation[] {
  if (!allocations) return [];
  if (Array.isArray(allocations)) return allocations;

  return Object.entries(allocations).map(([month, percent]) => ({
    month,
    percent: Number(percent) || 0,
  }));
}

function isValidMonthKey(month: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

function formatMonthLabel(month: string) {
  if (!isValidMonthKey(month)) return "";
  const [year, m] = month.split("-");
  const date = new Date(Number(year), Number(m) - 1, 1);
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function formatMonthLabelShort(month: string) {
  if (!isValidMonthKey(month)) return "";
  const [year, m] = month.split("-");
  const date = new Date(Number(year), Number(m) - 1, 1);
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

export default function WIPReportPage() {
  return <WIPReportContent />;
}

function WIPReportContent() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const qualifyingStatus = "In Progress";

  const [selectedJob, setSelectedJob] = useState<any>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editableSchedule, setEditableSchedule] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [weeklySchedule, setWeeklySchedule] = useState<Record<number, number>>({});
  const [weeklyModalVisible, setWeeklyModalVisible] = useState(false);
  const [monthTargetHours, setMonthTargetHours] = useState<number>(0);
  
  // Gantt / Scopes state
  const [scopesByJobKey, setScopesByJobKey] = useState<Record<string, Scope[]>>({});
  const [selectedGanttProject, setSelectedGanttProject] = useState<ProjectInfo | null>(null);

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
        setLoading(true);
        console.log("[WIP] Starting data fetch...");
        const start = Date.now();

        // Parallelize all primary data fetches
        const [projectsScopesRes, schedulesRes] = await Promise.all([
          fetch("/api/projects-scopes"),
          fetch("/api/scheduling"),
        ]);

        let projectsData: any[] = [];
        let scopesSnapshot: any[] = [];
        let schedulesData: any[] = [];

        // Handle projects-scopes response
        if (projectsScopesRes.ok) {
          const projectsScopesData = await projectsScopesRes.json();
          projectsSnapshot = projectsScopesData.projects || [];
          scopesSnapshot = projectsScopesData.scopes || [];
          projectsData = projectsSnapshot as any[];
        } else {
          console.warn("[WIP] Projects-scopes API endpoint not available");
        }

        // Handle schedules response
        if (schedulesRes.ok) {
          const schedulesJson = await schedulesRes.json();
          schedulesData = schedulesJson.data || [];
        } else {
          console.warn("[WIP] Scheduling API endpoint not available");
        }

        console.log(`[WIP] Fetched all primary data in ${Date.now() - start}ms`);
        const projectLookup = new Map();
        projectsData.forEach(p => {
          const key = `${p.customer || "" }~${p.projectNumber || "" }~${p.projectName || "" }`;
          projectLookup.set(key, p);
        });

        const schedulesWithStatus = schedulesData.map((schedule: any) => {
          const jobKey = schedule.jobKey || "";
          const matchingProject = projectLookup.get(jobKey);
          
          return {
            ...schedule,
            status: matchingProject?.status || "Unknown"
          };
        });

        setProjects(projectsData);
        setSchedules(schedulesWithStatus);
        
        // Fetch scopes for Gantt feed
        const rawScopes = scopesSnapshot as Scope[];
        const enrichedScopes = getEnrichedScopes(rawScopes, projectsData);
        
        const scopesMap: Record<string, Scope[]> = {};
        enrichedScopes.forEach((scope) => {
          if (!scope.jobKey) return;
          if ((scope.title || "").trim().toLowerCase() === "scheduled work") return;
          if (!scopesMap[scope.jobKey]) scopesMap[scope.jobKey] = [];
          scopesMap[scope.jobKey].push(scope);
        });
        setScopesByJobKey(scopesMap);
        console.log(`[WIP] Processed all data in ${Date.now() - start}ms`);
      } catch (error) {
        console.warn("[WIP] Error loading data (using empty defaults):", error);
        setProjects([]);
        setSchedules([]);
        setScopesByJobKey({});
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

  async function openJobModal(customer: string, projectName: string, projectNumber: string) {
    const jobKey = `${customer}~${projectNumber}~${projectName}`;
    const project = projects.find((p) => 
      p.customer === customer && 
      p.projectName === projectName && 
      p.projectNumber === projectNumber
    );
    
    if (!project) {
      alert("Project not found");
      return;
    }

    // Find existing schedule
    const existingSchedule = schedules.find((s) => s.jobKey === jobKey);
    
    // Get all months from schedules
    const allMonths = new Set<string>();
    schedules.forEach((s) => {
      normalizeAllocations(s.allocations).forEach((a) => {
        if (isValidMonthKey(a.month)) {
          allMonths.add(a.month);
        }
      });
    });
    const sortedMonths = Array.from(allMonths).sort();

    const allocations: Record<string, number> = {};
    if (existingSchedule) {
      normalizeAllocations(existingSchedule.allocations).forEach((a) => {
        allocations[a.month] = a.percent;
      });
      // Use the schedule's totalHours if available, otherwise use project hours
      const totalHours = existingSchedule.totalHours || project.projectedPreconstHours || 0;
      
      setSelectedJob({
        jobKey,
        customer,
        projectNumber,
        projectName,
        status: project.status || "In Progress",
        totalHours: totalHours,
        allocations,
        months: sortedMonths,
      });
    } else {
      sortedMonths.forEach((m) => {
        allocations[m] = 0;
      });
      
      setSelectedJob({
        jobKey,
        customer,
        projectNumber,
        projectName,
        status: project.status || "In Progress",
        totalHours: project.projectedPreconstHours || 0,
        allocations,
        months: sortedMonths,
      });
    }
    
    setEditableSchedule(allocations);
    setModalVisible(true);
  }

  async function openGanttModal(customer: string, projectName: string, projectNumber: string) {
    const jobKey = `${customer}~${projectNumber}~${projectName}`;
    const project = projects.find((p) => 
      p.customer === customer && 
      p.projectName === projectName && 
      p.projectNumber === projectNumber
    );
    
    if (!project) {
      alert("Project not found");
      return;
    }

    setSelectedGanttProject({
      jobKey,
      customer,
      projectNumber,
      projectName,
      projectDocId: project.id
    });
  }

  function updateModalPercent(month: string, percent: number) {
    const validPercent = Math.max(0, Math.min(100, isNaN(percent) ? 0 : percent));
    setEditableSchedule((prev: any) => ({
      ...prev,
      [month]: validPercent,
    }));
  }

  async function openWeeklySchedule(month: string) {
    if (!selectedJob) return;
    
    setSelectedMonth(month);
    
    // Calculate target hours for this month
    const percent = editableSchedule[month] || 0;
    const targetHours = (selectedJob.totalHours * percent) / 100;
    setMonthTargetHours(targetHours);
    
    // Load existing weekly schedule from API
    try {
      const response = await fetch(`/api/long-term-schedule?jobKey=${encodeURIComponent(selectedJob.jobKey)}&month=${encodeURIComponent(month)}`);
      if (!response.ok) {
        console.warn("[WIP] Long-term-schedule API endpoint not available, using empty schedule");
        const weeks: Record<number, number> = {};
        for (let i = 1; i <= 5; i++) {
          weeks[i] = 0;
        }
        setWeeklySchedule(weeks);
        setWeeklyModalVisible(true);
        return;
      }
      const schedules = await response.json();
      const existingSchedule = schedules.length > 0 ? schedules[0] : null;
      
      if (existingSchedule) {
        const weeks: Record<number, number> = {};
        (existingSchedule.weeks || []).forEach((w: any) => {
          weeks[w.weekNumber || w.week_number] = w.hours || 0;
        });
        setWeeklySchedule(weeks);
      } else {
        // Initialize with empty weeks (4-5 weeks per month)
        const weeks: Record<number, number> = {};
        for (let i = 1; i <= 5; i++) {
          weeks[i] = 0;
        }
        setWeeklySchedule(weeks);
      }
      
      setWeeklyModalVisible(true);
    } catch (error) {
      console.warn("[WIP] Failed to load weekly schedule:", error);
    }
  }

  function updateWeeklyHours(weekNumber: number, hours: number) {
    const validHours = Math.max(0, isNaN(hours) ? 0 : hours);
    setWeeklySchedule((prev) => ({
      ...prev,
      [weekNumber]: validHours,
    }));
  }

  async function saveWeeklySchedule() {
    if (!selectedJob || !selectedMonth) return;
    
    setSaving(true);
    try {
      const weeks = Object.entries(weeklySchedule).map(([weekNumber, hours]) => ({
        weekNumber: Number(weekNumber),
        hours,
      }));

      const response = await fetch("/api/long-term-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobKey: selectedJob.jobKey,
          customer: selectedJob.customer,
          projectNumber: selectedJob.projectNumber,
          projectName: selectedJob.projectName,
          month: selectedMonth,
          weeks,
          totalHours: weeks.reduce((sum, w) => sum + w.hours, 0),
        }),
      });

      if (!response.ok) {
        console.warn("[WIP] Long-term-schedule API endpoint not available, skipping save");
        // Don't throw, just skip in static export mode
      } else {
        console.log("[WIP] Weekly schedule saved successfully");
      }

      setWeeklyModalVisible(false);
      setSelectedMonth(null);
    } catch (error) {
      console.warn("[WIP] Failed to save weekly schedule:", error);
    } finally {
      setSaving(false);
    }
  }

  async function saveJobSchedule() {
    if (!selectedJob) return;
    
    setSaving(true);
    try {
      const allocations = selectedJob.months.map((month: string) => ({
        month,
        percent: editableSchedule[month] || 0,
      }));

      const response = await fetch("/api/scheduling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobKey: selectedJob.jobKey,
          customer: selectedJob.customer,
          projectNumber: selectedJob.projectNumber,
          projectName: selectedJob.projectName,
          status: selectedJob.status,
          totalHours: selectedJob.totalHours,
          allocations,
        }),
      });

      if (!response.ok) {
        console.warn("[WIP] Scheduling API endpoint not available, skipping save");
        // Don't throw, just skip in static export mode
      } else {
        console.log("[WIP] Schedule saved successfully");
      }

      setModalVisible(false);
      // Refresh data
      // window.location.reload();
    } catch (error) {
      console.warn("[WIP] Failed to save schedule:", error);
    } finally {
      setSaving(false);
    }
  }

  const { 
    monthlyData, 
    scheduledSalesByMonth, 
    bidSubmittedSalesByMonth,
    inProgressScheduledHoursForGantt, 
    filteredInProgressHoursFromGantt, 
    projectsWithGanttData, 
    qualifyingKeyMap, 
    totalPoolHours,
    allInProgressScheduledHours,
    filteredInProgressHours,
    poolBreakdown
  } = React.useMemo(() => {
    const monthlyData: Record<string, MonthlyWIP> = {};
    const scheduledSalesByMonth: Record<string, number> = {};
    const bidSubmittedSalesByMonth: Record<string, number> = {};
    let inProgressScheduledHoursForGantt = 0;
    let filteredInProgressHoursFromGantt = 0;

    const projectsWithGanttData = new Set<string>();
    const qualifyingKeyMap = new Map<string, any[]>();
    
    // Group projects by jobKey for O(1) lookups
    const projectsByJobKey = new Map<string, any[]>();
    projects.forEach(p => {
      const key = p.jobKey || `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`;
      if (!projectsByJobKey.has(key)) projectsByJobKey.set(key, []);
      projectsByJobKey.get(key)!.push(p);
    });

    // Step 1: Identify all qualifying projects (In Progress and not archived)
    // We are now keeping ALL qualifying projects to ensure we capture the full 33,503 pool
    const qualifyingProjects = projects.filter((p) => {
      if ((p as any).projectArchived) return false;
      const status = (p.status || "").toString().toLowerCase().trim();
      if (status !== "in progress") return false;

      const customer = (p.customer ?? "").toString().toLowerCase();
      if (customer.includes("sop inc")) return false;
      const projectName = (p.projectName ?? "").toString().toLowerCase();
      if (projectName === "pmc operations") return false;
      if (projectName === "pmc shop time") return false;
      if (projectName === "pmc test project") return false;
      if (projectName.includes("sandbox") || projectName.includes("raymond king")) return false;
      
      return true;
    });

    const qualifyingJobKeys = new Set(qualifyingProjects.map(p => 
      p.jobKey || `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`
    ));

    // Also include projects that only exist as schedules but are "In Progress"
    schedules.forEach(s => {
      const status = (s.status || "").toString().toLowerCase().trim();
      if (status !== "in progress") return;
      const key = s.jobKey || `${s.customer || "" }~${s.projectNumber || "" }~${s.projectName || "" }`;
      const isExcluded = (s.customer || "").toLowerCase().includes("sop inc") || 
                        (s.projectName || "").toLowerCase().includes("sandbox");
      if (!isExcluded) qualifyingJobKeys.add(key);
    });

    // Step 2: Calculate Scheduled Hours and Gantt Data
    const internalDistributeValue = (totalValue: number, startDate: string, endDate: string) => {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return {};
      const totalDays = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24) + 1);
      const dailyRate = totalValue / totalDays;
      const distribution: Record<string, number> = {};
      let current = new Date(start.getFullYear(), start.getMonth(), 1);
      const last = new Date(end.getFullYear(), end.getMonth(), 1);
      while (current.getTime() <= last.getTime()) {
        const monthKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
        const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
        const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
        const overlapStart = start.getTime() > monthStart.getTime() ? start : monthStart;
        const overlapEnd = end.getTime() < monthEnd.getTime() ? end : monthEnd;
        const overlapDays = Math.max(0, (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24) + 1);
        if (overlapDays > 0) distribution[monthKey] = dailyRate * overlapDays;
        current.setMonth(current.getMonth() + 1);
      }
      return distribution;
    };

    Object.entries(scopesByJobKey).forEach(([jobKey, scopes]) => {
      if (!qualifyingJobKeys.has(jobKey)) return;
      const validScopes = scopes.filter(s => s.startDate && s.endDate);
      if (validScopes.length > 0) {
        projectsWithGanttData.add(jobKey);
        const jobProjects = projectsByJobKey.get(jobKey) || [];
        if (jobProjects.length === 0) return;
        
        const projectCostItems = jobProjects.map(p => ({
          customer: p.customer,
          projectName: p.projectName,
          projectNumber: p.projectNumber,
          costitems: (p.costitems || "").toLowerCase(),
          scopeOfWork: (p.scopeOfWork || "").toLowerCase(),
          hours: typeof p.hours === "number" ? p.hours : 0,
          costType: typeof p.costType === "string" ? p.costType : "",
        }));

        validScopes.forEach(scope => {
          const titleWithoutQty = (scope.title || "Scope").trim().toLowerCase().replace(/^[\d,]+\s*(sq\s*ft\.?|ln\s*ft\.?|each|lf)?\s*([-–]\s*)?/i, "").trim();
          const matchedItems = projectCostItems.filter((item) => 
            item.scopeOfWork.includes(titleWithoutQty) || 
            titleWithoutQty.includes(item.scopeOfWork) ||
            item.costitems.includes(titleWithoutQty) || 
            titleWithoutQty.includes(item.costitems)
          );
          const scopeHours = matchedItems.reduce((acc, item) => !item.costType.toLowerCase().includes("management") ? acc + item.hours : acc, 0) || (typeof scope.hours === "number" ? scope.hours : 0);
          if (scopeHours <= 0) return;
          const hourDist = internalDistributeValue(scopeHours, scope.startDate!, scope.endDate!);
          Object.entries(hourDist).forEach(([monthKey, hours]) => {
            if (!monthlyData[monthKey]) monthlyData[monthKey] = { month: monthKey, hours: 0, jobs: [] };
            monthlyData[monthKey].hours += hours;
            inProgressScheduledHoursForGantt += hours;
            if (!yearFilter || monthKey.startsWith(yearFilter)) filteredInProgressHoursFromGantt += hours;

            const existingJob = monthlyData[monthKey].jobs.find(j => j.projectName === projectCostItems[0].projectName && j.customer === projectCostItems[0].customer);
            if (existingJob) existingJob.hours += hours;
            else monthlyData[monthKey].jobs.push({ customer: projectCostItems[0].customer || "Unknown", projectNumber: projectCostItems[0].projectNumber || "N/A", projectName: projectCostItems[0].projectName || "Unnamed", hours: hours });
          });
        });
      }
    });

    schedules.forEach((schedule) => {
      const status = (schedule.status || "").toString().toLowerCase().trim();
      if (status !== "in progress" || projectsWithGanttData.has(schedule.jobKey || "")) return;
      if (!qualifyingJobKeys.has(schedule.jobKey || "")) return;
      normalizeAllocations(schedule.allocations).forEach((alloc) => {
        if (!isValidMonthKey(alloc.month)) return;
        if (!monthlyData[alloc.month]) monthlyData[alloc.month] = { month: alloc.month, hours: 0, jobs: [] };
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

    // Step 3: Calculate Sales and Bids
    const scheduleSalesMap = new Map<string, number>();
    projects.forEach((project) => {
      const key = project.jobKey || `${project.customer || ""}~${project.projectNumber || ""}~${project.projectName || ""}`;
      const sales = Number(project.sales ?? 0);
      if (!Number.isFinite(sales)) return;
      scheduleSalesMap.set(key, (scheduleSalesMap.get(key) || 0) + sales);

      // Bid Submitted Sales
      if ((project.status || "").toString().toLowerCase().trim() === "bid submitted") {
        const projectDate = parseDateValue(project.dateCreated) || parseDateValue(project.dateUpdated);
        if (projectDate) {
          const monthKey = `${projectDate.getFullYear()}-${String(projectDate.getMonth() + 1).padStart(2, "0")}`;
          bidSubmittedSalesByMonth[monthKey] = (bidSubmittedSalesByMonth[monthKey] || 0) + sales;
        }
      }
    });
    
    schedules.forEach((schedule) => {
      const status = (schedule.status || "").toString().toLowerCase().trim();
      if (status !== "in progress") return;
      const key = schedule.jobKey || `${schedule.customer || ""}~${schedule.projectNumber || ""}~${schedule.projectName || ""}`;
      const projectSales = scheduleSalesMap.get(key);
      if (!projectSales) return;
      normalizeAllocations(schedule.allocations).forEach((alloc) => {
        const percent = Number(alloc.percent ?? 0);
        if (percent <= 0) return;
        scheduledSalesByMonth[alloc.month] = (scheduledSalesByMonth[alloc.month] || 0) + (projectSales * (percent / 100));
      });
    });

    // Step 4: Calculate Total Labor Pool Hours (Target: ~33,503)
    let totalPoolHours = 0;
    const poolBreakdown: { 
      jobKey: string; 
      budget: number; 
      projectName: string;
      customer: string;
      hasSchedule: boolean;
      hasGantt: boolean;
      p_hours: number;
      p_proj: number;
    }[] = [];

    qualifyingJobKeys.forEach(jobKey => {
      const jobProjects = projectsByJobKey.get(jobKey) || [];
      const schedule = schedules.find(s => s.jobKey === jobKey);
      let ganttBudget = 0;
      const jobScopes = scopesByJobKey[jobKey] || [];
      if (jobScopes.length > 0) {
        jobScopes.forEach(scope => {
          ganttBudget += (typeof scope.hours === "number" ? scope.hours : 0);
        });
      }
      const scheduleBudget = schedule ? (schedule.totalHours || 0) : 0;
      // Additive Budgeting: Sum of Hours + Projected Hours for ALL qualifying projects matching this jobKey
      const lineItemBudget = jobProjects.reduce((sum, p) => {
        const status = (p.status || "").toString().toLowerCase().trim();
        if (status !== "in progress") return sum;
        if ((p as any).projectArchived) return sum; // Skip archived projects
        
        return sum + (Number(p.hours) || 0) + (Number(p.projectedPreconstHours) || 0);
      }, 0);
      
      let jobTotalBudget = Math.max(ganttBudget, scheduleBudget, lineItemBudget);
      
      // If year filter is active and we have no schedule/gantt to tell us the year,
      // we should probably exclude it or treat it as current year? 
      // Actually, the user's question "is this only calculating for the year filtered?" 
      // implies they want it to be.
      if (yearFilter) {
        if (schedule) {
          let yearAllocPercent = normalizeAllocations(schedule.allocations)
            .filter(a => a.month.startsWith(yearFilter))
            .reduce((sum, a) => sum + a.percent, 0);
          jobTotalBudget = jobTotalBudget * (yearAllocPercent / 100);
        } else if (jobScopes.length > 0) {
          // If we have Gantt but no schedule, filter by Gantt months
          let yearGanttHours = 0;
          jobScopes.forEach(s => {
            const dist = internalDistributeValue(s.hours || 0, s.startDate!, s.endDate!);
            Object.entries(dist).forEach(([m, h]) => {
              if (m.startsWith(yearFilter)) yearGanttHours += h;
            });
          });
          
          const totalGanttHours = jobScopes.reduce((a, b) => a + (b.hours || 0), 0);
          if (totalGanttHours > 0) {
            jobTotalBudget = jobTotalBudget * (yearGanttHours / totalGanttHours);
          } else {
            jobTotalBudget = 0;
          }
        }
      }
      
      if (jobTotalBudget > 0) {
        totalPoolHours += jobTotalBudget;
        poolBreakdown.push({
          jobKey,
          budget: jobTotalBudget,
          projectName: jobProjects[0]?.projectName || "Unknown",
          customer: jobProjects[0]?.customer || "Unknown",
          hasSchedule: !!schedule,
          hasGantt: jobScopes.length > 0,
          p_hours: jobProjects.reduce((s, p) => s + (Number(p.hours) || 0), 0),
          p_proj: jobProjects.reduce((s, p) => s + (Number(p.projectedPreconstHours) || 0), 0)
        });
      }
    });

    poolBreakdown.sort((a, b) => b.budget - a.budget);

    // Step 5: Calculate Scheduled Hours for Unscheduled reconciliation
    const allInProgressScheduledHours = inProgressScheduledHoursForGantt + schedules
      .filter(s => (s.status || "").toString().toLowerCase().trim() === "in progress" && !projectsWithGanttData.has(s.jobKey || ""))
      .reduce((sum, schedule) => {
        return sum + normalizeAllocations(schedule.allocations).reduce((acc, a) => acc + (schedule.totalHours * (a.percent / 100)), 0);
      }, 0);

    const filteredInProgressHours = filteredInProgressHoursFromGantt + schedules
      .filter(s => (s.status || "").toString().toLowerCase().trim() === "in progress" && !projectsWithGanttData.has(s.jobKey || ""))
      .reduce((sum, schedule) => {
        return sum + normalizeAllocations(schedule.allocations)
          .filter(a => !yearFilter || a.month.startsWith(yearFilter))
          .reduce((acc, a) => acc + (schedule.totalHours * (a.percent / 100)), 0);
      }, 0);

    return { 
      monthlyData, 
      scheduledSalesByMonth, 
      bidSubmittedSalesByMonth,
      inProgressScheduledHoursForGantt, 
      filteredInProgressHoursFromGantt, 
      projectsWithGanttData, 
      qualifyingKeyMap, 
      totalPoolHours,
      allInProgressScheduledHours,
      filteredInProgressHours,
      poolBreakdown
    };
  }, [scopesByJobKey, projects, schedules, yearFilter, qualifyingStatus]);

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

  // Filter schedules to ONLY include In Progress for the rest of the UI (counts, filters)
  const qualifyingSchedules = schedules.filter(s => (s.status || "").toString().toLowerCase().trim() === "in progress");

  // Get unique customers and projects for filters
  const uniqueCustomers = Array.from(new Set(qualifyingSchedules.map(s => s.customer || "Unknown"))).sort();
  const uniqueProjects = Array.from(new Set(qualifyingSchedules.map(s => s.projectName || "Unnamed"))).sort();

  // Filter monthly data based on selected filters
  const filteredMonthlyData: Record<string, MonthlyWIP> = {};
  months.forEach((month) => {
    // Apply year filter
    if (yearFilter) {
      const [year] = month.split("-");
      if (year !== yearFilter) return;
    }
    
    const originalData = monthlyData[month];
    const filteredJobs = (originalData.jobs || []).filter((job) => {
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
  const filteredTotalHours = Object.values(filteredMonthlyData).reduce((sum, m) => sum + m.hours, 0);
  const filteredAvgHours = filteredMonths.length > 0 ? filteredTotalHours / filteredMonths.length : 0;

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
  
  // Unscheduled calculation uses the unified pool from useMemo
  const scheduledHoursForQualifying = (yearFilter ? filteredInProgressHoursFromGantt : inProgressScheduledHoursForGantt) + schedules.reduce((sum, schedule) => {
    const status = (schedule.status || "").toString().toLowerCase().trim();
    if (status !== "in progress") return sum;
    const key = schedule.jobKey || `${schedule.customer ?? ""}~${schedule.projectNumber ?? ""}~${schedule.projectName ?? ""}`;
    if (projectsWithGanttData.has(key)) return sum;
    if (customerFilter && schedule.customer !== customerFilter) return sum;
    if (projectFilter && schedule.projectName !== projectFilter) return sum;

    const scheduledHours = normalizeAllocations(schedule.allocations).reduce((scheduleSum, alloc) => {
      if (!isValidMonthKey(alloc.month)) return scheduleSum;
      if (yearFilter && !alloc.month.startsWith(yearFilter)) return scheduleSum;
      return scheduleSum + (schedule.totalHours * (alloc.percent / 100));
    }, 0);

    return sum + scheduledHours;
  }, 0);

  const unscheduledHours = Math.max(0, totalPoolHours - scheduledHoursForQualifying);

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
  bidSubmittedSalesMonths.forEach(month => {
    if (yearFilter) {
      const [year] = month.split("-");
      if (year !== yearFilter) return;
    }
    filteredBidSubmittedSalesByMonth[month] = bidSubmittedSalesByMonth[month];
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
  
  const combinedSalesYears = Array.from(new Set([...scheduledSalesYears, ...bidSubmittedSalesYears])).filter(year => year !== "2024").sort();
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
        <h1 style={{ color: "#15616D", fontSize: 32, margin: 0 }}>WIP Report</h1>
        <Navigation currentPage="wip" />
      </div>

      {/* Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 12 }}>
        <SummaryCard label="Total Scheduled Hours" value={filteredTotalHours.toFixed(1)} />
        <SummaryCard label="Average Monthly Hours" value={filteredAvgHours.toFixed(1)} />
        <SummaryCard label="Months Scheduled" value={filteredMonths.length} />
        <SummaryCard label="Scheduled Jobs" value={qualifyingSchedules.length} />
      </div>

      {/* Unscheduled Hours Container */}
      <div style={{ background: "#ef4444", borderRadius: 12, padding: 24, border: "1px solid #dc2626", marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Unscheduled Hours</div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.7)" }}>
              {qualifyingStatus} Jobs
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
              {unscheduledHours.toFixed(1)}
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)" }}>
              of {totalPoolHours.toFixed(1)} total hours
            </div>
          </div>
        </div>
        {unscheduledHours > 0 && (
          <div style={{ marginTop: 12, fontSize: 12, color: "rgba(255,255,255,0.8)" }}>
            {((unscheduledHours / totalPoolHours) * 100).toFixed(0)}% remaining to schedule
          </div>
        )}
      </div>

      {/* Hours Line Chart */}
      {filteredMonths.length > 0 && (
        <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd", marginBottom: 12 }}>
          <h2 style={{ color: "#15616D", marginBottom: 16 }}>Scheduled Hours Trend</h2>
          <div style={{ width: "100%", height: 400 }}>
            <HoursLineChart months={filteredMonths} monthlyData={filteredMonthlyData} projects={projects} yearFilter={yearFilter} />
          </div>
        </div>
      )}

      {/* Year/Month Matrix Table */}
      {filteredYears.length > 0 && (
        <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd", marginBottom: 12 }}>
          <h2 style={{ color: "#15616D", marginBottom: 16 }}>Hours by Month</h2>
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
                  <th style={{ padding: "12px", textAlign: "center", color: "#666", fontWeight: 600 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {filteredYears.map((year, yearIndex) => {
                  const yearTotal = Object.values(yearMonthMap[year] || {}).reduce((sum, h) => sum + (h || 0), 0);
                  return (
                    <tr key={year} style={{ borderBottom: "1px solid #3a3d42", backgroundColor: yearIndex % 2 === 0 ? "#ffffff" : "#f9f9f9" }}>
                      <td style={{ padding: "12px", color: "#333", fontWeight: 700 }}>{year}</td>
                      {monthNames.map((_, idx) => {
                        const hours = yearMonthMap[year][idx + 1] || 0;
                        return (
                          <td key={idx} style={{ padding: "12px", textAlign: "center", color: hours > 0 ? "#22c55e" : "#6b7280", fontWeight: hours > 0 ? 700 : 400 }}>
                            {hours > 0 ? hours.toFixed(0) : "—"}
                          </td>
                        );
                      })}
                      <td style={{ padding: "12px", textAlign: "center", color: "#15616D", fontWeight: 700, backgroundColor: 'rgba(21, 97, 109, 0.05)' }}>
                        {yearTotal.toFixed(0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid #3a3d42", fontWeight: 700, backgroundColor: "#f3f4f6" }}>
                  <td style={{ padding: "12px", color: "#333" }}>Total</td>
                  {monthNames.map((_, idx) => {
                    const monthTotal = filteredYears.reduce((sum, year) => sum + (yearMonthMap[year][idx + 1] || 0), 0);
                    return (
                      <td key={idx} style={{ padding: "12px", textAlign: "center", color: "#15616D" }}>
                        {monthTotal > 0 ? monthTotal.toFixed(0) : "—"}
                      </td>
                    );
                  })}
                  <td style={{ padding: "12px", textAlign: "center", color: "#15616D", fontSize: "16px", backgroundColor: 'rgba(21, 97, 109, 0.1)' }}>
                    {filteredTotalHours.toFixed(0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {months.length > 0 ? (
        <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h2 style={{ color: "#15616D", margin: 0 }}>Monthly Breakdown</h2>
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
                    <h3 style={{ color: "#15616D", fontSize: 20, margin: 0 }}>{formatMonthLabel(month)}</h3>
                    <div style={{ color: "#E06C00", fontWeight: 700, fontSize: 18 }}>
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
                      <div 
                        key={idx} 
                        onClick={() => openGanttModal(job.customer, job.projectName, job.projectNumber)}
                        style={{ 
                          display: "grid", 
                          gridTemplateColumns: "repeat(3, 1fr)", 
                          gap: 12, 
                          fontSize: 13, 
                          color: "#222", 
                          marginBottom: 8, 
                          paddingBottom: 8, 
                          borderBottom: "1px solid #f0f0f0",
                          cursor: "pointer",
                          padding: "8px",
                          borderRadius: "4px",
                          backgroundColor: idx % 2 === 0 ? "#ffffff" : "#f9f9f9",
                          transition: "background 0.2s"
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "#f5f5f5"}
                        onMouseLeave={(e) => e.currentTarget.style.background = idx % 2 === 0 ? "#ffffff" : "#f9f9f9"}
                      >
                        <div>{job.customer}</div>
                        <div>{job.projectName}</div>
                        <div style={{ textAlign: "right", color: "#E06C00", fontWeight: 600 }}>{job.hours.toFixed(1)}</div>
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
          <a href="/scheduling" style={{ color: "#E06C00", textDecoration: "underline" }}>
            Scheduling
          </a>{" "}
          to create a schedule.
        </div>
      )}

      {selectedGanttProject && (
        <ProjectScopesModal
          project={selectedGanttProject}
          scopes={scopesByJobKey[selectedGanttProject.jobKey] || []}
          selectedScopeId={null}
          onClose={() => setSelectedGanttProject(null)}
          onScopesUpdated={(jobKey, updatedScopes) => {
            const enriched = getEnrichedScopes(updatedScopes, projects);
            setScopesByJobKey(prev => ({ ...prev, [jobKey]: enriched }));
          }}
        />
      )}

      {/* Pool Breakdown for debugging target hours */}
      {poolBreakdown.length > 0 && (
        <div style={{ marginTop: 40, padding: 20, background: "#fff", borderRadius: 12, border: "1px solid #ddd" }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ color: "#15616D", margin: 0 }}>Labor Pool Breakdown (Top 50)</h3>
            <button
              onClick={() => {
                const headers = ["Customer", "Project Name", "Job Key", "Source", "Contract Hr", "Proj PreHr", "Total Budget"];
                const rows = poolBreakdown.map(item => [
                  `"${item.customer}"`,
                  `"${item.projectName}"`,
                  `"${item.jobKey}"`,
                  `"${(item.hasSchedule ? "SCHED" : "NO-SCH") + " " + (item.hasGantt ? "GANTT" : "BASE")}"`,
                  item.p_hours.toFixed(0),
                  item.p_proj.toFixed(0),
                  item.budget.toFixed(0)
                ]);
                const csvContent = headers.join(",") + "\n" + rows.map(e => e.join(",")).join("\n");
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.setAttribute("href", url);
                link.setAttribute("download", `wip_labor_pool_${new Date().toISOString().split('T')[0]}.csv`);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
              style={{
                padding: '6px 12px',
                borderRadius: 4,
                border: 'none',
                backgroundColor: '#10b981',
                color: '#fff',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download Pool CSV
            </button>
          </div>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
            This list shows the projects contributing to the {totalPoolHours.toFixed(0)} hour pool.
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #eee", textAlign: "left" }}>
                <th style={{ padding: 8 }}>Customer / Project</th>
                <th style={{ padding: 8, textAlign: "center" }}>Source</th>
                <th style={{ padding: 8, textAlign: "right" }}>Contract Hr</th>
                <th style={{ padding: 8, textAlign: "right" }}>Proj PreHr</th>
                <th style={{ padding: 8, textAlign: "right" }}>Total Budget</th>
              </tr>
            </thead>
            <tbody>
              {poolBreakdown.slice(0, 50).map((item, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f9f9f9" }}>
                  <td style={{ padding: 8 }}>
                    <div style={{ fontWeight: 600 }}>{item.customer}</div>
                    <div style={{ fontSize: 11, color: "#666" }}>{item.projectName}</div>
                  </td>
                  <td style={{ padding: 8, textAlign: "center" }}>
                    <span style={{ fontSize: 10, padding: "2px 4px", borderRadius: 4, background: item.hasSchedule ? "#dcfce7" : "#fee2e2", color: item.hasSchedule ? "#166534" : "#991b1b", marginRight: 4 }}>
                      {item.hasSchedule ? "SCHED" : "NO-SCH"}
                    </span>
                    <span style={{ fontSize: 10, padding: "2px 4px", borderRadius: 4, background: item.hasGantt ? "#dbeafe" : "#f1f5f9", color: item.hasGantt ? "#1e40af" : "#64748b" }}>
                      {item.hasGantt ? "GANTT" : "BASE"}
                    </span>
                  </td>
                  <td style={{ padding: 8, textAlign: "right" }}>{item.p_hours.toFixed(0)}</td>
                  <td style={{ padding: 8, textAlign: "right", color: "#666" }}>{item.p_proj.toFixed(0)}</td>
                  <td style={{ padding: 8, textAlign: "right", fontWeight: 700 }}>{item.budget.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function HoursLineChart({ months, monthlyData, projects, yearFilter }: { months: string[]; monthlyData: Record<string, any>; projects: any[]; yearFilter: string }) {
  const sortedMonths = months.sort();
  const hours = sortedMonths.map(month => monthlyData[month]?.hours || 0);
  const labels = sortedMonths.map(month => {
    return formatMonthLabelShort(month) || "";
  });

  // Determine current month (today's month/year)
  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentMonthIndex = sortedMonths.indexOf(currentYearMonth);
  
  // Calculate Leadtime - Box pattern with all hours:
  // Calculate total of ALL scheduled hours (all months)
  // Past months: frozen at their end-of-month value (visual reference)
  // Current month and beyond: dynamic (includes all future work)
  const totalAllHours = sortedMonths.reduce((sum, month) => {
    return sum + (monthlyData[month]?.hours || 0);
  }, 0);
  
  const leadtimeData: (number | null)[] = [];
  
  sortedMonths.forEach((month, index) => {
    if (index < currentMonthIndex) {
      // Past months: locked at their final cumulative value through that month
      // Special case: Jan 2026 is hard-coded as 6.2
      if (month === "2026-01") {
        leadtimeData.push(6.2);
      } else {
        const cumulativeThrough = sortedMonths.slice(0, index + 1).reduce((sum, m) => {
          return sum + (monthlyData[m]?.hours || 0);
        }, 0);
        leadtimeData.push(cumulativeThrough / 3938);
      }
    } else {
      // Current month and future: dynamic using all hours total
      leadtimeData.push(totalAllHours / 3938);
    }
  });

  // Calculate forecast for next 3 months using linear regression
  const numForecastMonths = 3;
  const forecastData: (number | null)[] = [];
  const actualData: (number | null)[] = [];
  
  // Calculate linear regression from last 6 months (or all available data)
  const trendPeriod = Math.min(6, hours.length);
  const recentHours = hours.slice(-trendPeriod);
  
  if (recentHours.length >= 2) {
    // Linear regression: y = mx + b
    const n = recentHours.length;
    const xValues = Array.from({ length: n }, (_, i) => i); // 0, 1, 2, 3...
    const yValues = recentHours;
    
    // Calculate slope (m) and intercept (b)
    const sumX = xValues.reduce((sum, x) => sum + x, 0);
    const sumY = yValues.reduce((sum, y) => sum + y, 0);
    const sumXY = xValues.reduce((sum, x, i) => sum + x * yValues[i], 0);
    const sumX2 = xValues.reduce((sum, x) => sum + x * x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    const lastValue = hours[hours.length - 1];
    
    // Create actual data (fill with nulls, then add last actual value as connection point)
    actualData.push(...Array(hours.length).fill(null));
    
    // Create forecast data (start from last actual value)
    forecastData.push(...Array(hours.length - 1).fill(null));
    forecastData.push(lastValue); // Connection point
    
    // Generate forecast months using the regression line
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
      // Project using the regression line
      const forecastValue = slope * (n + i) + intercept;
      forecastData.push(Math.max(0, forecastValue));
      
      const date = new Date(forecastYear, forecastMonth - 1, 1);
      forecastLabels.push(isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", year: "2-digit" }));
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
        borderColor: "#15616D",
        backgroundColor: "rgba(21, 97, 109, 0.25)",
        tension: 0.4,
        fill: true,
        pointBackgroundColor: "#15616D",
        pointBorderColor: "#fff",
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2.5,
        yAxisID: 'y',
        datalabels: {
          display: true,
          color: "#15616D",
          font: { weight: "bold", size: 11 },
          formatter: (value: any) => {
            if (value === null) return "";
            return Math.round(value).toLocaleString();
          },
          offset: 8,
          anchor: "end",
          align: "top",
        },
      },
      {
        label: "Forecast",
        data: forecastData,
        borderColor: "#E06C00",
        backgroundColor: "rgba(224, 108, 0, 0.25)",
        borderDash: [8, 4],
        borderWidth: 2.5,
        tension: 0.4,
        fill: true,
        pointBackgroundColor: "#E06C00",
        pointBorderColor: "#fff",
        pointBorderWidth: 2,
        pointRadius: 4,
        yAxisID: 'y',
        datalabels: {
          display: false,
        },
      },
      {
        label: "Target (4,800 hours)",
        data: Array(labels.length).fill(4800),
        borderColor: "#ef4444",
        borderDash: [5, 5],
        borderWidth: 2,
        fill: false,
        pointRadius: 0,
        pointHoverRadius: 0,
        yAxisID: 'y',
      },
      {
        label: "Leadtime (M) - Box View",
        data: leadtimeData.concat(Array(numForecastMonths).fill(null)),
        borderColor: "#33CC33",
        backgroundColor: "rgba(34, 197, 94, 0.1)",
        tension: 0,
        stepped: 'middle' as const,
        fill: true,
        pointBackgroundColor: "#33CC33",
        pointBorderColor: "#fff",
        pointBorderWidth: 1.5,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2,
        yAxisID: 'y2',
        datalabels: {
          display: true,
          color: "#33CC33",
          font: { weight: "bold", size: 11 },
          formatter: (value: any) => {
            if (value === null) return "";
            return Math.round(value).toLocaleString();
          },
          offset: 8,
          anchor: "end",
          align: "bottom",
        },
      },
    ],
  };

  const maxLeadtime = Math.max(...leadtimeData.filter((v): v is number => v !== null), 1);
  
  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top" as const,
        labels: {
          color: "#111827",
          boxWidth: 12,
          padding: 15,
          font: { size: 12 },
        },
      },
      tooltip: {
        backgroundColor: "rgba(0, 0, 0, 0.9)",
        titleColor: "#fff",
        bodyColor: "#e5e7eb",
        borderColor: "#3a3d42",
        borderWidth: 1,
        padding: 12,
        titleFont: { size: 13, weight: "bold" },
        bodyFont: { size: 12 },
        callbacks: {
          label: function(context) {
            let label = context.dataset.label || '';
            if (label) {
              label += ': ';
            }
            if (context.parsed.y !== null) {
              if (context.dataset.yAxisID === 'y2') {
                label += context.parsed.y.toFixed(1) + ' months';
              } else {
                label += context.parsed.y.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' hours';
              }
            }
            return label;
          }
        }
      },
    },
    scales: {
      y: {
        type: 'linear' as const,
        position: 'left' as const,
        beginAtZero: true,
        max: maxHours * 1.1,
        ticks: {
          color: "#9ca3af",
          callback: function(value) {
            return (value as number).toLocaleString();
          },
        },
        grid: {
          color: "#e5e7eb",
        },
      },
      y2: {
        type: 'linear' as const,
        position: 'right' as const,
        beginAtZero: true,
        max: maxLeadtime * 1.35,
        ticks: {
          color: "#22c55e",
          callback: function(value) {
            return (value as number).toFixed(1);
          },
        },
        grid: {
          drawOnChartArea: false,
        },
      },
      x: {
        ticks: {
          color: "#9ca3af",
          maxRotation: 45,
          minRotation: 0,
        },
        grid: {
          color: "#e5e7eb",
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
    return formatMonthLabelShort(month) || "";
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
        borderColor: "#E06C00",
        backgroundColor: "rgba(0, 102, 204, 0.1)",
        tension: 0.3,
        fill: true,
        pointBackgroundColor: "#E06C00",
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
          color: "#E06C00",
          callback: function(value) {
            return `$${Math.round(value as number).toLocaleString()}`;
          },
        },
        title: {
          display: true,
          text: "Bid Submitted Sales",
          color: "#E06C00",
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

