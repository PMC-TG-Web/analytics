"use client";

import React, { useState, useCallback } from "react";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";
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

  return (
    <main className="min-h-screen bg-neutral-100 p-2 md:p-4 font-sans text-slate-900">
      <div className="w-full flex flex-col min-h-[calc(100vh-2rem)] bg-white shadow-2xl rounded-3xl overflow-hidden border border-gray-200 p-4 md:p-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 pb-4 border-b border-gray-100">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900 uppercase italic leading-none">
              Project <span className="text-orange-600">Gantt</span>
            </h1>
            <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-[0.2em] mt-2 border-l-2 border-orange-600/30 pl-3">
              Lifecycle Visualization & Scope Control
            </p>
          </div>
          <div className="flex flex-col md:flex-row items-end md:items-center gap-4 w-full md:w-auto">
             <GanttToolbar
               startFilter={startFilter}
               setStartFilter={setStartFilter}
               viewMode={viewMode}
               setViewMode={setViewMode}
             />
             <Navigation currentPage="project-schedule" />
          </div>
        </div>

        {displayTasks.length === 0 ? (
          <div className="bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200 p-12 text-center">
             <p className="text-gray-400 font-black uppercase tracking-[0.2em]">No Active Projects in Range</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Mobile View: Timeline Cards */}
            <div className="md:hidden flex-1 overflow-y-auto space-y-4 custom-scrollbar pb-10">
              {displayTasks.filter(t => t.type === 'project').map((task, idx) => (
                <div 
                  key={`${task.jobKey}-${idx}`}
                  onClick={() => handleOpenTask(task)}
                  className="bg-gray-50 rounded-2xl p-5 border border-gray-100 shadow-sm active:scale-95 transition-all group"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      <h3 className="font-black text-gray-900 text-sm uppercase leading-tight italic truncate pr-4">{task.projectName}</h3>
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">{task.customer}</p>
                    </div>
                    <div className="bg-orange-600 text-white px-2 py-0.5 rounded-lg text-[10px] font-black">
                      #{task.projectNumber}
                    </div>
                  </div>
                  
                  <div className="bg-white rounded-xl p-3 border border-orange-50 space-y-2">
                     <div className="flex justify-between items-center text-[10px] font-bold">
                        <span className="text-gray-400 uppercase tracking-tighter">Engagement Window</span>
                        <span className="text-orange-600 uppercase tracking-widest">Active</span>
                     </div>
                     <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-orange-600" style={{ width: '60%', marginLeft: '10%' }}></div>
                     </div>
                  </div>
                  
                  <div className="mt-4 flex items-center justify-between">
                    <button className="text-[9px] font-black uppercase tracking-widest text-orange-600 flex items-center gap-1.5">
                       View Scopes 
                       <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6"></polyline>
                       </svg>
                    </button>
                    <div className="text-[8px] font-black text-gray-300 uppercase italic">PMC Analytics x Field Ops</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop View: Gantt Grid */}
            <div className="hidden md:block flex-1 bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto h-full custom-scrollbar">
                <div className="min-w-max">
                  {/* Header */}
                  <div className="grid border-b border-gray-100" style={{ gridTemplateColumns: `320px repeat(${units.length}, ${unitWidth}px)` }}>
                    <div className="sticky left-0 z-40 bg-stone-800 py-6 px-6 text-xs font-black text-white uppercase tracking-[0.2em] italic border-r border-stone-700 shadow-xl">
                      Project Matrix
                    </div>
                    {units.map((unit) => (
                      <div
                        key={unit.key}
                        className="bg-stone-800 text-center py-5 border-r border-stone-700"
                      >
                        <div className="text-[10px] text-orange-500 uppercase tracking-[0.2em] font-black mb-1">{unitLabel}</div>
                        <div className="text-sm font-black text-white italic tracking-tighter">{unit.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Rows */}
                  <div className="bg-white">
                    {displayTasks.map((task, idx) => (
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
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
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
      
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
      `}</style>
    </main>
  );
}
