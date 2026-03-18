"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ProjectScopesModal } from "@/app/project-schedule/components/ProjectScopesModal";
import { type ProjectInfo, type Scope } from "@/types";

interface WeekColumn {
  weekStartDate: Date;
  weekLabel: string;
}

interface WeekAllocation {
  hours: number;
  projects: Array<{ jobKey: string; scopeOfWork: string; hours: number }>;
}

interface ForemanRow {
  id: string;
  name: string;
  weekAllocations: Record<string, WeekAllocation>;
  dayAllocations: Record<string, WeekAllocation>;
  totalHours: number;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  isActive?: boolean;
}

interface Holiday {
  id: string;
  date: string;
  name: string;
  isPaid: boolean;
}

interface ActiveScheduleEntry {
  jobKey: string;
  scopeOfWork?: string;
  date: string;
  hours: number;
  foreman?: string | null;
  source?: string | null;
}

interface PMGroup {
  pmId: string;
  pmName: string;
  foremanRows: ForemanRow[];
  totalHours: number;
}

interface PMAssignment {
  assignmentKey?: string;
  jobKey: string;
  pmId: string;
}

interface TimeOffRequest {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  hours?: number;
}

interface RawTimeOffRecord {
  id?: string;
  employeeId?: string;
  startDate?: string;
  endDate?: string;
  dates?: string[];
  hours?: number | string;
}

type ColDef =
  | { type: "week"; weekKey: string; weekLabel: string }
  | {
      type: "day";
      weekKey: string;
      dateKey: string;
      dateLabel: string;
      holiday?: Holiday;
    };

const PM_TITLES = ["Project Manager", "Lead Foreman / Project Manager", "Superintendent"];

function isForemanRole(jobTitle?: string) {
  return (
    jobTitle === "Foreman" ||
    jobTitle === "Lead foreman" ||
    jobTitle === "Lead Foreman" ||
    jobTitle === "Lead Foreman / Project Manager"
  );
}

function isDispatchCapacityFieldRole(jobTitle?: string) {
  const title = (jobTitle || "").toLowerCase();
  return (
    title === "laborer" ||
    title === "right hand men" ||
    title === "right hand man" ||
    title === "right hand man/ sealhard crew leader"
  );
}

function getCurrentWeekMonday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monday = new Date(today);
  const dayOfWeek = monday.getDay();
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  monday.setDate(monday.getDate() + daysToMonday);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function formatWeekLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addProjectToAllocation(
  allocation: WeekAllocation,
  jobKey: string,
  scopeOfWork: string,
  hours: number
) {
  allocation.hours += hours;
  const projectKey = `${jobKey}|${scopeOfWork}`;
  let projectEntry = allocation.projects.find((p) => `${p.jobKey}|${p.scopeOfWork}` === projectKey);
  if (!projectEntry) {
    projectEntry = { jobKey, scopeOfWork, hours: 0 };
    allocation.projects.push(projectEntry);
  }
  projectEntry.hours += hours;
}

function getAssignmentKey(jobKey: string, scopeOfWork: string): string {
  return `${jobKey}||${scopeOfWork || "Unnamed Scope"}`;
}

export default function LongTermSchedulePage() {
  const [weekColumns, setWeekColumns] = useState<WeekColumn[]>([]);
  const [foremanRows, setForemanRows] = useState<ForemanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedProject, setDraggedProject] = useState<{
    jobKey: string;
    scopeOfWork: string;
    sourceDateKey?: string;
    sourceForemanId?: string;
    hours?: number;
  } | null>(null);

  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [paidHolidayByDate, setPaidHolidayByDate] = useState<Record<string, Holiday>>({});

  const [pmEmployees, setPmEmployees] = useState<Employee[]>([]);
  const [pmOverrides, setPmOverrides] = useState<Record<string, string>>({});
  const [jobKeyToProjectPM, setJobKeyToProjectPM] = useState<Record<string, string>>({});
  const [editingPMForJob, setEditingPMForJob] = useState<string | null>(null);
  const [savingPM, setSavingPM] = useState(false);
  const [collapsedPMGroups, setCollapsedPMGroups] = useState<Set<string>>(new Set());
  const [dispatchCapacityStaff, setDispatchCapacityStaff] = useState<Employee[]>([]);
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);

  // Scope modal state
  const [selectedModalProject, setSelectedModalProject] = useState<ProjectInfo | null>(null);
  const [selectedModalScopeTitle, setSelectedModalScopeTitle] = useState<string | null>(null);
  const [scopesByJobKey, setScopesByJobKey] = useState<Record<string, Scope[]>>({});
  const [jobKeyToProjectDocId, setJobKeyToProjectDocId] = useState<Record<string, string>>({});

  useEffect(() => {
    loadSchedules();
  }, []);

  async function loadSchedules() {
    try {
      setLoading(true);
      const currentWeekStart = getCurrentWeekMonday();

      const generatedWeeks: WeekColumn[] = [];
      for (let i = 0; i < 15; i++) {
        const weekStartDate = new Date(currentWeekStart);
        weekStartDate.setDate(weekStartDate.getDate() + i * 7);
        generatedWeeks.push({
          weekStartDate,
          weekLabel: formatWeekLabel(weekStartDate),
        });
      }
      setWeekColumns(generatedWeeks);

      const rangeEnd = new Date(currentWeekStart);
      rangeEnd.setDate(rangeEnd.getDate() + 15 * 7 - 1);
      const startDate = currentWeekStart.toISOString().split("T")[0];
      const endDate = rangeEnd.toISOString().split("T")[0];

      const [employeesRes, scheduleRes, holidaysRes, projectsRes, pmAssignmentsRes, timeOffRes] = await Promise.all([
        fetch("/api/short-term-schedule?action=employees"),
        fetch(`/api/short-term-schedule?action=active-schedule&startDate=${startDate}&endDate=${endDate}`),
        fetch("/api/holidays?page=1&pageSize=500"),
        fetch("/api/projects?page=1&pageSize=500"),
        fetch("/api/long-term-schedule/pm-assignments"),
        fetch("/api/time-off"),
      ]);

      const employeesJson = await employeesRes.json();
      const scheduleJson = await scheduleRes.json();
      const holidaysJson = holidaysRes.ok ? await holidaysRes.json() : { data: [] };
      const projectsJson = projectsRes.ok ? await projectsRes.json() : { data: [] };
      const pmAssignmentsJson = pmAssignmentsRes.ok ? await pmAssignmentsRes.json() : { data: [] };
      const timeOffJson = timeOffRes.ok ? await timeOffRes.json() : { data: [] };

      const employees: Employee[] = employeesJson?.data || [];
      const activeSchedules: ActiveScheduleEntry[] = scheduleJson?.data || [];
      const projects: Array<{ id?: string; customer?: string; projectNumber?: string; projectName?: string; projectManager?: string }> =
        projectsJson?.data || [];
      const pmAssignments: PMAssignment[] = pmAssignmentsJson?.data || [];

      const paidHolidayMap: Record<string, Holiday> = {};
      (holidaysJson?.data || []).forEach((holiday: Holiday) => {
        if (holiday?.isPaid && holiday?.date) {
          paidHolidayMap[holiday.date] = holiday;
        }
      });
      setPaidHolidayByDate(paidHolidayMap);

      const pmOverrideMap: Record<string, string> = {};
      pmAssignments.forEach((a) => {
        const key = (a?.assignmentKey || a?.jobKey || "").trim();
        if (key && a?.pmId) {
          pmOverrideMap[key] = a.pmId;
        }
      });
      setPmOverrides(pmOverrideMap);

      const projectPMMap: Record<string, string> = {};
      projects.forEach((project) => {
        const jobKey = `${project.customer || ""}~${project.projectNumber || ""}~${project.projectName || ""}`;
        if (project.projectManager) {
          projectPMMap[jobKey] = project.projectManager;
        }
      });
      setJobKeyToProjectPM(projectPMMap);

      const docIdMap: Record<string, string> = {};
      projects.forEach((project) => {
        const jobKey = `${project.customer || ""}~${project.projectNumber || ""}~${project.projectName || ""}`;
        if (project.id) docIdMap[jobKey] = project.id;
      });
      setJobKeyToProjectDocId(docIdMap);

      const pmEmployeeList = employees.filter((emp) => emp.isActive && PM_TITLES.includes(emp.jobTitle));
      setPmEmployees(pmEmployeeList);

      const dispatchStaff = employees.filter(
        (emp) => emp.isActive && (isForemanRole(emp.jobTitle) || isDispatchCapacityFieldRole(emp.jobTitle))
      );
      setDispatchCapacityStaff(dispatchStaff);

      const rawTimeOffRows = (timeOffJson?.data || []) as RawTimeOffRecord[];
      const normalizedTimeOffs: TimeOffRequest[] = rawTimeOffRows.flatMap((t: RawTimeOffRecord) => {
        const dates = Array.isArray(t?.dates)
          ? t.dates.filter((d: unknown) => typeof d === "string" && d)
          : [];

        if (typeof t?.startDate === "string" && typeof t?.endDate === "string") {
          return [{
            id: t.id,
            employeeId: t.employeeId,
            startDate: t.startDate,
            endDate: t.endDate,
            hours: Number(t.hours) > 0 ? Number(t.hours) : undefined,
          }];
        }

        if (dates.length === 0) return [];
        const sortedDates = [...dates].sort();
        return [{
          id: t.id,
          employeeId: t.employeeId,
          startDate: sortedDates[0],
          endDate: sortedDates[sortedDates.length - 1],
          hours: Number(t.hours) > 0 ? Number(t.hours) : undefined,
        }];
      });
      setTimeOffRequests(normalizedTimeOffs);

      const ganttInitiatedSchedules = activeSchedules.filter((entry) => {
        const source = (entry.source || "").toLowerCase();
        return source === "gantt" || source === "wip-page";
      });

      const foremen = employees
        .filter((emp) => emp.isActive && isForemanRole(emp.jobTitle))
        .slice(0, 6);

      const hasUnassignedEntries = ganttInitiatedSchedules.some((entry) => !entry.foreman);

      while (foremen.length < 6) {
        const n = foremen.length + 1;
        foremen.push({
          id: `placeholder-${n}`,
          firstName: `Foreman ${n}`,
          lastName: "",
          jobTitle: "Foreman",
          isActive: true,
        });
      }

      const rowEmployees = hasUnassignedEntries
        ? [
            ...foremen,
            {
              id: "__unassigned__",
              firstName: "Unassigned",
              lastName: "",
              jobTitle: "Foreman",
              isActive: true,
            },
          ]
        : foremen;

      const rows: ForemanRow[] = rowEmployees.map((foreman) => {
        const weekAllocations: Record<string, WeekAllocation> = {};
        const dayAllocations: Record<string, WeekAllocation> = {};

        generatedWeeks.forEach((week) => {
          weekAllocations[week.weekStartDate.toISOString()] = { hours: 0, projects: [] };
        });

        ganttInitiatedSchedules.forEach((entry) => {
          if (foreman.id === "__unassigned__") {
            if (entry.foreman) return;
          } else {
            if (!entry.foreman || entry.foreman !== foreman.id) return;
          }

          const entryDate = new Date(`${entry.date}T00:00:00`);
          entryDate.setHours(0, 0, 0, 0);
          const diffDays = Math.floor((entryDate.getTime() - currentWeekStart.getTime()) / (24 * 60 * 60 * 1000));
          if (diffDays < 0) return;

          const weekIndex = Math.floor(diffDays / 7);
          if (weekIndex < 0 || weekIndex >= generatedWeeks.length) return;

          const weekKey = generatedWeeks[weekIndex].weekStartDate.toISOString();
          const weekAllocation = weekAllocations[weekKey];
          const dayKey = formatDateKey(entryDate);
          if (!dayAllocations[dayKey]) {
            dayAllocations[dayKey] = { hours: 0, projects: [] };
          }
          const dayAllocation = dayAllocations[dayKey];

          const scopeOfWork = entry.scopeOfWork || "Unnamed Scope";
          const hours = Number(entry.hours || 0);
          addProjectToAllocation(weekAllocation, entry.jobKey, scopeOfWork, hours);
          addProjectToAllocation(dayAllocation, entry.jobKey, scopeOfWork, hours);
        });

        const totalHours = Object.values(weekAllocations).reduce((sum, alloc) => sum + alloc.hours, 0);
        return {
          id: foreman.id,
          name: `${foreman.firstName || ""} ${foreman.lastName || ""}`.trim() || "Foreman",
          weekAllocations,
          dayAllocations,
          totalHours,
        };
      });

      setForemanRows(rows);
    } catch (error) {
      console.error("Failed to load long-term schedule:", error);
      setForemanRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function assignProjectToForeman(jobKey: string, scopeOfWork: string, foremanId: string) {
    try {
      const res = await fetch("/api/gantt-v2/long-term/assign", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobKey,
          scopeOfWork,
          foreman: foremanId === "__unassigned__" ? null : foremanId,
        }),
      });

      const data = await res.json();
      if (data.success) {
        await loadSchedules();
      } else {
        console.error("Failed to assign foreman:", data.error);
        alert("Failed to assign foreman: " + data.error);
      }
    } catch (err) {
      console.error("Error assigning foreman:", err);
      alert("Error assigning foreman");
    }
  }

  async function savePMAssignment(assignmentKey: string, jobKey: string, pmId: string) {
    try {
      setSavingPM(true);
      let res: Response;
      if (pmId === "__project_default__") {
        res = await fetch("/api/long-term-schedule/pm-assignments", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignmentKey, jobKey }),
        });
      } else {
        res = await fetch("/api/long-term-schedule/pm-assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignmentKey, jobKey, pmId }),
        });
      }

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || "Failed to save PM assignment");
      }

      await loadSchedules();
    } catch (err) {
      console.error("Failed to save PM assignment:", err);
      alert(err instanceof Error ? err.message : "Failed to save PM assignment");
    } finally {
      setSavingPM(false);
      setEditingPMForJob(null);
    }
  }

  const getResolvedPMId = useCallback((assignmentKey: string, jobKey: string): string => {
    const override = pmOverrides[assignmentKey] || pmOverrides[jobKey];
    if (override) return override;

    const projectPMName = (jobKeyToProjectPM[jobKey] || "").trim().toLowerCase();
    if (projectPMName) {
      const match = pmEmployees.find((emp) => `${emp.firstName} ${emp.lastName}`.trim().toLowerCase() === projectPMName);
      if (match) return match.id;
    }

    return "__no_pm__";
  }, [pmOverrides, jobKeyToProjectPM, pmEmployees]);

  const getResolvedPMName = useCallback((pmId: string): string => {
    if (pmId === "__no_pm__") return "No PM Assigned";
    const pm = pmEmployees.find((emp) => emp.id === pmId);
    return pm ? `${pm.firstName} ${pm.lastName}`.trim() : "Unknown PM";
  }, [pmEmployees]);

  function handleDragStart(
    e: React.DragEvent,
    jobKey: string,
    scopeOfWork: string,
    sourceDateKey?: string,
    sourceForemanId?: string,
    hours?: number
  ) {
    // Ensure drag/drop consistently works across browsers.
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${jobKey}|${scopeOfWork}`);

    setDraggedProject({ jobKey, scopeOfWork, sourceDateKey, sourceForemanId, hours });
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  async function handleDrop(e: React.DragEvent, targetForemanId: string, targetDateKey?: string) {
    e.preventDefault();
    if (!draggedProject) return;

    const sourceDateKey = draggedProject.sourceDateKey || null;
    const resolvedTargetDateKey = targetDateKey || sourceDateKey;
    const normalizedSourceForemanId = draggedProject.sourceForemanId === "__unassigned__" ? null : (draggedProject.sourceForemanId || null);
    const normalizedTargetForemanId = targetForemanId === "__unassigned__" ? null : targetForemanId;

    try {
      if (sourceDateKey && resolvedTargetDateKey) {
        if (sourceDateKey === resolvedTargetDateKey && normalizedSourceForemanId === normalizedTargetForemanId) {
          return;
        }

        const response = await fetch('/api/short-term-schedule/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobKey: draggedProject.jobKey,
            scopeOfWork: draggedProject.scopeOfWork,
            sourceDateKey,
            sourceForemanId: normalizedSourceForemanId,
            targetDateKey: resolvedTargetDateKey,
            targetForemanId: normalizedTargetForemanId,
            hours: Number.isFinite(Number(draggedProject.hours)) ? Number(draggedProject.hours) : 10,
          }),
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result?.success) {
          throw new Error(result?.error || 'Failed to move project assignment');
        }

        await loadSchedules();
        return;
      }

      // Week-level cards are summary rows without a concrete date.
      // Fall back to foreman reassignment behavior for those drops.
      await assignProjectToForeman(draggedProject.jobKey, draggedProject.scopeOfWork, targetForemanId);
    } catch (error) {
      console.error('Error moving long-term schedule project:', error);
      alert(error instanceof Error ? error.message : 'Failed to move project');
    } finally {
      setDraggedProject(null);
    }
  }

  function toggleWeek(weekKey: string) {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(weekKey)) {
        next.delete(weekKey);
      } else {
        next.add(weekKey);
      }
      return next;
    });
  }

  function togglePMGroup(pmId: string) {
    setCollapsedPMGroups((prev) => {
      const next = new Set(prev);
      if (next.has(pmId)) {
        next.delete(pmId);
      } else {
        next.add(pmId);
      }
      return next;
    });
  }

  const pmGroups = useMemo<PMGroup[]>(() => {
    const allRows = foremanRows;
    const pmIdToRows = new Map<string, ForemanRow[]>();

    const weekKeys = weekColumns.map((week) => week.weekStartDate.toISOString());

    allRows.forEach((row) => {
      const pmRowMap = new Map<string, ForemanRow>();

      weekKeys.forEach((weekKey) => {
        const allocation = row.weekAllocations[weekKey];
        if (!allocation || allocation.projects.length === 0) return;

        allocation.projects.forEach((project) => {
          const assignmentKey = getAssignmentKey(project.jobKey, project.scopeOfWork);
          const pmId = getResolvedPMId(assignmentKey, project.jobKey);
          if (!pmRowMap.has(pmId)) {
            const emptyWeekAllocations: Record<string, WeekAllocation> = {};
            weekKeys.forEach((wk) => {
              emptyWeekAllocations[wk] = { hours: 0, projects: [] };
            });

            pmRowMap.set(pmId, {
              id: row.id,
              name: row.name,
              weekAllocations: emptyWeekAllocations,
              dayAllocations: {},
              totalHours: 0,
            });
          }

          const pmScopedRow = pmRowMap.get(pmId)!;
          addProjectToAllocation(pmScopedRow.weekAllocations[weekKey], project.jobKey, project.scopeOfWork, project.hours);
        });
      });

      Object.entries(row.dayAllocations).forEach(([dayKey, allocation]) => {
        allocation.projects.forEach((project) => {
          const assignmentKey = getAssignmentKey(project.jobKey, project.scopeOfWork);
          const pmId = getResolvedPMId(assignmentKey, project.jobKey);
          const pmScopedRow = pmRowMap.get(pmId);
          if (!pmScopedRow) return;

          if (!pmScopedRow.dayAllocations[dayKey]) {
            pmScopedRow.dayAllocations[dayKey] = { hours: 0, projects: [] };
          }

          addProjectToAllocation(pmScopedRow.dayAllocations[dayKey], project.jobKey, project.scopeOfWork, project.hours);
        });
      });

      pmRowMap.forEach((pmRow, pmId) => {
        pmRow.totalHours = Object.values(pmRow.weekAllocations).reduce((sum, alloc) => sum + alloc.hours, 0);
        if (pmRow.totalHours <= 0) return;

        if (!pmIdToRows.has(pmId)) {
          pmIdToRows.set(pmId, []);
        }
        pmIdToRows.get(pmId)!.push(pmRow);
      });
    });

    const groups: PMGroup[] = Array.from(pmIdToRows.entries()).map(([pmId, rows]) => ({
      pmId,
      pmName: getResolvedPMName(pmId),
      foremanRows: rows,
      totalHours: rows.reduce((sum, row) => sum + row.totalHours, 0),
    }));

    return groups.sort((a, b) => {
      if (a.pmId === "__no_pm__") return 1;
      if (b.pmId === "__no_pm__") return -1;
      return a.pmName.localeCompare(b.pmName);
    });
  }, [foremanRows, weekColumns, getResolvedPMId, getResolvedPMName]);

  const columnDefs = useMemo<ColDef[]>(() => {
    const cols: ColDef[] = [];

    weekColumns.forEach((week) => {
      const weekKey = week.weekStartDate.toISOString();
      if (!expandedWeeks.has(weekKey)) {
        cols.push({ type: "week", weekKey, weekLabel: week.weekLabel });
        return;
      }

      for (let i = 0; i < 5; i++) {
        const day = new Date(week.weekStartDate);
        day.setDate(day.getDate() + i);
        const dateKey = formatDateKey(day);

        cols.push({
          type: "day",
          weekKey,
          dateKey,
          dateLabel: day.toLocaleDateString("en-US", {
            weekday: "short",
            month: "numeric",
            day: "numeric",
          }),
          holiday: paidHolidayByDate[dateKey],
        });
      }
    });

    return cols;
  }, [weekColumns, expandedWeeks, paidHolidayByDate]);

  const globalColumnTotals = useMemo(() => {
    return columnDefs.map((col) => {
      return foremanRows.reduce((sum, row) => {
        if (col.type === "week") {
          return sum + (row.weekAllocations[col.weekKey]?.hours || 0);
        }
        return sum + (row.dayAllocations[col.dateKey]?.hours || 0);
      }, 0);
    });
  }, [columnDefs, foremanRows]);

  const grandTotal = useMemo(
    () => foremanRows.reduce((sum, row) => sum + row.totalHours, 0),
    [foremanRows]
  );

  function openScopeModal(jobKey: string, scopeTitle?: string) {
    const parts = jobKey.split("~");
    setSelectedModalScopeTitle((scopeTitle || "").trim() || null);
    setSelectedModalProject({
      jobKey,
      customer: parts[0] || "",
      projectNumber: parts[1] || "",
      projectName: parts[2] || "",
      projectDocId: jobKeyToProjectDocId[jobKey] || "",
    });
  }

  function renderProjects(
    projects: Array<{ jobKey: string; scopeOfWork: string; hours: number }>,
    isCompact = false,
    dragContext?: { sourceDateKey?: string; sourceForemanId?: string }
  ) {
    return projects.map((proj, idx) => {
      const assignmentKey = getAssignmentKey(proj.jobKey, proj.scopeOfWork);
      const resolvedPmId = getResolvedPMId(assignmentKey, proj.jobKey);
      const defaultPMName = jobKeyToProjectPM[proj.jobKey] || "Project Default";
      const canDrag = Boolean(dragContext?.sourceDateKey);

      return (
        <div
          key={`${proj.jobKey}-${proj.scopeOfWork}-${idx}`}
          className={`text-[10px] text-left text-gray-700 mt-1.5 ${isCompact ? "p-1.5" : "px-2 py-1.5"} ${canDrag ? "cursor-move" : "cursor-default"} bg-white rounded border border-gray-300 hover:border-orange-500 hover:bg-orange-50 transition-colors`}
          draggable={canDrag}
          onDragStart={(e) =>
            handleDragStart(
              e,
              proj.jobKey,
              proj.scopeOfWork,
              dragContext?.sourceDateKey,
              dragContext?.sourceForemanId,
              proj.hours
            )
          }
        >
          <div className="font-black text-gray-900 truncate">{proj.scopeOfWork}</div>
          <div className="text-gray-500 truncate">{proj.jobKey.split("~")[2] || proj.jobKey}</div>
          <div className="mt-1.5 flex items-center gap-1">
            <button
              type="button"
              className="text-[10px] text-blue-600 font-black hover:text-blue-800 mr-1"
              onClick={(e) => {
                e.stopPropagation();
                openScopeModal(proj.jobKey, proj.scopeOfWork);
              }}
              title="Edit scope details"
            >
              Edit
            </button>
            <button
              type="button"
              className="text-[10px] text-orange-700 font-black hover:text-orange-800"
              onClick={(e) => {
                e.stopPropagation();
                setEditingPMForJob(editingPMForJob === assignmentKey ? null : assignmentKey);
              }}
            >
              PM: {getResolvedPMName(resolvedPmId)}
            </button>
          </div>
          {editingPMForJob === assignmentKey && (
            <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
              <select
                disabled={savingPM}
                className="w-full text-[10px] border border-orange-400 rounded px-2 py-1 bg-white"
                defaultValue={pmOverrides[assignmentKey] || pmOverrides[proj.jobKey] || "__project_default__"}
                onChange={(e) => savePMAssignment(assignmentKey, proj.jobKey, e.target.value)}
              >
                <option value="__project_default__">Use Project Default ({defaultPMName})</option>
                {pmEmployees.map((pm) => (
                  <option key={pm.id} value={pm.id}>
                    {pm.firstName} {pm.lastName}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      );
    });
  }

  return (
    <main className="min-h-screen bg-neutral-100 p-2 md:p-4 font-sans text-slate-900">
      <div className="w-full flex flex-col min-h-[calc(100vh-2rem)] bg-white shadow-2xl rounded-3xl overflow-hidden border border-gray-200 p-4 md:p-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-3 pb-3 border-b border-gray-100">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900 uppercase italic leading-none">
              Long-Term <span className="text-orange-600">Schedule</span>
            </h1>
          </div>
        </div>

        {loading ? (
          <div className="bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200 p-12 text-center">
            <p className="text-gray-400 font-black uppercase tracking-[0.2em]">Loading Long-Term Data...</p>
          </div>
        ) : weekColumns.length === 0 || foremanRows.length === 0 ? (
          <div className="bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200 p-12 text-center">
            <p className="text-gray-400 font-black uppercase tracking-[0.2em]">No Long-Term Data Found</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="hidden md:block flex-1 bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto h-full lt-visible-scrollbar">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-30">
                    <tr className="bg-stone-800">
                      <th className="sticky left-0 z-40 bg-stone-800 text-left py-5 px-5 text-base font-black text-white uppercase tracking-[0.12em] italic border-r border-stone-700 w-60 shadow-lg">
                        PM / Foreman
                      </th>
                      {columnDefs.map((col) => {
                        const isWeekCol = col.type === "week";
                        const uniqueJobs = new Set<string>();
                        const allocatedHours = foremanRows.reduce((sum, row) => {
                          if (isWeekCol) {
                            const alloc = row.weekAllocations[col.weekKey];
                            (alloc?.projects || []).forEach((p) => uniqueJobs.add(p.jobKey));
                            return sum + (alloc?.hours || 0);
                          }
                          const alloc = row.dayAllocations[col.dateKey];
                          (alloc?.projects || []).forEach((p) => uniqueJobs.add(p.jobKey));
                          return sum + (alloc?.hours || 0);
                        }, 0);
                        const baseDispatchCapacity = dispatchCapacityStaff.length * 10;

                        const getDayCapacity = (dateKey: string) => {
                          if (paidHolidayByDate[dateKey]) {
                            return 0;
                          }

                          let totalHoursOff = 0;
                          dispatchCapacityStaff.forEach((employee) => {
                            const req = timeOffRequests.find(
                              (r) => r.employeeId === employee.id && dateKey >= r.startDate && dateKey <= r.endDate
                            );
                            if (req) {
                              totalHoursOff += req.hours || 10;
                            }
                          });

                          return Math.max(baseDispatchCapacity - totalHoursOff, 0);
                        };

                        let capacityHours = 0;
                        let activeHeadcount = 0;
                        const allocatedFTE = isWeekCol ? allocatedHours / 50 : allocatedHours / 10;

                        if (isWeekCol) {
                          const weekStart = weekColumns.find((w) => w.weekStartDate.toISOString() === col.weekKey)?.weekStartDate;
                          if (weekStart) {
                            for (let i = 0; i < 5; i++) {
                              const day = new Date(weekStart);
                              day.setDate(day.getDate() + i);
                              const dayCapacity = getDayCapacity(formatDateKey(day));
                              capacityHours += dayCapacity;
                            }
                          }
                          activeHeadcount = capacityHours / 50;
                        } else {
                          capacityHours = getDayCapacity(col.dateKey);
                          activeHeadcount = capacityHours / 10;
                        }

                        if (col.type === "week") {
                          const isExpanded = expandedWeeks.has(col.weekKey);
                          return (
                            <th
                              key={col.weekKey}
                              className="text-center py-4 px-3 text-base font-black text-white border-r border-stone-700 min-w-[170px] cursor-pointer hover:bg-stone-700/80 transition-colors"
                              onClick={() => toggleWeek(col.weekKey)}
                            >
                              <div className="text-xs text-orange-400 uppercase tracking-widest mb-1 flex items-center justify-center gap-1">
                                Week Of
                                <span
                                  aria-hidden="true"
                                  className={`inline-block h-0 w-0 border-y-[4px] border-y-transparent border-l-[6px] border-l-current text-orange-300 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                />
                              </div>
                              <div className="text-2xl italic tracking-tight text-white">{col.weekLabel}</div>
                              <div className="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1">
                                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest gap-2">
                                  <span className="text-stone-300">Headcount</span>
                                  <span className="text-orange-300">{Number.isInteger(activeHeadcount) ? activeHeadcount : activeHeadcount.toFixed(1)}</span>
                                  <span className="text-stone-500">|</span>
                                  <span className="text-orange-200">FTE {allocatedFTE.toFixed(1)}</span>
                                </div>
                                <div className="mt-0.5 flex items-center justify-between text-xs font-black">
                                  <span className="text-orange-200">{allocatedHours.toFixed(0)}H</span>
                                  <span className="text-stone-400">/</span>
                                  <span className="text-stone-300">{capacityHours}H</span>
                                </div>
                                <div className="mt-0.5 text-[10px] font-black text-stone-300 uppercase tracking-wider text-left">
                                  {uniqueJobs.size} Jobs
                                </div>
                              </div>
                            </th>
                          );
                        }

                        const isDayOff = Boolean(col.holiday);
                        return (
                          <th
                            key={`${col.weekKey}-${col.dateKey}`}
                            className={`text-center py-3 px-2 text-base font-black text-white border-r border-stone-700 min-w-[110px] cursor-pointer hover:bg-stone-700/70 transition-colors ${
                              isDayOff ? "bg-rose-900/60" : ""
                            }`}
                            onClick={() => toggleWeek(col.weekKey)}
                            title="Click to collapse this week"
                          >
                            <div className="text-xs uppercase tracking-wider text-orange-200">{col.dateLabel}</div>
                            <div className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1">
                              <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest gap-2">
                                <span className="text-stone-300">Headcount</span>
                                <span className="text-orange-300">{Number.isInteger(activeHeadcount) ? activeHeadcount : activeHeadcount.toFixed(1)}</span>
                                <span className="text-stone-500">|</span>
                                <span className="text-orange-200">FTE {allocatedFTE.toFixed(1)}</span>
                              </div>
                              <div className="mt-0.5 flex items-center justify-between text-[10px] font-black">
                                <span className="text-orange-200">{allocatedHours.toFixed(0)}H</span>
                                <span className="text-stone-400">/</span>
                                <span className="text-stone-300">{capacityHours}H</span>
                              </div>
                              <div className="mt-0.5 text-[9px] font-black text-stone-300 uppercase tracking-wider text-left">
                                {uniqueJobs.size} Jobs
                              </div>
                            </div>
                            {isDayOff && (
                              <div className="mt-1 inline-flex items-center px-2 py-0.5 rounded bg-rose-500/20 border border-rose-300/40 text-xs text-rose-100 uppercase tracking-widest">
                                Day Off
                              </div>
                            )}
                            <div className="mt-1 text-[10px] text-stone-300 uppercase tracking-widest">Collapse</div>
                          </th>
                        );
                      })}
                      <th className="text-center py-5 px-5 text-base font-black text-white bg-stone-800 border-l border-stone-700 uppercase tracking-widest">
                        Total Sum
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pmGroups.map((group) => (
                      <Fragment key={`pm-group-${group.pmId}`}>
                        {(() => {
                          const isCollapsed = collapsedPMGroups.has(group.pmId);
                          return (
                        <tr key={`pm-header-${group.pmId}`} className="bg-stone-700 text-white border-b border-stone-600">
                          <td className="sticky left-0 z-20 bg-stone-700 py-3 px-5 text-sm font-black uppercase tracking-[0.12em] border-r border-stone-600 shadow-md">
                            <button
                              type="button"
                              onClick={() => togglePMGroup(group.pmId)}
                              className="w-full flex items-center justify-between text-left"
                              title={isCollapsed ? "Expand PM rows" : "Collapse PM rows"}
                            >
                              <span>PM: {group.pmName}</span>
                              <span
                                aria-hidden="true"
                                className={`inline-block h-0 w-0 border-y-[4px] border-y-transparent border-l-[6px] border-l-current text-orange-300 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                              />
                            </button>
                          </td>
                          {columnDefs.map((col) => {
                            const uniqueJobs = new Set<string>();
                            const columnHours = group.foremanRows.reduce((sum, row) => {
                              if (col.type === "week") {
                                const alloc = row.weekAllocations[col.weekKey];
                                (alloc?.projects || []).forEach((p) => uniqueJobs.add(p.jobKey));
                                return sum + (alloc?.hours || 0);
                              }
                              const alloc = row.dayAllocations[col.dateKey];
                              (alloc?.projects || []).forEach((p) => uniqueJobs.add(p.jobKey));
                              return sum + (alloc?.hours || 0);
                            }, 0);

                            return (
                              <td
                                key={`pm-${group.pmId}-${col.type === "week" ? col.weekKey : `${col.weekKey}-${col.dateKey}`}`}
                                className="py-3 px-2 text-center text-xs font-black text-orange-100 border-r border-stone-600"
                              >
                                <div className="text-orange-50 tracking-tight text-sm">{columnHours.toFixed(0)}H</div>
                                <div className="text-[10px] text-orange-300">{(columnHours / 50).toFixed(1)} FTE</div>
                                <div className="text-[10px] text-stone-300 uppercase tracking-wider">{uniqueJobs.size} Jobs</div>
                              </td>
                            );
                          })}
                          <td className="py-3 px-3 text-center text-xs font-black text-orange-100 border-l border-stone-600 bg-stone-800">
                            <div className="text-sm">{group.totalHours.toFixed(0)}H</div>
                            <div className="text-[10px] text-orange-300">{(group.totalHours / 50).toFixed(1)} FTE</div>
                            <div className="text-[10px] text-stone-300 uppercase tracking-wider">{
                              new Set(
                                group.foremanRows.flatMap((row) =>
                                  Object.values(row.weekAllocations).flatMap((alloc) =>
                                    (alloc?.projects || []).map((p) => p.jobKey)
                                  )
                                )
                              ).size
                            } Jobs</div>
                          </td>
                        </tr>
                          );
                        })()}

                        {!collapsedPMGroups.has(group.pmId) && group.foremanRows.map((row, idx) => (
                          <tr
                            key={`${group.pmId}-${row.id}-${idx}`}
                            className={`border-b border-gray-50 transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}
                          >
                            <td
                              className="sticky left-0 z-20 bg-inherit py-4 px-5 text-sm font-black text-gray-900 uppercase tracking-wide italic border-r border-gray-100 shadow-md"
                              onDragOver={handleDragOver}
                              onDrop={(e) => handleDrop(e, row.id)}
                            >
                              {row.name}
                            </td>
                            {columnDefs.map((col) => {
                              if (col.type === "week") {
                                const allocation = row.weekAllocations[col.weekKey];
                                const hours = allocation?.hours || 0;
                                return (
                                  <td
                                    key={col.weekKey}
                                    className={`text-center py-2 px-2 text-sm border-r border-gray-100 transition-all align-top ${
                                      hours > 0 ? "bg-orange-50/30" : ""
                                    }`}
                                    onDragOver={handleDragOver}
                                    onDrop={(e) => handleDrop(e, row.id)}
                                  >
                                    {hours > 0 && (
                                      <div className="space-y-1.5">
                                        <div className="font-black text-gray-900 text-base tracking-tight">
                                          {hours.toFixed(1)}
                                          <span className="text-[10px] opacity-40 ml-0.5">H</span>
                                        </div>
                                        {renderProjects(allocation.projects)}
                                      </div>
                                    )}
                                  </td>
                                );
                              }

                              const dayAllocation = row.dayAllocations[col.dateKey];
                              const dayHours = dayAllocation?.hours || 0;
                              const isDayOff = Boolean(col.holiday);
                              return (
                                <td
                                  key={`${col.weekKey}-${col.dateKey}`}
                                  className={`text-center py-2 px-1 text-sm border-r border-gray-100 transition-all align-top ${
                                    dayHours > 0 ? "bg-orange-50/30" : ""
                                  } ${isDayOff ? "bg-rose-50/50" : ""}`}
                                  onDragOver={isDayOff ? undefined : handleDragOver}
                                  onDrop={isDayOff ? undefined : (e) => handleDrop(e, row.id, col.dateKey)}
                                >
                                  {isDayOff && (
                                    <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-rose-600">
                                      {col.holiday?.name || "Day Off"}
                                    </div>
                                  )}
                                  {dayHours > 0 && (
                                    <div className="space-y-1.5">
                                      <div className="font-black text-gray-900 text-base tracking-tight">
                                        {dayHours.toFixed(1)}
                                        <span className="text-[10px] opacity-40 ml-0.5">H</span>
                                      </div>
                                      {renderProjects(dayAllocation.projects, true, { sourceDateKey: col.dateKey, sourceForemanId: row.id })}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                            <td className="text-center py-4 px-5 text-base font-black bg-stone-50 border-l border-gray-200">
                              <div className="text-gray-900">{row.totalHours.toFixed(1)}H</div>
                              <div className="text-[10px] font-black text-orange-700 uppercase">
                                {(row.totalHours / 50).toFixed(1)} Total FTE
                              </div>
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}

                    <tr className="bg-stone-800 text-white font-black uppercase tracking-widest italic">
                      <td className="sticky left-0 z-20 bg-stone-800 py-6 px-6 text-xs border-r border-stone-700 shadow-lg">
                        Weekly Cumulative Load
                      </td>
                      {globalColumnTotals.map((total, idx) => (
                        <td key={idx} className="text-center py-6 px-3 text-sm border-r border-stone-700">
                          <div className="text-lg tracking-tight text-orange-300">{total.toFixed(0)}H</div>
                          <div className="text-[10px] text-stone-300 opacity-80">{(total / 50).toFixed(1)} FTE</div>
                        </td>
                      ))}
                      <td className="text-center py-6 px-5 text-sm bg-stone-800 border-l border-stone-700">
                        <div className="text-xl text-orange-300">{grandTotal.toFixed(0)}H</div>
                        <div className="text-[10px] text-stone-300 opacity-80">Total Lifecycle</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="md:hidden flex-1 overflow-y-auto space-y-6 lt-visible-scrollbar pb-10">
              {pmGroups.map((group) => (
                <div key={group.pmId} className="space-y-3">
                  <div className="bg-stone-800 text-white rounded-xl px-4 py-2 border border-stone-700">
                    <button
                      type="button"
                      onClick={() => togglePMGroup(group.pmId)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-[9px] font-black uppercase tracking-widest text-orange-300">Project Manager</div>
                        <span
                          aria-hidden="true"
                          className={`inline-block h-0 w-0 border-y-[4px] border-y-transparent border-l-[6px] border-l-current text-orange-300 transition-transform ${collapsedPMGroups.has(group.pmId) ? "" : "rotate-90"}`}
                        />
                      </div>
                      <div className="text-sm font-black uppercase italic">{group.pmName}</div>
                      <div className="text-[9px] font-bold text-orange-200 mt-1">{group.totalHours.toFixed(0)}h <span className="text-orange-400">|</span> {(group.totalHours / 50).toFixed(1)} FTE</div>
                    </button>
                  </div>

                  {!collapsedPMGroups.has(group.pmId) && group.foremanRows.map((row) => (
                    <div
                      key={`${group.pmId}-${row.id}`}
                      className="bg-gray-50 rounded-2xl p-5 border border-gray-100 shadow-sm"
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, row.id)}
                    >
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="font-black text-gray-900 text-base uppercase leading-tight italic truncate pr-4">{row.name}</h3>
                        <div className="bg-orange-600 text-white px-3 py-1 rounded-xl text-xs font-black shadow-lg shadow-orange-600/20">
                          {row.totalHours.toFixed(0)}h
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3">
                        {weekColumns
                          .filter((w) => (row.weekAllocations[w.weekStartDate.toISOString()]?.hours || 0) > 0)
                          .slice(0, 4)
                          .map((week) => {
                            const weekKey = week.weekStartDate.toISOString();
                            const allocation = row.weekAllocations[weekKey];
                            const hours = allocation?.hours || 0;
                            const expanded = expandedWeeks.has(weekKey);

                            return (
                              <div key={weekKey} className="bg-white p-3 rounded-xl border border-orange-100">
                                <button
                                  type="button"
                                  className="w-full flex items-center justify-between"
                                  onClick={() => toggleWeek(weekKey)}
                                >
                                  <p className="text-[8px] font-black uppercase text-gray-400 mb-1">{week.weekLabel}</p>
                                  <span
                                    aria-hidden="true"
                                    className={`inline-block h-0 w-0 border-y-[4px] border-y-transparent border-l-[6px] border-l-current text-gray-400 transition-transform ${expanded ? "rotate-90" : ""}`}
                                  />
                                </button>

                                <div className="mb-2">
                                  <span className="font-black text-gray-900 text-sm">{hours.toFixed(1)}h</span>
                                </div>

                                {!expanded ? (
                                  renderProjects(allocation?.projects || [], true)
                                ) : (
                                  <div className="space-y-2">
                                    {Array.from({ length: 5 }).map((_, i) => {
                                      const day = new Date(week.weekStartDate);
                                      day.setDate(day.getDate() + i);
                                      const dayKey = formatDateKey(day);
                                      const dayAllocation = row.dayAllocations[dayKey];
                                      const dayHours = dayAllocation?.hours || 0;
                                      const holiday = paidHolidayByDate[dayKey];

                                      return (
                                        <div
                                          key={dayKey}
                                          className={`rounded-lg border px-2 py-1 ${holiday ? "border-rose-200 bg-rose-50" : "border-gray-200 bg-gray-50"}`}
                                          onDragOver={holiday ? undefined : handleDragOver}
                                          onDrop={holiday ? undefined : (e) => handleDrop(e, row.id, dayKey)}
                                        >
                                          <div className="text-[8px] font-black text-gray-500 uppercase tracking-wider">
                                            {day.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" })}
                                          </div>
                                          {holiday && (
                                            <div className="text-[8px] font-black text-rose-600 uppercase tracking-widest mt-0.5">
                                              Day Off: {holiday.name}
                                            </div>
                                          )}
                                          {dayHours > 0 && (
                                            <div className="space-y-1">
                                              <div className="text-[10px] font-black text-gray-800 mt-1">{dayHours.toFixed(1)}h</div>
                                              {renderProjects(dayAllocation?.projects || [], true, { sourceDateKey: dayKey, sourceForemanId: row.id })}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {selectedModalProject && (
        <ProjectScopesModal
          project={selectedModalProject}
          scopes={scopesByJobKey[selectedModalProject.jobKey] || []}
          allScopes={scopesByJobKey}
          selectedScopeId={null}
          selectedScopeTitle={selectedModalScopeTitle}
          onClose={() => {
            setSelectedModalProject(null);
            setSelectedModalScopeTitle(null);
          }}
          onScopesUpdated={(jobKey, updatedScopes) => {
            setScopesByJobKey((prev) => ({ ...prev, [jobKey]: updatedScopes }));
            // Scope date changes can resync active schedule rows; refresh the board immediately.
            void loadSchedules();
          }}
        />
      )}
      <style>{`
        .lt-visible-scrollbar {
          scrollbar-width: auto;
          scrollbar-color: #f97316 #e7e5e4;
        }

        .lt-visible-scrollbar::-webkit-scrollbar {
          width: 12px;
          height: 12px;
        }

        .lt-visible-scrollbar::-webkit-scrollbar-track {
          background: #e7e5e4;
          border-radius: 9999px;
        }

        .lt-visible-scrollbar::-webkit-scrollbar-thumb {
          background: #f97316;
          border-radius: 9999px;
          border: 2px solid #e7e5e4;
        }

        .lt-visible-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #ea580c;
        }
      `}</style>
    </main>
  );
}

