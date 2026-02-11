"use client";
import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { db } from "@/firebase";
import { collection, getDocs, doc, setDoc, query, where } from "firebase/firestore";
import ProtectedPage from "@/components/ProtectedPage";
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
  return (
    <ProtectedPage page="wip">
      <WIPReportContent />
    </ProtectedPage>
  );
}

function WIPReportContent() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const qualifyingStatuses = ["In Progress", "Accepted"];
  const priorityStatuses = ["Accepted", "In Progress", "Complete"];

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
        // Fetch projects directly from Firestore
        const projectsSnapshot = await getDocs(query(
          collection(db, "projects"),
          where("status", "not-in", ["Bid Submitted", "Lost"])
        ));
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
            const projectKey = `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`;
            return projectKey === jobKey;
          }) as any;
          
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

        // Fetch scopes for Gantt feed
        const scopesSnapshot = await getDocs(collection(db, "projectScopes"));
        const rawScopes = scopesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Scope));
        const enrichedScopes = getEnrichedScopes(rawScopes, projectsData);
        
        const scopesMap: Record<string, Scope[]> = {};
        enrichedScopes.forEach((scope) => {
          if (scope.jobKey) {
            if (!scopesMap[scope.jobKey]) scopesMap[scope.jobKey] = [];
            scopesMap[scope.jobKey].push(scope);
          }
        });
        setScopesByJobKey(scopesMap);
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
    
    // Load existing weekly schedule from Firestore
    try {
      const longTermSnapshot = await getDocs(collection(db, "long term schedual"));
      const existingDoc = longTermSnapshot.docs.find(
        (doc) => doc.data().jobKey === selectedJob.jobKey && doc.data().month === month
      );
      
      if (existingDoc) {
        const data = existingDoc.data();
        const weeks: Record<number, number> = {};
        (data.weeks || []).forEach((w: any) => {
          weeks[w.weekNumber] = w.hours || 0;
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
      console.error("Failed to load weekly schedule:", error);
      alert("Failed to load weekly schedule");
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

      // Save to long term schedual collection
      const docId = `${selectedJob.jobKey}_${selectedMonth}`.replace(/[^a-zA-Z0-9_-]/g, "_");
      await setDoc(doc(db, "long term schedual", docId), {
        jobKey: selectedJob.jobKey,
        customer: selectedJob.customer,
        projectNumber: selectedJob.projectNumber,
        projectName: selectedJob.projectName,
        month: selectedMonth,
        weeks,
        totalHours: weeks.reduce((sum, w) => sum + w.hours, 0),
        updatedAt: new Date().toISOString(),
      });

      alert("Weekly schedule saved successfully!");
      setWeeklyModalVisible(false);
      setSelectedMonth(null);
    } catch (error) {
      console.error("Failed to save weekly schedule:", error);
      alert("Failed to save weekly schedule");
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
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save");
      }

      alert("Schedule saved successfully!");
      setModalVisible(false);
      // Refresh data
      window.location.reload();
    } catch (error) {
      console.error("Failed to save schedule:", error);
      alert("Failed to save schedule");
    } finally {
      setSaving(false);
    }
  }

  const { monthlyData, scheduledSalesByMonth, inProgressScheduledHoursForGantt, filteredInProgressHoursFromGantt, projectsWithGanttData } = React.useMemo(() => {
    const monthlyData: Record<string, MonthlyWIP> = {};
    const scheduledSalesByMonth: Record<string, number> = {};
    let inProgressScheduledHoursForGantt = 0;
    let filteredInProgressHoursFromGantt = 0;

    const projectsWithGanttData = new Set<string>();

    // Step 0: Identify qualifying projects/jobs using global production filters and deduplication
    const activeProjects = projects.filter((p) => {
      if ((p as any).projectArchived) return false;
      const customer = (p.customer ?? "").toString().toLowerCase();
      if (customer.includes("sop inc")) return false;
      const projectName = (p.projectName ?? "").toString().toLowerCase();
      if (projectName === "pmc operations") return false;
      if (projectName === "pmc shop time") return false;
      if (projectName === "pmc test project") return false;
      if (projectName.includes("sandbox")) return false;
      if (projectName.includes("raymond king")) return false;
      if (projectName === "alexander drive addition latest") return false;
      const estimator = ((p as any).estimator ?? "").toString().trim();
      if (!estimator) return false;
      if (estimator.toLowerCase() === "todd gilmore") return false;
      const projectNumber = (p.projectNumber ?? "").toString().toLowerCase();
      if (projectNumber === "701 poplar church rd") return false;
      return true;
    });

    // Deduplicate by project identifier (matches scheduling/page.tsx logic)
    const projectIdentifierMap = new Map<string, any[]>();
    activeProjects.forEach((project) => {
      const identifier = (project.projectNumber ?? project.projectName ?? "").toString().trim();
      if (!identifier) return;
      if (!projectIdentifierMap.has(identifier)) projectIdentifierMap.set(identifier, []);
      projectIdentifierMap.get(identifier)!.push(project);
    });

    const dedupedByCustomer: any[] = [];
    projectIdentifierMap.forEach((projectList) => {
      const customerMap = new Map<string, any[]>();
      projectList.forEach(p => {
        const customer = (p.customer ?? "").toString().trim();
        if (!customerMap.has(customer)) customerMap.set(customer, []);
        customerMap.get(customer)!.push(p);
      });
      
      if (customerMap.size > 1) {
        let selectedCustomer = "";
        let foundPriorityCustomer = false;
        customerMap.forEach((projs, customer) => {
          if (projs.some(p => priorityStatuses.includes(p.status || "")) && !foundPriorityCustomer) {
            selectedCustomer = customer;
            foundPriorityCustomer = true;
          }
        });
        if (!foundPriorityCustomer) {
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
              selectedCustomer = customer;
            }
          });
        }
        dedupedByCustomer.push(...(customerMap.get(selectedCustomer) || []));
      } else {
        projectList.forEach(p => dedupedByCustomer.push(p));
      }
    });

    const qualifyingJobKeys = new Set(dedupedByCustomer.map(p => 
      p.jobKey || `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`
    ));

    const internalDistributeValue = (totalValue: number, startDate: string, endDate: string) => {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return {};
      const totalDays = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24) + 1);
      const dailyRate = totalValue / totalDays;
      const distribution: Record<string, number> = {};
      let current = new Date(start.getFullYear(), start.getMonth(), 1);
      const last = new Date(end.getFullYear(), end.getMonth(), 1);
      while (current <= last) {
        const monthKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
        const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
        const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
        const overlapStart = start > monthStart ? start : monthStart;
        const overlapEnd = end < monthEnd ? end : monthEnd;
        const overlapDays = Math.max(0, (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24) + 1);
        if (overlapDays > 0) distribution[monthKey] = dailyRate * overlapDays;
        current.setMonth(current.getMonth() + 1);
      }
      return distribution;
    };

    Object.entries(scopesByJobKey).forEach(([jobKey, scopes]) => {
      // Skip if this project is excluded by global filters
      if (!qualifyingJobKeys.has(jobKey)) return;

      const validScopes = scopes.filter(s => s.startDate && s.endDate);
      if (validScopes.length > 0) {
        projectsWithGanttData.add(jobKey);
        const jobProjects = (projects as any[]).filter(p => ((p.jobKey || `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`) === jobKey));
        if (jobProjects.length === 0) return;
        const projectCostItems = jobProjects.map(p => ({
          costitems: (p.costitems || "").toLowerCase(),
          hours: typeof p.hours === "number" ? p.hours : 0,
          costType: typeof p.costType === "string" ? p.costType : "",
        }));
        const totalProjectSales = jobProjects.reduce((sum, p) => sum + (Number(p.sales) || 0), 0);
        const totalProjectHours = jobProjects.reduce((sum, p) => sum + (Number(p.hours) || 0), 0);
        const isQualifying = jobProjects.some(p => ["In Progress", "Accepted"].includes(p.status || ""));

        validScopes.forEach(scope => {
          const titleWithoutQty = (scope.title || "Scope").trim().toLowerCase().replace(/^[\d,]+\s*(sq\s*ft\.?|ln\s*ft\.?|each|lf)?\s*([-–]\s*)?/i, "").trim();
          const matchedItems = projectCostItems.filter((item) => item.costitems.includes(titleWithoutQty) || titleWithoutQty.includes(item.costitems));
          const scopeHours = matchedItems.reduce((acc, item) => !item.costType.toLowerCase().includes("management") ? acc + item.hours : acc, 0) || (typeof scope.hours === "number" ? scope.hours : 0);
          if (scopeHours <= 0) return;
          const hourDist = internalDistributeValue(scopeHours, scope.startDate!, scope.endDate!);
          Object.entries(hourDist).forEach(([monthKey, hours]) => {
            if (!monthlyData[monthKey]) monthlyData[monthKey] = { month: monthKey, hours: 0, jobs: [] };
            monthlyData[monthKey].hours += hours;
            if (isQualifying) {
              inProgressScheduledHoursForGantt += hours;
              if (!yearFilter || monthKey.startsWith(yearFilter)) filteredInProgressHoursFromGantt += hours;
            }
            const existingJob = monthlyData[monthKey].jobs.find(j => j.projectName === jobProjects[0].projectName && j.customer === jobProjects[0].customer);
            if (existingJob) existingJob.hours += hours;
            else monthlyData[monthKey].jobs.push({ customer: jobProjects[0].customer || "Unknown", projectNumber: jobProjects[0].projectNumber || "N/A", projectName: jobProjects[0].projectName || "Unnamed", hours: hours });
          });
          if (totalProjectSales > 0 && totalProjectHours > 0) {
            const scopeSales = (scopeHours / totalProjectHours) * totalProjectSales;
            const salesDist = internalDistributeValue(scopeSales, scope.startDate!, scope.endDate!);
            Object.entries(salesDist).forEach(([monthKey, sales]) => {
              scheduledSalesByMonth[monthKey] = (scheduledSalesByMonth[monthKey] || 0) + sales;
            });
          }
        });
      }
    });

    schedules.forEach((schedule) => {
      if (schedule.status === 'Complete' || projectsWithGanttData.has(schedule.jobKey || "")) return;
      
      // Skip if this project is excluded by global filters
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

    return { monthlyData, scheduledSalesByMonth, inProgressScheduledHoursForGantt, filteredInProgressHoursFromGantt, projectsWithGanttData };
  }, [scopesByJobKey, projects, schedules, yearFilter]);






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
  
  // Calculate totals from filtered data
  const filteredTotalHours = Object.values(filteredMonthlyData).reduce((sum, m) => sum + m.hours, 0);
  const filteredAvgHours = filteredMonths.length > 0 ? filteredTotalHours / filteredMonths.length : 0;
  
  // Calculate filtered hours for In Progress jobs only (using allocations for the filtered months)
  const filteredInProgressHours = filteredInProgressHoursFromGantt + schedules
    .filter(s => qualifyingStatuses.includes(s.status || "") && !projectsWithGanttData.has(s.jobKey || ""))
    .reduce((sum, schedule) => {
      // For filtered months, sum the allocated hours
      const normalizedAllocs = normalizeAllocations(schedule.allocations);
      const scheduledHours = normalizedAllocs
        .filter(alloc => filteredMonths.includes(alloc.month))
        .reduce((scheduleSum, alloc) => {
          return scheduleSum + (schedule.totalHours * (alloc.percent / 100));
        }, 0);
      return sum + scheduledHours;
    }, 0);
  
  // Calculate ALL scheduled hours for In Progress jobs (not filtered by year/month)
  // This is used to properly calculate unscheduled hours
  const allInProgressScheduledHours = inProgressScheduledHoursForGantt + schedules
    .filter(s => qualifyingStatuses.includes(s.status || "") && !projectsWithGanttData.has(s.jobKey || ""))
    .reduce((sum, schedule) => {
      // Sum all allocated hours across all months for this schedule
      const normalizedAllocs = normalizeAllocations(schedule.allocations);
      const scheduledHours = normalizedAllocs.reduce((scheduleSum, alloc) => {
        return scheduleSum + (schedule.totalHours * (alloc.percent / 100));
      }, 0);
      return sum + scheduledHours;
    }, 0);

  // Calculate unscheduled hours from ALL qualifying projects with filters
  
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
    const key = `${p.customer ?? ""}~${p.projectNumber ?? ""}~${p.projectName ?? ""}`;
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
  
  // Calculate filtered total qualifying hours (applying customer/project/year filters)
  let filteredTotalQualifyingHours = 0;
  qualifyingProjectsMap.forEach((project, key) => {
    // Apply customer filter
    if (customerFilter && project.customer !== customerFilter) return;
    // Apply project filter
    if (projectFilter && project.projectName !== projectFilter) return;
    
    // If year filter is set, subtract hours scheduled in other years
    let budget = project.totalHours;
    if (yearFilter) {
      const schedule = schedules.find(s => s.jobKey === key);
      if (schedule) {
        let otherYearHours = 0;
        normalizeAllocations(schedule.allocations).forEach(alloc => {
          if (!alloc.month.startsWith(yearFilter)) {
            otherYearHours += (schedule.totalHours * (alloc.percent / 100));
          }
        });
        budget = Math.max(0, budget - otherYearHours);
      }
    }
    
    filteredTotalQualifyingHours += budget;
  });

  const qualifyingKeyHours = new Map<string, number>();
  qualifyingProjectsMap.forEach((project, key) => {
    if (customerFilter && project.customer !== customerFilter) return;
    if (projectFilter && project.projectName !== projectFilter) return;
    
    let budget = project.totalHours;
    if (yearFilter) {
      const schedule = schedules.find(s => s.jobKey === key);
      if (schedule) {
        let otherYearHours = 0;
        normalizeAllocations(schedule.allocations).forEach(alloc => {
          if (!alloc.month.startsWith(yearFilter)) {
            otherYearHours += (schedule.totalHours * (alloc.percent / 100));
          }
        });
        budget = Math.max(0, budget - otherYearHours);
      }
    }
    qualifyingKeyHours.set(key, budget);
  });
  
  // Calculate total scheduled hours from schedules (respecting year filter and excluding Complete)
  let totalScheduledHours = 0;
  schedules.forEach(schedule => {
    if (schedule.status === 'Complete') return;
    
    const projectHours = schedule.totalHours || 0;
    const scheduledHours = normalizeAllocations(schedule.allocations).reduce((sum: number, alloc: any) => {
      // Apply year filter if set
      if (yearFilter && !alloc.month.startsWith(yearFilter)) return sum;
      return sum + (projectHours * (alloc.percent / 100));
    }, 0);
    totalScheduledHours += scheduledHours;
  });

  // Calculate scheduled hours specifically for In Progress jobs used in unscheduled calculation
  const scheduledHoursForQualifying = (yearFilter ? filteredInProgressHoursFromGantt : inProgressScheduledHoursForGantt) + schedules.reduce((sum, schedule) => {
    if (!qualifyingStatuses.includes(schedule.status)) return sum;
    const key = schedule.jobKey || `${schedule.customer ?? ""}~${schedule.projectNumber ?? ""}~${schedule.projectName ?? ""}`;
    if (projectsWithGanttData.has(key)) return sum;
    const projectHours = schedule.totalHours || qualifyingKeyHours.get(key) || 0;
    if (!qualifyingKeyHours.has(key) || projectHours <= 0) return sum;

    const scheduledHours = normalizeAllocations(schedule.allocations).reduce((scheduleSum, alloc) => {
      if (!isValidMonthKey(alloc.month)) return scheduleSum;
      // Apply year filter if set
      if (yearFilter && !alloc.month.startsWith(yearFilter)) return scheduleSum;
      return scheduleSum + (projectHours * (alloc.percent / 100));
    }, 0);

    return sum + scheduledHours;
  }, 0);

  const unscheduledHours = Math.max(0, filteredTotalQualifyingHours - scheduledHoursForQualifying);

  const projectKeyForSchedule = (customer?: string, projectNumber?: string, projectName?: string) => {
    return `${customer ?? ""}~${projectNumber ?? ""}~${projectName ?? ""}`;
  };

  const bidSubmittedSalesByMonth: Record<string, number> = {};
  dedupedByCustomer.forEach((project) => {
    if ((project.status || "") !== "Bid Submitted") return;
    // Try dateCreated first, then dateUpdated as fallback
    const projectDate = parseDateValue(project.dateCreated) || parseDateValue(project.dateUpdated);
    if (!projectDate) return;
    const monthKey = `${projectDate.getFullYear()}-${String(projectDate.getMonth() + 1).padStart(2, "0")}`;
    const sales = Number(project.sales ?? 0);
    if (!Number.isFinite(sales) || sales === 0) return;
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
  
  // For each schedule, distribute sales across months based on allocation percentages
  schedules.forEach((schedule) => {
    // Skip Complete status jobs
    if (schedule.status === 'Complete') return;
    
    const key = schedule.jobKey || projectKeyForSchedule(schedule.customer, schedule.projectNumber, schedule.projectName);
    
    // Skip if we already used Gantt data for this project
    if (projectsWithGanttData.has(key)) return;

    const projectSales = scheduleSalesMap.get(key);
    
    if (!projectSales) {
      return;
    }

    normalizeAllocations(schedule.allocations).forEach((alloc) => {
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
        <h1 style={{ color: "#15616D", fontSize: 32, margin: 0 }}>WIP Report</h1>
        <Navigation currentPage="wip" />
      </div>

      {/* Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 12 }}>
        <SummaryCard label="Total Scheduled Hours" value={filteredTotalHours.toFixed(1)} />
        <SummaryCard label="Average Monthly Hours" value={filteredAvgHours.toFixed(1)} />
        <SummaryCard label="Months Scheduled" value={filteredMonths.length} />
        <SummaryCard label="Scheduled Jobs" value={schedules.length} />
      </div>

      {/* Unscheduled Hours Container */}
      <div style={{ background: "#ef4444", borderRadius: 12, padding: 24, border: "1px solid #dc2626", marginBottom: 12 }}>
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
              of {filteredTotalQualifyingHours.toFixed(1)} total hours
            </div>
          </div>
        </div>
        {unscheduledHours > 0 && (
          <div style={{ marginTop: 12, fontSize: 12, color: "rgba(255,255,255,0.8)" }}>
            {((unscheduledHours / filteredTotalQualifyingHours) * 100).toFixed(0)}% remaining to schedule
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

