import { useState, useCallback, useMemo, useEffect } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/firebase";
import { Scope, ViewMode, GanttTask, ProjectInfo } from "@/types";
import { ShortTermJob, LongTermJob, MonthJob } from "@/types/schedule";
import { getProjectKey, parseDateValue } from "@/utils/projectUtils";
import { 
  addDays, 
  diffInDays, 
  diffInMonths, 
  getMonthRange, 
  parseDateInput, 
  formatDateInput 
} from "@/utils/dateUtils";
import { ActiveScheduleEntry } from "@/utils/activeScheduleUtils";

export function useProjectSchedule() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [shortTermJobs, setShortTermJobs] = useState<ShortTermJob[]>([]);
  const [longTermJobs, setLongTermJobs] = useState<LongTermJob[]>([]);
  const [monthJobs, setMonthJobs] = useState<MonthJob[]>([]);
  const [scopesByJobKey, setScopesByJobKey] = useState<Record<string, Scope[]>>({});
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [startFilter, setStartFilter] = useState(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return formatDateInput(today);
  });

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    const start = Date.now();
    try {
      console.log("[useProjectSchedule] Starting data fetch...");
      
      // Parallelize all Firestore fetches
      const [
        projectsSnapshot,
        scopesSnapshot,
        activeScheduleSnapshot
      ] = await Promise.all([
        getDocs(collection(db, "projects")),
        getDocs(collection(db, "projectScopes")),
        getDocs(collection(db, "activeSchedule"))
      ]);

      console.log(`[useProjectSchedule] Fetched all snapshots in ${Date.now() - start}ms`);
      
      const docMap: Record<string, string> = {};
      const projectCostItems: Record<string, Array<{ costitems: string; scopeOfWork: string; pmcGroup: string; sales: number; cost: number; hours: number; costType: string }>> = {};
      const allProjects: ProjectInfo[] = [];

      projectsSnapshot.docs.forEach((doc) => {
        const data = doc.data() as any;
        const { projectName = "", jobKey, customer = "", projectNumber = "", status = "" } = data;
        
        if (status === "Invitations" || status === "Lost") return;

        // Force evaluation of the standardized key for mapping
        const generatedKey = getProjectKey({ ...data, id: doc.id });
        const itemJobKey = generatedKey; 
        
        if (projectName) docMap[projectName] = doc.id;
        if (jobKey) docMap[jobKey] = doc.id;
        docMap[itemJobKey] = doc.id;

        if (!itemJobKey) return;

        // Skip adding the same project multiple times to allProjects
        if (!allProjects.find(p => p.jobKey === itemJobKey)) {
          allProjects.push({
            jobKey: itemJobKey,
            customer,
            projectNumber,
            projectName,
            projectDocId: doc.id,
            dateCreated: data.dateCreated,
            dateUpdated: data.dateUpdated
          } as any);
        }

        if (!projectCostItems[itemJobKey]) projectCostItems[itemJobKey] = [];

        projectCostItems[itemJobKey].push({
          costitems: (data.costitems || "").toString(),
          scopeOfWork: (data.scopeOfWork || "").toString(),
          pmcGroup: (data.pmcGroup || data.pmcgroup || "").toString(),
          sales: typeof data.sales === "number" ? data.sales : 0,
          cost: typeof data.cost === "number" ? data.cost : 0,
          hours: typeof data.hours === "number" ? data.hours : 0,
          costType: typeof data.costType === "string" ? data.costType : "",
        });
      });

      const scopesMap: Record<string, Scope[]> = {};
      const isAutoScheduledScope = (scope: Scope) =>
        (scope.title || "").trim().toLowerCase() === "scheduled work";

      scopesSnapshot.docs.forEach((docSnap) => {
        const data = docSnap.data() as Partial<Scope> & { jobKey?: string };
        let jobKey = data.jobKey;
        if (!jobKey) return;

        // Force normalization of ANY jobKey found in projectScopes to the tilde format
        // We'll normalize it to Customer~Number~Name if it's pipes or has extra baggage
        const parts = jobKey.split(/[~|]/).map(p => p.trim());
        if (parts.length >= 3) {
          jobKey = `${parts[0]}~${parts[1]}~${parts[2]}`;
        } else if (jobKey.includes('|')) {
          jobKey = jobKey.replace(/\|/g, '~');
        }

        const title = typeof data.title === "string" && data.title.trim() ? data.title : "Scope";
        const costItems = projectCostItems[jobKey] || [];
        const titleLower = title.toLowerCase();
        const titleWithoutQty = titleLower
          .replace(/^[\d,]+\s*(sq\s*ft\.?|ln\s*ft\.?|each|lf)?\s*([-–]\s*)?/i, "")
          .trim();

        const matchedItems = costItems.filter((item) =>
          item.scopeOfWork.includes(titleWithoutQty) || 
          titleWithoutQty.includes(item.scopeOfWork) ||
          item.costitems.includes(titleWithoutQty) || 
          titleWithoutQty.includes(item.costitems)
        );

        const totals = matchedItems.reduce(
          (acc, item) => {
            acc.sales += item.sales;
            acc.cost += item.cost;
            if (!item.costType.toLowerCase().includes("management")) {
              acc.hours += item.hours;
            }
            return acc;
          },
          { sales: 0, cost: 0, hours: 0 }
        );

        const scope: Scope = {
          id: docSnap.id,
          title,
          jobKey,
          startDate: data.startDate,
          endDate: data.endDate,
          manpower: data.manpower,
          description: data.description,
          tasks: Array.isArray(data.tasks) ? data.tasks : [],
          sales: matchedItems.length > 0 ? totals.sales : undefined,
          cost: matchedItems.length > 0 ? totals.cost : undefined,
          hours: matchedItems.length > 0 ? totals.hours : (typeof data.hours === "number" ? data.hours : undefined),
        };

        if (!scopesMap[jobKey]) scopesMap[jobKey] = [];
        scopesMap[jobKey].push(scope);
      });

      Object.entries(scopesMap).forEach(([jobKey, scopes]) => {
        const realScopes = scopes.filter(scope => !isAutoScheduledScope(scope));
        scopesMap[jobKey] = realScopes;
      });

      console.log(`[useProjectSchedule] Processed projects and scopes at ${Date.now() - start}ms`);

      // BACKFILL: Generate "Virtual Scopes" from PMC Groups / CostItems
      // for any missing scope titles (not just missing jobKeys).
      const processedJobKeys = new Set<string>();
      allProjects.forEach(project => {
        if (processedJobKeys.has(project.jobKey)) return;
        processedJobKeys.add(project.jobKey);

        const existingScopes = scopesMap[project.jobKey] || [];
        const existingTitles = new Set(
          existingScopes
            .map(scope => (scope.title || "").trim().toLowerCase())
            .filter(Boolean)
        );

        const costItems = projectCostItems[project.jobKey] || [];
        const groups: Record<string, { title: string, hours: number, sales: number }> = {};

        costItems.forEach(item => {
          if (item.hours <= 0 && item.sales <= 0) return;
          const groupName = item.scopeOfWork || item.pmcGroup || item.costType || "Other";
          if (!groups[groupName]) {
            groups[groupName] = { title: groupName, hours: 0, sales: 0 };
          }
          groups[groupName].hours += item.hours;
          groups[groupName].sales += item.sales;
        });

        const fallbackScopes = Object.values(groups)
          .filter(group => !existingTitles.has(group.title.trim().toLowerCase()))
          .map((group, idx) => ({
            id: `virtual-${project.jobKey}-${idx}`,
            jobKey: project.jobKey,
            title: group.title,
            hours: group.hours,
            sales: group.sales,
            startDate: "",
            endDate: "",
            tasks: []
          }));

        if (!scopesMap[project.jobKey]) scopesMap[project.jobKey] = [];
        scopesMap[project.jobKey] = [...scopesMap[project.jobKey], ...fallbackScopes];
      });

      const shortTermMap = new Map<string, ShortTermJob>();
      const longTermMap = new Map<string, LongTermJob>();
      const monthMap = new Map<string, MonthJob>();
      const projectLookup = new Map(allProjects.map(p => [p.jobKey, p]));

      const normalizeJobKey = (jobKey: string) => {
        const parts = jobKey.split(/[~|]/).map(p => p.trim());
        if (parts.length >= 3) {
          return `${parts[0]}~${parts[1]}~${parts[2]}`;
        }
        if (jobKey.includes("|")) return jobKey.replace(/\|/g, "~");
        return jobKey;
      };

      const getProjectInfo = (jobKey: string) => {
        const project = projectLookup.get(jobKey);
        if (project) {
          return {
            customer: project.customer || "",
            projectNumber: project.projectNumber || "",
            projectName: project.projectName || "",
            projectDocId: project.projectDocId || "",
          };
        }
        const parts = jobKey.split("~");
        return {
          customer: parts[0] || "",
          projectNumber: parts[1] || "",
          projectName: parts[2] || "",
          projectDocId: docMap[jobKey] || "",
        };
      };

      activeScheduleSnapshot.docs.forEach((doc) => {
        const data = doc.data() as ActiveScheduleEntry;
        if (!data.jobKey || !data.date) return;

        const jobKey = normalizeJobKey(data.jobKey);
        const entryDate = new Date(data.date);
        if (Number.isNaN(entryDate.getTime())) return;

        const info = getProjectInfo(jobKey);
        const hours = typeof data.hours === "number" ? data.hours : 0;

        if (!shortTermMap.has(jobKey)) {
          shortTermMap.set(jobKey, {
            jobKey,
            customer: info.customer,
            projectNumber: info.projectNumber,
            projectName: info.projectName,
            projectDocId: info.projectDocId,
            dates: [],
            totalHours: 0,
            scopes: scopesMap[jobKey] || [],
          });
        }
        const stJob = shortTermMap.get(jobKey)!;
        stJob.dates.push(entryDate);
        stJob.totalHours += hours;

        if (!longTermMap.has(jobKey)) {
          longTermMap.set(jobKey, {
            jobKey,
            customer: info.customer,
            projectNumber: info.projectNumber,
            projectName: info.projectName,
            projectDocId: info.projectDocId,
            weekStarts: [],
            totalHours: 0,
            scopes: scopesMap[jobKey] || [],
          });
        }
        const ltJob = longTermMap.get(jobKey)!;
        const weekStart = new Date(entryDate);
        const day = weekStart.getDay();
        const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1);
        weekStart.setDate(diff);
        weekStart.setHours(0, 0, 0, 0);
        ltJob.weekStarts.push(weekStart);
        ltJob.totalHours += hours;

        const monthKey = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, "0")}`;
        const monthMapKey = `${jobKey}__${monthKey}`;
        if (!monthMap.has(monthMapKey)) {
          monthMap.set(monthMapKey, {
            jobKey,
            customer: info.customer,
            projectNumber: info.projectNumber,
            projectName: info.projectName,
            projectDocId: info.projectDocId,
            month: monthKey,
            totalHours: 0,
            scopes: scopesMap[jobKey] || [],
          });
        }
        const monthJob = monthMap.get(monthMapKey)!;
        monthJob.totalHours += hours;
      });

      shortTermMap.forEach((job) => {
        const unique = new Map<string, Date>();
        job.dates.forEach((d) => unique.set(d.toISOString().split("T")[0], d));
        job.dates = Array.from(unique.values());
      });

      longTermMap.forEach((job) => {
        const unique = new Map<string, Date>();
        job.weekStarts.forEach((d) => unique.set(d.toISOString(), d));
        job.weekStarts = Array.from(unique.values());
      });

      const monthList = Array.from(monthMap.values());

      setScopesByJobKey(scopesMap);
      setProjects(allProjects);
      setShortTermJobs(Array.from(shortTermMap.values()));
      setLongTermJobs(Array.from(longTermMap.values()));
      setMonthJobs(monthList);
    } catch (error) {
      console.error("Error loading schedules:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  const parseScopeDate = (value?: string) => {
    if (!value) return null;
    const dateOnly = parseDateInput(value);
    if (dateOnly) return dateOnly;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const startDateRange = useMemo(() => {
    const parsed = parseDateInput(startFilter) || new Date(startFilter);
    if (Number.isNaN(parsed.getTime())) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return today;
    }
    parsed.setHours(0, 0, 0, 0);
    return parsed;
  }, [startFilter]);

  const latestDateRange = useMemo(() => {
    let maxDate: Date | null = null;
    const consider = (value?: Date | null) => {
      if (!value) return;
      if (!maxDate || value.getTime() > maxDate.getTime()) maxDate = value;
    };

    // Use Maps for O(1) lookups
    const stMap = new Map(shortTermJobs.map(j => [j.jobKey, j]));
    const ltMap = new Map(longTermJobs.map(j => [j.jobKey, j]));
    const mMap = new Map<string, MonthJob[]>();
    monthJobs.forEach(mj => {
      if (!mMap.has(mj.jobKey)) mMap.set(mj.jobKey, []);
      mMap.get(mj.jobKey)!.push(mj);
    });

    projects.forEach((project) => {
      // Consider ALL schedules
      const sj = stMap.get(project.jobKey);
      sj?.dates.forEach(date => consider(date));
      
      const lj = ltMap.get(project.jobKey);
      lj?.weekStarts.forEach(ws => consider(addDays(ws, 6)));

      const mjs = mMap.get(project.jobKey) || [];
      mjs.forEach(mj => {
        const range = getMonthRange(mj.month);
        if (range) consider(range.end);
      });

      // Consider scopes
      const rawScopes = [
        ...(scopesByJobKey[project.jobKey] || []),
        ...(scopesByJobKey[project.projectName] || []),
        ...(scopesByJobKey[`${project.projectNumber}|${project.customer}`] || []),
        ...(scopesByJobKey[`${project.projectNumber}~${project.customer}`] || [])
      ];
      // Quick unique by ID
      const seenIds = new Set();
      const jobScopes = rawScopes.filter(s => {
        if (seenIds.has(s.id)) return false;
        seenIds.add(s.id);
        return true;
      });

      jobScopes.forEach(scope => {
        consider(parseScopeDate(scope.startDate));
        consider(parseScopeDate(scope.endDate));
      });
    });

    const resultDate = maxDate as (Date | null);
    
    // Safety check: Don't allow range to exceed 1 year from start
    const oneYearFromStart = addDays(startDateRange, 365);
    const cappedDate = (resultDate && resultDate.getTime() > oneYearFromStart.getTime()) 
      ? oneYearFromStart 
      : resultDate;

    return (!cappedDate || cappedDate.getTime() < startDateRange.getTime()) 
      ? addDays(startDateRange, 30) 
      : cappedDate;
  }, [viewMode, projects, shortTermJobs, longTermJobs, monthJobs, startDateRange, scopesByJobKey]);

  const ganttTasks = useMemo(() => {
    // Use Maps for O(1) lookups
    const stMap = new Map(shortTermJobs.map(j => [j.jobKey, j]));
    const ltMap = new Map(longTermJobs.map(j => [j.jobKey, j]));
    const mMap = new Map<string, MonthJob[]>();
    monthJobs.forEach(mj => {
      if (!mMap.has(mj.jobKey)) mMap.set(mj.jobKey, []);
      mMap.get(mj.jobKey)!.push(mj);
    });

    // Helper to extract range and create tasks for a project
    const getProjectTasks = (project: ProjectInfo): GanttTask[] => {
      let projectStart: Date | null = null;
      let projectEnd: Date | null = null;
      let totalHours = 0;
      
      // Try multiple possible keys for scopes
      const rawScopes = [
        ...(scopesByJobKey[project.jobKey] || []),
        ...(scopesByJobKey[project.projectName] || []),
        ...(scopesByJobKey[`${project.projectNumber}|${project.customer}`] || []),
        ...(scopesByJobKey[`${project.projectNumber}~${project.customer}`] || [])
      ];
      const seenIds = new Set();
      const jobScopes = rawScopes.filter(s => {
        if (seenIds.has(s.id)) return false;
        seenIds.add(s.id);
        return true;
      });

      const sj = stMap.get(project.jobKey);
      const lj = ltMap.get(project.jobKey);
      const mjs = mMap.get(project.jobKey) || [];

      let foundDates: Date[] = [];

      // 1. Check ALL schedules for dates
      if (sj && sj.dates.length > 0) {
        foundDates.push(...sj.dates);
        if (viewMode === "day") totalHours = sj.totalHours;
      }
      
      if (lj && lj.weekStarts.length > 0) {
        foundDates.push(...lj.weekStarts);
        // Add endpoints for weeks
        lj.weekStarts.forEach(ws => foundDates.push(addDays(ws, 6)));
        if (viewMode === "week") totalHours = lj.totalHours;
      }

      mjs.forEach(mj => {
        const range = getMonthRange(mj.month);
        if (range) {
          foundDates.push(range.start);
          foundDates.push(range.end);
          if (viewMode === "month") totalHours = mj.totalHours;
        }
      });

      // 2. Check scopes for dates
      jobScopes.forEach(scope => {
        const s = parseScopeDate(scope.startDate);
        const e = parseScopeDate(scope.endDate);
        if (s) foundDates.push(s);
        if (e) foundDates.push(e);
      });

      if (foundDates.length > 0) {
        const sorted = foundDates.sort((a, b) => a.getTime() - b.getTime());
        projectStart = sorted[0];
        projectEnd = sorted[sorted.length - 1];
      }

      // If no hours for current viewMode, but we have them elsewhere, pick any for display
      if (totalHours === 0) {
        if (viewMode === "day" && lj) totalHours = lj.totalHours;
        else if (viewMode === "week" && sj) totalHours = sj.totalHours;
        else if (mjs.length > 0) totalHours = mjs[0].totalHours;
      }

      // FALLBACK: Default to first Monday of the first month with hours in WIP
      if (!projectStart || !projectEnd) {
        const firstMj = mjs[0];
        if (firstMj && firstMj.month) {
          const [year, month] = firstMj.month.split("-").map(Number);
          const firstOfMonth = new Date(year, month - 1, 1);
          // Find first Monday
          while (firstOfMonth.getDay() !== 1) {
            firstOfMonth.setDate(firstOfMonth.getDate() + 1);
          }
          projectStart = firstOfMonth;
          projectEnd = addDays(firstOfMonth, 7);
        }
      }

      // If still no dates, this project doesn't have a timeline yet or any scopes to show
      if (!projectStart || !projectEnd) return [];

      const projectTask: GanttTask = {
        type: "project",
        jobKey: project.jobKey,
        customer: project.customer,
        projectNumber: project.projectNumber,
        projectName: project.projectName,
        projectDocId: project.projectDocId,
        start: projectStart,
        end: projectEnd,
        totalHours: totalHours,
      };

      const scopeTasks: GanttTask[] = jobScopes.map((scope: Scope) => ({
        type: "scope",
        jobKey: project.jobKey,
        customer: project.customer,
        projectNumber: project.projectNumber,
        projectName: project.projectName,
        projectDocId: project.projectDocId,
        scopeId: scope.id,
        title: scope.title,
        start: parseScopeDate(scope.startDate) || projectStart!,
        end: parseScopeDate(scope.endDate) || projectEnd!,
        totalHours: scope.hours || 0,
        manpower: scope.manpower,
        description: scope.description,
        tasks: scope.tasks,
        sales: scope.sales,
        cost: scope.cost,
        hours: scope.hours,
      }));

      return [projectTask, ...scopeTasks];
    };

    return projects.flatMap(getProjectTasks);
  }, [viewMode, projects, shortTermJobs, longTermJobs, monthJobs, scopesByJobKey]);

  const units = useMemo(() => {
    const items: { key: string; label: string; date: Date }[] = [];
    if (viewMode === "day") {
      const days = diffInDays(startDateRange, latestDateRange) + 1;
      for (let i = 0; i < days; i++) {
        const date = addDays(startDateRange, i);
        items.push({ key: date.toISOString(), label: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }), date });
      }
    } else if (viewMode === "week") {
      const weeks = Math.floor(diffInDays(startDateRange, latestDateRange) / 7) + 1;
      for (let i = 0; i < weeks; i++) {
        const date = addDays(startDateRange, i * 7);
        items.push({ key: date.toISOString(), label: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }), date });
      }
    } else {
      const months = diffInMonths(startDateRange, latestDateRange) + 1;
      for (let i = 0; i < months; i++) {
        const date = new Date(startDateRange.getFullYear(), startDateRange.getMonth() + i, 1);
        items.push({ key: date.toISOString(), label: date.toLocaleDateString("en-US", { month: "short", year: "2-digit" }), date });
      }
    }
    return items;
  }, [viewMode, startDateRange, latestDateRange]);

  const displayTasks = useMemo(() => {
    return ganttTasks
      .map((task) => {
        const clampedStart = task.start.getTime() > startDateRange.getTime() ? task.start : startDateRange;
        const clampedEnd = task.end.getTime() < latestDateRange.getTime() ? task.end : latestDateRange;
        if (clampedEnd.getTime() < clampedStart.getTime()) return { ...task, startIndex: 0, endIndex: 0, outOfRange: true };

        let startIndex = 0, endIndex = 0;
        if (viewMode === "day") {
          startIndex = diffInDays(startDateRange, clampedStart);
          endIndex = diffInDays(startDateRange, clampedEnd);
        } else if (viewMode === "week") {
          startIndex = Math.floor(diffInDays(startDateRange, clampedStart) / 7);
          endIndex = Math.floor(diffInDays(startDateRange, clampedEnd) / 7);
        } else {
          startIndex = diffInMonths(startDateRange, clampedStart);
          endIndex = diffInMonths(startDateRange, clampedEnd);
        }
        return { ...task, startIndex, endIndex };
      })
      .filter((task) => task.type === "project" || expandedProjects[task.jobKey])
      .sort((a, b) => {
        const nameCompare = a.projectName.localeCompare(b.projectName);
        if (nameCompare !== 0) return nameCompare;
        if (a.type !== b.type) return a.type === "project" ? -1 : 1;
        return (a.title || "").localeCompare(b.title || "");
      });
  }, [ganttTasks, startDateRange, latestDateRange, viewMode, expandedProjects]);

  return {
    loading,
    viewMode,
    setViewMode,
    startFilter,
    setStartFilter,
    units,
    displayTasks,
    expandedProjects,
    setExpandedProjects,
    loadSchedules,
    scopesByJobKey,
    setScopesByJobKey,
  };
}

