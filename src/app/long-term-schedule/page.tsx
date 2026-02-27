"use client";

import { useEffect, useState, useMemo } from "react";


import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";
import { Scope, Project } from "@/types";
import { ProjectScopesModal } from "@/app/project-schedule/components/ProjectScopesModal";
import { getEnrichedScopes } from "@/utils/projectUtils";
import { loadActiveScheduleByWeek } from "@/utils/activeScheduleLoader";

interface WeekData {
  weekNumber: number;
  hours: number;
}

interface ScheduleDoc {
  jobKey: string;
  customer: string;
  projectNumber: string;
  projectName: string;
  month: string;
  weeks: WeekData[];
  totalHours: number;
  updatedAt: string;
}

interface WeekColumn {
  weekStartDate: Date;
  weekLabel: string;
}

interface JobRow {
  jobKey: string;
  customer: string;
  projectNumber: string;
  projectName: string;
  weekHours: Record<string, number>; // weekKey -> hours
  totalHours: number;
}

export default function LongTermSchedulePage() {
  return (
    <ProtectedPage page="long-term-schedule">
      <LongTermScheduleContent />
    </ProtectedPage>
  );
}

function LongTermScheduleContent() {
  const [weekColumns, setWeekColumns] = useState<WeekColumn[]>([]);
  const [jobRows, setJobRows] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [scopesByJobKey, setScopesByJobKey] = useState<Record<string, Scope[]>>({});
  const [selectedGanttProject, setSelectedGanttProject] = useState<Project | null>(null);

  useEffect(() => {
    loadSchedules();
  }, []);

  function openGanttModal(customer: string, projectName: string, projectNumber: string) {
    const jobKey = `${customer || ""}~${projectNumber || ""}~${projectName || ""}`;
    const project = allProjects.find((p) => {
      const pKey = `${p.customer || ""}~${p.projectNumber || ""}~${p.projectName || ""}`;
      return pKey === jobKey;
    });

    if (project) {
      setSelectedGanttProject({ ...project, jobKey });
    } else {
      console.warn("Project not found for key:", jobKey);
    }
  }

  function getMonthWeekDates(monthStr: string): Date[] {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthStr)) return [];
    const [year, month] = monthStr.split("-").map(Number);
    const dates: Date[] = [];
    
    // Find first Monday of the month
    let date = new Date(year, month - 1, 1);
    while (date.getDay() !== 1) {
      date.setDate(date.getDate() + 1);
    }
    
    // Collect all Mondays in this month
    while (date.getMonth() === month - 1) {
      dates.push(new Date(date));
      date.setDate(date.getDate() + 7);
    }
    
    return dates;
  }

  async function loadSchedules() {
    try {
      console.log('[LongTermSchedule] Loading schedules from activeSchedule...');
      
      // Load projects and scopes (unchanged)
      const projectScopesSnapshot = await getDocs(collection(db, "projectScopes"));
      const projectsSnapshot = await getDocs(query(
        collection(db, "projects"),
        where("status", "not-in", ["Bid Submitted", "Lost"])
      ));
      
      const projs = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Project);
      console.log('[LongTermSchedule] Loaded projects:', projs.length);
      setAllProjects(projs);
      
      const rawScopes = projectScopesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Scope));
      console.log('[LongTermSchedule] Loaded raw scopes:', rawScopes.length);
      const enrichedScopes = getEnrichedScopes(rawScopes, projs);
      console.log('[LongTermSchedule] Enriched scopes:', enrichedScopes.length);
      const scopesObj: Record<string, Scope[]> = {};
      enrichedScopes.forEach(scope => {
        if (scope.jobKey) {
          if (!scopesObj[scope.jobKey]) scopesObj[scope.jobKey] = [];
          scopesObj[scope.jobKey].push(scope);
        }
      });
      console.log('[LongTermSchedule] Scopes by jobKey:', Object.keys(scopesObj).length, 'jobs');
      
      // BACKFILL: Generate virtual scopes for projects without explicit scopes
      let backfilledCount = 0;
      projs.forEach(project => {
        const jobKey = `${project.customer || ''}~${project.projectNumber || ''}~${project.projectName || ''}`;
        
        // Skip if this project already has scopes
        if (scopesObj[jobKey] && scopesObj[jobKey].length > 0) return;
        
        // Get all cost items for this project (projects collection has one row per cost item)
        const projectCostItems = projs.filter(p => {
          const pKey = `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`;
          return pKey === jobKey;
        });
        
        // Group cost items by scopeOfWork/pmcGroup/costType
        const groups: Record<string, { title: string; hours: number; sales: number; cost: number }> = {};
        
        projectCostItems.forEach(item => {
          const itemHours = typeof item.hours === 'number' ? item.hours : 0;
          const itemSales = typeof item.sales === 'number' ? item.sales : 0;
          const itemCost = typeof item.cost === 'number' ? item.cost : 0;
          
          if (itemHours <= 0 && itemSales <= 0) return;
          
          // Use scopeOfWork first, then pmcGroup, then costType
          const groupName = (item as any).scopeOfWork || (item as any).pmcGroup || (item as any).pmcgroup || item.costType || 'Other';
          
          if (!groups[groupName]) {
            groups[groupName] = { title: groupName, hours: 0, sales: 0, cost: 0 };
          }
          
          // Don't count management hours
          if (!(item.costType || '').toLowerCase().includes('management')) {
            groups[groupName].hours += itemHours;
          }
          groups[groupName].sales += itemSales;
          groups[groupName].cost += itemCost;
        });
        
        // Create virtual scopes from groups
        const virtualScopes = Object.values(groups)
          .filter(g => g.hours > 0 || g.sales > 0)
          .map((group, idx) => ({
            id: `virtual-${jobKey}-${idx}`,
            jobKey,
            title: group.title,
            hours: group.hours,
            sales: group.sales,
            cost: group.cost,
            startDate: '',
            endDate: '',
            tasks: []
          }));
        
        if (virtualScopes.length > 0) {
          scopesObj[jobKey] = virtualScopes;
          backfilledCount++;
        }
      });
      
      console.log('[LongTermSchedule] Backfilled virtual scopes for', backfilledCount, 'projects');
      setScopesByJobKey(scopesObj);

      // Calculate the date range for next 15 weeks (including current week)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Find the Monday of the current week
      const currentWeekStart = new Date(today);
      const dayOfWeek = currentWeekStart.getDay();
      const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      currentWeekStart.setDate(currentWeekStart.getDate() + daysToMonday);
      currentWeekStart.setHours(0, 0, 0, 0);
      
      const fifteenWeeksFromStart = new Date(currentWeekStart);
      fifteenWeeksFromStart.setDate(fifteenWeeksFromStart.getDate() + (15 * 7));
      
      // Load schedule data from activeSchedule aggregated by week
      const { weekColumns, jobRows } = await loadActiveScheduleByWeek(currentWeekStart, fifteenWeeksFromStart);
      
      console.log('[LongTermSchedule] Loaded from activeSchedule:', jobRows.length, 'jobs', weekColumns.length, 'weeks');
      
      setWeekColumns(weekColumns);
      setJobRows(jobRows);
    } catch (error) {
      console.error("Failed to load schedules:", error);
    } finally {
      setLoading(false);
    }
  }

  const weekTotals = useMemo(() => {
    return weekColumns.map(col => {
      let sum = 0;
      const weekKey = col.weekStartDate.toISOString();
      jobRows.forEach(row => {
        sum += row.weekHours[weekKey] || 0;
      });
      return sum;
    });
  }, [weekColumns, jobRows]);

  const grandTotal = useMemo(() => {
    return weekTotals.reduce((sum, current) => sum + current, 0);
  }, [weekTotals]);

  return (
    <main className="min-h-screen bg-neutral-100 p-2 md:p-4 font-sans text-slate-900">
      <div className="w-full flex flex-col min-h-[calc(100vh-2rem)] bg-white shadow-2xl rounded-3xl overflow-hidden border border-gray-200 p-4 md:p-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 pb-8 border-b border-gray-100">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900 uppercase italic leading-none">
              Long-Term <span className="text-teal-600">Schedule</span>
            </h1>
            <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-[0.2em] mt-2 border-l-2 border-teal-600/30 pl-3">
              15-Week Project Forecast
            </p>
          </div>
          <Navigation currentPage="long-term-schedule" />
        </div>

        {weekColumns.length === 0 ? (
          <div className="bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200 p-12 text-center">
             <p className="text-gray-400 font-black uppercase tracking-[0.2em]">No Long-Term Data Found</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Mobile Cards for Field Users */}
            <div className="md:hidden flex-1 overflow-y-auto space-y-6 custom-scrollbar pb-10">
              {jobRows.filter(job => job.totalHours > 0).map((job) => (
                <div 
                  key={job.jobKey} 
                  onClick={() => openGanttModal(job.customer, job.projectName, job.projectNumber)}
                  className="bg-gray-50 rounded-2xl p-5 border border-gray-100 shadow-sm relative overflow-hidden active:scale-95 transition-all"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                      <h3 className="font-black text-gray-900 text-base uppercase leading-tight italic truncate pr-4">{job.projectName}</h3>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">{job.customer}</p>
                    </div>
                    <div className="bg-teal-600 text-white px-3 py-1 rounded-xl text-xs font-black shadow-lg shadow-teal-600/20">
                      {job.totalHours.toFixed(0)}h
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {weekColumns.filter(w => job.weekHours[w.weekStartDate.toISOString()] > 0).slice(0, 4).map((week) => {
                      const weekKey = week.weekStartDate.toISOString();
                      const hours = job.weekHours[weekKey];
                      const fte = hours / 50;
                      return (
                        <div key={weekKey} className="bg-white p-3 rounded-xl border border-teal-50">
                          <p className="text-[8px] font-black uppercase text-gray-400 mb-1">{week.weekLabel}</p>
                          <div className="flex items-center justify-between">
                            <span className="font-black text-gray-900 text-sm">{hours.toFixed(1)}h</span>
                            <span className="text-[9px] font-bold text-orange-600">{fte.toFixed(1)} FTE</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  
                  {job.totalHours > 0 && (
                     <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between items-center">
                        <span className="text-[8px] font-black uppercase tracking-widest text-teal-600">Project Status</span>
                        <div className="flex items-center gap-1.5">
                           <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                           <span className="text-[9px] font-bold text-gray-400 uppercase">Active Schedule</span>
                        </div>
                     </div>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block flex-1 bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto h-full custom-scrollbar">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-30">
                    <tr className="bg-stone-800">
                      <th className="sticky left-0 z-40 bg-stone-800 text-left py-6 px-6 text-xs font-black text-white uppercase tracking-[0.2em] italic border-r border-stone-700 w-48 shadow-lg">
                        Project Name
                      </th>
                      <th className="sticky left-0 z-40 bg-stone-800 text-left py-6 px-6 text-xs font-black text-white uppercase tracking-[0.2em] italic border-r border-stone-700 w-48 shadow-lg" style={{left: '192px'}}>
                        Customer
                      </th>
                      {weekColumns.map((week) => (
                        <th key={week.weekStartDate.toISOString()} className="text-center py-5 px-4 text-xs font-black text-white border-r border-stone-700 min-w-[150px]">
                          <div className="text-[10px] text-teal-500 uppercase tracking-widest mb-1">Week Of</div>
                          <div className="text-lg italic tracking-tighter text-white">{week.weekLabel}</div>
                        </th>
                      ))}
                      <th className="text-center py-6 px-6 text-xs font-black text-white bg-teal-900 border-l border-teal-800 uppercase tracking-widest">
                        Total Σ
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobRows.filter(job => job.totalHours > 0).map((job, idx) => (
                      <tr 
                        key={job.jobKey} 
                        className={`border-b border-gray-50 group hover:bg-teal-50/30 cursor-pointer transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                        onClick={() => openGanttModal(job.customer, job.projectName, job.projectNumber)}
                      >
                        <td className="sticky left-0 z-20 bg-inherit py-4 px-6 text-[11px] font-black text-gray-900 uppercase tracking-wider italic border-r border-gray-100 shadow-md">
                          {job.projectName}
                        </td>
                        <td className="sticky z-20 bg-inherit py-4 px-6 text-[10px] font-bold text-gray-500 uppercase tracking-widest border-r border-gray-100 shadow-md" style={{left: '192px'}}>
                          {job.customer}
                        </td>
                        {weekColumns.map((week) => {
                          const weekKey = week.weekStartDate.toISOString();
                          const hours = job.weekHours[weekKey] || 0;
                          const fte = hours / 50;
                          return (
                            <td key={weekKey} className={`text-center py-4 px-4 text-xs border-r border-gray-50 transition-all ${hours > 0 ? 'bg-teal-50/20' : ''}`}>
                              {hours > 0 ? (
                                <div className="space-y-1">
                                  <div className="font-black text-gray-900 text-sm tracking-tight">{hours.toFixed(1)}<span className="text-[9px] opacity-30 ml-0.5">H</span></div>
                                  <div className="text-[9px] font-black text-orange-600 uppercase tracking-tighter bg-orange-50 px-1.5 py-0.5 rounded-full border border-orange-100 inline-block">{fte.toFixed(1)} FTE</div>
                                </div>
                              ) : (
                                <span className="text-gray-200 select-none opacity-20">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="text-center py-4 px-6 text-sm font-black bg-stone-50 border-l border-gray-100">
                          <div className="text-gray-900">{job.totalHours.toFixed(1)}</div>
                          <div className="text-[9px] font-black text-teal-600 uppercase">{(job.totalHours / 50).toFixed(1)} Total FTE</div>
                        </td>
                      </tr>
                    ))}
                    
                    {/* Grand Totals Footer */}
                    <tr className="bg-stone-800 text-white font-black uppercase tracking-widest italic">
                      <td className="sticky left-0 z-20 bg-stone-800 py-6 px-6 text-xs border-r border-stone-700 shadow-lg" colSpan={2}>
                        Weekly Cumulative Load
                      </td>
                      {weekTotals.map((total, idx) => (
                        <td key={idx} className="text-center py-6 px-4 text-xs border-r border-stone-700">
                          <div className="text-base tracking-tighter text-teal-400">{total.toFixed(0)}H</div>
                          <div className="text-[9px] text-stone-500 opacity-60">{(total / 50).toFixed(1)} FTE</div>
                        </td>
                      ))}
                      <td className="text-center py-6 px-6 text-xs bg-teal-950 border-l border-teal-900">
                        <div className="text-lg text-teal-400">{grandTotal.toFixed(0)}H</div>
                        <div className="text-[9px] text-stone-500 opacity-60">Total Lifecycle</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedGanttProject && (
        <ProjectScopesModal
          project={selectedGanttProject as any}
          scopes={scopesByJobKey[selectedGanttProject.jobKey || ""] || []}
          selectedScopeId={null}
          onClose={() => setSelectedGanttProject(null)}
          onScopesUpdated={(jobKey, updatedScopes) => {
            const enriched = getEnrichedScopes(updatedScopes, allProjects);
            setScopesByJobKey(prev => ({ ...prev, [jobKey]: enriched }));
            loadSchedules();
          }}
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


