"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";

import { db } from "@/firebase";
import { Scope, GanttTask, ProjectInfo, ViewMode } from "@/types";
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
import { ProjectScopesModal } from "@/app/project-schedule/components/ProjectScopesModal";

interface ProjectGanttDrawerProps {
  project: {
    id: string;
    jobKey: string;
    projectName: string;
    customer: string;
    projectNumber: string;
    status: string;
    totalHours: number;
    totalSales: number;
    scopes: Scope[];
  };
  onClose: () => void;
}

export default function ProjectGanttDrawer({ project, onClose }: ProjectGanttDrawerProps) {
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [shortTermJob, setShortTermJob] = useState<ShortTermJob | null>(null);
  const [longTermJob, setLongTermJob] = useState<LongTermJob | null>(null);
  const [monthJobs, setMonthJobs] = useState<MonthJob[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);
  
  const [startFilter, setStartFilter] = useState(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return formatDateInput(today);
  });

  const loadProjectSchedule = useCallback(async () => {
    setLoading(true);
    try {
      const { jobKey } = project;
      
      // Load all schedule data in parallel
      const [scopesSnap, stSnap, ltSnap] = await Promise.all([
        getDocs(query(collection(db, "projectScopes"), where("jobKey", "==", jobKey))),
        getDocs(query(collection(db, "short term schedual"), where("jobKey", "==", jobKey))),
        getDocs(query(collection(db, "long term schedual"), where("jobKey", "==", jobKey)))
      ]);

      // 1. Process Scopes
      const formalScopes = scopesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Scope));
      
      // Merge with virtual scopes from hub to ensure everything shows up
      const mergedScopes = [...formalScopes];
      if (project.scopes) {
        project.scopes.forEach(s => {
          const isExisting = mergedScopes.some(fs => 
            fs.title?.toLowerCase() === s.title?.toLowerCase() || fs.id === s.id
          );
          if (!isExisting) mergedScopes.push(s);
        });
      }
      setScopes(mergedScopes);

      // 2. Process Short Term
      if (!stSnap.empty) {
        const docData = stSnap.docs[0].data() as ShortTermDoc;
        const monthWeekStarts = getMonthWeekStarts(docData.month);
        const dates: Date[] = [];
        let totalHours = 0;
        
        docData.weeks?.forEach(week => {
          const weekStart = monthWeekStarts[week.weekNumber - 1];
          if (!weekStart) return;
          const weekDates = getWeekDates(weekStart);
          week.days?.forEach(day => {
            if (day.hours > 0) {
              const d = weekDates[day.dayNumber - 1];
              if (d) dates.push(d);
              totalHours += day.hours;
            }
          });
        });

        setShortTermJob({
          jobKey,
          customer: project.customer,
          projectNumber: project.projectNumber,
          projectName: project.projectName,
          projectDocId: "",
          dates,
          totalHours,
          scopes: mergedScopes
        });
      }

      // 3. Process Long Term
      if (!ltSnap.empty) {
        const docData = ltSnap.docs[0].data() as LongTermDoc;
        const monthWeekStarts = getMonthWeekStarts(docData.month);
        const weekStarts: Date[] = [];
        let totalHours = 0;

        docData.weeks?.forEach(week => {
          if (week.hours > 0) {
            const ws = monthWeekStarts[week.weekNumber - 1];
            if (ws) {
              weekStarts.push(ws);
              totalHours += week.hours;
            }
          }
        });

        setLongTermJob({
          jobKey,
          customer: project.customer,
          projectNumber: project.projectNumber,
          projectName: project.projectName,
          projectDocId: "",
          weekStarts,
          totalHours,
          scopes: mergedScopes
        });
      }

      // 4. Load Month Jobs (simpler view of long term)
      const mList: MonthJob[] = [];
      ltSnap.docs.forEach(doc => {
        const d = doc.data() as LongTermDoc;
        const monthTotal = (d.weeks || []).reduce((sum, w) => sum + (w.hours || 0), 0);
        if (monthTotal > 0) {
          mList.push({
            jobKey,
            customer: project.customer,
            projectNumber: project.projectNumber,
            projectName: project.projectName,
            projectDocId: "",
            month: d.month,
            totalHours: monthTotal,
            scopes: mergedScopes
          });
        }
      });
      setMonthJobs(mList);

    } catch (error) {
      console.error("Error loading project schedule:", error);
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    loadProjectSchedule();
  }, [loadProjectSchedule]);

  const startDateRange = useMemo(() => {
    const parsed = parseDateInput(startFilter) || new Date();
    parsed.setHours(0, 0, 0, 0);
    return parsed;
  }, [startFilter]);

  const latestDateRange = useMemo(() => {
    let maxDate = addDays(startDateRange, 90); // Default 3 months view
    
    const consider = (d?: Date | null) => {
      if (d && d.getTime() > maxDate.getTime()) maxDate = d;
    };

    scopes.forEach(s => {
      consider(parseDateInput(s.startDate || ""));
      consider(parseDateInput(s.endDate || ""));
    });
    shortTermJob?.dates.forEach(d => consider(d));
    longTermJob?.weekStarts.forEach(ws => consider(addDays(ws, 6)));

    return maxDate;
  }, [startDateRange, scopes, shortTermJob, longTermJob]);

  const units = useMemo(() => {
    const items: { key: string; label: string; date: Date }[] = [];
    if (viewMode === "day") {
      const days = diffInDays(startDateRange, latestDateRange) + 1;
      for (let i = 0; i < days; i++) {
        const date = addDays(startDateRange, i);
        items.push({ key: date.toISOString(), label: date.toLocaleDateString("en-US", { month: "numeric", day: "numeric" }), date });
      }
    } else if (viewMode === "week") {
      const weeks = Math.floor(diffInDays(startDateRange, latestDateRange) / 7) + 1;
      for (let i = 0; i < weeks; i++) {
        const date = addDays(startDateRange, i * 7);
        items.push({ key: date.toISOString(), label: `W${i+1} (${date.getMonth()+1}/${date.getDate()})`, date });
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

  const tasks = useMemo(() => {
    const results: GanttTask[] = [];
    
    // Project Task
    let pStart: Date | null = null;
    let pEnd: Date | null = null;
    
    const allDates: Date[] = [];
    scopes.forEach(s => {
      const sd = parseDateInput(s.startDate || "");
      const ed = parseDateInput(s.endDate || "");
      if (sd) allDates.push(sd);
      if (ed) allDates.push(ed);
    });
    if (shortTermJob) allDates.push(...shortTermJob.dates);
    if (longTermJob) longTermJob.weekStarts.forEach(ws => { allDates.push(ws); allDates.push(addDays(ws, 6)); });

    if (allDates.length > 0) {
      const sorted = allDates.sort((a,b) => a.getTime() - b.getTime());
      pStart = sorted[0];
      pEnd = sorted[sorted.length-1];
    }

    if (pStart && pEnd) {
      results.push({
        type: "project",
        jobKey: project.jobKey,
        customer: project.customer,
        projectNumber: project.projectNumber,
        projectName: project.projectName,
        projectDocId: "",
        start: pStart,
        end: pEnd,
        totalHours: project.totalHours
      });
    }

    // Scope Tasks
    scopes.forEach(s => {
      const sd = parseDateInput(s.startDate || "") || pStart || new Date();
      const ed = parseDateInput(s.endDate || "") || pEnd || addDays(sd, 7);
      results.push({
        type: "scope",
        jobKey: project.jobKey,
        customer: project.customer,
        projectNumber: project.projectNumber,
        projectName: project.projectName,
        projectDocId: "",
        scopeId: s.id,
        title: s.title,
        start: sd,
        end: ed,
        totalHours: s.hours || 0,
        manpower: s.manpower,
        description: s.description,
        tasks: s.tasks
      });
    });

    return results;
  }, [project, scopes, shortTermJob, longTermJob]);

  const unitWidth = viewMode === "day" ? 50 : viewMode === "week" ? 80 : 100;

  return (
    <div className="fixed inset-y-0 right-0 w-[90%] md:w-[70%] max-w-5xl bg-white/70 backdrop-blur-3xl shadow-2xl z-[120] flex flex-col border-l border-gray-200 animate-in slide-in-from-right duration-500">
      {/* Header */}
      <div className="p-6 border-b border-gray-100 bg-gray-950/90 backdrop-blur-md text-white flex justify-between items-center">
        <div>
          <span className="text-[10px] font-black text-teal-400 uppercase tracking-widest mb-1 block">{project.customer}</span>
          <h2 className="text-xl font-black uppercase tracking-tight">{project.projectName} - Schedule</h2>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex bg-gray-800 rounded-lg p-1">
            {(["day", "week", "month"] as ViewMode[]).map(m => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-3 py-1 text-[9px] font-black uppercase tracking-widest rounded ${viewMode === m ? 'bg-teal-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                {m}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center text-xl hover:bg-gray-700 transition-colors">
            ×
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-gray-50/50">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="animate-spin w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full"></div>
          </div>
        ) : (
          <div className="min-w-max p-6">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {/* Gantt Header */}
              <div className="grid" style={{ gridTemplateColumns: `200px repeat(${units.length}, ${unitWidth}px)` }}>
                <div className="sticky left-0 z-20 bg-gray-50 border-r border-gray-100 px-4 py-3 text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Task / Scope
                </div>
                {units.map((u, idx) => (
                  <div key={idx} className={`border-r border-gray-50 px-2 py-3 text-[9px] font-black text-center uppercase tracking-tighter ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                    {u.label}
                  </div>
                ))}
              </div>

              {/* Gantt Body */}
              <div className="divide-y divide-gray-50">
                {tasks.map((t, idx) => {
                  const sIdx = units.findIndex(u => t.start <= u.date);
                  const eIdx = units.findIndex(u => t.end <= u.date);
                  const actualS = sIdx === -1 ? 0 : sIdx;
                  const actualE = eIdx === -1 ? units.length - 1 : eIdx;
                  
                  const left = actualS * unitWidth;
                  const width = (actualE - actualS + 1) * unitWidth;

                  return (
                    <div key={idx} className="grid group" style={{ gridTemplateColumns: `200px repeat(${units.length}, ${unitWidth}px)` }}>
                      <div className="sticky left-0 z-20 bg-white/50 backdrop-blur-md border-r border-gray-100 px-4 py-4 flex flex-col justify-center">
                        <span className={`text-[10px] font-black uppercase truncate ${t.type === 'project' ? 'text-gray-950' : 'text-gray-800'}`}>
                          {t.type === 'project' ? 'Overall Timeline' : (t.title || 'Untitled Scope')}
                        </span>
                        {t.totalHours > 0 && (
                          <span className="text-[8px] font-bold text-teal-600 uppercase mt-0.5">{t.totalHours.toLocaleString()} Hours</span>
                        )}
                      </div>
                      <div className="relative col-span-full py-3" style={{ gridColumn: `2 / span ${units.length}` }}>
                        <div 
                          onClick={() => {
                            if (t.type === 'scope') {
                              setSelectedScopeId(t.scopeId || null);
                              setIsModalOpen(true);
                            } else {
                              setSelectedScopeId(null);
                              setIsModalOpen(true);
                            }
                          }}
                          className={`h-7 rounded-lg shadow-sm flex items-center px-3 cursor-pointer hover:brightness-110 transition-all text-white text-[9px] font-black uppercase tracking-widest overflow-hidden whitespace-nowrap ${t.type === 'project' ? 'bg-gray-900 border border-gray-800' : 'bg-teal-600'}`}
                          style={{ marginLeft: `${left}px`, width: `${width}px` }}
                        >
                          {width > 40 && (t.type === 'project' ? 'PROJECT DURATION' : t.title)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">WIP Status</h4>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-orange-50 flex items-center justify-center text-orange-600 text-xl font-black">
                    {Math.round((shortTermJob?.totalHours || 0) / (project.totalHours || 1) * 100)}%
                  </div>
                  <div>
                    <span className="text-[9px] font-black text-gray-500 uppercase block">Scheduled in ST</span>
                    <span className="text-sm font-black text-gray-900">{(shortTermJob?.totalHours || 0).toLocaleString()} / {project.totalHours.toLocaleString()} Hrs</span>
                  </div>
                </div>
              </div>
              <div className="col-span-2 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
                <div>
                  <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Quick Action</h4>
                  <p className="text-xs font-bold text-gray-600">Click any bar to update dates, manpower, or tasks.</p>
                </div>
                <button 
                  onClick={() => {
                    setSelectedScopeId(null);
                    setIsModalOpen(true);
                  }}
                  className="px-6 py-3 bg-teal-800 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-teal-900 transition-all shadow-lg shadow-teal-900/10"
                >
                  Edit Scopes/Dates
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {isModalOpen && (
        <ProjectScopesModal
          project={{
            jobKey: project.jobKey,
            projectName: project.projectName,
            customer: project.customer,
            projectNumber: project.projectNumber,
            projectDocId: project.id,
          }}
          scopes={scopes}
          selectedScopeId={selectedScopeId}
          onClose={() => setIsModalOpen(false)}
          onScopesUpdated={(jk, updated) => {
            setScopes(updated);
            loadProjectSchedule(); // Reload all schedules after update
          }}
        />
      )}
    </div>
  );
}
