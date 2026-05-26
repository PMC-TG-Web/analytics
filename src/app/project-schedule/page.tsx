"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProjectScopesModal } from "@/app/project-schedule/components/ProjectScopesModal";
import { ProjectInfo, Scope, ScheduleTask } from "@/types";

type ProjectRow = {
  id: string;
  jobKey?: string | null;
  projectName: string;
  customer: string | null;
  projectNumber: string | null;
  status: string | null;
  scopeCount: number;
  scopedHours: number;
  startDate: string | null;
  endDate: string | null;
  scopes?: ScopeRow[];
  scheduleAllocations?: Array<{ period: string; hours: number }>;
};

type ScopeRow = {
  id: string;
  projectId: string;
  predecessorScopeId: string | null;
  title: string;
  startDate: string | null;
  endDate: string | null;
  totalHours: number;
  crewSize: number | null;
  notes: string | null;
  tasks?: Array<string | ScheduleTask>;
  color?: string; // Hex color code for scope
  taskColors?: Record<string, string>; // Map of task names to color codes
  schedulingMode?: "contiguous" | "specific-days";
  selectedDays?: Array<{ date: string; hours: number; foreman?: string | null }>;
  metadataBacked?: boolean;
  scheduledHours: number;
  remainingHours: number;
};

type ConcreteOrderSummary = {
  jobKey: string;
  date: string;
  totalYards: number;
};

const asDate = (value: string | null) => {
  if (!value) return null;
  // Parse YYYY-MM-DD as local date to avoid UTC timezone shifts (e.g. Apr 1 displaying in Mar)
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const buildProjectJobKey = (project: Pick<ProjectRow, "customer" | "projectNumber" | "projectName" | "jobKey">) =>
  String(project.jobKey || "").trim() || `${project.customer || ""}~${project.projectNumber || ""}~${project.projectName || ""}`;

const isDateKey = (value: string | null | undefined): value is string =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());

const normalizeStatusKey = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const formatStatusLabel = (value: string) =>
  value
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const summarizeProjectScopes = (project: ProjectRow, scopes: Scope[]): ProjectRow => {
  const previousScopeMetrics = new Map(
    (project.scopes || []).map((scope) => [
      scope.id,
      {
        scheduledHours: Number(scope.scheduledHours || 0),
      },
    ])
  );

  const nextScopes: ScopeRow[] = scopes.map((scope) => {
    const scheduledHours = previousScopeMetrics.get(scope.id)?.scheduledHours || 0;
    const totalHours = Number(scope.hours || 0);

    return {
      id: scope.id,
      projectId: project.id,
      predecessorScopeId: scope.predecessorScopeId || null,
      title: scope.title || "Scope",
      startDate: scope.startDate || null,
      endDate: scope.endDate || null,
      totalHours: Number.isFinite(totalHours) ? totalHours : 0,
      crewSize: scope.manpower ?? null,
      notes: scope.description || null,
      tasks: Array.isArray(scope.tasks) ? scope.tasks : [],
      color: scope.color,
      taskColors: scope.taskColors,
      scheduledHours,
      remainingHours: Math.max((Number.isFinite(totalHours) ? totalHours : 0) - scheduledHours, 0),
    };
  });

  const startDates = nextScopes
    .map((scope) => scope.startDate)
    .filter(isDateKey)
    .sort();
  const endDates = nextScopes
    .map((scope) => scope.endDate)
    .filter(isDateKey)
    .sort();

  return {
    ...project,
    scopes: nextScopes,
    scopeCount: nextScopes.length,
    scopedHours: nextScopes.reduce((sum, scope) => sum + Number(scope.totalHours || 0), 0),
    startDate: startDates[0] || null,
    endDate: endDates[endDates.length - 1] || null,
  };
};

const SCOPE_LINE_COLOR = "#6B7280"; // mid gray
const TASK_LINE_COLOR = "#EA580C"; // orange

const lightenColor = (hex: string, percent: number): string => {
  // Lighten a hex color by a percentage for hover states
  const num = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.min(255, (num >> 16) + amt);
  const G = Math.min(255, (num >> 8 & 0x00FF) + amt);
  const B = Math.min(255, (num & 0x0000FF) + amt);
  return "#" + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
};

const toNonNegativeNumber = (value: unknown): number | null => {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric;
};

const hydrateTaskYards = (
  tasks: Array<string | ScheduleTask> | undefined,
  yardsByDate: Record<string, number>,
): Array<string | ScheduleTask> => {
  if (!Array.isArray(tasks)) return [];

  return tasks.map((task) => {
    if (!task || typeof task !== "object" || Array.isArray(task)) return task;

    const existingYards = toNonNegativeNumber(task.yards);
    if (existingYards !== null && existingYards > 0) return task;

    const dateKey = String(task.startDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return task;

    const hydratedYards = toNonNegativeNumber(yardsByDate[dateKey]);
    if (hydratedYards === null || hydratedYards <= 0) return task;

    return {
      ...task,
      yards: hydratedYards,
    };
  });
};

export default function ProjectSchedulePage() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("in progress");
  const [selectedProject, setSelectedProject] = useState<ProjectRow | null>(null);
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);
  const [selectedTaskIndex, setSelectedTaskIndex] = useState<number | null>(null);
  const [dayHoursEditor, setDayHoursEditor] = useState<{
    projectId: string;
    scopeId: string;
    taskIndex: number | null;
    scopeTitle: string;
    dateKey: string;
    dateLabel: string;
    hours: number;
    saving: boolean;
    anchorX: number;
    anchorY: number;
  } | null>(null);
  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("day");
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [expandedScopes, setExpandedScopes] = useState<Set<string>>(new Set());
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [deletingProjectIds, setDeletingProjectIds] = useState<Set<string>>(new Set());

  const [newProject, setNewProject] = useState({
    projectName: "",
    customer: "",
    projectNumber: "",
    status: "In Progress",
  });
  const topScrollbarRef = useRef<HTMLDivElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const isSyncingScrollRef = useRef<"top" | "table" | null>(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);

  const openProjectScopesModal = (project: ProjectRow, scopeId: string | null = null, taskIndex: number | null = null) => {
    setSelectedTaskIndex(taskIndex);
    setSelectedScopeId(scopeId);
    setSelectedProject(project);
  };

  const handleScopesUpdated = useCallback((jobKey: string, updatedScopes: Scope[]) => {
    let updatedProject: ProjectRow | null = null;

    setProjects((currentProjects) =>
      currentProjects.map((project) => {
        const matchesSelectedProject = selectedProject ? project.id === selectedProject.id : false;
        const matchesJobKey = !selectedProject && buildProjectJobKey(project) === jobKey;

        if (!matchesSelectedProject && !matchesJobKey) {
          return project;
        }

        updatedProject = summarizeProjectScopes(project, updatedScopes);
        return updatedProject;
      })
    );

    if (updatedProject) {
      setSelectedProject(updatedProject);
    }
  }, [selectedProject]);

  const toggleProjectCollapse = (projectId: string) => {
    const newCollapsed = new Set(collapsedProjects);
    if (newCollapsed.has(projectId)) {
      newCollapsed.delete(projectId);
    } else {
      newCollapsed.add(projectId);
    }
    setCollapsedProjects(newCollapsed);
  };

  const toggleScopeExpand = (scopeId: string) => {
    const newExpanded = new Set(expandedScopes);
    if (newExpanded.has(scopeId)) {
      newExpanded.delete(scopeId);
    } else {
      newExpanded.add(scopeId);
    }
    setExpandedScopes(newExpanded);
  };

  const parseTaskMetadata = (taskEntry: string | { name?: string; startDate?: string; days?: number | null; yards?: number | null; concreteConfirmed?: boolean }) => {
    if (taskEntry && typeof taskEntry === 'object' && !Array.isArray(taskEntry)) {
      const taskName = String(taskEntry.name || '').trim();
      const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(taskEntry.startDate || '').trim())
        ? String(taskEntry.startDate || '').trim()
        : null;
      const daysRaw = Number(taskEntry.days || 0);
      const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.round(daysRaw) : 0;
      const yardsRaw = Number(taskEntry.yards);
      const yards = Number.isFinite(yardsRaw) && yardsRaw >= 0 ? yardsRaw : 0;
      const concreteConfirmed = Boolean(taskEntry.concreteConfirmed);
      return { taskName: taskName || 'Task', startDate, days, yards, concreteConfirmed };
    }

    const taskString = String(taskEntry || '');
    // Extract metadata from format: "[YYYY-MM-DD | Nd] Task Name"
    const match = taskString.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (!match) {
      return { taskName: taskString, startDate: null, days: 0 };
    }
    const metadata = match[1];
    const taskName = match[2];
    const parts = metadata.split('|').map(p => p.trim());
    const startDate = parts[0] || null;
    const daysMatch = parts[1]?.match(/^(\d+)d?$/);
    const days = daysMatch ? parseInt(daysMatch[1]) : 0;
    const yardsPart = parts.find((part, idx) => idx > 1 && /(\d+(?:\.\d+)?)/.test(part));
    const yardsMatch = yardsPart?.match(/(\d+(?:\.\d+)?)/);
    const yards = yardsMatch ? Number.parseFloat(yardsMatch[1]) : 0;
    return {
      taskName,
      startDate,
      days,
      yards: Number.isFinite(yards) && yards >= 0 ? yards : 0,
      concreteConfirmed: false,
    };
  };

  const updateTableScrollWidth = useCallback(() => {
    if (!tableScrollRef.current) return;
    setTableScrollWidth(tableScrollRef.current.scrollWidth);
  }, []);

  const handleTopScrollbarScroll = () => {
    if (!topScrollbarRef.current || !tableScrollRef.current) return;
    if (isSyncingScrollRef.current === "table") return;

    isSyncingScrollRef.current = "top";
    tableScrollRef.current.scrollLeft = topScrollbarRef.current.scrollLeft;
    requestAnimationFrame(() => {
      isSyncingScrollRef.current = null;
    });
  };

  const handleTableScroll = () => {
    if (!topScrollbarRef.current || !tableScrollRef.current) return;
    if (isSyncingScrollRef.current === "top") return;

    isSyncingScrollRef.current = "table";
    topScrollbarRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
    requestAnimationFrame(() => {
      isSyncingScrollRef.current = null;
    });
  };

  // Generate timeline based on view mode
  const timeline = useMemo(() => {
    // For month view, start from the first of the current month
    // For day/week views, start from the Monday of the current week
    const base = new Date();
    base.setHours(0, 0, 0, 0);

    if (viewMode === "day") {
      // Start from Monday of the current week, show 60 days forward
      const d = new Date(base);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
      
      const days: Date[] = [];
      for (let i = 0; i < 60; i++) {
        const dayDate = new Date(d);
        dayDate.setDate(dayDate.getDate() + i);
        days.push(dayDate);
      }
      return days;
    } else if (viewMode === "week") {
      // Start from Monday of the current week, show next 20 weeks
      const d = new Date(base);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
      
      const weeks: Date[] = [];
      for (let i = 0; i < 20; i++) {
        weeks.push(new Date(d));
        d.setDate(d.getDate() + 7);
      }
      return weeks;
    } else {
      // Month view: 10 months starting from the current month
      base.setDate(1);
      const months: Date[] = [];
      for (let i = 0; i < 10; i++) {
        months.push(new Date(base.getFullYear(), base.getMonth() + i, 1));
      }
      return months;
    }
  }, [viewMode]);

  const getTimelineLabel = (date: Date) => {
    if (viewMode === "day") {
      return date.toLocaleString("en-US", { month: "short", day: "numeric" });
    } else if (viewMode === "week") {
      const end = new Date(date);
      end.setDate(end.getDate() + 6);
      return `${date.getDate()}-${end.getDate()}`;
    } else {
      return date.toLocaleString("en-US", { month: "short", year: "2-digit" });
    }
  };

  const getColumnWidth = () => {
    if (viewMode === "day") return "minmax(40px, 1fr)";
    if (viewMode === "week") return "minmax(60px, 1fr)";
    return "minmax(80px, 1fr)";
  };

  const trailingColumns = viewMode === "day" ? 14 : viewMode === "week" ? 8 : 4;
  const totalTimelineColumns = timeline.length + trailingColumns;

  const getPositionAndWidth = (start: Date | null, end: Date | null) => {
    if (!start || !end || start > end) return { startIdx: -1, endIdx: -1 };

    const timelineStart = timeline[0];

    if (viewMode === "day") {
      // Days
      const startIdx = Math.max(
        0,
        Math.floor((start.getTime() - timelineStart.getTime()) / (24 * 60 * 60 * 1000))
      );
      const endIdx = Math.min(
        timeline.length - 1,
        Math.floor((end.getTime() - timelineStart.getTime()) / (24 * 60 * 60 * 1000))
      );
      return { startIdx, endIdx };
    } else if (viewMode === "week") {
      // Weeks
      const startIdx = Math.max(
        0,
        Math.floor((start.getTime() - timelineStart.getTime()) / (7 * 24 * 60 * 60 * 1000))
      );
      const endIdx = Math.min(
        timeline.length - 1,
        Math.floor((end.getTime() - timelineStart.getTime()) / (7 * 24 * 60 * 60 * 1000))
      );
      return { startIdx, endIdx };
    } else {
      // Months
      const startIdx = Math.max(
        0,
        (start.getFullYear() - timelineStart.getFullYear()) * 12 + (start.getMonth() - timelineStart.getMonth())
      );
      const endIdx = Math.min(
        timeline.length - 1,
        (end.getFullYear() - timelineStart.getFullYear()) * 12 + (end.getMonth() - timelineStart.getMonth())
      );
      return { startIdx, endIdx };
    }
  };

  const getAllocationTimelineIndex = (period: string) => {
    const [year, month] = period.split("-");
    const parsedYear = Number(year);
    const parsedMonth = Number(month);
    if (!parsedYear || !parsedMonth) return -1;

    const allocDate = new Date(parsedYear, parsedMonth - 1, 1);
    allocDate.setHours(0, 0, 0, 0);

    if (viewMode === "month") {
      return timeline.findIndex(
        (t) => t.getFullYear() === allocDate.getFullYear() && t.getMonth() === allocDate.getMonth()
      );
    }

    if (viewMode === "week") {
      return timeline.findIndex((t) => {
        const weekEnd = new Date(t);
        weekEnd.setDate(weekEnd.getDate() + 6);
        return allocDate >= t && allocDate <= weekEnd;
      });
    }

    const exactIdx = timeline.findIndex((t) => t.getTime() === allocDate.getTime());
    if (exactIdx !== -1) return exactIdx;
    return timeline.findIndex((t) => t >= allocDate);
  };

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [ganttRes, metadataRes, concreteOrdersRes] = await Promise.all([
        fetch("/api/gantt-v2/projects?refresh=1", { cache: "no-store", credentials: "include" }),
        fetch("/api/project-scopes", { cache: "no-store", credentials: "include" }),
        fetch("/api/project-schedule/concrete-yards", { cache: "no-store", credentials: "include" }),
      ]);

      const parseSafeJson = async (response: Response) => {
        return response.json().catch(() => ({ success: false }));
      };

      const json = await parseSafeJson(ganttRes);
      const metadataJson = metadataRes.ok ? await parseSafeJson(metadataRes) : { success: false, data: [] };
      const concreteOrdersJson = concreteOrdersRes.ok ? await parseSafeJson(concreteOrdersRes) : { success: false, data: [] };

      if (!ganttRes.ok || !json?.success) {
        const status = ganttRes.status;
        const message =
          status === 401
            ? "Not authenticated. Refresh or sign in again."
            : status === 403
            ? "No permission to load Project Gantt on this account."
            : (json?.error || `Failed to load projects (HTTP ${status || "unknown"}).`);
        throw new Error(message);
      }

      const projectsData: ProjectRow[] = json?.data || [];
      const metadataScopes: Array<{
        id?: string;
        jobKey?: string;
        title?: string;
        startDate?: string | null;
        endDate?: string | null;
        manpower?: number | null;
        hours?: number | null;
        description?: string | null;
        color?: string | null;
        taskColors?: Record<string, string> | null;
        tasks?: Array<string | ScheduleTask>;
        schedulingMode?: 'contiguous' | 'specific-days' | null;
        selectedDays?: Array<{ date: string; hours: number; foreman?: string | null }> | null;
      }> = Array.isArray(metadataJson?.data) ? metadataJson.data : [];
      const concreteOrders: ConcreteOrderSummary[] = Array.isArray(concreteOrdersJson?.data) ? concreteOrdersJson.data : [];

      const normalized = (value: unknown) =>
        String(value || "")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();
      const isGeneratedMappedMetadata = (value: unknown) =>
        String(value || "").trim().toLowerCase().startsWith("mapped from:");

      const metadataByJobKey = new Map<string, typeof metadataScopes>();
      metadataScopes.forEach((scope) => {
        const key = String(scope.jobKey || "").trim();
        if (!key) return;
        const bucket = metadataByJobKey.get(key) || [];
        bucket.push(scope);
        metadataByJobKey.set(key, bucket);
      });

      const concreteYardsByJobKey = new Map<string, Record<string, number>>();
      concreteOrders.forEach((order) => {
        const jobKey = String(order?.jobKey || "").trim();
        const dateKey = String(order?.date || "").trim();
        const totalYards = toNonNegativeNumber(order?.totalYards);
        if (!jobKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || totalYards === null || totalYards <= 0) return;

        const current = concreteYardsByJobKey.get(jobKey) || {};
        current[dateKey] = (current[dateKey] || 0) + totalYards;
        concreteYardsByJobKey.set(jobKey, current);
      });

      const mergedProjects = projectsData.map((project) => {
        const jobKey = buildProjectJobKey(project);
        const metadataForProject = metadataByJobKey.get(jobKey) || [];
        const yardsByDate = concreteYardsByJobKey.get(jobKey) || {};

        const mergedScopes = (project.scopes || []).map((scope) => {
          const titleKey = normalized(scope.title);
          const startKey = String(scope.startDate || "").trim();
          const endKey = String(scope.endDate || "").trim();

          const exact = metadataForProject.find((meta) =>
            normalized(meta.title) === titleKey &&
            String(meta.startDate || "").trim() === startKey &&
            String(meta.endDate || "").trim() === endKey
          );

          const fallback = metadataForProject.find((meta) => normalized(meta.title) === titleKey);
          const matched = exact || fallback;
          const matchedSelectedDays = Array.isArray(matched?.selectedDays)
            ? matched.selectedDays.map((entry: any) => ({
                date: String(entry?.date || ''),
                hours: Number(entry?.hours || 0),
                foreman: entry?.foreman || null,
              }))
            : [];
          const matchedIsGeneratedRollup = isGeneratedMappedMetadata(matched?.description);
          const shouldUseMatchedMetadata = Boolean(matched) && (!matchedIsGeneratedRollup || matchedSelectedDays.length > 0);
          const shouldUseMatchedTotals = Boolean(matched) && !matchedIsGeneratedRollup;
          const matchedHours = shouldUseMatchedTotals ? Number(matched?.hours) : Number.NaN;
          const matchedManpower = shouldUseMatchedTotals ? Number(matched?.manpower) : Number.NaN;

          const scopeSchedulingMode: "contiguous" | "specific-days" =
            shouldUseMatchedMetadata && matched?.schedulingMode === 'specific-days'
              ? 'specific-days'
              : scope.schedulingMode === 'specific-days'
                ? 'specific-days'
                : 'contiguous';
          const scopeSelectedDays: Array<{ date: string; hours: number; foreman?: string | null }> =
            shouldUseMatchedMetadata && matchedSelectedDays.length > 0
              ? matchedSelectedDays
              : Array.isArray(scope.selectedDays)
                ? scope.selectedDays.map((entry: any) => ({
                  date: String(entry?.date || ''),
                  hours: Number(entry?.hours || 0),
                  foreman: entry?.foreman || null,
                }))
                : [];

          // IMPORTANT: If matched has an id (from ProjectScope table), use that for saving.
          // The gantt_v2 scope ID is different from the ProjectScope ID.
          const effectiveId = shouldUseMatchedMetadata ? (matched?.id || scope.id) : scope.id;
          console.log('[loadProjects] Scope IDs:', { 
            ganttId: scope.id, 
            projectScopeId: matched?.id, 
            using: effectiveId,
            title: scope.title 
          });

          return {
            ...scope,
            id: effectiveId,  // Use ProjectScope ID if available, for save operations
            metadataBacked: shouldUseMatchedMetadata,
            startDate:
              shouldUseMatchedTotals && typeof matched?.startDate === "string" && matched.startDate.trim().length > 0
                ? matched.startDate
                : scope.startDate,
            endDate:
              shouldUseMatchedTotals && typeof matched?.endDate === "string" && matched.endDate.trim().length > 0
                ? matched.endDate
                : scope.endDate,
            totalHours:
              Number.isFinite(matchedHours) && matchedHours >= 0
                ? matchedHours
                : Number(scope.totalHours || 0),
            crewSize:
              Number.isFinite(matchedManpower) && matchedManpower >= 0
                ? matchedManpower
                : scope.crewSize,
            notes:
              shouldUseMatchedTotals && typeof matched?.description === "string" && matched.description.trim().length > 0
                ? matched.description
                : scope.notes,
            color:
              typeof matched?.color === "string" && matched.color.trim().length > 0
                ? matched.color
                : scope.color,
            taskColors:
              matched?.taskColors && typeof matched.taskColors === "object"
                ? matched.taskColors
                : scope.taskColors,
            schedulingMode: scopeSchedulingMode,
            selectedDays: scopeSelectedDays,
            tasks: hydrateTaskYards(Array.isArray(matched?.tasks) ? matched!.tasks : (scope.tasks || []), yardsByDate),
          };
        });

        return {
          ...project,
          scopes: mergedScopes,
        };
      });

      setProjects(mergedProjects);
      // Collapse all projects by default
      setCollapsedProjects(new Set(mergedProjects.map((p: ProjectRow) => p.id)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load projects.";
      setLoadError(message);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    updateTableScrollWidth();

    const onResize = () => updateTableScrollWidth();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updateTableScrollWidth, timeline.length, viewMode, loading, projects.length]);

  const openDayHoursEditor = useCallback((
    event: React.MouseEvent<HTMLDivElement>,
    project: ProjectRow,
    scope: ScopeRow,
    startIdx: number,
    endIdx: number,
    taskIndex: number | null = null,
    label?: string,
  ) => {
    if (viewMode !== "day" || startIdx < 0 || endIdx < startIdx) return;

    const coveredColumns = endIdx - startIdx + 1;
    const barWidth = event.currentTarget.getBoundingClientRect().width;
    const columnWidth = coveredColumns > 0 ? barWidth / coveredColumns : barWidth;
    const clickedOffset = Math.max(0, Math.min(event.nativeEvent.offsetX, Math.max(barWidth - 1, 0)));
    const relativeIdx = Math.min(coveredColumns - 1, Math.floor(clickedOffset / Math.max(columnWidth, 1)));
    const timelineIdx = startIdx + relativeIdx;
    const clickedDate = timeline[timelineIdx];
    if (!clickedDate) return;

    const dateKey = formatDateKey(clickedDate);
    const dateLabel = clickedDate.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    console.log('[openDayHoursEditor] Opening editor for:', { projectId: project.id, scopeId: scope.id, scopeTitle: scope.title, dateKey });

    let currentHours = 0;
    const matchedSelectedDay = Array.isArray(scope.selectedDays)
      ? scope.selectedDays.find((entry) => entry.date === dateKey)
      : null;
    if (matchedSelectedDay) {
      currentHours = Number(matchedSelectedDay.hours || 0);
    } else {
      const scopeStart = asDate(scope.startDate);
      const scopeEnd = asDate(scope.endDate);
      const isWithinRange = scopeStart && scopeEnd && clickedDate >= scopeStart && clickedDate <= scopeEnd;
      if (isWithinRange && scope.totalHours > 0) {
        const durationDays = Math.max(1, Math.floor((scopeEnd.getTime() - scopeStart.getTime()) / 86400000) + 1);
        currentHours = Math.round((scope.totalHours / durationDays) * 10) / 10;
      }
    }

    setDayHoursEditor({
      projectId: project.id,
      scopeId: scope.id,
      taskIndex,
      scopeTitle: label || scope.title,
      dateKey,
      dateLabel,
      hours: currentHours,
      saving: false,
      anchorX: Math.min(event.clientX, window.innerWidth - 240),
      anchorY: Math.min(event.clientY + 12, window.innerHeight - 220),
    });
  }, [timeline, viewMode]);

  const saveDayHoursEditor = useCallback(async () => {
    if (!dayHoursEditor) return;

    const project = projects.find((entry) => entry.id === dayHoursEditor.projectId);
    const scope = project?.scopes?.find((entry) => entry.id === dayHoursEditor.scopeId);
    if (!project || !scope) {
      alert("Could not find the selected scope.");
      return;
    }

    setDayHoursEditor((current) => (current ? { ...current, saving: true } : null));

    try {
      const existingSelectedDays = Array.isArray(scope.selectedDays)
        ? [...scope.selectedDays]
        : [];
      const otherDays = existingSelectedDays.filter((entry) => entry.date !== dayHoursEditor.dateKey);
      const nextSelectedDays = dayHoursEditor.hours > 0
        ? [...otherDays, { date: dayHoursEditor.dateKey, hours: dayHoursEditor.hours }].sort((a, b) => a.date.localeCompare(b.date))
        : otherDays;

      const requestPayload = {
        id: scope.id,
        jobKey: buildProjectJobKey(project),
        title: scope.title,
        startDate: scope.startDate,
        endDate: scope.endDate,
        manpower: scope.crewSize,
        description: scope.notes,
        tasks: Array.isArray(scope.tasks) ? scope.tasks : [],
        ...(scope.metadataBacked ? { hours: scope.totalHours } : {}),
        schedulingMode: "specific-days",
        selectedDays: nextSelectedDays,
        allowWeekendSelectedDays: true,
        syncToActiveSchedule: false,
      };

      console.log('[Client] Sending day hours save request:', requestPayload);

      const response = await fetch("/api/project-scopes", {
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });

      const result = await response.json().catch((e) => {
        console.error('[Client] Failed to parse JSON response:', e);
        return {};
      });

      console.log('[Client] API Response:', { status: response.status, ok: response.ok, result });

      if (!response.ok || !result?.success) {
        const errorMsg = result?.error || `Failed to save day hours (HTTP ${response.status})`;
        console.error('[Client] Save failed:', errorMsg);
        throw new Error(errorMsg);
      }

      console.log('[Client] Save successful, reloading projects');
      setDayHoursEditor(null);
      await loadProjects();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Client] Error in saveDayHoursEditor:', message);
      alert(`Failed to save day hours:\n\n${message}\n\nCheck browser console for more details.`);
      setDayHoursEditor((current) => (current ? { ...current, saving: false } : null));
    }
  }, [dayHoursEditor, loadProjects, projects]);

  const deleteProject = async (projectId: string, projectName: string) => {
    if (deletingProjectIds.has(projectId)) return;
    if (!window.confirm(`Delete project "${projectName}" and all its scopes? This cannot be undone.`)) return;
    setDeletingProjectIds((current) => new Set(current).add(projectId));
    try {
      const res = await fetch(`/api/gantt-v2/projects/${projectId}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok || !result?.success) {
        alert(`Failed to delete project: ${result?.error || 'Unknown error'}`);
        return;
      }

      // Optimistic UI update so users do not need a manual refresh.
      setProjects((current) => current.filter((project) => project.id !== projectId));
      setCollapsedProjects((current) => {
        const next = new Set(current);
        next.delete(projectId);
        return next;
      });
      setSelectedProject((current) => (current?.id === projectId ? null : current));

      // Reconcile with server state in the background.
      void loadProjects();
    } finally {
      setDeletingProjectIds((current) => {
        const next = new Set(current);
        next.delete(projectId);
        return next;
      });
    }
  };

  const addProject = async () => {
    if (isCreatingProject) return;
    if (!newProject.projectName.trim()) return;

    setIsCreatingProject(true);
    try {
      const response = await fetch("/api/gantt-v2/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newProject),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.success) {
        alert(`Failed to create project: ${result?.error || 'Unknown error'}`);
        return;
      }

      setNewProject({ projectName: "", customer: "", projectNumber: "", status: "In Progress" });
      await loadProjects();
    } finally {
      setIsCreatingProject(false);
    }
  };

  const filteredProjects = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const normalizedStatusFilter = normalizeStatusKey(statusFilter);

    const statusFilteredProjects = projects.filter((project) => {
      if (!normalizedStatusFilter || normalizedStatusFilter === "all") return true;
      return normalizeStatusKey(project.status) === normalizedStatusFilter;
    });

    if (!normalizedSearch) return statusFilteredProjects;

    return statusFilteredProjects
      .map((project) => {
        const projectName = (project.projectName || "").toLowerCase();
        const customer = (project.customer || "").toLowerCase();
        const projectNumber = (project.projectNumber || "").toLowerCase();
        const projectMatches =
          projectName.includes(normalizedSearch) ||
          customer.includes(normalizedSearch) ||
          projectNumber.includes(normalizedSearch);

        if (projectMatches) return project;

        const matchedScopes = (project.scopes || []).filter((scope) =>
          (scope.title || "").toLowerCase().includes(normalizedSearch)
        );

        if (matchedScopes.length === 0) return null;
        return { ...project, scopes: matchedScopes };
      })
      .filter((project): project is ProjectRow => project !== null);
  }, [projects, searchTerm, statusFilter]);

  const statusOptions = useMemo(() => {
    const options = new Map<string, string>();
    options.set("all", "All Statuses");
    options.set("in progress", "In Progress");

    projects.forEach((project) => {
      const key = normalizeStatusKey(project.status);
      if (!key || options.has(key)) return;
      options.set(key, formatStatusLabel(key));
    });

    return Array.from(options.entries()).map(([value, label]) => ({ value, label }));
  }, [projects]);

  const selectedProjectInfo = useMemo<ProjectInfo | null>(() => {
    if (!selectedProject) return null;
    return {
      jobKey: buildProjectJobKey(selectedProject),
      customer: selectedProject.customer || "",
      projectNumber: selectedProject.projectNumber || "",
      projectName: selectedProject.projectName || "",
      projectDocId: selectedProject.id,
    };
  }, [selectedProject]);

  const selectedProjectScopes = useMemo<Scope[]>(() => {
    if (!selectedProject?.scopes) return [];
    return selectedProject.scopes.map((scope) => ({
      id: scope.id,
      predecessorScopeId: scope.predecessorScopeId || null,
      jobKey: buildProjectJobKey(selectedProject),
      title: scope.title,
      startDate: scope.startDate || "",
      endDate: scope.endDate || "",
      manpower: scope.crewSize ?? undefined,
      description: scope.notes || "",
      tasks: Array.isArray(scope.tasks) ? scope.tasks : [],
      hours: Number(scope.totalHours || 0),
      color: scope.color || undefined,
      taskColors: (scope.taskColors && typeof scope.taskColors === 'object' ? scope.taskColors as Record<string, string> : undefined),
      schedulingMode: scope.schedulingMode === 'specific-days' ? 'specific-days' : 'contiguous',
      selectedDays: Array.isArray(scope.selectedDays) ? scope.selectedDays : [],
    }));
  }, [selectedProject]);

  return (
    <main className="min-h-screen bg-neutral-100 p-3 md:p-4 font-sans text-slate-900">
      <div className="w-full bg-white rounded-2xl border border-gray-200 shadow-sm p-4 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-100 pb-4 mb-4">
          <div>
            <p className="text-xs font-semibold text-gray-500">Project scope timeline and scheduling view</p>
          </div>
          <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center">
            <div className="w-full md:w-[180px]">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 focus:ring-1 focus:ring-orange-500 focus:border-orange-500 outline-none bg-white"
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-full md:w-[360px]">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search project, customer, number, or scope"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:ring-orange-500 focus:border-orange-500 outline-none"
            />
            </div>
          </div>
        </div>

        {/* View Mode Toggle */}
        <div className="flex gap-2 mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <button
            onClick={() => setViewMode("day")}
            className={`px-4 py-2 text-sm font-semibold rounded transition ${
              viewMode === "day"
                ? "bg-orange-600 text-white"
                : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-100"
            }`}
          >
            Day View
          </button>
          <button
            onClick={() => setViewMode("week")}
            className={`px-4 py-2 text-sm font-semibold rounded transition ${
              viewMode === "week"
                ? "bg-orange-600 text-white"
                : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-100"
            }`}
          >
            Week View
          </button>
          <button
            onClick={() => setViewMode("month")}
            className={`px-4 py-2 text-sm font-semibold rounded transition ${
              viewMode === "month"
                ? "bg-orange-600 text-white"
                : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-100"
            }`}
          >
            Month View
          </button>
        </div>

        <div className="border border-gray-200 rounded-lg p-3 mb-4">
          <div className="text-sm font-semibold text-gray-800 mb-2">Add Project</div>
          <div className="grid md:grid-cols-5 gap-2">
            <input className="border rounded px-3 py-2 text-sm" placeholder="Project Name" value={newProject.projectName} onChange={(e) => setNewProject((p) => ({ ...p, projectName: e.target.value }))} />
            <input className="border rounded px-3 py-2 text-sm" placeholder="Customer" value={newProject.customer} onChange={(e) => setNewProject((p) => ({ ...p, customer: e.target.value }))} />
            <input className="border rounded px-3 py-2 text-sm" placeholder="Project #" value={newProject.projectNumber} onChange={(e) => setNewProject((p) => ({ ...p, projectNumber: e.target.value }))} />
            <input className="border rounded px-3 py-2 text-sm" placeholder="Status" value={newProject.status} onChange={(e) => setNewProject((p) => ({ ...p, status: e.target.value }))} />
            <button
              onClick={addProject}
              disabled={isCreatingProject}
              className="rounded bg-orange-600 hover:bg-orange-700 disabled:bg-orange-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-3 py-2"
            >
              {isCreatingProject ? "Creating..." : "Create"}
            </button>
          </div>
        </div>

        <div className="mb-3 text-xs text-gray-500">
          Projects are collapsed by default. Click the chevron next to a project name to show scope bars.
        </div>

        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div
            ref={topScrollbarRef}
            onScroll={handleTopScrollbarScroll}
            className="overflow-x-auto overflow-y-hidden border-b border-gray-200 bg-gray-50"
          >
            <div
              style={{
                width: tableScrollWidth > 0 ? `${tableScrollWidth}px` : "100%",
                height: "14px",
              }}
            />
          </div>

          <div ref={tableScrollRef} onScroll={handleTableScroll} className="overflow-x-auto">
            <div className="min-w-max">
              <div className="grid" style={{ gridTemplateColumns: `320px repeat(${totalTimelineColumns}, ${getColumnWidth()})` }}>
            <div className="sticky left-0 z-30 bg-gray-50 border-r border-b border-gray-200 px-3 py-2 text-xs font-bold uppercase text-gray-500">Project</div>
            {timeline.map((t) => (
              <div key={t.toISOString()} className="border-b border-r border-gray-200 px-2 py-2 text-xs font-bold text-gray-500 text-center">
                {getTimelineLabel(t)}
              </div>
            ))}
            {Array.from({ length: trailingColumns }).map((_, idx) => (
              <div key={`trailing-${idx}`} className="border-b border-r border-gray-200 px-2 py-2" />
            ))}
              </div>

              {loading ? (
                <div className="p-4 text-sm text-gray-500">Loading...</div>
              ) : loadError ? (
                <div className="p-4 text-sm text-red-600">
                  {loadError}
                </div>
              ) : filteredProjects.length === 0 ? (
                <div className="p-4 text-sm text-gray-500">
                  {searchTerm.trim()
                    ? "No projects match your search and status filter."
                    : statusFilter !== "all"
                    ? "No projects match the selected status filter."
                    : "No projects yet."}
                </div>
              ) : (
                filteredProjects.map((project) => {
              const scopes = project.scopes || [];
              const isCollapsed = collapsedProjects.has(project.id);
              const projectAllocations = project.scheduleAllocations || [];
              const visibleScopeHours = scopes.reduce((sum, scope) => sum + Number(scope.totalHours || 0), 0);
              const projectTotalHours =
                scopes.length > 0
                  ? visibleScopeHours
                  : projectAllocations.reduce((sum, alloc) => sum + Number(alloc.hours || 0), 0);
              return (
                <React.Fragment key={project.id}>
                  {/* Project header row */}
                  <div className="grid border-t border-gray-100 bg-gray-50" style={{ gridTemplateColumns: `320px repeat(${totalTimelineColumns}, ${getColumnWidth()})` }}>
                    <div className="sticky left-0 z-20 bg-gray-50 border-r border-gray-200 px-3 py-3 flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleProjectCollapse(project.id)}
                            className="relative z-30 text-gray-600 hover:text-gray-800 p-1 -ml-1"
                            title={isCollapsed ? "Expand" : "Collapse"}
                          >
                            <svg
                              className={`w-4 h-4 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 5l7 7-7 7"
                              />
                            </svg>
                          </button>
                          <div
                            onClick={() => openProjectScopesModal(project)}
                            className="cursor-pointer"
                          >
                            <div className="text-sm font-bold text-gray-900">{project.projectName}</div>
                            <div className="text-xs text-gray-600">{project.customer || "No customer"}</div>
                          </div>
                        </div>
                        <div className="mt-1 text-[11px] text-gray-500 ml-6">
                          {scopes.length} scope{scopes.length !== 1 ? "s" : ""} {"\u2022"} {projectTotalHours.toFixed(1)} hours
                        </div>
                        <div className="mt-2 ml-6 flex gap-2">
                          <button
                            onClick={() => openProjectScopesModal(project)}
                            className="text-xs px-2 py-1 rounded border border-orange-300 text-orange-700 hover:bg-orange-50"
                          >
                            Manage Scopes
                          </button>
                          <button
                            onClick={() => deleteProject(project.id, project.projectName)}
                            disabled={deletingProjectIds.has(project.id)}
                            className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {deletingProjectIds.has(project.id) ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="col-span-full relative" style={{ gridColumn: `2 / span ${timeline.length}` }}>
                      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${timeline.length}, ${getColumnWidth()})` }}>
                        {timeline.map((t) => (
                          <div key={`${project.id}-project-${t.toISOString()}`} className="border-r border-gray-100" />
                        ))}
                      </div>

                      {projectAllocations.map((alloc) => {
                        const allocIdx = getAllocationTimelineIndex(alloc.period);
                        if (allocIdx === -1) return null;

                        return (
                          <div
                            key={`${project.id}-project-${alloc.period}`}
                            onClick={() => {
                              setSelectedScopeId(null);
                              setSelectedProject(project);
                            }}
                            className="absolute top-1.5 h-5 rounded bg-orange-500 text-white text-[10px] font-semibold px-1.5 flex items-center cursor-pointer hover:bg-orange-600"
                            style={{
                              left: `calc(${(allocIdx / timeline.length) * 100}% + 4px)`,
                              width: `calc(${(1 / timeline.length) * 100}% - 8px)`,
                            }}
                          >
                            {alloc.hours.toFixed(0)}h
                          </div>
                        );
                      })}

                      <div className="h-8" />
                    </div>
                  </div>

                  {/* Scope rows - only shown if not collapsed */}
                  {!isCollapsed && (
                    <>
                      {scopes.length === 0 ? (
                        projectTotalHours > 0 && projectAllocations.length > 0 ? (
                          <div className="grid border-t border-gray-100" style={{ gridTemplateColumns: `320px repeat(${totalTimelineColumns}, ${getColumnWidth()})` }}>
                            <div className="sticky left-0 z-20 bg-white border-r border-gray-200 px-3 py-2 ml-6">
                              <div
                                    onClick={() => openProjectScopesModal(project)}
                                className="text-xs font-medium text-gray-700 truncate cursor-pointer hover:text-blue-700"
                              >
                                Unscoped Allocation
                              </div>
                              <div className="text-[11px] text-gray-500 mt-0.5">
                                {projectTotalHours.toFixed(1)}h from schedule allocations
                              </div>
                            </div>

                            <div className="col-span-full relative" style={{ gridColumn: `2 / span ${timeline.length}` }}>
                              <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${timeline.length}, ${getColumnWidth()})` }}>
                                {timeline.map((t) => (
                                  <div key={`${project.id}-unscoped-${t.toISOString()}`} className="border-r border-gray-100" />
                                ))}
                              </div>

                              {projectAllocations.map((alloc) => {
                                const allocIdx = getAllocationTimelineIndex(alloc.period);
                                if (allocIdx === -1) return null;

                                return (
                                  <div
                                    key={`${project.id}-unscoped-${alloc.period}`}
                                    onClick={() => {
                                      setSelectedScopeId(null);
                                      setSelectedProject(project);
                                    }}
                                    className="absolute top-1.5 h-6 rounded bg-green-500 text-white text-xs font-semibold px-2 flex items-center cursor-pointer hover:bg-green-600"
                                    style={{
                                      left: `calc(${(allocIdx / timeline.length) * 100}% + 4px)`,
                                      width: `calc(${(1 / timeline.length) * 100}% - 8px)`,
                                    }}
                                  >
                                    {Number(alloc.hours || 0).toFixed(0)}h
                                  </div>
                                );
                              })}

                              <div className="h-8" />
                            </div>
                          </div>
                        ) : (
                          <div className="grid border-t border-gray-100" style={{ gridTemplateColumns: `320px repeat(${totalTimelineColumns}, ${getColumnWidth()})` }}>
                            <div className="sticky left-0 z-20 bg-white border-r border-gray-200 px-3 py-2 ml-6">
                              <div className="text-xs italic text-gray-400">No scopes yet</div>
                            </div>
                          </div>
                        )
                      ) : (
                        scopes.map((scope, scopeIdx) => {
                          const scopeRenderKey = `${project.id}-scope-${scope.id}-${scopeIdx}`;
                          const start = asDate(scope.startDate);
                          const end = asDate(scope.endDate);
                          const hasDates = start && end && start <= end;
                          const { startIdx, endIdx } = getPositionAndWidth(start, end);
                          const hasBar = startIdx >= 0 && endIdx >= 0 && endIdx >= startIdx;

                          // If scope has dates, use those; otherwise use schedule allocations
                          const allocations = projectAllocations;
                          const scopeHours = scope.totalHours || 0;
                          const projectHours = projectTotalHours || 0;

                          return (
                            <React.Fragment key={scopeRenderKey}>
                              <div className="grid border-t border-gray-100" style={{ gridTemplateColumns: `320px repeat(${totalTimelineColumns}, ${getColumnWidth()})` }}>
                                <div className="sticky left-0 z-20 bg-white border-r border-gray-200 px-3 py-2 ml-6">
                                  <div className="flex items-start gap-2">
                                    {scope.tasks && scope.tasks.length > 0 && (
                                      <button
                                        onClick={() => toggleScopeExpand(scope.id)}
                                        className="relative z-30 text-gray-600 hover:text-gray-800 p-0.5 -ml-1 flex-shrink-0 mt-0.5"
                                        title={expandedScopes.has(scope.id) ? "Collapse tasks" : "Expand tasks"}
                                      >
                                        <svg
                                          className={`w-3.5 h-3.5 transition-transform ${expandedScopes.has(scope.id) ? "rotate-90" : ""}`}
                                          fill="none"
                                          stroke="currentColor"
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M9 5l7 7-7 7"
                                          />
                                        </svg>
                                      </button>
                                    )}
                                    {!scope.tasks || scope.tasks.length === 0 ? <div className="w-3.5" /> : null}
                                    <div className="flex-1 min-w-0">
                                      <div
                                            onClick={() => openProjectScopesModal(project, scope.id)}
                                        className="text-xs font-medium text-gray-700 cursor-pointer hover:text-blue-700 whitespace-normal break-words leading-tight"
                                      >
                                        {scope.title}
                                      </div>
                                      <div className="text-[11px] text-gray-500 mt-0.5">
                                        {scope.totalHours.toFixed(1)}h
                                        {scope.scheduledHours > 0 && ` \u2022 ${scope.scheduledHours.toFixed(1)} scheduled`}
                                      </div>
                                    </div>
                                  </div>
                                </div>

                              <div className="col-span-full relative" style={{ gridColumn: `2 / span ${timeline.length}` }}>
                                <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${timeline.length}, ${getColumnWidth()})` }}>
                                  {timeline.map((t) => (
                                    <div key={`${scopeRenderKey}-${t.toISOString()}`} className="border-r border-gray-100" />
                                  ))}
                                </div>

                                {/* If scope has dates, show date-based bar */}
                                {hasDates && hasBar && (
                                  <div
                                    onClick={(event) => {
                                      if (viewMode === "day") {
                                        openDayHoursEditor(event, project, scope, startIdx, endIdx);
                                        return;
                                      }
                                      openProjectScopesModal(project, scope.id);
                                    }}
                                    className="absolute top-1.5 h-6 rounded text-white text-xs font-semibold px-2 flex items-center cursor-pointer"
                                    style={{
                                      backgroundColor: SCOPE_LINE_COLOR,
                                      left: `calc(${(startIdx / timeline.length) * 100}% + 4px)`,
                                      width: `calc(${((endIdx - startIdx + 1) / timeline.length) * 100}% - 8px)`,
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.backgroundColor = lightenColor(SCOPE_LINE_COLOR, 10);
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.backgroundColor = SCOPE_LINE_COLOR;
                                    }}
                                  >
                                    {scope.totalHours.toFixed(0)}h
                                  </div>
                                )}

                                {/* If scope has no dates, show allocation-based bars */}
                                {!hasDates && allocations.length > 0 && (
                                  allocations.map((alloc) => {
                                    const allocIdx = getAllocationTimelineIndex(alloc.period);

                                    if (allocIdx === -1) return null;

                                    const scopeAllocationHours =
                                      projectHours > 0 ? (alloc.hours * scopeHours) / projectHours : 0;
                                    if (scopeAllocationHours <= 0) return null;

                                    const scopeColor = SCOPE_LINE_COLOR;
                                    return (
                                      <div
                                        key={`${scopeRenderKey}-${alloc.period}`}
                                        onClick={(event) => {
                                          if (viewMode === "day") {
                                            openDayHoursEditor(event, project, scope, allocIdx, allocIdx);
                                            return;
                                          }
                                          setSelectedScopeId(scope.id);
                                          setSelectedProject(project);
                                        }}
                                        className="absolute top-1.5 h-6 rounded text-white text-xs font-semibold px-2 flex items-center cursor-pointer"
                                        style={{
                                          backgroundColor: scopeColor,
                                          left: `calc(${(allocIdx / timeline.length) * 100}% + 4px)`,
                                          width: `calc(${(1 / timeline.length) * 100}% - 8px)`,
                                        }}
                                        onMouseEnter={(e) => {
                                          e.currentTarget.style.backgroundColor = lightenColor(scopeColor, 10);
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.backgroundColor = scopeColor;
                                        }}
                                      >
                                        {scopeAllocationHours.toFixed(0)}h
                                      </div>
                                    );
                                  })
                                )}

                                <div className="h-8" />
                              </div>
                            </div>

                            {/* Task rows - shown when scope is expanded */}
                            {expandedScopes.has(scope.id) && scope.tasks && scope.tasks.length > 0 && (
                              <>
                                {scope.tasks.map((taskString, taskIdx) => {
                                  const { taskName, startDate, days, yards, concreteConfirmed } = parseTaskMetadata(taskString);
                                  const taskStart = asDate(startDate);
                                  const taskEnd = taskStart && days > 0
                                    ? new Date(taskStart.getTime() + (days - 1) * 24 * 60 * 60 * 1000)
                                    : taskStart;
                                  const { startIdx: taskStartIdx, endIdx: taskEndIdx } = getPositionAndWidth(taskStart, taskEnd);
                                  const taskHasBar = taskStartIdx >= 0 && taskEndIdx >= 0 && taskEndIdx >= taskStartIdx;

                                  return (
                                    <div key={`${scopeRenderKey}-task-${taskIdx}`} className="grid border-t border-gray-200" style={{ gridTemplateColumns: `320px repeat(${totalTimelineColumns}, ${getColumnWidth()})` }}>
                                      <div className="sticky left-0 z-20 bg-gray-50 border-r border-gray-200 px-3 py-2 ml-12">
                                        <div
                                            onClick={() => openProjectScopesModal(project, scope.id, taskIdx)}
                                          className="text-xs text-gray-600 whitespace-normal break-words leading-tight cursor-pointer hover:text-blue-700"
                                        >
                                          {taskName}
                                        </div>
                                        {startDate && days > 0 && (
                                          <div className="text-[10px] text-gray-500 mt-0.5">
                                            {startDate} • {days}d
                                          </div>
                                        )}
                                        {startDate && !days && (
                                          <div className="text-[10px] text-gray-500 mt-0.5">
                                            {startDate}
                                          </div>
                                        )}
                                        <div className="text-[10px] text-gray-500 mt-0.5">
                                          {yards.toFixed(1)} yd
                                        </div>
                                        {yards > 0 && (
                                          <div className="mt-1">
                                            <span
                                              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                                concreteConfirmed
                                                  ? 'bg-green-100 text-green-700 border border-green-200'
                                                  : 'bg-red-100 text-red-700 border border-red-200'
                                              }`}
                                            >
                                              {concreteConfirmed ? 'Confirmed' : 'Not Confirmed'}
                                            </span>
                                          </div>
                                        )}
                                      </div>

                                      <div className="col-span-full relative" style={{ gridColumn: `2 / span ${timeline.length}` }}>
                                        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${timeline.length}, ${getColumnWidth()})` }}>
                                          {timeline.map((t) => (
                                            <div key={`${scopeRenderKey}-task-${taskIdx}-${t.toISOString()}`} className="border-r border-gray-200" />
                                          ))}
                                        </div>

                                        {taskHasBar && taskStart && (
                                          <div
                                            onClick={(event) => {
                                              if (viewMode === "day") {
                                                openDayHoursEditor(event, project, scope, taskStartIdx, taskEndIdx, taskIdx, taskName);
                                                return;
                                              }
                                              openProjectScopesModal(project, scope.id, taskIdx);
                                            }}
                                            className="absolute top-1.5 h-5 rounded text-white text-[10px] font-semibold px-1.5 flex items-center cursor-pointer"
                                            style={{
                                              backgroundColor: TASK_LINE_COLOR,
                                              left: `calc(${(taskStartIdx / timeline.length) * 100}% + 4px)`,
                                              width: `calc(${((taskEndIdx - taskStartIdx + 1) / timeline.length) * 100}% - 8px)`,
                                            }}
                                            onMouseEnter={(e) => {
                                              e.currentTarget.style.backgroundColor = lightenColor(TASK_LINE_COLOR, 10);
                                            }}
                                            onMouseLeave={(e) => {
                                              e.currentTarget.style.backgroundColor = TASK_LINE_COLOR;
                                            }}
                                            title={`${taskName} - ${startDate} (${days}d)`}
                                          >
                                            {days > 0 ? `${days}d` : startDate?.slice(5)}
                                          </div>
                                        )}

                                        <div className="h-6" />
                                      </div>
                                    </div>
                                  );
                                })}
                              </>
                            )}
                          </React.Fragment>
                        );
                      })
                      )}
                    </>
                  )}
                </React.Fragment>
              );
            })
              )}
            </div>
          </div>
        </div>
      </div>

      {dayHoursEditor && (
        <>
          <div className="fixed inset-0 z-[150]" onClick={() => setDayHoursEditor(null)} />
          <div
            className="fixed z-[151] w-72 rounded-3xl border border-stone-200 bg-white/95 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.18)] backdrop-blur-sm"
            style={{ left: dayHoursEditor.anchorX, top: dayHoursEditor.anchorY }}
          >
            <div className="text-[9px] font-black uppercase tracking-[0.22em] text-orange-600 truncate">
              {dayHoursEditor.taskIndex === null ? "Scope Day Hours" : "Task Day Hours"}
            </div>
            <div className="mt-2 text-sm font-black text-slate-900 leading-tight break-words">{dayHoursEditor.scopeTitle}</div>
            <div className="mt-1 text-xs font-medium text-slate-500">{dayHoursEditor.dateLabel}</div>

            <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50/80 p-3">
              <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Adjust Hours</div>
              <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDayHoursEditor((current) => current ? { ...current, hours: Math.max(0, Math.round((current.hours - 0.5) * 10) / 10) } : null)}
                className="h-11 w-11 rounded-xl border border-stone-200 bg-white text-2xl font-black leading-none text-slate-700 transition-colors hover:bg-stone-100"
              >
                -
              </button>
              <div className="flex-1 rounded-2xl border border-stone-200 bg-white px-3 py-2 shadow-sm">
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={dayHoursEditor.hours}
                  onChange={(event) => setDayHoursEditor((current) => current ? { ...current, hours: Math.max(0, parseFloat(event.target.value) || 0) } : null)}
                  className="h-8 w-full bg-transparent text-center text-3xl font-black text-slate-900 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <div className="text-center text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Hours</div>
              </div>
              <button
                type="button"
                onClick={() => setDayHoursEditor((current) => current ? { ...current, hours: Math.round((current.hours + 0.5) * 10) / 10 } : null)}
                className="h-11 w-11 rounded-xl border border-stone-200 bg-white text-2xl font-black leading-none text-slate-700 transition-colors hover:bg-stone-100"
              >
                +
              </button>
            </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setDayHoursEditor((current) => current ? { ...current, hours: Math.max(0, Math.round((current.hours - 2) * 10) / 10) } : null)}
                  className="flex-1 rounded-xl border border-stone-200 bg-white px-2 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 transition-colors hover:bg-stone-100"
                >
                  -2h
                </button>
                <button
                  type="button"
                  onClick={() => setDayHoursEditor((current) => current ? { ...current, hours: Math.round((current.hours + 2) * 10) / 10 } : null)}
                  className="flex-1 rounded-xl border border-stone-200 bg-white px-2 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 transition-colors hover:bg-stone-100"
                >
                  +2h
                </button>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setDayHoursEditor(null)}
                className="flex-1 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 transition-colors hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveDayHoursEditor}
                disabled={dayHoursEditor.saving}
                className="flex-1 rounded-xl bg-orange-600 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-orange-700 disabled:opacity-60"
              >
                {dayHoursEditor.saving ? "Saving" : "Save"}
              </button>
            </div>
          </div>
        </>
      )}

      {selectedProject && selectedProjectInfo && (
        <ProjectScopesModal
          project={selectedProjectInfo}
          scopes={selectedProjectScopes}
          selectedScopeId={selectedScopeId}
          selectedTaskIndex={selectedTaskIndex}
          allowLongTermAssignmentEditing
          onClose={() => {
            setSelectedProject(null);
            setSelectedScopeId(null);
            setSelectedTaskIndex(null);
          }}
          onScopesUpdated={handleScopesUpdated}
        />
      )}
    </main>
  );
}
