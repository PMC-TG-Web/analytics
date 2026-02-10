"use client";

import React, { useState, useCallback } from "react";
import ProtectedPage from "@/components/ProtectedPage";
import { useProjectSchedule } from "./hooks/useProjectSchedule";
import { ProjectScopesModal } from "./components/ProjectScopesModal";
import { GanttToolbar } from "./components/GanttToolbar";
import { GanttRow } from "./components/GanttRow";
import { ProjectInfo, GanttTask, Scope } from "@/types";

export default function ProjectSchedulePage() {
  return (
    <ProtectedPage page="project-schedule">
      <ProjectScheduleContent />
    </ProtectedPage>
  );
}

function ProjectScheduleContent() {
  const {
    loading,
    viewMode,
    setViewMode,
    startFilter,
    setStartFilter,
    units,
    displayTasks,
    expandedProjects,
    setExpandedProjects,
    scopesByJobKey,
    setScopesByJobKey,
  } = useProjectSchedule();

  const [selectedProject, setSelectedProject] = useState<ProjectInfo | null>(null);
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);

  const toggleProjectScopes = useCallback((jobKey: string) => {
    setExpandedProjects((prev) => ({
      ...prev,
      [jobKey]: !prev[jobKey],
    }));
  }, [setExpandedProjects]);

  const handleOpenTask = useCallback((task: GanttTask) => {
    setSelectedProject({
      jobKey: task.jobKey,
      customer: task.customer,
      projectNumber: task.projectNumber,
      projectName: task.projectName,
      projectDocId: task.projectDocId,
    });
    setSelectedScopeId(task.type === "scope" ? task.scopeId || null : null);
  }, []);

  const handleScopesUpdated = useCallback((jobKey: string, scopes: Scope[]) => {
    setScopesByJobKey((prev) => ({
      ...prev,
      [jobKey]: scopes,
    }));
  }, [setScopesByJobKey]);

  const unitWidth = viewMode === "day" ? 70 : viewMode === "week" ? 90 : 120;
  const unitLabel = viewMode === "day" ? "Day" : viewMode === "week" ? "Week" : "Month";

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-xl font-semibold text-gray-600">Loading schedules...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-full mx-auto">
        <GanttToolbar
          startFilter={startFilter}
          setStartFilter={setStartFilter}
          viewMode={viewMode}
          setViewMode={setViewMode}
        />

        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-max">
              {/* Header */}
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

              {/* Rows */}
              {displayTasks.length === 0 ? (
                <div className="px-6 py-10 text-center text-gray-500">No scheduled projects in this range.</div>
              ) : (
                displayTasks.map((task, idx) => (
                  <GanttRow
                    key={`${task.jobKey}-${task.type}-${task.scopeId || idx}`}
                    task={task}
                    unitWidth={unitWidth}
                    unitsCount={units.length}
                    scopesByJobKey={scopesByJobKey}
                    expandedProjects={expandedProjects}
                    onToggleProject={toggleProjectScopes}
                    onOpenTask={handleOpenTask}
                  />
                ))
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
          onScopesUpdated={handleScopesUpdated}
        />
      )}
    </div>
  );
}
