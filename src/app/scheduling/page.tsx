"use client";
import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where, updateDoc, doc } from "firebase/firestore";
import { db } from "@/firebase";
import ProtectedPage from "@/components/ProtectedPage";
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
};

type JobSchedule = {
  jobKey: string;
  customer: string;
  projectName: string;
  status: string;
  totalHours: number;
  allocations: Record<string, number>;
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
        return Number(year) >= 2026;
      })
    )
  ).sort();
}

function parseDateValue(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value.toDate) {
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
  // Generate all months for 2026 and beyond
  const now = new Date();
  const currentYear = now.getFullYear();
  const startYear = Math.max(2026, currentYear);
  
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
  return (
    <ProtectedPage page="scheduling">
      <SchedulingContent />
    </ProtectedPage>
  );
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
          // Filter out any months before 2026
          const filtered = normalizeMonths(parsed);
          
          // Ensure we have all 12 months of 2026 at minimum
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
  const [sortColumn, setSortColumn] = useState<string>("customer");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [savingJobKey, setSavingJobKey] = useState<string>("");
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [scopesByJobKey, setScopesByJobKey] = useState<Record<string, any[]>>({});

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

  const validMonths = useMemo(() => normalizeMonths(months), [months]);

  useEffect(() => {
    async function fetchData() {
      try {
        const projectsSnapshot = await getDocs(query(
          collection(db, "projects"),
          where("status", "not-in", ["Bid Submitted", "Lost"])
        ));
        const projectsData = projectsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as Omit<Project, "id">),
        }));
        setProjects(projectsData);

        const schedulesRes = await fetch("/api/scheduling");
        const schedulesJson = await schedulesRes.json();
        const schedulesArray = (schedulesJson.data || []).map((s: any) => {
          // Handle both object and array formats for allocations
          let allocations: Record<string, number> = {};
          if (s.allocations) {
            if (Array.isArray(s.allocations)) {
              // Array format: convert to object
              allocations = s.allocations.reduce((acc: Record<string, number>, alloc: any) => {
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
        setSchedules(schedulesArray);

        // Fetch scopes for Gantt prioritization logic
        const scopesSnapshot = await getDocs(collection(db, "projectScopes"));
        const rawScopes = scopesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const scopesMap: Record<string, any[]> = {};
        rawScopes.forEach((scope: any) => {
          if (scope.jobKey) {
            if (!scopesMap[scope.jobKey]) scopesMap[scope.jobKey] = [];
            scopesMap[scope.jobKey].push(scope);
          }
        });
        setScopesByJobKey(scopesMap);

        // Collect all months that have scheduled hours (valid months only)
        const scheduledMonths = new Set<string>();
        schedulesArray.forEach((schedule: JobSchedule) => {
          Object.entries(schedule.allocations).forEach(([month, percent]) => {
            if (!isValidMonthKey(month) || percent <= 0) return;
            const [year] = month.split("-");
            if (Number(year) < 2026) return;
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
              const currentDate = parseDateValue((current as any).dateCreated);
              const latestDateVal = parseDateValue((latest as any).dateCreated);
              if (!currentDate) return latest;
              if (!latestDateVal) return current;
              return currentDate.getTime() > latestDateVal.getTime() ? current : latest;
            }, projs[0]);
            
            const projDate = parseDateValue((mostRecentProj as any).dateCreated);
            if (projDate && (!latestDate || projDate.getTime() > latestDate.getTime())) {
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
      const [customer, projectNumber, projectName] = jobKey.split("~");
      
      // Update projects collection
      const projectsRef = collection(db, "projects");
      const q = query(
        projectsRef,
        where("customer", "==", customer),
        where("projectNumber", "==", projectNumber)
      );
      
      const querySnapshot = await getDocs(q);
      
      console.log(`Updating ${querySnapshot.size} project document(s) for ${customer} - ${projectName}`);
      
      // Update all matching project documents
      const updatePromises = querySnapshot.docs.map((docSnapshot) => {
        const docRef = doc(db, "projects", docSnapshot.id);
        return updateDoc(docRef, { status: newStatus });
      });
      
      await Promise.all(updatePromises);
      console.log("Projects updated successfully");
      
      // Also update the schedule document - query by projectName instead of using jobKey as doc ID
      try {
        const schedulesRef = collection(db, "schedules");
        const scheduleQuery = query(schedulesRef, where("projectName", "==", projectName));
        const scheduleSnapshot = await getDocs(scheduleQuery);
        
        if (scheduleSnapshot.docs.length > 0) {
          const scheduleUpdatePromises = scheduleSnapshot.docs.map((scheduleDoc) => {
            return updateDoc(scheduleDoc.ref, { status: newStatus });
          });
          await Promise.all(scheduleUpdatePromises);
          console.log(`Schedule updated successfully for ${projectName}`);
        } else {
          console.log(`No schedule found for ${projectName}, skipping schedule update`);
        }
      } catch (scheduleError) {
        console.error("Error updating schedule:", scheduleError);
        // Continue even if schedule update fails
      }
      
      // Refresh the projects data
      const allProjects = await getDocs(query(
        collection(db, "projects"),
        where("status", "not-in", ["Bid Submitted", "Lost"])
      ));
      setProjects(allProjects.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as any);
      
      // Refresh schedules data
      const schedulesRes = await fetch("/api/scheduling");
      const schedulesJson = await schedulesRes.json();
      const schedulesArray = (schedulesJson.data || []).map((s: any) => ({
        jobKey: s.jobKey,
        customer: s.customer,
        projectName: s.projectName,
        status: s.status || "Unknown",
        totalHours: s.totalHours,
        allocations: s.allocations.reduce((acc: Record<string, number>, alloc: any) => {
          acc[alloc.month] = alloc.percent;
          return acc;
        }, {}),
      }));
      setSchedules(schedulesArray);
      console.log("Schedules refreshed, new status:", schedulesArray.find((s: any) => s.jobKey === jobKey)?.status);
      
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
    
    // Ensure all existing schedules have all months initialized and get current status
    const updatedSchedules = schedules.map((schedule) => {
      const allocations: Record<string, number> = { ...schedule.allocations };
      validMonths.forEach((month) => {
        allocations[month] = allocations[month] ?? 0;
      });
      // Get hours and status from uniqueJobs (projects data)
      const currentJob = uniqueJobs.find((j) => j.key === schedule.jobKey);
      // Use schedule's status if it's explicitly set (not "Unknown"), otherwise use project's status
      const status = (schedule.status && schedule.status !== "Unknown") 
        ? schedule.status 
        : (currentJob?.status || schedule.status || "Unknown");
      
      return { 
        ...schedule, 
        allocations,
        status,
        totalHours: currentJob?.totalHours || schedule.totalHours || 0,
      };
    });

    // Check against ALL schedules (before filtering) to prevent re-adding jobs that were marked Complete
    const allScheduleKeys = new Set(schedules.map((s) => s.jobKey));
    const qualifyingKeys = new Set(uniqueJobs.map(j => j.key));
    
    const filteredSchedules = updatedSchedules.filter((schedule) => {
      // Must be a qualifying job (not excluded by global filters)
      if (!qualifyingKeys.has(schedule.jobKey || "")) return false;
      // Only include schedules with qualifying status
      return qualifyingStatuses.includes(schedule.status || "");
    });

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
  }, [schedules, uniqueJobs, validMonths]);

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
      let aVal: any = a[sortColumn as keyof JobSchedule];
      let bVal: any = b[sortColumn as keyof JobSchedule];

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

  // Calculate unscheduled hours
  const unscheduledHoursCalc = useMemo(() => {
    // Only include jobs that are currently qualifying (In Progress)
    const qualifyingJobKeys = new Set(uniqueJobs.map(j => j.key));
    const projectsWithGanttData = new Set<string>();
    let totalScheduledGanttHours = 0;

    // 1. Calculate hours from Gantt scopes for qualifying months (2026+)
    Object.entries(scopesByJobKey).forEach(([jobKey, scopes]) => {
      const validScopes = scopes.filter(s => s.startDate && s.endDate);
      if (validScopes.length > 0) {
        // Find if this job is qualifying
        const jobInfo = uniqueJobs.find(j => j.key === jobKey);
        if (!jobInfo || (jobInfo.status || "").toLowerCase().trim() !== "in progress") return;
        
        projectsWithGanttData.add(jobKey);

        const jobProjects = (projects as any[]).filter(p => ((p.jobKey || `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`) === jobKey));
        const projectCostItems = jobProjects.map(p => ({
          costitems: (p.costitems || "").toLowerCase(),
          hours: typeof p.hours === "number" ? p.hours : 0,
          costType: typeof p.costType === "string" ? p.costType : "",
        }));

        validScopes.forEach(scope => {
          const titleWithoutQty = (scope.title || "Scope").trim().toLowerCase().replace(/^[\d,]+\s*(sq\s*ft\.?|ln\s*ft\.?|each|lf)?\s*([-–]\s*)?/i, "").trim();
          const matchedItems = projectCostItems.filter((item) => item.costitems.includes(titleWithoutQty) || titleWithoutQty.includes(item.costitems));
          const scopeHours = matchedItems.reduce((acc, item) => !item.costType.toLowerCase().includes("management") ? acc + item.hours : acc, 0) || (typeof scope.hours === "number" ? scope.hours : 0);
          
          if (scopeHours > 0) {
            const dist = internalDistributeValue(scopeHours, scope.startDate!, scope.endDate!);
            Object.entries(dist).forEach(([month, hours]) => {
              if (validMonths.includes(month)) {
                totalScheduledGanttHours += hours;
              }
            });
          }
        });
      }
    });

    const totalQualifyingHours = uniqueJobs.reduce((sum, job) => {
      // Find the schedule for this job to see if it has hours in 2025
      const schedule = schedules.find(s => s.jobKey === job.key);
      let excludedHours = 0;
      if (schedule) {
        Object.entries(schedule.allocations).forEach(([month, percent]) => {
          const [year] = month.split("-");
          // If year is 2025 or before, exclude it from the "Qualifying" budget for this 2026+ view
          if (parseInt(year) < 2026) {
            excludedHours += ((schedule.totalHours || 0) * ((percent || 0) / 100));
          }
        });
      }
      // Return remaining budget (Budget - 2025 hours)
      return sum + Math.max(0, (job.totalHours || 0) - excludedHours);
    }, 0);
    
    // 2. Calculate scheduled hours for jobs WITHOUT Gantt data
    const totalManualScheduledHours = schedules
      .filter(schedule => {
        if (!qualifyingJobKeys.has(schedule.jobKey || "")) return false;
        if (schedule.status === 'Complete') return false;
        if (projectsWithGanttData.has(schedule.jobKey || "")) return false;
        return true;
      })
      .reduce((sum, schedule) => {
        // Only count hours in our valid (2026+) months
        const totalPercent = validMonths.reduce((jobSum, month) => {
          const percent = schedule.allocations[month] ?? 0;
          return jobSum + percent;
        }, 0);
        const jobScheduledHours = (schedule.totalHours || 0) * (totalPercent / 100);
        return sum + jobScheduledHours;
      }, 0);
    
    const totalScheduled = (totalScheduledGanttHours || 0) + (totalManualScheduledHours || 0);

    return {
      totalQualifying: totalQualifyingHours || 0,
      totalScheduled: totalScheduled || 0,
      unscheduled: Math.max(0, (totalQualifyingHours || 0) - (totalScheduled || 0)),
    };
  }, [uniqueJobs, schedules, validMonths, scopesByJobKey, projects]);

  // Pre-calculate Gantt hours per job/month for the table cells
  const jobGanttHoursMap = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    
    Object.entries(scopesByJobKey).forEach(([jobKey, scopes]) => {
      const validScopes = scopes.filter(s => s.startDate && s.endDate);
      if (validScopes.length === 0) return;

      const jobProjects = (projects as any[]).filter(p => ((p.jobKey || `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`) === jobKey));
      const projectCostItems = jobProjects.map(p => ({
        costitems: (p.costitems || "").toLowerCase(),
        hours: typeof p.hours === "number" ? p.hours : 0,
        costType: typeof p.costType === "string" ? p.costType : "",
      }));

      map[jobKey] = {};
      validScopes.forEach(scope => {
        const titleWithoutQty = (scope.title || "Scope").trim().toLowerCase().replace(/^[\d,]+\s*(sq\s*ft\.?|ln\s*ft\.?|each|lf)?\s*([-–]\s*)?/i, "").trim();
        const matchedItems = projectCostItems.filter((item) => item.costitems.includes(titleWithoutQty) || titleWithoutQty.includes(item.costitems));
        const scopeHours = matchedItems.reduce((acc, item) => !item.costType.toLowerCase().includes("management") ? acc + item.hours : acc, 0) || (typeof scope.hours === "number" ? scope.hours : 0);
        
        if (scopeHours > 0) {
          const dist = internalDistributeValue(scopeHours, scope.startDate!, scope.endDate!);
          Object.entries(dist).forEach(([month, hours]) => {
            map[jobKey][month] = (map[jobKey][month] || 0) + hours;
          });
        }
      });
    });
    
    return map;
  }, [scopesByJobKey, projects]);

  function handleSort(column: string) {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  function clearFilters() {
    setCustomerFilter("");
    setJobFilter("");
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
          {validMonths.map((month) => {
            const projectsWithGanttData = new Set<string>();
            let monthTotalGanttHours = 0;

            // Step 1: Calculate Gantt hours for this month
            Object.entries(scopesByJobKey).forEach(([jobKey, scopes]) => {
              const validScopes = scopes.filter(s => s.startDate && s.endDate);
              if (validScopes.length > 0) {
                projectsWithGanttData.add(jobKey);
                
                // Only include if the job is In Progress
                const jobInfo = uniqueJobs.find(j => j.key === jobKey);
                if (!jobInfo || (jobInfo.status || "").toLowerCase().trim() !== "in progress") return;

                const jobProjects = (projects as any[]).filter(p => ((p.jobKey || `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`) === jobKey));
                const projectCostItems = jobProjects.map(p => ({
                  costitems: (p.costitems || "").toLowerCase(),
                  hours: typeof p.hours === "number" ? p.hours : 0,
                  costType: typeof p.costType === "string" ? p.costType : "",
                }));

                validScopes.forEach(scope => {
                  const titleWithoutQty = (scope.title || "Scope").trim().toLowerCase().replace(/^[\d,]+\s*(sq\s*ft\.?|ln\s*ft\.?|each|lf)?\s*([-–]\s*)?/i, "").trim();
                  const matchedItems = projectCostItems.filter((item) => item.costitems.includes(titleWithoutQty) || titleWithoutQty.includes(item.costitems));
                  const scopeHours = matchedItems.reduce((acc, item) => !item.costType.toLowerCase().includes("management") ? acc + item.hours : acc, 0) || (typeof scope.hours === "number" ? scope.hours : 0);
                  
                  if (scopeHours > 0) {
                    const dist = internalDistributeValue(scopeHours, scope.startDate!, scope.endDate!);
                    if (dist[month]) {
                      monthTotalGanttHours += dist[month];
                    }
                  }
                });
              }
            });

            // Step 2: Calculate manual schedule hours for jobs WITHOUT Gantt data
            const manualScheduledHours = allJobs.reduce((sum, job) => {
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
                <th style={{ textAlign: "right", padding: "12px 8px", color: "#9ca3af", fontWeight: 600 }}>Scheduled Hours</th>
                {validMonths.map((month) => (
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
                    <td style={{ padding: "12px 8px", color: "#15616D", fontWeight: 700, textAlign: "right" }}>
                      {(() => {
                        // Priority 1: Gantt data
                        const ganttHours = Object.values(jobGanttHoursMap[job.jobKey] || {}).reduce((sum, h) => sum + h, 0);
                        if (ganttHours > 0) return Math.round(ganttHours || 0);

                        // Priority 2: Manual allocations
                        const totalPercent = validMonths.reduce((sum, month) => {
                          return sum + (job.allocations[month] ?? 0);
                        }, 0);
                        const cappedPercent = Math.min(100, totalPercent);
                        return Math.round((job.totalHours * (cappedPercent / 100)) || 0);
                      })()}
                    </td>
                    {validMonths.map((month) => {
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
