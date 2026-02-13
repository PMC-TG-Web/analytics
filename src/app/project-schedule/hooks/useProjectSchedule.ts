import { useState, useCallback, useMemo, useEffect } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/firebase";
import { Scope, ViewMode, GanttTask, ProjectInfo } from "@/types";
import { ShortTermJob, LongTermJob, MonthJob, ShortTermDoc, LongTermDoc } from "@/types/schedule";
import { getProjectKey, parseDateValue } from "@/utils/projectUtils";
import { 
  addDays, 
  diffInDays, 
  diffInMonths, 
  getMonthRange, 
  getMonthWeekStarts, 
  getWeekDates, 
  parseDateInput, 
  formatDateInput 
} from "@/utils/dateUtils";

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
    try {
      const projectsSnapshot = await getDocs(query(
        collection(db, "projects"),
        where("status", "not-in", ["Lost"])
      ));
      const docMap: Record<string, string> = {};
      const projectCostItems: Record<string, Array<{ costitems: string; pmcGroup: string; sales: number; cost: number; hours: number; costType: string }>> = {};
      const allProjects: ProjectInfo[] = [];

      projectsSnapshot.docs.forEach((doc) => {
        const data = doc.data() as any;
        const { projectName = "", jobKey, customer = "", projectNumber = "", status = "" } = data;
        
        if (status === "Invitations") return;

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
          pmcGroup: (data.pmcGroup || data.pmcgroup || "").toString(),
          sales: typeof data.sales === "number" ? data.sales : 0,
          cost: typeof data.cost === "number" ? data.cost : 0,
          hours: typeof data.hours === "number" ? data.hours : 0,
          costType: typeof data.costType === "string" ? data.costType : "",
        });
      });

      const scopesSnapshot = await getDocs(collection(db, "projectScopes"));
      const scopesMap: Record<string, Scope[]> = {};

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
          .replace(/^[\d,]+\s*(sq\s*ft\.?|ln\s*ft\.?|each|lf)?\s*[-–]\s*/i, "")
          .trim();

        const matchedItems = costItems.filter((item) =>
          item.costitems.includes(titleWithoutQty) || titleWithoutQty.includes(item.costitems)
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

      // BACKFILL: If a project has no explicit scopes in projectScopes, 
      // generate "Virtual Scopes" from its PMC Groups / CostItems
      allProjects.forEach(project => {
        if (!scopesMap[project.jobKey] || scopesMap[project.jobKey].length === 0) {
          const costItems = projectCostItems[project.jobKey] || [];
          const groups: Record<string, { title: string, hours: number, sales: number }> = {};
          
          costItems.forEach(item => {
            if (item.hours <= 0 && item.sales <= 0) return;
            const groupName = item.pmcGroup || item.costType || "Other";
            if (!groups[groupName]) {
              groups[groupName] = { title: groupName, hours: 0, sales: 0 };
            }
            groups[groupName].hours += item.hours;
            groups[groupName].sales += item.sales;
          });

          scopesMap[project.jobKey] = Object.values(groups).map((group, idx) => ({
            id: `virtual-${project.jobKey}-${idx}`,
            jobKey: project.jobKey,
            title: group.title,
            hours: group.hours,
            sales: group.sales,
            startDate: "",
            endDate: "",
            tasks: []
          }));
        }
      });

      const shortTermSnapshot = await getDocs(collection(db, "short term schedual"));
      const longTermSnapshot = await getDocs(collection(db, "long term schedual"));

      const shortTermMap = new Map<string, ShortTermJob>();
      shortTermSnapshot.docs.forEach((doc) => {
        const docData = doc.data() as ShortTermDoc;
        if (doc.id === "_placeholder" || !docData.jobKey) return;

        const jobKey = docData.jobKey;
        if (!shortTermMap.has(jobKey)) {
          shortTermMap.set(jobKey, {
            jobKey,
            customer: docData.customer || "",
            projectNumber: docData.projectNumber || "",
            projectName: docData.projectName || "",
            projectDocId: docMap[jobKey] || docMap[docData.projectName] || "",
            dates: [],
            totalHours: 0,
            scopes: scopesMap[jobKey] || [],
          });
        }

        const monthWeekStarts = getMonthWeekStarts(docData.month);
        (docData.weeks || []).forEach((week) => {
          const weekStart = monthWeekStarts[week.weekNumber - 1];
          if (!weekStart) return;

          const weekDates = getWeekDates(weekStart);
          (week.days || []).forEach((day) => {
            if (!day.hours || day.hours <= 0) return;
            const dayDate = weekDates[day.dayNumber - 1];
            if (!dayDate) return;

            const job = shortTermMap.get(jobKey)!;
            job.dates.push(dayDate);
            job.totalHours += day.hours;
          });
        });
      });

      const longTermMap = new Map<string, LongTermJob>();
      const monthList: MonthJob[] = [];
      longTermSnapshot.docs.forEach((doc) => {
        const docData = doc.data() as LongTermDoc;
        if (doc.id === "_placeholder" || !docData.jobKey) return;

        const jobKey = docData.jobKey;
        if (!longTermMap.has(jobKey)) {
          longTermMap.set(jobKey, {
            jobKey,
            customer: docData.customer || "",
            projectNumber: docData.projectNumber || "",
            projectName: docData.projectName || "",
            projectDocId: docMap[jobKey] || docMap[docData.projectName] || "",
            weekStarts: [],
            totalHours: 0,
            scopes: scopesMap[jobKey] || [],
          });
        }

        const monthWeekStarts = getMonthWeekStarts(docData.month);
        (docData.weeks || []).forEach((week) => {
          if (!week.hours || week.hours <= 0) return;
          const weekStart = monthWeekStarts[week.weekNumber - 1];
          if (!weekStart) return;

          const job = longTermMap.get(jobKey)!;
          job.weekStarts.push(weekStart);
          job.totalHours += week.hours;
        });

        const monthTotal = docData.totalHours ?? (docData.weeks || []).reduce((sum, w) => sum + (w.hours || 0), 0);
        if (monthTotal > 0) {
          monthList.push({
            jobKey,
            customer: docData.customer || "",
            projectNumber: docData.projectNumber || "",
            projectName: docData.projectName || "",
            projectDocId: docMap[jobKey] || docMap[docData.projectName] || "",
            month: docData.month,
            totalHours: monthTotal,
            scopes: scopesMap[jobKey] || [],
          });
        }
      });

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

    projects.forEach((project) => {
      // Consider schedules
      if (viewMode === "day") {
        const sj = shortTermJobs.find(j => j.jobKey === project.jobKey);
        sj?.dates.forEach(date => consider(date));
      } else if (viewMode === "week") {
        const lj = longTermJobs.find(j => j.jobKey === project.jobKey);
        lj?.weekStarts.forEach(ws => consider(addDays(ws, 6)));
      } else {
        const mj = monthJobs.find(j => j.jobKey === project.jobKey);
        if (mj) {
          const range = getMonthRange(mj.month);
          if (range) consider(range.end);
        }
      }

      // Consider scopes
      const rawScopes = [
        ...(scopesByJobKey[project.jobKey] || []),
        ...(scopesByJobKey[project.projectName] || []),
        ...(scopesByJobKey[`${project.projectNumber}|${project.customer}`] || []),
        ...(scopesByJobKey[`${project.projectNumber}~${project.customer}`] || [])
      ];
      const jobScopes = Array.from(new Map(rawScopes.map(s => [s.id, s])).values());

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
    // Helper to extract range and create tasks for a project
    const getProjectTasks = (project: ProjectInfo): GanttTask[] => {
      let projectStart: Date | null = null;
      let projectEnd: Date | null = null;
      let totalHours = 0;
      
      // Try multiple possible keys for scopes (new format, old pipe format, and old swapped format)
      const rawScopes = [
        ...(scopesByJobKey[project.jobKey] || []),
        ...(scopesByJobKey[project.projectName] || []),
        ...(scopesByJobKey[`${project.projectNumber}|${project.customer}`] || []),
        ...(scopesByJobKey[`${project.projectNumber}~${project.customer}`] || [])
      ];
      const jobScopes = Array.from(new Map(rawScopes.map(s => [s.id, s])).values());

      // If we have virtual scopes but also real schedules, ensure those virtual scopes 
      // appear even if their dates are empty by giving them a fallback timeline
      const hasRealSchedule = projectStart && projectEnd;
      
      // Check schedules for dates
      if (viewMode === "day") {
        const sj = shortTermJobs.find(j => j.jobKey === project.jobKey);
        if (sj && sj.dates.length > 0) {
          const sorted = [...sj.dates].sort((a, b) => a.getTime() - b.getTime());
          projectStart = sorted[0];
          projectEnd = sorted[sorted.length - 1];
          totalHours = sj.totalHours;
        }
      } else if (viewMode === "week") {
        const lj = longTermJobs.find(j => j.jobKey === project.jobKey);
        if (lj && lj.weekStarts.length > 0) {
          const sorted = [...lj.weekStarts].sort((a, b) => a.getTime() - b.getTime());
          projectStart = sorted[0];
          projectEnd = addDays(sorted[sorted.length - 1], 6);
          totalHours = lj.totalHours;
        }
      } else {
        const mj = monthJobs.find(j => j.jobKey === project.jobKey);
        if (mj) {
          const range = getMonthRange(mj.month);
          if (range) {
            projectStart = range.start;
            projectEnd = range.end;
            totalHours = mj.totalHours;
          }
        }
      }

      // Check scopes for dates if none found in schedules
      jobScopes.forEach(scope => {
        const s = parseScopeDate(scope.startDate);
        const e = parseScopeDate(scope.endDate);
        if (s) {
          if (!projectStart || s < projectStart) projectStart = s;
          if (!projectEnd || s > projectEnd) projectEnd = s;
        }
        if (e) {
          if (!projectStart || e < projectStart) projectStart = e;
          if (!projectEnd || e > projectEnd) projectEnd = e;
        }
      });

      // FALLBACK: Default to first Monday of the first month with hours in WIP
      if (!projectStart || !projectEnd) {
        const mj = monthJobs.find(j => j.jobKey === project.jobKey);
        if (mj && mj.month) {
          const [year, month] = mj.month.split("-").map(Number);
          const firstOfMonth = new Date(year, month - 1, 1);
          // Find first Monday
          while (firstOfMonth.getDay() !== 1) {
            firstOfMonth.setDate(firstOfMonth.getDate() + 1);
          }
          projectStart = firstOfMonth;
          projectEnd = addDays(firstOfMonth, 7);
        }
      }

      // SECOND FALLBACK: Use project's creation/update dates
      if (!projectStart || !projectEnd) {
        const fallbackDate = parseDateValue((project as any).dateUpdated) || 
                             parseDateValue((project as any).dateCreated);
        if (fallbackDate) {
          projectStart = fallbackDate;
          projectEnd = addDays(fallbackDate, 7);
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
        const clampedStart = task.start > startDateRange ? task.start : startDateRange;
        const clampedEnd = task.end < latestDateRange ? task.end : latestDateRange;
        if (clampedEnd < clampedStart) return { ...task, startIndex: 0, endIndex: 0, outOfRange: true };

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

