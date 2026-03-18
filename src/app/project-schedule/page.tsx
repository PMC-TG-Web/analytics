"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ProjectScopesModal } from "@/app/project-schedule/components/ProjectScopesModal";
import { ProjectInfo, Scope } from "@/types";

type ProjectRow = {
  id: string;
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
  title: string;
  startDate: string | null;
  endDate: string | null;
  totalHours: number;
  crewSize: number | null;
  notes: string | null;
  tasks?: string[];
  scheduledHours: number;
  remainingHours: number;
};

type SchedulingDiagnostics = {
  totals: {
    monthlyPlannedHours: number;
    weeklyPlannedHours: number;
    scopePlannedHours: number;
    scheduledHours: number;
    remainingScopeHours: number;
    driftVsScopePlanHours: number;
    driftVsMonthlyPlanHours: number;
  };
  active: {
    bySource: Record<string, number>;
    byScope: Record<string, { plannedHours: number; scheduledHours: number; driftHours: number }>;
  };
};

const monthLabel = (value: Date) =>
  value.toLocaleString("en-US", { month: "short", year: "2-digit" });

const asDate = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export default function ProjectSchedulePage() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProject, setSelectedProject] = useState<ProjectRow | null>(null);
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("month");
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());

  const [newProject, setNewProject] = useState({
    projectName: "",
    customer: "",
    projectNumber: "",
    status: "In Progress",
  });

  const toggleProjectCollapse = (projectId: string) => {
    const newCollapsed = new Set(collapsedProjects);
    if (newCollapsed.has(projectId)) {
      newCollapsed.delete(projectId);
    } else {
      newCollapsed.add(projectId);
    }
    setCollapsedProjects(newCollapsed);
  };

  // Generate timeline based on view mode
  const timeline = useMemo(() => {
    const base = new Date();
    base.setDate(1);
    base.setHours(0, 0, 0, 0);

    if (viewMode === "day") {
      // Next 30 days
      const days: Date[] = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(base);
        d.setDate(d.getDate() + i);
        days.push(d);
      }
      return days;
    } else if (viewMode === "week") {
      // Next 20 weeks (Mondays)
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
      // Month view: 10 months
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

  const getPositionAndWidth = (start: Date | null, end: Date | null) => {
    if (!start || !end || start > end) return { startIdx: -1, endIdx: -1 };

    const timelineStart = timeline[0];
    const timelineEnd = timeline[timeline.length - 1];

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
    try {
      await fetch("/api/gantt-v2/setup", { method: "POST" });
      const res = await fetch("/api/gantt-v2/projects");
      const json = await res.json();
      const projectsData = json?.data || [];
      setProjects(projectsData);
      // Collapse all projects by default
      setCollapsedProjects(new Set(projectsData.map((p: ProjectRow) => p.id)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const addProject = async () => {
    if (!newProject.projectName.trim()) return;
    await fetch("/api/gantt-v2/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newProject),
    });
    setNewProject({ projectName: "", customer: "", projectNumber: "", status: "In Progress" });
    await loadProjects();
  };

  const filteredProjects = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) return projects;

    return projects
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
  }, [projects, searchTerm]);

  const timelineStart = timeline[0];
  const timelineEnd = timeline[timeline.length - 1];

  const selectedProjectInfo = useMemo<ProjectInfo | null>(() => {
    if (!selectedProject) return null;
    return {
      jobKey: `${selectedProject.customer || ""}~${selectedProject.projectNumber || ""}~${selectedProject.projectName || ""}`,
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
      jobKey: `${selectedProject.customer || ""}~${selectedProject.projectNumber || ""}~${selectedProject.projectName || ""}`,
      title: scope.title,
      startDate: scope.startDate || "",
      endDate: scope.endDate || "",
      manpower: scope.crewSize ?? undefined,
      description: scope.notes || "",
      tasks: Array.isArray(scope.tasks) ? scope.tasks : [],
      hours: Number(scope.totalHours || 0),
      schedulingMode: "contiguous",
      selectedDays: [],
    }));
  }, [selectedProject]);

  return (
    <main className="min-h-screen bg-neutral-100 p-3 md:p-4 font-sans text-slate-900">
      <div className="w-full bg-white rounded-2xl border border-gray-200 shadow-sm p-4 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-100 pb-4 mb-4">
          <div>
            <p className="text-xs font-semibold text-gray-500">Project scope timeline and scheduling view</p>
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
            <button onClick={addProject} className="rounded bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold px-3 py-2">Create</button>
          </div>
        </div>

        <div className="mb-3 text-xs text-gray-500">
          Projects are collapsed by default. Click the chevron next to a project name to show scope bars.
        </div>

        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="grid" style={{ gridTemplateColumns: `320px repeat(${timeline.length}, ${getColumnWidth()})` }}>
            <div className="sticky left-0 bg-gray-50 border-r border-b border-gray-200 px-3 py-2 text-xs font-bold uppercase text-gray-500">Project</div>
            {timeline.map((t) => (
              <div key={t.toISOString()} className="border-b border-r border-gray-200 px-2 py-2 text-xs font-bold text-gray-500 text-center">
                {getTimelineLabel(t)}
              </div>
            ))}
          </div>

          {loading ? (
            <div className="p-4 text-sm text-gray-500">Loading...</div>
          ) : filteredProjects.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">
              {searchTerm.trim() ? "No projects match your search." : "No projects yet."}
            </div>
          ) : (
            filteredProjects.map((project) => {
              const scopes = project.scopes || [];
              const isCollapsed = collapsedProjects.has(project.id);
              const projectAllocations = project.scheduleAllocations || [];
              const projectTotalHours =
                project.scopedHours > 0
                  ? project.scopedHours
                  : projectAllocations.reduce((sum, alloc) => sum + Number(alloc.hours || 0), 0);
              return (
                <React.Fragment key={project.id}>
                  {/* Project header row */}
                  <div className="grid border-t border-gray-100 bg-gray-50" style={{ gridTemplateColumns: `320px repeat(${timeline.length}, ${getColumnWidth()})` }}>
                    <div className="sticky left-0 bg-gray-50 border-r border-gray-200 px-3 py-3 flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleProjectCollapse(project.id)}
                            className="text-gray-600 hover:text-gray-800 p-1 -ml-1"
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
                            onClick={() => {
                              setSelectedScopeId(null);
                              setSelectedProject(project);
                            }}
                            className="cursor-pointer"
                          >
                            <div className="text-sm font-bold text-gray-900">{project.projectName}</div>
                            <div className="text-xs text-gray-600">{project.customer || "No customer"}</div>
                          </div>
                        </div>
                        <div className="mt-1 text-[11px] text-gray-500 ml-6">
                          {scopes.length} scope{scopes.length !== 1 ? "s" : ""} {"\u2022"} {projectTotalHours.toFixed(1)} hours
                        </div>
                        <button
                          onClick={() => setSelectedProject(project)}
                          className="mt-2 ml-6 text-xs px-2 py-1 rounded border border-orange-300 text-orange-700 hover:bg-orange-50"
                        >
                          Manage Scopes
                        </button>
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
                          <div className="grid border-t border-gray-100" style={{ gridTemplateColumns: `320px repeat(${timeline.length}, ${getColumnWidth()})` }}>
                            <div className="sticky left-0 bg-white border-r border-gray-200 px-3 py-2 ml-6">
                              <div
                                onClick={() => {
                                  setSelectedScopeId(null);
                                  setSelectedProject(project);
                                }}
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
                          <div className="grid border-t border-gray-100" style={{ gridTemplateColumns: `320px repeat(${timeline.length}, ${getColumnWidth()})` }}>
                            <div className="sticky left-0 bg-white border-r border-gray-200 px-3 py-2 ml-6">
                              <div className="text-xs italic text-gray-400">No scopes yet</div>
                            </div>
                          </div>
                        )
                      ) : (
                        scopes.map((scope) => {
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
                            <div key={scope.id} className="grid border-t border-gray-100" style={{ gridTemplateColumns: `320px repeat(${timeline.length}, ${getColumnWidth()})` }}>
                              <div className="sticky left-0 bg-white border-r border-gray-200 px-3 py-2 ml-6">
                                <div
                                  onClick={() => {
                                    setSelectedScopeId(scope.id);
                                    setSelectedProject(project);
                                  }}
                                  className="text-xs font-medium text-gray-700 truncate cursor-pointer hover:text-blue-700"
                                >
                                  {scope.title}
                                </div>
                                <div className="text-[11px] text-gray-500 mt-0.5">
                                  {scope.totalHours.toFixed(1)}h
                                  {scope.scheduledHours > 0 && ` \u2022 ${scope.scheduledHours.toFixed(1)} scheduled`}
                                </div>
                              </div>

                              <div className="col-span-full relative" style={{ gridColumn: `2 / span ${timeline.length}` }}>
                                <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${timeline.length}, ${getColumnWidth()})` }}>
                                  {timeline.map((t) => (
                                    <div key={`${scope.id}-${t.toISOString()}`} className="border-r border-gray-100" />
                                  ))}
                                </div>

                                {/* If scope has dates, show date-based bar */}
                                {hasDates && hasBar && (
                                  <div
                                    onClick={() => {
                                      setSelectedScopeId(scope.id);
                                      setSelectedProject(project);
                                    }}
                                    className="absolute top-1.5 h-6 rounded bg-blue-500 text-white text-xs font-semibold px-2 flex items-center cursor-pointer hover:bg-blue-600"
                                    style={{
                                      left: `calc(${(startIdx / timeline.length) * 100}% + 4px)`,
                                      width: `calc(${((endIdx - startIdx + 1) / timeline.length) * 100}% - 8px)`,
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

                                    return (
                                      <div
                                        key={`${scope.id}-${alloc.period}`}
                                        onClick={() => {
                                          setSelectedScopeId(scope.id);
                                          setSelectedProject(project);
                                        }}
                                        className="absolute top-1.5 h-6 rounded bg-green-500 text-white text-xs font-semibold px-2 flex items-center cursor-pointer hover:bg-green-600"
                                        style={{
                                          left: `calc(${(allocIdx / timeline.length) * 100}% + 4px)`,
                                          width: `calc(${(1 / timeline.length) * 100}% - 8px)`,
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

      {selectedProject && selectedProjectInfo && (
        <ProjectScopesModal
          project={selectedProjectInfo}
          scopes={selectedProjectScopes}
          selectedScopeId={selectedScopeId}
          onClose={() => {
            setSelectedProject(null);
            setSelectedScopeId(null);
          }}
          onScopesUpdated={() => {
            loadProjects();
          }}
        />
      )}
    </main>
  );
}
