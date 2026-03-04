"use client";
import React, { useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";

type Project = {
  id: string;
  customer?: string;
  projectName?: string;
  projectNumber?: string;
  hours?: number;
  status?: string;
  pmcgroup?: boolean;
  projectManager?: string;
  projectArchived?: boolean;
  estimator?: string;
  dateCreated?: string | Date;
  jobKey?: string;
  costitems?: string;
  costType?: string;
};

type JobSchedule = {
  jobKey: string;
  customer: string;
  projectName: string;
  status: string;
  totalHours: number;
  allocations: Record<string, number>;
};

type ApiProject = Project;

type ApiSchedule = {
  jobKey: string;
  customer: string;
  projectName: string;
  status?: string;
  totalHours: number;
  allocations: Record<string, number> | Array<{ month: string; percent: number }>;
};

type ApiScope = {
  jobKey: string;
  title: string;
  startDate?: string;
  endDate?: string;
  hours?: number;
  description?: string;
  tasks?: string[];
};

function formatMonthLabel(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return "";
  const [year, m] = month.split("-");
  const date = new Date(Number(year), Number(m) - 1, 1);
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function isValidMonthKey(month: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

function normalizeMonths(list: string[]) {
  return Array.from(
    new Set(
      list.filter((month) => {
        if (!isValidMonthKey(month)) return false;
        const [year] = month.split("-");
        return Number(year) >= 2025;
      })
    )
  ).sort();
}

function parseDateValue(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !isNaN(date.getTime()) ? date : null;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function getNextMonths(count: number) {
  const months: string[] = [];
  // Generate all months for 2025 and beyond
  const now = new Date();
  const currentYear = now.getFullYear();
  const startYear = Math.max(2025, currentYear);
  
  // Generate all 12 months of the start year
  for (let m = 1; m <= 12; m++) {
    months.push(`${startYear}-${String(m).padStart(2, "0")}`);
  }
  
  // Add additional months for next year if count > 12
  if (count > 12) {
    const additionalMonths = count - 12;
    for (let i = 0; i < additionalMonths; i++) {
      const m = (i % 12) + 1;
      const year = startYear + 1 + Math.floor(i / 12);
      const monthStr = `${year}-${String(m).padStart(2, "0")}`;
      if (!months.includes(monthStr)) {
        months.push(monthStr);
      }
    }
  }
  
  return months;
}

export default function SchedulingPage() {
  return <SchedulingContent />;
}

function SchedulingContent() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [schedules, setSchedules] = useState<JobSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("schedulingMonths");
      let months = getNextMonths(12);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // Filter out any months before 2025
          const filtered = normalizeMonths(parsed);
          
          // Ensure we have all 12 months of 2025 at minimum
          const baseMonths = getNextMonths(12);
          const allMonths = normalizeMonths([...baseMonths, ...filtered]);
          
          months = allMonths;
        } catch {
          months = getNextMonths(12);
        }
      }
      return normalizeMonths(months);
    }
    return getNextMonths(12);
  });
  const [saving, setSaving] = useState(false);
  const [customerFilter, setCustomerFilter] = useState<string>("");
  const [jobFilter, setJobFilter] = useState<string>("");
  const [yearFilter, setYearFilter] = useState<string>("");
  const [sortColumn, setSortColumn] = useState<string>("customer");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [savingJobKey, setSavingJobKey] = useState<string>("");
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [scopesByJobKey, setScopesByJobKey] = useState<Record<string, ApiScope[]>>({});

  const internalDistributeValue = (totalValue: number, startDate: string, endDate: string) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return {};
    const totalDays = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24) + 1);
    const dailyRate = totalValue / totalDays;
    const distribution: Record<string, number> = {};
    const current = new Date(start.getFullYear(), start.getMonth(), 1);
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

  const validMonths = useMemo(() => normalizeMonths(months), [months]);

  // Filter months by year if year filter is active
  const displayMonths = useMemo(() => {
    if (!yearFilter) return validMonths;
    return validMonths.filter(month => month.startsWith(yearFilter));
  }, [validMonths, yearFilter]);

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch projects from API
        const projectsRes = await fetch("/api/projects");
        if (!projectsRes.ok) {
          console.warn("Failed to fetch projects from API");
          setProjects([]);
        } else {
          const projectsJson = await projectsRes.json();
          const projectsData = (projectsJson.data || []).map((p: any) => ({
            id: p.id,
            ...(p as Omit<Project, "id">),
          }));
          setProjects(projectsData);
        }

        let schedulesArray: JobSchedule[] = [];
        try {
          const schedulesRes = await fetch("/api/scheduling");
          if (!schedulesRes.ok) throw new Error("Not found");
          const schedulesJson = await schedulesRes.json();
          schedulesArray = (schedulesJson.data || []).map((s: ApiSchedule) => {
          // Handle both object and array formats for allocations
          let allocations: Record<string, number> = {};
          if (s.allocations) {
            if (Array.isArray(s.allocations)) {
              // Array format: convert to object
              allocations = s.allocations.reduce((acc: Record<string, number>, alloc: { month: string; percent: number }) => {
                acc[alloc.month] = alloc.percent;
                return acc;
              }, {});
            } else {
              // Already an object: use as-is
              allocations = s.allocations;
            }
          }
          
          return {
            jobKey: s.jobKey,
            customer: s.customer,
            projectName: s.projectName,
            status: s.status || "Unknown",
            totalHours: s.totalHours,
            allocations,
          };
        });
        } catch (error) {
          console.warn("Failed to load schedules from API:", error);
          schedulesArray = [];
        }
        setSchedules(schedulesArray);

        // Fetch scopes from API
        try {
          const scopesRes = await fetch("/api/project-scopes");
          if (!scopesRes.ok) throw new Error("Failed to fetch scopes");
          const scopesJson = await scopesRes.json();
          const rawScopes = scopesJson.data || [];
          const scopesMap: Record<string, ApiScope[]> = {};
          rawScopes.forEach((scope: ApiScope) => {
            if (scope.jobKey) {
              if (!scopesMap[scope.jobKey]) scopesMap[scope.jobKey] = [];
              scopesMap[scope.jobKey].push(scope);
            }
          });
          setScopesByJobKey(scopesMap);
        } catch (error) {
          console.warn("Failed to load scopes from API:", error);
          setScopesByJobKey({});
        }

        // Collect all months that have scheduled hours (valid months only)
        const scheduledMonths = new Set<string>();
        schedulesArray.forEach((schedule: JobSchedule) => {
          Object.entries(schedule.allocations).forEach(([month, percent]) => {
            if (!isValidMonthKey(month) || percent <= 0) return;
            const [year] = month.split("-");
            if (Number(year) < 2025) return;
            scheduledMonths.add(month);
          });
        });

        // Merge with existing months and normalize
        const allMonths = normalizeMonths([...months, ...Array.from(scheduledMonths)]);
        if (allMonths.join("|") !== normalizeMonths(months).join("|")) {
          setMonths(allMonths);
        }
      } catch (error) {
        console.error("Failed to load data:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Save months to localStorage and optionally to database
    const normalized = normalizeMonths(months);
    if (normalized.join("|") !== months.join("|")) {
      setMonths(normalized);
      return;
    }
    localStorage.setItem("schedulingMonths", JSON.stringify(normalized));
  }, [months]);

  const uniqueJobs = useMemo(() => {
    const qualifyingStatuses = ["In Progress"];
    const priorityStatuses = ["In Progress"];
    
    // Step 1: Filter active projects with exclusions
    const activeProjects = projects.filter((p) => {
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
      // Don't filter out Todd Gilmore, otherwise user sees nothing if they are the estimator
      // const estimator = ((p as any).estimator ?? "").toString().trim().toLowerCase();
      // if (estimator.includes("todd gilmore") || estimator.includes("gilmore todd")) return false;
      const projectNumber = (p.projectNumber ?? "").toString().toLowerCase();
      if (projectNumber === "701 poplar church rd") return false;
      return true;
    });
    
    // Step 2: Group by project identifier to find duplicates with different customers
    const projectIdentifierMap = new Map<string, typeof activeProjects>();
    activeProjects.forEach((project) => {
      const identifier = (project.projectNumber || project.projectName || "").toString().trim();
      if (!identifier) return;
      if (!projectIdentifierMap.has(identifier)) {
        projectIdentifierMap.set(identifier, []);
      }
      projectIdentifierMap.get(identifier)!.push(project);
    });
    
    // Step 3: Deduplicate by customer (pick one customer per project identifier)
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
              return currentDate.getTime() > latestDateVal.getTime() ? current : latest;
            }, projs[0]);
            
            const projDate = parseDateValue(mostRecentProj.dateCreated);
            if (projDate && (!latestDate || projDate.getTime() > latestDate.getTime())) {
              latestDate = projDate;
              latestCustomer = customer;
            }
          });
          
          selectedProjects = customerMap.get(latestCustomer) || [];
        }
        
        dedupedByCustomer.push(...selectedProjects);
      } else {
        projectList.forEach(p => dedupedByCustomer.push(p));
      }
    });
    
    // Step 4: Filter by qualifying statuses and exclude PM hours
    const filteredByStatus = dedupedByCustomer.filter(p => {
      if (!qualifyingStatuses.includes(p.status || "")) return false;
      if (p.pmcgroup) return false;
      return true;
    });
    
    // Step 5: Group by key (projectNumber + customer)
    const keyMap = new Map<string, typeof filteredByStatus>();
    filteredByStatus.forEach((p) => {
      const key = `${p.customer ?? ""}~${p.projectNumber ?? ""}~${p.projectName ?? ""}`;
      if (!keyMap.has(key)) {
        keyMap.set(key, []);
      }
      keyMap.get(key)!.push(p);
    });
    
    // Step 6: Apply alphabetic tiebreaker and aggregate
    const results: Array<{ key: string; customer: string; projectName: string; status: string; totalHours: number }> = [];
    keyMap.forEach((projectGroup, key) => {
      const sorted = projectGroup.sort((a, b) => {
        const nameA = (a.projectName ?? "").toString().toLowerCase();
        const nameB = (b.projectName ?? "").toString().toLowerCase();
        return nameA.localeCompare(nameB);
      });
      
      const representative = sorted[0];
      const totalHours = projectGroup.reduce((sum, p) => sum + (p.hours ?? 0), 0);
      
      results.push({
        key,
        customer: representative.customer ?? "Unknown",
        projectName: representative.projectName ?? "Unnamed",
        status: representative.status ?? "Unknown",
        totalHours,
      });
    });
    
    return results;
  }, [projects]);

  function updatePercent(jobKey: string, month: string, percent: number) {
    const validPercent = Math.max(0, Math.min(100, isNaN(percent) ? 0 : percent));
    setSchedules((prev) => {
      const existing = prev.find((s) => s.jobKey === jobKey);
      if (existing) {
        // Update existing schedule
        return prev.map((s) =>
          s.jobKey === jobKey
            ? { ...s, allocations: { ...s.allocations, [month]: validPercent } }
            : s
        );
      } else {
        // Add new schedule if it doesn't exist yet
        const job = uniqueJobs.find((j) => j.key === jobKey);
        if (!job) return prev;
        
        const allocations: Record<string, number> = {};
        validMonths.forEach((m) => {
          allocations[m] = m === month ? validPercent : 0;
        });
        
        return [
          ...prev,
          {
            jobKey: job.key,
            customer: job.customer,
            projectName: job.projectName,
            status: job.status,
            totalHours: job.totalHours,
            allocations,
          },
        ];
      }
    });
  }

  function addMonth() {
    const last = validMonths[validMonths.length - 1] || getNextMonths(1)[0];
    const [year, m] = last.split("-");
    const next = new Date(Number(year), Number(m), 1);
    const nextMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
    setMonths((prev) => normalizeMonths([...prev, nextMonth]));
  }

  async function saveSchedule(jobKey: string) {
    setSavingJobKey(jobKey);
    try {
      // Find the job in allJobs (which includes both saved schedules and new jobs)
      const job = allJobs.find((j) => j.jobKey === jobKey);
      if (!job) {
        console.error("Job not found:", jobKey);
        return;
      }

      // Save ALL allocations (including historical months), not just visible ones
      const allocations = job.allocations;

      const projectInfo = uniqueJobs.find((j) => j.key === job.jobKey);
      const projectNumber = projectInfo?.key.split("~")[1] || "";

      const response = await fetch("/api/scheduling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobKey: job.jobKey,
          customer: job.customer,
          projectNumber: projectNumber,
          projectName: job.projectName,
          status: job.status,
          totalHours: job.totalHours,
          allocations,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save");
      }
      
      alert("Schedule saved successfully!");
    } catch (error) {
      console.error("Failed to save schedule:", error);
      alert("Failed to save schedule");
    } finally {
      setSavingJobKey("");
    }
  }

  async function saveAllSchedules() {
    setSaving(true);
    try {
      for (const schedule of schedules) {
        // Save ALL allocations (including historical months), not just visible ones
        const allocations = schedule.allocations;

        const job = uniqueJobs.find((j) => j.key === schedule.jobKey);
        if (!job) continue;

        await fetch("/api/scheduling", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobKey: schedule.jobKey,
            customer: schedule.customer,
            projectNumber: job.key.split("~")[1],
            projectName: schedule.projectName,
            status: schedule.status,
            totalHours: schedule.totalHours,
            allocations,
          }),
        });
      }
      alert("All schedules saved successfully!");
    } catch (error) {
      console.error("Failed to save schedules:", error);
      alert("Failed to save schedules");
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(jobKey: string, newStatus: string) {
    try {
      setUpdatingStatus(jobKey);
      
      // Parse the jobKey to get customer, projectNumber, and projectName
      const [customer, projectNumber] = jobKey.split("~");
      
      // Update projects via API
      const updateRes = await fetch("/api/projects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer,
          projectNumber,
          status: newStatus,
        }),
      });
      
      if (!updateRes.ok) {
        const error = await updateRes.json();
        throw new Error(error.error || "Failed to update status");
      }
      
      const updateData = await updateRes.json();
      console.log(`Updated ${updateData.data.count} project(s)`);
      
      // Refresh the projects data
      try {
        const projectsRes = await fetch("/api/projects");
        if (projectsRes.ok) {
          const projectsJson = await projectsRes.json();
          const projectsData = (projectsJson.data || []).map((p: ApiProject) => ({
            id: p.id,
            ...(p as Omit<Project, "id">),
          }));
          setProjects(projectsData);
        }
      } catch (error) {
        console.warn("Failed to refresh projects:", error);
      }
      
      // Refresh schedules data
      try {
        const schedulesRes = await fetch("/api/scheduling");
        if (schedulesRes.ok) {
          const schedulesJson = await schedulesRes.json();
          const schedulesArray = (schedulesJson.data || []).map((s: ApiSchedule) => ({
            jobKey: s.jobKey,
            customer: s.customer,
            projectName: s.projectName,
            status: s.status || "Unknown",
            totalHours: s.totalHours,
            allocations: Array.isArray(s.allocations)
              ? s.allocations.reduce((acc: Record<string, number>, alloc: { month: string; percent: number }) => {
                  acc[alloc.month] = alloc.percent;
                  return acc;
                }, {})
              : s.allocations,
          }));
          setSchedules(schedulesArray);
          console.log("Schedules refreshed, new status:", schedulesArray.find((s) => s.jobKey === jobKey)?.status);
        }
      } catch (scheduleRefreshError) {
        console.warn("Failed to refresh schedules:", scheduleRefreshError);
      }
      
      alert(`Status updated to ${newStatus} successfully!`);
    } catch (error) {
      console.error("Failed to update status:", error);
      alert("Failed to update status");
    } finally {
      setUpdatingStatus(null);
    }
  }

  const allJobs = useMemo(() => {
    const qualifyingStatuses = ["In Progress"];
    
    // Ensure all existing schedules have all months initialized
    const updatedSchedules = schedules.map((schedule) => {
      const allocations: Record<string, number> = { ...schedule.allocations };
      validMonths.forEach((month) => {
        allocations[month] = allocations[month] ?? 0;
      });
      // Get hours from uniqueJobs (projects data) if available, otherwise use schedule's totalHours
      const currentJob = uniqueJobs.find((j) => j.key === schedule.jobKey);
      const totalHours = currentJob?.totalHours || schedule.totalHours || 0;
      
      return { 
        ...schedule, 
        allocations,
        totalHours,
      };
    });

    // Filter schedules by status and smart year filtering
    const filteredSchedules = updatedSchedules.filter((schedule) => {
      if (!qualifyingStatuses.includes(schedule.status || "")) return false;
      
      // If year filter is NOT active, show all In Progress
      if (!yearFilter) return true;
      
      // If year filter IS active, show if:
      // 1. Has allocations in filtered year, OR
      // 2. Has unscheduled hours (total allocation < 100%)
      const hasYearAllocation = displayMonths.some((month) => {
        return (schedule.allocations[month] ?? 0) > 0;
      });
      
      if (hasYearAllocation) return true;
      
      // Check if fully scheduled (100% or more allocated)
      const totalPercent = Object.values(schedule.allocations).reduce((sum, percent) => sum + percent, 0);
      const isFullyScheduled = totalPercent >= 100;
      
      // Show if NOT fully scheduled (has room for more allocations)
      return !isFullyScheduled;
    });

    // Add any qualifying jobs from uniqueJobs that don't have schedules yet
    const allScheduleKeys = new Set(schedules.map((s) => s.jobKey));
    const toAdd = uniqueJobs.filter((job) => !allScheduleKeys.has(job.key)).map((job) => {
      const allocations: Record<string, number> = {};
      validMonths.forEach((month) => {
        allocations[month] = 0;
      });
      return {
        jobKey: job.key,
        customer: job.customer,
        projectName: job.projectName,
        status: job.status,
        totalHours: job.totalHours,
        allocations,
      };
    });
    return [...filteredSchedules, ...toAdd];
  }, [schedules, uniqueJobs, validMonths, displayMonths, yearFilter]);

  const uniqueCustomers = useMemo(() => {
    return Array.from(new Set(allJobs.map((j) => j.customer))).sort();
  }, [allJobs]);

  const filteredJobs = useMemo(() => {
    const filtered = allJobs.filter((job) => {
      const customerMatch = !customerFilter || job.customer === customerFilter;
      const jobMatch = !jobFilter || job.projectName.toLowerCase().includes(jobFilter.toLowerCase());
      const hasHours = job.totalHours > 0;
      
      return customerMatch && jobMatch && hasHours;
    });

    const sorted = [...filtered].sort((a, b) => {
      // Check if sorting by a month column
      if (validMonths.includes(sortColumn)) {
        const aVal = a.allocations[sortColumn] || 0;
        const bVal = b.allocations[sortColumn] || 0;
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }

      // Sort by regular columns
      const aVal = a[sortColumn as keyof JobSchedule];
      const bVal = b[sortColumn as keyof JobSchedule];

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal || "").toLowerCase();
      const bStr = String(bVal || "").toLowerCase();
      const comparison = aStr.localeCompare(bStr);
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [allJobs, customerFilter, jobFilter, sortColumn, sortDirection, validMonths]);

  // Calculate unscheduled hours (ALWAYS uses all In Progress projects, ignores year filter)
  const unscheduledHoursCalc = useMemo(() => {
    // Use ALL jobs (allJobs, not filtered), to get true qualifying hours
    const qualifyingJobKeys = new Set(allJobs.map(j => j.jobKey));
    const projectsWithGanttData = new Set<string>();
    let totalScheduledGanttHours = 0;

    // 1. Calculate hours from Gantt scopes across ALL time (not filtered by year)
    Object.entries(scopesByJobKey).forEach(([jobKey, scopes]) => {
      if (!qualifyingJobKeys.has(jobKey)) return;
      
      const validScopes = scopes.filter(s => s.startDate && s.endDate);
      if (validScopes.length > 0) {
        // Find if this job is qualifying
        const jobInfo = allJobs.find(j => j.jobKey === jobKey);
        if (!jobInfo || (jobInfo.status || "").toLowerCase().trim() !== "in progress") return;
        
        projectsWithGanttData.add(jobKey);

        // Use scope hours directly (removed broken cost item matching)
        validScopes.forEach(scope => {
          const scopeHours = typeof scope.hours === "number" ? scope.hours : 0;
          
          if (scopeHours > 0) {
            const dist = internalDistributeValue(scopeHours, scope.startDate!, scope.endDate!);
            Object.entries(dist).forEach(([month, hours]) => {
              // Use ALL months (validMonths), not just filtered year (displayMonths)
              if (validMonths.includes(month)) {
                totalScheduledGanttHours += hours;
              }
            });
          }
        });
      }
    });

    // Total qualifying hours = ALL In Progress jobs (ignores year filter)
    const totalQualifyingHours = allJobs.reduce((sum, job) => {
      if (job.status === 'Complete') return sum;
      return sum + (job.totalHours || 0);
    }, 0);
    
    // 2. Calculate scheduled hours for jobs WITHOUT Gantt data (across ALL time)
    const totalManualScheduledHours = allJobs
      .filter(job => {
        if (job.status === 'Complete') return false;
        if (projectsWithGanttData.has(job.jobKey || "")) return false;
        return true;
      })
      .reduce((sum, job) => {
        // Count hours across ALL months (validMonths), not just filtered year
        const totalPercent = validMonths.reduce((jobSum, month) => {
          const percent = job.allocations[month] ?? 0;
          return jobSum + percent;
        }, 0);
        const jobScheduledHours = (job.totalHours || 0) * (totalPercent / 100);
        return sum + jobScheduledHours;
      }, 0);
    
    const totalScheduled = (totalScheduledGanttHours || 0) + (totalManualScheduledHours || 0);

    return {
      totalQualifying: totalQualifyingHours || 0,
      totalScheduled: totalScheduled || 0,
      unscheduled: Math.max(0, (totalQualifyingHours || 0) - (totalScheduled || 0)),
    };
  }, [allJobs, validMonths, scopesByJobKey]);

  // Pre-calculate Gantt hours per job/month for the table cells
  const jobGanttHoursMap = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    
    Object.entries(scopesByJobKey).forEach(([jobKey, scopes]) => {
      const validScopes = scopes.filter(s => s.startDate && s.endDate);
      if (validScopes.length === 0) return;

      map[jobKey] = {};
      validScopes.forEach(scope => {
        // Use scope hours directly (removed broken cost item matching)
        const scopeHours = typeof scope.hours === "number" ? scope.hours : 0;
        
        if (scopeHours > 0) {
          const dist = internalDistributeValue(scopeHours, scope.startDate!, scope.endDate!);
          Object.entries(dist).forEach(([month, hours]) => {
            map[jobKey][month] = (map[jobKey][month] || 0) + hours;
          });
        }
      });
    });
    
    return map;
  }, [scopesByJobKey]);

  function handleSort(column: string) {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  if (loading) {
    return (
      <main className="p-8" style={{ background: "#1a1d23", minHeight: "100vh", color: "#e5e7eb" }}>
        <div>Loading...</div>
      </main>
    );
  }

  return (
    <main className="p-8" style={{ fontFamily: "sans-serif", background: "#f5f5f5", minHeight: "100vh", color: "#222" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ color: "#15616D", fontSize: 32, margin: 0 }}>Scheduling</h1>
        <Navigation currentPage="scheduling" />
      </div>

      <div style={{ background: "#ffffff", borderRadius: 12, padding: 16, border: "1px solid #ddd", marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ color: "#fff", fontSize: 20, margin: 0 }}>Scheduled Hours by Month</h2>
          <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#666", fontSize: 12, marginBottom: 4 }}>Total Qualifying Hours</div>
              <div style={{ color: "#E06C00", fontSize: 20, fontWeight: 700 }}>{Math.round(unscheduledHoursCalc.totalQualifying || 0)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#666", fontSize: 12, marginBottom: 4 }}>Total Scheduled</div>
              <div style={{ color: "#15616D", fontSize: 20, fontWeight: 700 }}>{Math.round(unscheduledHoursCalc.totalScheduled || 0)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#666", fontSize: 12, marginBottom: 4 }}>Unscheduled Hours</div>
              <div style={{ color: unscheduledHoursCalc.unscheduled > 0 ? "#ef4444" : "#E06C00", fontSize: 20, fontWeight: 700 }}>
                {Math.round(unscheduledHoursCalc.unscheduled || 0)}
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
          {displayMonths.map((month) => {
            const projectsWithGanttData = new Set<string>();
            let monthTotalGanttHours = 0;

            // Step 1: Calculate Gantt hours for this month (filtered jobs only)
            Object.entries(scopesByJobKey).forEach(([jobKey, scopes]) => {
              const validScopes = scopes.filter(s => s.startDate && s.endDate);
              if (validScopes.length > 0) {
                projectsWithGanttData.add(jobKey);
                
                // Only include if the job is In Progress and in filtered jobs
                const jobInfo = filteredJobs.find(j => j.jobKey === jobKey);
                if (!jobInfo || (jobInfo.status || "").toLowerCase().trim() !== "in progress") return;

                // Use scope hours directly (removed broken cost item matching)
                validScopes.forEach(scope => {
                  const scopeHours = typeof scope.hours === "number" ? scope.hours : 0;
                  
                  if (scopeHours > 0) {
                    const dist = internalDistributeValue(scopeHours, scope.startDate!, scope.endDate!);
                    if (dist[month]) {
                      monthTotalGanttHours += dist[month];
                    }
                  }
                });
              }
            });

            // Step 2: Calculate manual schedule hours for jobs WITHOUT Gantt data (filtered jobs only)
            const manualScheduledHours = filteredJobs.reduce((sum, job) => {
              // Skip if this job has Gantt data (already counted in Step 1)
              if (job && projectsWithGanttData.has(job.jobKey)) return sum;
              
              const allocation = job.allocations[month] || 0;
              return sum + ((job.totalHours || 0) * (allocation / 100));
            }, 0);

            const totalHours = monthTotalGanttHours + manualScheduledHours;

            return (
              <div key={month} style={{ background: "#ffffff", padding: 12, borderRadius: 8, border: "1px solid #ddd", textAlign: "center" }}>
                <div style={{ color: "#666", fontSize: 12, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {formatMonthLabel(month)}
                </div>
                <div style={{ color: "#E06C00", fontSize: 24, fontWeight: 700 }}>
                  {Math.round(totalHours || 0)}
                </div>
                <div style={{ color: "#999", fontSize: 11, marginTop: 2 }}>hours</div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ color: "#15616D", fontSize: 20, margin: 0 }}>Jobs</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Active Filters Badge */}
            {(yearFilter || customerFilter || jobFilter) && (
              <div style={{ 
                padding: "4px 12px", 
                background: "#E06C00", 
                color: "#ffffff", 
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600
              }}>
                {[yearFilter && "Year", customerFilter && "Customer", jobFilter && "Project"].filter(Boolean).join(", ")} Active
              </div>
            )}
            <button
              onClick={() => {
                setYearFilter("");
                setCustomerFilter("");
                setJobFilter("");
              }}
              style={{
                padding: "6px 14px",
                background: "#E06C00",
                border: "none",
                color: "#ffffff",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Clear Filters
            </button>
            <button
              onClick={addMonth}
              style={{
                padding: "8px 12px",
                background: "#22c55e",
                borderRadius: 8,
                border: "none",
                color: "#0b1215",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              + Add Month
            </button>
          </div>
        </div>

        {/* Filters */}
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(3, 1fr)", 
          gap: 12, 
          marginBottom: 20, 
          padding: 16, 
          background: "#f8f9fa", 
          borderRadius: 8,
          border: "1px solid #dee2e6"
        }}>
          <div>
            <label style={{ fontSize: 13, color: "#15616D", display: "block", marginBottom: 6, fontWeight: 600 }}>Filter by Year</label>
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "#ffffff",
                color: "#333333",
                border: yearFilter ? "2px solid #E06C00" : "1px solid #ced4da",
                borderRadius: 6,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              <option value="">All Years</option>
              {Array.from(new Set(validMonths.map(m => m.split('-')[0]))).sort().map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 13, color: "#15616D", display: "block", marginBottom: 6, fontWeight: 600 }}>Filter by Customer</label>
            <select
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "#ffffff",
                color: "#333333",
                border: customerFilter ? "2px solid #E06C00" : "1px solid #ced4da",
                borderRadius: 6,
                fontSize: 14,
                cursor: "pointer",
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
            <label style={{ fontSize: 13, color: "#15616D", display: "block", marginBottom: 6, fontWeight: 600 }}>Filter by Project Name</label>
            <input
              type="text"
              placeholder="Search projects..."
              value={jobFilter}
              onChange={(e) => setJobFilter(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "#ffffff",
                color: "#333333",
                border: jobFilter ? "2px solid #E06C00" : "1px solid #ced4da",
                borderRadius: 6,
                fontSize: 14,
              }}
            />
          </div>
        </div>

        <div style={{ maxHeight: "500px", overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
              <tr style={{ borderBottom: "2px solid #ddd", background: "#f9f9f9" }}>
                <th onClick={() => handleSort("customer")} style={{ textAlign: "left", padding: "12px 8px", color: sortColumn === "customer" ? "#E06C00" : "#666", fontWeight: 600, cursor: "pointer", userSelect: "none" }}>
                  Customer {sortColumn === "customer" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
                <th onClick={() => handleSort("projectName")} style={{ textAlign: "left", padding: "12px 8px", color: sortColumn === "projectName" ? "#E06C00" : "#666", fontWeight: 600, cursor: "pointer", userSelect: "none" }}>
                  Job Name {sortColumn === "projectName" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
                <th onClick={() => handleSort("status")} style={{ textAlign: "left", padding: "12px 8px", color: sortColumn === "status" ? "#E06C00" : "#666", fontWeight: 600, cursor: "pointer", userSelect: "none" }}>
                  Status {sortColumn === "status" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
                <th onClick={() => handleSort("totalHours")} style={{ textAlign: "right", padding: "12px 8px", color: sortColumn === "totalHours" ? "#E06C00" : "#666", fontWeight: 600, cursor: "pointer", userSelect: "none" }}>
                  Total Hours {sortColumn === "totalHours" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
                <th style={{ textAlign: "right", padding: "12px 8px", color: "#9ca3af", fontWeight: 600 }} title="Total hours scheduled across all time periods (including months not shown)">
                  Total Scheduled
                </th>
                {displayMonths.map((month) => (
                  <th key={month} onClick={() => handleSort(month)} style={{ textAlign: "center", padding: "12px 8px", color: sortColumn === month ? "#22c55e" : "#9ca3af", fontWeight: 600, cursor: "pointer", userSelect: "none" }}>
                    {formatMonthLabel(month)} {sortColumn === month && (sortDirection === "asc" ? "↑" : "↓")}
                  </th>
                ))}
                <th style={{ textAlign: "center", padding: "12px 8px", color: "#9ca3af", fontWeight: 600 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map((job) => {
                const statusColor = job.status === "In Progress" ? "#E06C00" : "#ef4444";
                return (
                  <tr key={job.jobKey} style={{ borderBottom: "1px solid #eee", background: "#fafafa" }}>
                    <td style={{ padding: "12px 8px", color: "#222" }}>{job.customer}</td>
                    <td style={{ padding: "12px 8px", color: "#222" }}>{job.projectName}</td>
                    <td style={{ padding: "12px 8px" }}>
                      <select
                        value={job.status}
                        onChange={(e) => updateStatus(job.jobKey, e.target.value)}
                        disabled={updatingStatus === job.jobKey}
                        style={{
                          padding: "6px 12px",
                          background: "#fff",
                          borderRadius: 6,
                          border: "1px solid #ddd",
                          color: statusColor,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        <option value="In Progress">In Progress</option>
                        <option value="Complete">Complete</option>
                        <option value="Delayed">Delayed</option>
                      </select>
                    </td>
                    <td style={{ padding: "12px 8px", color: "#E06C00", fontWeight: 700, textAlign: "right" }}>
                      {job.totalHours.toLocaleString()}
                    </td>
                    <td 
                      style={{ 
                        padding: "12px 8px", 
                        color: (() => {
                          const totalPercent = Object.values(job.allocations).reduce((sum, percent) => sum + percent, 0);
                          return totalPercent > 100 ? "#ef4444" : "#15616D"; // Red if over-scheduled
                        })(),
                        fontWeight: 700, 
                        textAlign: "right" 
                      }} 
                      title="Total hours scheduled across ALL time periods (including months not currently displayed)"
                    >
                      {(() => {
                        // Priority 1: Gantt data (all months, not just visible)
                        const ganttHours = Object.values(jobGanttHoursMap[job.jobKey] || {}).reduce((sum, h) => sum + h, 0);
                        if (ganttHours > 0) return Math.round(ganttHours || 0);

                        // Priority 2: Manual allocations (ALL months, not just visible ones) - NO CAP
                        const totalPercent = Object.values(job.allocations).reduce((sum, percent) => sum + percent, 0);
                        return Math.round((job.totalHours * (totalPercent / 100)) || 0);
                      })()}
                    </td>
                    {displayMonths.map((month) => {
                      const ganttHours = jobGanttHoursMap[job.jobKey]?.[month] ?? 0;
                      const manualValue = job.allocations[month];

                      return (
                        <td key={`${job.jobKey}-${month}`} style={{ padding: "8px", textAlign: "center" }}>
                          {ganttHours > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                              <div style={{ color: '#E06C00', fontWeight: 600 }}>{Math.round(ganttHours || 0)} hrs</div>
                              <div style={{ color: '#aaa', fontSize: '9px', textTransform: 'uppercase' }}>Gantt</div>
                            </div>
                          ) : (
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={manualValue === 0 || manualValue === undefined ? '' : manualValue}
                              onChange={(e) => updatePercent(job.jobKey, month, parseInt(e.target.value || "0", 10))}
                              style={{
                                width: "60px",
                                padding: "6px 8px",
                                borderRadius: 6,
                                background: "#fff",
                                color: "#222",
                                border: "1px solid #ddd",
                                textAlign: "center",
                              }}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      <button
                        onClick={() => saveSchedule(job.jobKey)}
                        disabled={savingJobKey === job.jobKey}
                        style={{
                          padding: "6px 12px",
                          background: savingJobKey === job.jobKey ? "#4b5563" : "#3b82f6",
                          borderRadius: 6,
                          border: "none",
                          color: "#fff",
                          fontWeight: 600,
                          cursor: savingJobKey === job.jobKey ? "not-allowed" : "pointer",
                          fontSize: "12px",
                          opacity: savingJobKey === job.jobKey ? 0.6 : 1,
                        }}
                      >
                        {savingJobKey === job.jobKey ? "Saving..." : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <button
        onClick={saveAllSchedules}
        disabled={saving}
        style={{
          padding: "10px 16px",
          background: "#3b82f6",
          borderRadius: 8,
          border: "none",
          color: "#fff",
          fontWeight: 700,
          cursor: saving ? "not-allowed" : "pointer",
          opacity: saving ? 0.6 : 1,
          marginTop: "20px",
        }}
      >
        {saving ? "Saving..." : "Save All Schedules"}
      </button>

      </main>
  );
}
