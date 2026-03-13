"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

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
  scheduledHours: number;
  remainingHours: number;
};

const monthLabel = (value: Date) =>
  value.toLocaleString("en-US", { month: "short", year: "2-digit" });

const asDate = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

function ScopeModal({
  project,
  selectedScopeId,
  onClose,
  onSaved,
}: {
  project: ProjectRow;
  selectedScopeId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [scopes, setScopes] = useState<ScopeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    id: "",
    title: "",
    startDate: "",
    endDate: "",
    totalHours: "",
    crewSize: "",
    notes: "",
  });

  const loadScopes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/gantt-v2/projects/${project.id}/scopes`);
      const json = await res.json();
      setScopes(json?.data || []);
      console.log(`[SCOPE] Loaded ${json?.data?.length || 0} scopes for project ${project.projectName}`);

      // Automatically sync active schedule hours to scopes
      if (project.projectNumber) {
        console.log(`[SCOPE] Starting sync with projectId=${project.id}, projectNumber=${project.projectNumber}`);
        try {
          const syncRes = await fetch("/api/gantt-v2/sync-schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: project.id,
              projectNumber: project.projectNumber,
            }),
          });

          const syncData = await syncRes.json();
          console.log(`[SCOPE] Sync response:`, syncData);
          
          // Reload scopes to show updated scheduled hours
          const reloadRes = await fetch(`/api/gantt-v2/projects/${project.id}/scopes`);
          const reloadJson = await reloadRes.json();
          setScopes(reloadJson?.data || []);
          console.log(`[SCOPE] Reloaded scopes after sync:`, reloadJson?.data);
        } catch (syncError) {
          console.warn("[SCOPE] Failed to sync active schedule:", syncError);
          // Continue with unsynced data
        }
      } else {
        console.warn('[SCOPE] No projectNumber available for sync');
      }
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    loadScopes();
  }, [loadScopes]);

  const resetForm = () => {
    setForm({ id: "", title: "", startDate: "", endDate: "", totalHours: "", crewSize: "", notes: "" });
  };

  const editScope = (scope: ScopeRow) => {
    setForm({
      id: scope.id,
      title: scope.title,
      startDate: scope.startDate || "",
      endDate: scope.endDate || "",
      totalHours: String(scope.totalHours || ""),
      crewSize: scope.crewSize === null ? "" : String(scope.crewSize),
      notes: scope.notes || "",
    });
  };

  useEffect(() => {
    if (!selectedScopeId || scopes.length === 0) return;
    const selectedScope = scopes.find((scope) => scope.id === selectedScopeId);
    if (selectedScope) {
      editScope(selectedScope);
    }
  }, [selectedScopeId, scopes]);

  const saveScope = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        totalHours: Number(form.totalHours || 0),
        crewSize: form.crewSize === "" ? null : Number(form.crewSize),
        notes: form.notes || null,
      };

      if (form.id) {
        await fetch(`/api/gantt-v2/scopes/${form.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch(`/api/gantt-v2/projects/${project.id}/scopes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      await loadScopes();
      onSaved();
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const deleteScope = async (scopeId: string) => {
    await fetch(`/api/gantt-v2/scopes/${scopeId}`, { method: "DELETE" });
    await loadScopes();
    onSaved();
    if (form.id === scopeId) resetForm();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 p-4 flex items-center justify-center">
      <div className="w-full max-w-4xl bg-white rounded-xl shadow-xl border border-gray-200 p-5 max-h-[90vh] overflow-auto">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{project.projectName}</h2>
            <p className="text-sm text-gray-500">Scopes</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">Close</button>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-gray-200 rounded-lg p-3">
            <h3 className="text-sm font-semibold mb-3 text-gray-800">Scope List</h3>
            {loading ? (
              <div className="text-sm text-gray-500">Loading...</div>
            ) : scopes.length === 0 ? (
              <div className="text-sm text-gray-500">No scopes yet.</div>
            ) : (
              <div className="space-y-2">
                {scopes.map((scope) => {
                  const pct = scope.totalHours > 0 ? Math.round((scope.scheduledHours / scope.totalHours) * 100) : 0;
                  return (
                    <div key={scope.id} className="border border-gray-200 rounded-md p-2">
                      <div className="flex justify-between items-center gap-2">
                        <div>
                          <div className="text-sm font-semibold text-gray-900">{scope.title}</div>
                          <div className="text-xs text-gray-500">
                            {scope.startDate || "No start"} - {scope.endDate || "No end"}
                          </div>
                        </div>
                        <div className="text-xs font-bold text-orange-700">{pct}%</div>
                      </div>
                      <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-orange-500" style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }} />
                      </div>
                      <div className="mt-1 grid grid-cols-3 text-[11px] text-gray-600">
                        <span>Total {scope.totalHours.toFixed(1)}</span>
                        <span>Sch {scope.scheduledHours.toFixed(1)}</span>
                        <span>Rem {scope.remainingHours.toFixed(1)}</span>
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => editScope(scope)} className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50">Edit</button>
                        <button onClick={() => deleteScope(scope.id)} className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50">Delete</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border border-gray-200 rounded-lg p-3">
            <h3 className="text-sm font-semibold mb-3 text-gray-800">{form.id ? "Edit Scope" : "New Scope"}</h3>
            <div className="space-y-2">
              <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Scope title" className="w-full border rounded px-3 py-2 text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" />
                <input type="date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" value={form.totalHours} onChange={(e) => setForm((p) => ({ ...p, totalHours: e.target.value }))} placeholder="Total hours" className="w-full border rounded px-3 py-2 text-sm" />
                <input type="number" value={form.crewSize} onChange={(e) => setForm((p) => ({ ...p, crewSize: e.target.value }))} placeholder="Crew size" className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Notes" className="w-full border rounded px-3 py-2 text-sm" rows={4} />
              <div className="flex gap-2">
                <button disabled={saving} onClick={saveScope} className="px-3 py-2 text-sm rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-60">
                  {saving ? "Saving..." : form.id ? "Update Scope" : "Create Scope"}
                </button>
                {form.id && (
                  <button onClick={resetForm} className="px-3 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50">Cancel Edit</button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProjectSchedulePage() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
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

  const timelineStart = timeline[0];
  const timelineEnd = timeline[timeline.length - 1];

  return (
    <main className="min-h-screen bg-neutral-100 p-3 md:p-4 font-sans text-slate-900">
      <div className="w-full bg-white rounded-2xl border border-gray-200 shadow-sm p-4 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-100 pb-4 mb-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-gray-900">Gantt V2</h1>
            <p className="text-xs font-semibold text-gray-500">New page on isolated database tables</p>
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
          ) : projects.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">No projects yet in Gantt V2.</div>
          ) : (
            projects.map((project) => {
              const scopes = project.scopes || [];
              const isCollapsed = collapsedProjects.has(project.id);
              const projectAllocations = project.scheduleAllocations || [];
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
                          {scopes.length} scope{scopes.length !== 1 ? "s" : ""} {"\u2022"} {project.scopedHours.toFixed(1)} hours
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
                        <div className="grid border-t border-gray-100" style={{ gridTemplateColumns: `320px repeat(${timeline.length}, ${getColumnWidth()})` }}>
                          <div className="sticky left-0 bg-white border-r border-gray-200 px-3 py-2 ml-6">
                            <div className="text-xs italic text-gray-400">No scopes yet</div>
                          </div>
                        </div>
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
                          const projectHours = project.scopedHours || 0;

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

      {selectedProject && (
        <ScopeModal
          project={selectedProject}
          selectedScopeId={selectedScopeId}
          onClose={() => {
            setSelectedProject(null);
            setSelectedScopeId(null);
          }}
          onSaved={loadProjects}
        />
      )}
    </main>
  );
}
