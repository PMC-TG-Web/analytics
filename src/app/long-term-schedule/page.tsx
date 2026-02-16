"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/firebase";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";
import { Scope, Project } from "@/types";
import { ProjectScopesModal } from "@/app/project-schedule/components/ProjectScopesModal";
import { getEnrichedScopes } from "@/utils/projectUtils";

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
      const snapshot = await getDocs(collection(db, "long term schedual"));
      const projectScopesSnapshot = await getDocs(collection(db, "projectScopes"));
      const projectsSnapshot = await getDocs(query(
        collection(db, "projects"),
        where("status", "not-in", ["Bid Submitted", "Lost"])
      ));
      
      const projs = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Project);
      setAllProjects(projs);
      
      const rawScopes = projectScopesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Scope));
      const enrichedScopes = getEnrichedScopes(rawScopes, projs);
      const scopesObj: Record<string, Scope[]> = {};
      enrichedScopes.forEach(scope => {
        if (scope.jobKey) {
          if (!scopesObj[scope.jobKey]) scopesObj[scope.jobKey] = [];
          scopesObj[scope.jobKey].push(scope);
        }
      });
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
      
      // Build week columns and job data
      const weekMap = new Map<string, WeekColumn>();
      const jobMap = new Map<string, JobRow>();
      const projectsWithGanttData = new Set<string>();

      // Generate week columns first
      for (let i = 0; i < 15; i++) {
        const weekDate = new Date(currentWeekStart);
        weekDate.setDate(weekDate.getDate() + (i * 7));
        const weekKey = weekDate.toISOString();
        weekMap.set(weekKey, {
          weekStartDate: weekDate,
          weekLabel: weekDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        });
      }

      // Process Gantt Scopes first
      Object.entries(scopesObj).forEach(([jobKey, scopes]) => {
        const jobProjects = projs.filter(p => {
          const pKey = `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`;
          return pKey === jobKey;
        });
        if (jobProjects.length === 0) return;

        const validScopes = scopes.filter(s => s.startDate && s.endDate);
        if (validScopes.length > 0) {
          projectsWithGanttData.add(jobKey);

          validScopes.forEach(scope => {
            const start = new Date(scope.startDate!);
            const end = new Date(scope.endDate!);
            if (isNaN(start.getTime()) || isNaN(end.getTime())) return;

            const title = (scope.title || "Scope").trim().toLowerCase();
            const titleWithoutQty = title
              .replace(/^[\d,]+\s*(sq\s*ft\.?|ln\s*ft\.?|each|lf)?\s*[-–]\s*/i, "")
              .trim();
            
            const projectCostItems = jobProjects.map(p => ({
              costitems: (p.costitems || "").toLowerCase(),
              hours: typeof p.hours === "number" ? p.hours : 0,
              costType: typeof p.costType === "string" ? p.costType : "",
            }));

            const matchedItems = projectCostItems.filter((item) =>
              item.costitems.includes(titleWithoutQty) || titleWithoutQty.includes(item.costitems)
            );

            const scopeHours = matchedItems.reduce(
              (acc, item) => !item.costType.toLowerCase().includes("management") ? acc + item.hours : acc,
              0
            ) || (typeof scope.hours === "number" ? scope.hours : 0);

            if (scopeHours <= 0) return;

            // Count work days in range (Mon-Fri)
            let workDaysInRange = 0;
            let current = new Date(start);
            while (current <= end) {
              if (current.getDay() !== 0 && current.getDay() !== 6) {
                workDaysInRange++;
              }
              current.setDate(current.getDate() + 1);
            }
            
            if (workDaysInRange === 0) return;
            const hourRatePerWorkDay = scopeHours / workDaysInRange;

            // Create job row if not exists
            if (!jobMap.has(jobKey)) {
              jobMap.set(jobKey, {
                jobKey,
                customer: jobProjects[0].customer || "",
                projectNumber: jobProjects[0].projectNumber || "",
                projectName: jobProjects[0].projectName || "",
                weekHours: {},
                totalHours: 0,
              });
            }
            const job = jobMap.get(jobKey)!;

            // Distribute hours into the weeks in our grid
            weekMap.forEach((col, weekKey) => {
              const weekStart = col.weekStartDate;
              const weekEnd = new Date(weekStart);
              weekEnd.setDate(weekEnd.getDate() + 6); // End of week

              // Find overlap between [start, end] and [weekStart, weekEnd]
              const overlapStart = start > weekStart ? start : weekStart;
              const overlapEnd = end < weekEnd ? end : weekEnd;

              if (overlapStart <= overlapEnd) {
                // Count work days in overlap
                let overlapWorkDays = 0;
                let c = new Date(overlapStart);
                while (c <= overlapEnd) {
                  if (c.getDay() !== 0 && c.getDay() !== 6) {
                    overlapWorkDays++;
                  }
                  c.setDate(c.getDate() + 1);
                }
                const overlapHours = hourRatePerWorkDay * overlapWorkDays;
                if (overlapHours > 0) {
                  job.weekHours[weekKey] = (job.weekHours[weekKey] || 0) + overlapHours;
                  job.totalHours += overlapHours;
                }
              }
            });
          });
        }
      });
      
      snapshot.docs.forEach((doc) => {
        const docData = doc.data();
        if (doc.id === "_placeholder" || !docData.jobKey) return;
        if (projectsWithGanttData.has(docData.jobKey)) return;

        const month = docData.month || "";
        const weeks = docData.weeks || [];
        const weekDates = getMonthWeekDates(month);
        
        weeks.forEach((week: WeekData) => {
          const weekDate = weekDates[week.weekNumber - 1];
          
          if (!weekDate || weekDate < currentWeekStart || weekDate >= fifteenWeeksFromStart) return;
          
          const weekKey = weekDate.toISOString();
          
          // Add week column if not exists
          if (!weekMap.has(weekKey)) {
            weekMap.set(weekKey, {
              weekStartDate: weekDate,
              weekLabel: weekDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
            });
          }
          
          // Add or update job row
          if (!jobMap.has(docData.jobKey)) {
            jobMap.set(docData.jobKey, {
              jobKey: docData.jobKey,
              customer: docData.customer || "",
              projectNumber: docData.projectNumber || "",
              projectName: docData.projectName || "",
              weekHours: {},
              totalHours: 0,
            });
          }
          
          const job = jobMap.get(docData.jobKey)!;
          job.weekHours[weekKey] = week.hours;
          job.totalHours += week.hours;
        });
      });
      
      // Convert to arrays and sort
      const columns = Array.from(weekMap.values()).sort((a, b) => 
        a.weekStartDate.getTime() - b.weekStartDate.getTime()
      );
      
      const rows = Array.from(jobMap.values()).sort((a, b) => 
        a.projectName.localeCompare(b.projectName)
      );
      
      setWeekColumns(columns);
      setJobRows(rows);
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


