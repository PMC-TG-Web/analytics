"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { addDoc, collection, getDocs, doc, setDoc } from "firebase/firestore";
import { db } from "@/firebase";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function diffInDays(start: Date, end: Date): number {
  const ms = startOfDay(end).getTime() - startOfDay(start).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function diffInMonths(start: Date, end: Date): number {
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInput(value: string): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function getWeekDates(weekStart: Date): Date[] {
  const dates: Date[] = [];
  for (let i = 0; i < 5; i++) {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    dates.push(date);
  }
  return dates;
}

function getMonthWeekStarts(monthStr: string): Date[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthStr)) return [];
  const [year, month] = monthStr.split("-").map(Number);
  const dates: Date[] = [];

  const startDate = new Date(year, month - 1, 1);
  while (startDate.getDay() !== 1) {
    startDate.setDate(startDate.getDate() + 1);
  }

  while (startDate.getMonth() === month - 1) {
    dates.push(new Date(startDate));
    startDate.setDate(startDate.getDate() + 7);
  }

  return dates;
}

function getMonthRange(monthStr: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthStr)) return null;
  const [year, month] = monthStr.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return { start, end };
}

interface DayData {
  dayNumber: number;
  hours: number;
}

interface WeekData {
  weekNumber: number;
  hours: number;
}

interface ShortTermDoc {
  jobKey: string;
  customer: string;
  projectNumber: string;
  projectName: string;
  month: string;
  weeks: { weekNumber: number; days: DayData[] }[];
}

interface LongTermDoc {
  jobKey: string;
  customer: string;
  projectNumber: string;
  projectName: string;
  month: string;
  weeks: WeekData[];
  totalHours?: number;
}

interface ScopeOfWorkDetail {
  title?: string;
  startDate?: string;
  endDate?: string;
  manpower?: number;
  description?: string;
  tasks?: string[];
}

interface Scope extends ScopeOfWorkDetail {
  id: string;
  jobKey?: string;
  sales?: number;
  cost?: number;
  hours?: number;
}

interface ProjectInfo {
  jobKey: string;
  customer: string;
  projectNumber: string;
  projectName: string;
  projectDocId: string;
}

interface ShortTermJob extends ProjectInfo {
  dates: Date[];
  totalHours: number;
  scopes: Scope[];
}

interface LongTermJob extends ProjectInfo {
  weekStarts: Date[];
  totalHours: number;
  scopes: Scope[];
}

interface MonthJob extends ProjectInfo {
  month: string;
  totalHours: number;
  scopes: Scope[];
}

type ViewMode = "day" | "week" | "month";

interface GanttTask {
  type: "project" | "scope";
  jobKey: string;
  customer: string;
  projectNumber: string;
  projectName: string;
  projectDocId: string;
  scopeId?: string;
  title?: string;
  start: Date;
  end: Date;
  totalHours: number;
  manpower?: number;
  description?: string;
  tasks?: string[];
  sales?: number;
  cost?: number;
  hours?: number;
}

export default function ProjectSchedulePage() {
  return (
    <ProtectedPage page="project-schedule">
      <ProjectScheduleContent />
    </ProtectedPage>
  );
}

function ProjectScheduleContent() {
  const [shortTermJobs, setShortTermJobs] = useState<ShortTermJob[]>([]);
  const [longTermJobs, setLongTermJobs] = useState<LongTermJob[]>([]);
  const [monthJobs, setMonthJobs] = useState<MonthJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [selectedProject, setSelectedProject] = useState<ProjectInfo | null>(null);
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [scopesByJobKey, setScopesByJobKey] = useState<Record<string, Scope[]>>({});
  const [startFilter, setStartFilter] = useState(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return formatDateInput(today);
  });

  const loadSchedules = useCallback(async () => {
    try {
      // Load project documents for mapping
      const projectsSnapshot = await getDocs(collection(db, "projects"));
      const docMap: Record<string, string> = {};
      
      const projectCostItems: Record<
        string,
        Array<{ costitems: string; sales: number; cost: number; hours: number; costType: string }>
      > = {};

      projectsSnapshot.docs.forEach((doc) => {
        const data = doc.data();
        const projectName = data.projectName;
        const jobKey = data.jobKey;
        const customer = data.customer || "";
        const projectNumber = data.projectNumber || "";
        const itemJobKey = jobKey || `${customer}~${projectNumber}~${projectName || ""}`;
        
        // Map both projectName and jobKey to the document ID for lookups
        if (projectName) {
          docMap[projectName] = doc.id;
        }
        if (jobKey) {
          docMap[jobKey] = doc.id;
        }

        if (!itemJobKey) return;
        if (!projectCostItems[itemJobKey]) {
          projectCostItems[itemJobKey] = [];
        }

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

        // Use hours from cost items (excluding Management), sales/cost from projects
        const scope: Scope = {
          id: docSnap.id,
          title,
          startDate: typeof data.startDate === "string" ? data.startDate : undefined,
          endDate: typeof data.endDate === "string" ? data.endDate : undefined,
          manpower: typeof data.manpower === "number" ? data.manpower : undefined,
          description: typeof data.description === "string" ? data.description : undefined,
          tasks: Array.isArray(data.tasks)
            ? data.tasks.filter((task) => typeof task === "string")
            : [],
          sales: matchedItems.length > 0 ? totals.sales : undefined,
          cost: matchedItems.length > 0 ? totals.cost : undefined,
          hours: matchedItems.length > 0 ? totals.hours : typeof data.hours === "number" ? data.hours : undefined,
        };

        if (!scopesMap[jobKey]) scopesMap[jobKey] = [];
        scopesMap[jobKey].push(scope);
      });

      const shortTermSnapshot = await getDocs(collection(db, "short term schedual"));
      const longTermSnapshot = await getDocs(collection(db, "long term schedual"));

      // Collect all valid jobKeys from schedules
      const validJobKeys = new Set<string>();
      shortTermSnapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (doc.id !== "_placeholder" && data.jobKey) {
          validJobKeys.add(data.jobKey);
        }
      });
      longTermSnapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (doc.id !== "_placeholder" && data.jobKey) {
          validJobKeys.add(data.jobKey);
        }
      });

      // Filter scopesMap to only include scopes for projects that exist in schedules
      const filteredScopesMap: Record<string, Scope[]> = {};
      for (const [jobKey, scopes] of Object.entries(scopesMap)) {
        if (validJobKeys.has(jobKey)) {
          filteredScopesMap[jobKey] = scopes;
        }
      }

      setScopesByJobKey(filteredScopesMap);

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

      setShortTermJobs(Array.from(shortTermMap.values()));
      setLongTermJobs(Array.from(longTermMap.values()));
      setMonthJobs(monthList);
    } catch (error) {
      console.error("Failed to load schedules:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  const applyScopesToJobs = useCallback((jobKey: string, scopes: Scope[]) => {
    setScopesByJobKey((prev) => ({
      ...prev,
      [jobKey]: scopes,
    }));
    setShortTermJobs((prev) =>
      prev.map((job) => (job.jobKey === jobKey ? { ...job, scopes } : job))
    );
    setLongTermJobs((prev) =>
      prev.map((job) => (job.jobKey === jobKey ? { ...job, scopes } : job))
    );
    setMonthJobs((prev) =>
      prev.map((job) => (job.jobKey === jobKey ? { ...job, scopes } : job))
    );
  }, []);

  const handleOpenScopes = useCallback((task: GanttTask) => {
    setSelectedProject({
      jobKey: task.jobKey,
      customer: task.customer,
      projectNumber: task.projectNumber,
      projectName: task.projectName,
      projectDocId: task.projectDocId,
    });
    setSelectedScopeId(task.type === "scope" ? task.scopeId || null : null);
  }, []);

  const toggleProjectScopes = useCallback((jobKey: string) => {
    setCollapsedProjects((prev) => ({
      ...prev,
      [jobKey]: !prev[jobKey],
    }));
  }, []);

  const parseScopeDate = (value?: string) => {
    if (!value) return null;
    const dateOnly = parseDateInput(value);
    if (dateOnly) return dateOnly;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const startDate = useMemo(() => {
    const parsed = parseDateInput(startFilter) || new Date(startFilter);
    if (Number.isNaN(parsed.getTime())) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return today;
    }
    parsed.setHours(0, 0, 0, 0);
    return parsed;
  }, [startFilter]);

  const latestDate = useMemo(() => {
    let maxDate: Date | null = null;

    const consider = (value?: Date | null) => {
      if (!value) return;
      if (!maxDate || value.getTime() > maxDate.getTime()) {
        maxDate = value;
      }
    };

    if (viewMode === "day") {
      shortTermJobs.forEach((job) => {
        job.dates.forEach((date) => consider(date));
        (job.scopes || []).forEach((scope) => {
          consider(parseScopeDate(scope.endDate) || parseScopeDate(scope.startDate));
        });
      });
    } else if (viewMode === "week") {
      longTermJobs.forEach((job) => {
        job.weekStarts.forEach((weekStart) => consider(addDays(weekStart, 6)));
        (job.scopes || []).forEach((scope) => {
          consider(parseScopeDate(scope.endDate) || parseScopeDate(scope.startDate));
        });
      });
    } else if (viewMode === "month") {
      monthJobs.forEach((job) => {
        const range = getMonthRange(job.month);
        if (range) consider(range.end);
        (job.scopes || []).forEach((scope) => {
          consider(parseScopeDate(scope.endDate) || parseScopeDate(scope.startDate));
        });
      });
    }

    if (!maxDate || (maxDate as Date).getTime() < startDate.getTime()) {
      return addDays(startDate, 30);
    }

    return maxDate;
  }, [viewMode, shortTermJobs, longTermJobs, monthJobs, startDate]);

  const timelineRange = useMemo(() => {
    return {
      start: startDate,
      end: latestDate,
    };
  }, [startDate, latestDate]);

  const ganttTasks = useMemo(() => {
    if (viewMode === "day") {
      return shortTermJobs
        .filter((job) => job.dates.length > 0)
        .flatMap((job) => {
          const sorted = [...job.dates].sort((a, b) => a.getTime() - b.getTime());
          const projectTask: GanttTask = {
            type: "project",
            jobKey: job.jobKey,
            customer: job.customer,
            projectNumber: job.projectNumber,
            projectName: job.projectName,
            projectDocId: job.projectDocId,
            start: sorted[0],
            end: sorted[sorted.length - 1],
            totalHours: job.totalHours,
          };

          const scopeTasks: GanttTask[] = (job.scopes || []).map((scope) => {
            const scopeStart = parseScopeDate(scope.startDate) || projectTask.start;
            const scopeEnd = parseScopeDate(scope.endDate) || projectTask.end;
            return {
              type: "scope",
              jobKey: job.jobKey,
              customer: job.customer,
              projectNumber: job.projectNumber,
              projectName: job.projectName,
              projectDocId: job.projectDocId,
              scopeId: scope.id,
              title: scope.title,
              start: scopeStart,
              end: scopeEnd,
              totalHours: scope.hours || 0,
              manpower: scope.manpower,
              description: scope.description,
              tasks: scope.tasks,
              sales: scope.sales,
              cost: scope.cost,
              hours: scope.hours,
            };
          });

          return [projectTask, ...scopeTasks];
        });
    }

    if (viewMode === "week") {
      return longTermJobs
        .filter((job) => job.weekStarts.length > 0)
        .flatMap((job) => {
          const sorted = [...job.weekStarts].sort((a, b) => a.getTime() - b.getTime());
          const projectTask: GanttTask = {
            type: "project",
            jobKey: job.jobKey,
            customer: job.customer,
            projectNumber: job.projectNumber,
            projectName: job.projectName,
            projectDocId: job.projectDocId,
            start: sorted[0],
            end: addDays(sorted[sorted.length - 1], 6),
            totalHours: job.totalHours,
          };

          const scopeTasks: GanttTask[] = (job.scopes || []).map((scope) => {
            const scopeStart = parseScopeDate(scope.startDate) || projectTask.start;
            const scopeEnd = parseScopeDate(scope.endDate) || projectTask.end;
            return {
              type: "scope",
              jobKey: job.jobKey,
              customer: job.customer,
              projectNumber: job.projectNumber,
              projectName: job.projectName,
              projectDocId: job.projectDocId,
              scopeId: scope.id,
              title: scope.title,
              start: scopeStart,
              end: scopeEnd,
              totalHours: scope.hours || 0,
              manpower: scope.manpower,
              description: scope.description,
              tasks: scope.tasks,
              sales: scope.sales,
              cost: scope.cost,
              hours: scope.hours,
            };
          });

          return [projectTask, ...scopeTasks];
        });
    }

    return monthJobs.flatMap((job) => {
      const range = getMonthRange(job.month);
      if (!range) return [];

      const projectTask: GanttTask = {
        type: "project",
        jobKey: job.jobKey,
        customer: job.customer,
        projectNumber: job.projectNumber,
        projectName: job.projectName,
        projectDocId: job.projectDocId,
        start: range.start,
        end: range.end,
        totalHours: job.totalHours,
      };

      const scopeTasks: GanttTask[] = (job.scopes || []).map((scope) => {
        const scopeStart = parseScopeDate(scope.startDate) || projectTask.start;
        const scopeEnd = parseScopeDate(scope.endDate) || projectTask.end;
        return {
          type: "scope",
          jobKey: job.jobKey,
          customer: job.customer,
          projectNumber: job.projectNumber,
          projectName: job.projectName,
          projectDocId: job.projectDocId,
          scopeId: scope.id,
          title: scope.title,
          start: scopeStart,
          end: scopeEnd,
          totalHours: scope.hours || 0,
          manpower: scope.manpower,
          description: scope.description,
          tasks: scope.tasks,
          sales: scope.sales,
          cost: scope.cost,
          hours: scope.hours,
        };
      });

      return [projectTask, ...scopeTasks];
    });
  }, [viewMode, shortTermJobs, longTermJobs, monthJobs]);

  const { unitWidth, unitLabel } = useMemo(() => {
    if (viewMode === "day") return { unitWidth: 70, unitLabel: "Day" };
    if (viewMode === "week") return { unitWidth: 90, unitLabel: "Week" };
    return { unitWidth: 120, unitLabel: "Month" };
  }, [viewMode]);

  const units = useMemo(() => {
    const items: { key: string; label: string; date: Date }[] = [];
    if (viewMode === "day") {
      const days = diffInDays(timelineRange.start, timelineRange.end) + 1;
      for (let i = 0; i < days; i++) {
        const date = addDays(timelineRange.start, i);
        items.push({
          key: date.toISOString(),
          label: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          date,
        });
      }
    } else if (viewMode === "week") {
      const weeks = Math.floor(diffInDays(timelineRange.start, timelineRange.end) / 7) + 1;
      for (let i = 0; i < weeks; i++) {
        const date = addDays(timelineRange.start, i * 7);
        items.push({
          key: date.toISOString(),
          label: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          date,
        });
      }
    } else {
      const months = diffInMonths(timelineRange.start, timelineRange.end) + 1;
      for (let i = 0; i < months; i++) {
        const date = new Date(timelineRange.start.getFullYear(), timelineRange.start.getMonth() + i, 1);
        items.push({
          key: date.toISOString(),
          label: date.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
          date,
        });
      }
    }

    return items;
  }, [viewMode, timelineRange]);

  const displayTasks = useMemo(() => {
    const start = timelineRange.start;
    const end = timelineRange.end;

    return ganttTasks
      .map((task): (GanttTask & { startIndex: number; endIndex: number; outOfRange?: boolean }) | null => {
        const clampedStart = task.start > start ? task.start : start;
        const clampedEnd = task.end < end ? task.end : end;
        if (clampedEnd < clampedStart) {
          // Include all tasks (projects and scopes) that are out of range
          return {
            ...task,
            startIndex: 0,
            endIndex: 0,
            outOfRange: true,
          };
        }

        let startIndex = 0;
        let endIndex = 0;

        if (viewMode === "day") {
          startIndex = diffInDays(start, clampedStart);
          endIndex = diffInDays(start, clampedEnd);
        } else if (viewMode === "week") {
          startIndex = Math.floor(diffInDays(start, clampedStart) / 7);
          endIndex = Math.floor(diffInDays(start, clampedEnd) / 7);
        } else {
          startIndex = diffInMonths(start, clampedStart);
          endIndex = diffInMonths(start, clampedEnd);
        }

        return {
          ...task,
          startIndex,
          endIndex,
        };
      })
      .filter((task): task is GanttTask & { startIndex: number; endIndex: number; outOfRange?: boolean } => Boolean(task))
      .filter((task) => task.type === "project" || !collapsedProjects[task.jobKey])
      .sort((a, b) => {
        const nameCompare = a.projectName.localeCompare(b.projectName);
        if (nameCompare !== 0) return nameCompare;
        if (a.type !== b.type) return a.type === "project" ? -1 : 1;
        return (a.title || "").localeCompare(b.title || "");
      });
  }, [ganttTasks, timelineRange, viewMode, collapsedProjects]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-full mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Project Schedule</h1>
          <div className="text-center py-12">Loading schedules...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-full mx-auto">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Project Schedule</h1>
            <p className="text-gray-600 mt-1">Gantt view with day, week, and month zoom levels</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
              Start
              <input
                type="date"
                value={startFilter}
                onChange={(e) => setStartFilter(e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded-md text-xs"
              />
            </label>
            <div className="inline-flex rounded-md shadow-sm overflow-hidden border border-gray-200">
              {(["day", "week", "month"] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
                    viewMode === mode
                      ? "bg-orange-600 text-white"
                      : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
            <Navigation currentPage="project-schedule" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-max">
              <div className="grid" style={{ gridTemplateColumns: `260px repeat(${units.length}, ${unitWidth}px)` }}>
                <div className="sticky left-0 z-10 bg-orange-600 text-white text-sm font-bold px-4 py-3 border-r border-orange-500">
                  Project
                </div>
                {units.map((unit) => (
                  <div
                    key={unit.key}
                    className="bg-orange-600 text-white text-xs font-semibold text-center py-3 border-r border-orange-500"
                  >
                    <div>{unit.label}</div>
                    <div className="text-[10px] text-orange-100">{unitLabel}</div>
                  </div>
                ))}
              </div>

              {displayTasks.length === 0 ? (
                <div className="px-6 py-10 text-center text-gray-500">No scheduled projects in this range.</div>
              ) : (
                displayTasks.map((task, taskIndex) => {
                  const isOutOfRange = Boolean(task.outOfRange);
                  const left = isOutOfRange ? 0 : task.startIndex * unitWidth;
                  const width = isOutOfRange ? 0 : (task.endIndex - task.startIndex + 1) * unitWidth;

                  return (
                    <div
                      key={`${task.type === "project" ? `${task.jobKey}-project` : `${task.jobKey}-scope-${task.scopeId}`}-${taskIndex}`}
                      className="grid border-t border-gray-200"
                      style={{ gridTemplateColumns: `260px repeat(${units.length}, ${unitWidth}px)` }}
                    >
                      <div className="sticky left-0 z-10 bg-white px-4 py-3 border-r border-gray-200">
                        {task.type === "project" ? (
                          <>
                            <div className="text-sm font-semibold text-gray-900 truncate" title={task.projectName}>
                              {task.projectName}
                            </div>
                            <div className="text-xs text-gray-500 truncate">
                              {task.customer}
                            </div>
                            {scopesByJobKey[task.jobKey]?.length ? (
                              <div className="mt-1 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => toggleProjectScopes(task.jobKey)}
                                  className="text-[11px] font-semibold text-orange-600 hover:text-orange-700"
                                >
                                  {collapsedProjects[task.jobKey] ? "+" : "–"}
                                </button>
                                <div className="text-[11px] text-gray-400">
                                  {scopesByJobKey[task.jobKey].length} scope
                                  {scopesByJobKey[task.jobKey].length === 1 ? "" : "s"}
                                </div>
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <div className="pl-4">
                            <div className="text-xs font-semibold text-gray-700 truncate" title={task.title || "Scope"}>
                              {task.title || "Scope"}
                            </div>
                            <div className="flex gap-3 text-[11px] text-gray-400 mt-1">
                              {typeof task.sales === "number" && task.sales > 0 ? (
                                <span>Sales: ${task.sales.toLocaleString(undefined, {maximumFractionDigits: 0})}</span>
                              ) : null}
                              {typeof task.cost === "number" && task.cost > 0 ? (
                                <span>Cost: ${task.cost.toLocaleString(undefined, {maximumFractionDigits: 0})}</span>
                              ) : null}
                              {typeof task.hours === "number" && task.hours > 0 ? (
                                <span>Hours: {task.hours.toFixed(1)}</span>
                              ) : null}
                              {typeof task.manpower === "number" ? (
                                <span>Crew: {task.manpower}</span>
                              ) : null}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="relative col-span-full" style={{ gridColumn: `2 / span ${units.length}` }}>
                        <div className="absolute inset-0 flex items-center">
                          {isOutOfRange ? (
                            <div className="text-[11px] text-gray-400 px-2">Out of range</div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleOpenScopes(task)}
                              className="h-8 rounded-md bg-orange-500 text-white text-xs font-semibold px-3 shadow-sm hover:bg-orange-600"
                              style={{ marginLeft: left, width }}
                            >
                              {task.type === "project" ? `${task.totalHours.toFixed(1)} hrs` : task.title || "Scope"}
                            </button>
                          )}
                        </div>
                        <div className="h-12"></div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {selectedProject && (
        <ProjectScopesModal
          project={selectedProject}
          scopes={scopesByJobKey[selectedProject.jobKey] || []}
          selectedScopeId={selectedScopeId}
          onClose={() => {
            setSelectedProject(null);
            setSelectedScopeId(null);
          }}
          onScopesUpdated={(jobKey, scopes) => applyScopesToJobs(jobKey, scopes)}
        />
      )}
    </div>
  );
}

interface ProjectScopesModalProps {
  project: ProjectInfo;
  scopes: Scope[];
  selectedScopeId: string | null;
  onClose: () => void;
  onScopesUpdated: (jobKey: string, scopes: Scope[]) => void;
}

function ProjectScopesModal({
  project,
  scopes,
  selectedScopeId,
  onClose,
  onScopesUpdated,
}: ProjectScopesModalProps) {
  const [activeScopeId, setActiveScopeId] = useState<string | null>(selectedScopeId);
  const [scopeDetail, setScopeDetail] = useState<ScopeOfWorkDetail>({
    title: "",
    startDate: "",
    endDate: "",
    description: "",
    tasks: [],
  });
  const [isSaving, setIsSaving] = useState(false);
  const [newTask, setNewTask] = useState("");

  useEffect(() => {
    setActiveScopeId(selectedScopeId);
  }, [selectedScopeId]);

  useEffect(() => {
    const scope = scopes.find((item) => item.id === activeScopeId);
    if (!scope) {
      setScopeDetail({
        title: "",
        startDate: "",
        endDate: "",
        manpower: undefined,
        description: "",
        tasks: [],
      });
      return;
    }

    setScopeDetail({
      title: scope.title || "",
      startDate: scope.startDate || "",
      endDate: scope.endDate || "",
      manpower: scope.manpower,
      description: scope.description || "",
      tasks: Array.isArray(scope.tasks) ? scope.tasks : [],
    });
  }, [activeScopeId, scopes]);

  const handleAddTask = () => {
    const trimmed = newTask.trim();
    if (!trimmed) return;
    setScopeDetail((prev) => ({
      ...prev,
      tasks: [...(prev.tasks || []), trimmed],
    }));
    setNewTask("");
  };

  const handleRemoveTask = (index: number) => {
    setScopeDetail((prev) => ({
      ...prev,
      tasks: prev.tasks?.filter((_, i) => i !== index) || [],
    }));
  };

  const handleSaveScope = async () => {
    setIsSaving(true);
    try {
      const payload: ScopeOfWorkDetail & { jobKey: string; title: string; tasks: string[] } = {
        jobKey: project.jobKey,
        title: (scopeDetail.title || "Scope").trim() || "Scope",
        startDate: scopeDetail.startDate || "",
        endDate: scopeDetail.endDate || "",
        manpower: scopeDetail.manpower,
        description: scopeDetail.description || "",
        tasks: (scopeDetail.tasks || []).filter((task) => task.trim()),
      };

      if (activeScopeId) {
        await setDoc(doc(db, "projectScopes", activeScopeId), payload, { merge: true });
        const updatedScopes = scopes.map((scope) =>
          scope.id === activeScopeId ? { ...scope, ...payload, id: activeScopeId } : scope
        );
        onScopesUpdated(project.jobKey, updatedScopes);
      } else {
        const docRef = await addDoc(collection(db, "projectScopes"), payload);
        const newScope: Scope = { id: docRef.id, ...payload };
        onScopesUpdated(project.jobKey, [...scopes, newScope]);
        setActiveScopeId(docRef.id);
      }

      alert("Scope saved successfully!");
    } catch (error) {
      console.error("Failed to save scope:", error);
      alert("Failed to save scope. Check console for details.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="text-lg font-bold text-gray-900">{project.projectName}</div>
            <div className="text-sm text-gray-500">{project.customer}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-xl font-bold"
          >
            ✕
          </button>
        </div>

        <div className="space-y-5">
          {/* Project Info Grid */}
          <div className="grid grid-cols-2 gap-4 text-sm bg-gray-50 p-4 rounded">
            <div>
              <span className="font-semibold text-gray-900">Project #:</span>
              <p className="text-gray-700 mt-1">{project.projectNumber || "—"}</p>
            </div>
            <div>
              <span className="font-semibold text-gray-900">Customer:</span>
              <p className="text-gray-700 mt-1">{project.customer || "—"}</p>
            </div>
            <div className="col-span-2">
              <span className="font-semibold text-gray-900">Job Key:</span>
              <p className="text-gray-700 mt-1">{project.jobKey || "—"}</p>
            </div>
          </div>

          {/* Scopes List */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Scopes</h3>
              <button
                type="button"
                onClick={() => setActiveScopeId(null)}
                className="text-xs font-semibold px-3 py-1.5 rounded-md border border-orange-300 text-orange-700 hover:bg-orange-50"
              >
                + Add Scope
              </button>
            </div>
            <div className="grid gap-2 max-h-40 overflow-y-auto">
              {scopes.length === 0 ? (
                <div className="text-sm text-gray-500">No scopes yet. Add the first one.</div>
              ) : (
                scopes.map((scope) => (
                  <button
                    key={scope.id}
                    type="button"
                    onClick={() => setActiveScopeId(scope.id)}
                    className={`text-left border rounded-md px-3 py-2 transition-colors ${
                      activeScopeId === scope.id
                        ? "border-orange-400 bg-orange-50"
                        : "border-gray-200 hover:border-orange-200"
                    }`}
                  >
                    <div className="text-sm font-semibold text-gray-900">
                      {scope.title || "Scope"}
                    </div>
                    <div className="text-xs text-gray-500">
                      {scope.startDate || "No start"} - {scope.endDate || "No end"}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Scope of Work Details */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Scope Details</h3>
              <span className="text-xs text-gray-500">
                {activeScopeId ? "Editing existing scope" : "New scope"}
              </span>
            </div>

            {/* Title */}
            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-900 mb-1">
                Scope Title
              </label>
              <input
                type="text"
                value={scopeDetail.title || ""}
                onChange={(e) =>
                  setScopeDetail((prev) => ({
                    ...prev,
                    title: e.target.value,
                  }))
                }
                placeholder="e.g., Demo, Framing, Trim, Punch List"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            {/* Start Date */}
            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-900 mb-1">
                Work Start Date
              </label>
              <input
                type="date"
                value={scopeDetail.startDate || ""}
                onChange={(e) =>
                  setScopeDetail((prev) => ({
                    ...prev,
                    startDate: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            {/* End Date */}
            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-900 mb-1">
                Work End Date
              </label>
              <input
                type="date"
                value={scopeDetail.endDate || ""}
                onChange={(e) =>
                  setScopeDetail((prev) => ({
                    ...prev,
                    endDate: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            {/* Manpower */}
            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-900 mb-1">
                Manpower (Number of Workers)
              </label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={scopeDetail.manpower ?? ""}
                onChange={(e) =>
                  setScopeDetail((prev) => ({
                    ...prev,
                    manpower: e.target.value ? parseFloat(e.target.value) : undefined,
                  }))
                }
                placeholder="e.g., 3, 4.5, 8"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              {activeScopeId && (() => {
                const scope = scopes.find((s) => s.id === activeScopeId);
                const hoursValue = typeof scope?.hours === "number" ? scope.hours : null;
                return (
                  <div className="mt-2 text-sm text-gray-600">
                    Total Hours: <span className="font-semibold">{hoursValue !== null ? `${hoursValue.toFixed(1)} hours` : "—"}</span>
                  </div>
                );
              })()}
            </div>

            {/* Description */}
            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-900 mb-1">
                Description of Work
              </label>
              <textarea
                value={scopeDetail.description || ""}
                onChange={(e) =>
                  setScopeDetail((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder="Describe the scope of work, materials, and any special requirements..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                rows={4}
              />
            </div>

            {/* Tasks List */}
            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                Work Tasks/Items
              </label>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={newTask}
                  onChange={(e) => setNewTask(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === "Enter") {
                      handleAddTask();
                    }
                  }}
                  placeholder="Add a task or item..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <button
                  type="button"
                  onClick={handleAddTask}
                  className="px-4 py-2 bg-gray-200 text-gray-900 rounded-md text-sm font-semibold hover:bg-gray-300"
                >
                  Add
                </button>
              </div>

              {scopeDetail.tasks && scopeDetail.tasks.length > 0 && (
                <div className="space-y-2 bg-gray-50 p-3 rounded">
                  {scopeDetail.tasks.map((task, index) => (
                    <div
                      key={index}
                      className="flex items-start justify-between gap-2 bg-white p-2 rounded border border-gray-200"
                    >
                      <div className="text-sm text-gray-900 flex-1">{task}</div>
                      <button
                        type="button"
                        onClick={() => handleRemoveTask(index)}
                        className="text-red-500 hover:text-red-700 font-bold"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-4 border-t">
            <button
              type="button"
              onClick={handleSaveScope}
              disabled={isSaving}
              className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-md text-sm font-semibold hover:bg-orange-700 disabled:bg-gray-400"
            >
              {isSaving ? "Saving..." : "Save Scope of Work"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-900 rounded-md text-sm font-semibold hover:bg-gray-300"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
