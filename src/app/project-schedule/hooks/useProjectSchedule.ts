import { useState, useCallback, useMemo, useEffect } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/firebase";
import { Scope, ViewMode, GanttTask } from "@/types";
import { ShortTermJob, LongTermJob, MonthJob, ShortTermDoc, LongTermDoc } from "@/types/schedule";
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
        where("status", "not-in", ["Bid Submitted", "Lost"])
      ));
      const docMap: Record<string, string> = {};
      const projectCostItems: Record<string, Array<{ costitems: string; sales: number; cost: number; hours: number; costType: string }>> = {};

      projectsSnapshot.docs.forEach((doc) => {
        const data = doc.data();
        const { projectName, jobKey, customer = "", projectNumber = "" } = data;
        const itemJobKey = jobKey || `${customer}~${projectNumber}~${projectName || ""}`;
        
        if (projectName) docMap[projectName] = doc.id;
        if (jobKey) docMap[jobKey] = doc.id;

        if (!itemJobKey) return;
        if (!projectCostItems[itemJobKey]) projectCostItems[itemJobKey] = [];

        projectCostItems[itemJobKey].push({
          costitems: (data.costitems || "").toLowerCase(),
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
        const jobKey = data.jobKey;
        if (!jobKey) return;

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

    if (viewMode === "day") {
      shortTermJobs.forEach((job) => {
        job.dates.forEach((date) => consider(date));
        (job.scopes || []).forEach((scope) => consider(parseScopeDate(scope.endDate) || parseScopeDate(scope.startDate)));
      });
    } else if (viewMode === "week") {
      longTermJobs.forEach((job) => {
        job.weekStarts.forEach((weekStart) => consider(addDays(weekStart, 6)));
        (job.scopes || []).forEach((scope) => consider(parseScopeDate(scope.endDate) || parseScopeDate(scope.startDate)));
      });
    } else {
      monthJobs.forEach((job) => {
        const range = getMonthRange(job.month);
        if (range) consider(range.end);
        (job.scopes || []).forEach((scope) => consider(parseScopeDate(scope.endDate) || parseScopeDate(scope.startDate)));
      });
    }

    const resultDate = maxDate as (Date | null);
    
    // Safety check: Don't allow range to exceed 1 year from start
    const oneYearFromStart = addDays(startDateRange, 365);
    const cappedDate = (resultDate && resultDate.getTime() > oneYearFromStart.getTime()) 
      ? oneYearFromStart 
      : resultDate;

    return (!cappedDate || cappedDate.getTime() < startDateRange.getTime()) 
      ? addDays(startDateRange, 30) 
      : cappedDate;
  }, [viewMode, shortTermJobs, longTermJobs, monthJobs, startDateRange]);

  const ganttTasks = useMemo(() => {
    const projectToTasks = (job: ShortTermJob | LongTermJob | MonthJob, start: Date, end: Date) => {
      const projectTask: GanttTask = {
        type: "project",
        jobKey: job.jobKey,
        customer: job.customer,
        projectNumber: job.projectNumber,
        projectName: job.projectName,
        projectDocId: job.projectDocId,
        start,
        end,
        totalHours: job.totalHours,
      };

      const scopeTasks: GanttTask[] = (job.scopes || []).map((scope: Scope) => ({
        type: "scope",
        jobKey: job.jobKey,
        customer: job.customer,
        projectNumber: job.projectNumber,
        projectName: job.projectName,
        projectDocId: job.projectDocId,
        scopeId: scope.id,
        title: scope.title,
        start: parseScopeDate(scope.startDate) || start,
        end: parseScopeDate(scope.endDate) || end,
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

    if (viewMode === "day") {
      return shortTermJobs
        .filter((job) => job.dates.length > 0)
        .flatMap((job) => {
          const sorted = [...job.dates].sort((a, b) => a.getTime() - b.getTime());
          return projectToTasks(job, sorted[0], sorted[sorted.length - 1]);
        });
    }

    if (viewMode === "week") {
      return longTermJobs
        .filter((job) => job.weekStarts.length > 0)
        .flatMap((job) => {
          const sorted = [...job.weekStarts].sort((a, b) => a.getTime() - b.getTime());
          return projectToTasks(job, sorted[0], addDays(sorted[sorted.length - 1], 6));
        });
    }

    return monthJobs.flatMap((job) => {
      const range = getMonthRange(job.month);
      return range ? projectToTasks(job, range.start, range.end) : [];
    });
  }, [viewMode, shortTermJobs, longTermJobs, monthJobs]);

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

