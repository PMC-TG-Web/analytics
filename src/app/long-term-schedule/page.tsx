"use client";

import { useEffect, useMemo, useState } from "react";

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
  totalHours: number;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  isActive?: boolean;
}

interface ActiveScheduleEntry {
  jobKey: string;
  scopeOfWork?: string;
  date: string;
  hours: number;
  foreman?: string | null;
  source?: string | null;
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

export default function LongTermSchedulePage() {
  const [weekColumns, setWeekColumns] = useState<WeekColumn[]>([]);
  const [foremanRows, setForemanRows] = useState<ForemanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedProject, setDraggedProject] = useState<{ jobKey: string; scopeOfWork: string } | null>(null);

  useEffect(() => {
    loadSchedules();
  }, []);

  async function loadSchedules() {
    try {
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

      const [employeesRes, scheduleRes] = await Promise.all([
        fetch("/api/short-term-schedule?action=employees"),
        fetch(`/api/short-term-schedule?action=active-schedule&startDate=${startDate}&endDate=${endDate}`),
      ]);

      const employeesJson = await employeesRes.json();
      const scheduleJson = await scheduleRes.json();

      const employees: Employee[] = employeesJson?.data || [];
      const activeSchedules: ActiveScheduleEntry[] = scheduleJson?.data || [];
      const ganttInitiatedSchedules = activeSchedules.filter((entry) => {
        const source = (entry.source || "").toLowerCase();
        return source === "gantt" || source === "wip-page";
      });

      const foremen = employees
        .filter((emp) =>
          emp.isActive &&
          (
            emp.jobTitle === "Foreman" ||
            emp.jobTitle === "Lead foreman" ||
            emp.jobTitle === "Lead Foreman" ||
            emp.jobTitle === "Lead Foreman / Project Manager"
          )
        )
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
          const allocation = weekAllocations[weekKey];
          allocation.hours += Number(entry.hours || 0);
          
          // Find or create project entry
          const projectKey = `${entry.jobKey}|${entry.scopeOfWork || 'Unnamed Scope'}`;
          let projectEntry = allocation.projects.find(p => `${p.jobKey}|${p.scopeOfWork}` === projectKey);
          if (!projectEntry) {
            projectEntry = { jobKey: entry.jobKey, scopeOfWork: entry.scopeOfWork || 'Unnamed Scope', hours: 0 };
            allocation.projects.push(projectEntry);
          }
          projectEntry.hours += Number(entry.hours || 0);
        });

        const totalHours = Object.values(weekAllocations).reduce((sum, alloc) => sum + alloc.hours, 0);
        return {
          id: foreman.id,
          name: `${foreman.firstName || ""} ${foreman.lastName || ""}`.trim() || "Foreman",
          weekAllocations,
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
      const res = await fetch('/api/gantt-v2/long-term/assign', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobKey,
          scopeOfWork,
          foreman: foremanId === '__unassigned__' ? null : foremanId,
        }),
      });

      const data = await res.json();
      if (data.success) {
        await loadSchedules(); // Reload to reflect changes
      } else {
        console.error('Failed to assign foreman:', data.error);
        alert('Failed to assign foreman: ' + data.error);
      }
    } catch (err) {
      console.error('Error assigning foreman:', err);
      alert('Error assigning foreman');
    }
  }

  function handleDragStart(jobKey: string, scopeOfWork: string) {
    setDraggedProject({ jobKey, scopeOfWork });
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault(); // Allow drop
  }

  function handleDrop(e: React.DragEvent, targetForemanId: string) {
    e.preventDefault();
    if (draggedProject) {
      assignProjectToForeman(draggedProject.jobKey, draggedProject.scopeOfWork, targetForemanId);
      setDraggedProject(null);
    }
  }

  const weekTotals = useMemo(() => {
    return weekColumns.map((col) => {
      const weekKey = col.weekStartDate.toISOString();
      return foremanRows.reduce((sum, row) => sum + (row.weekAllocations[weekKey]?.hours || 0), 0);
    });
  }, [weekColumns, foremanRows]);

  const grandTotal = useMemo(() => weekTotals.reduce((sum, current) => sum + current, 0), [weekTotals]);

  return (
    <main className="min-h-screen bg-neutral-100 p-2 md:p-4 font-sans text-slate-900">
      <div className="w-full flex flex-col min-h-[calc(100vh-2rem)] bg-white shadow-2xl rounded-3xl overflow-hidden border border-gray-200 p-4 md:p-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 pb-8 border-b border-gray-100">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900 uppercase italic leading-none">
              Long-Term <span className="text-teal-600">Schedule</span>
            </h1>
            <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-[0.2em] mt-2 border-l-2 border-teal-600/30 pl-3">
              15-Week Foreman View (Gantt-Initiated Only)
            </p>
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
              <div className="overflow-x-auto h-full custom-scrollbar">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-30">
                    <tr className="bg-stone-800">
                      <th className="sticky left-0 z-40 bg-stone-800 text-left py-6 px-6 text-xs font-black text-white uppercase tracking-[0.2em] italic border-r border-stone-700 w-56 shadow-lg">
                        Foreman
                      </th>
                      {weekColumns.map((week) => (
                        <th key={week.weekStartDate.toISOString()} className="text-center py-5 px-4 text-xs font-black text-white border-r border-stone-700 min-w-[150px]">
                          <div className="text-[10px] text-teal-500 uppercase tracking-widest mb-1">Week Of</div>
                          <div className="text-lg italic tracking-tighter text-white">{week.weekLabel}</div>
                        </th>
                      ))}
                      <th className="text-center py-6 px-6 text-xs font-black text-white bg-teal-900 border-l border-teal-800 uppercase tracking-widest">
                        Total Sum
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {foremanRows.map((row, idx) => (
                      <tr key={row.id} className={`border-b border-gray-50 transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}>
                        <td 
                          className="sticky left-0 z-20 bg-inherit py-4 px-6 text-[11px] font-black text-gray-900 uppercase tracking-wider italic border-r border-gray-100 shadow-md"
                          onDragOver={handleDragOver}
                          onDrop={(e) => handleDrop(e, row.id)}
                        >
                          {row.name}
                        </td>
                        {weekColumns.map((week) => {
                          const weekKey = week.weekStartDate.toISOString();
                          const allocation = row.weekAllocations[weekKey];
                          const hours = allocation?.hours || 0;
                          return (
                            <td
                              key={weekKey}
                              className={`text-center py-2 px-2 text-xs border-r border-gray-50 transition-all align-top ${hours > 0 ? "bg-teal-50/20" : ""}`}
                              onDragOver={handleDragOver}
                              onDrop={(e) => handleDrop(e, row.id)}
                            >
                              {hours > 0 && (
                                <div className="space-y-1">
                                  <div className="font-black text-gray-900 text-sm tracking-tight">{hours.toFixed(1)}<span className="text-[9px] opacity-30 ml-0.5">H</span></div>
                                  {allocation.projects.map((proj, idx) => (
                                    <div 
                                      key={idx} 
                                      className="text-[8px] text-left text-gray-600 mt-1 px-1 cursor-move bg-white/50 rounded border border-gray-200 hover:border-teal-400 hover:bg-teal-50 transition-colors"
                                      draggable
                                      onDragStart={() => handleDragStart(proj.jobKey, proj.scopeOfWork)}
                                    >
                                      <div className="font-bold truncate">{proj.scopeOfWork}</div>
                                      <div className="text-gray-400 truncate">{proj.jobKey.split('~')[2] || proj.jobKey}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        <td className="text-center py-4 px-6 text-sm font-black bg-stone-50 border-l border-gray-100">
                          <div className="text-gray-900">{row.totalHours.toFixed(1)}</div>
                          <div className="text-[9px] font-black text-teal-600 uppercase">{(row.totalHours / 50).toFixed(1)} Total FTE</div>
                        </td>
                      </tr>
                    ))}

                    <tr className="bg-stone-800 text-white font-black uppercase tracking-widest italic">
                      <td className="sticky left-0 z-20 bg-stone-800 py-6 px-6 text-xs border-r border-stone-700 shadow-lg">
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

            <div className="md:hidden flex-1 overflow-y-auto space-y-6 custom-scrollbar pb-10">
              {foremanRows.map((row) => (
                <div 
                  key={row.id} 
                  className="bg-gray-50 rounded-2xl p-5 border border-gray-100 shadow-sm"
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, row.id)}
                >
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-black text-gray-900 text-base uppercase leading-tight italic truncate pr-4">{row.name}</h3>
                    <div className="bg-teal-600 text-white px-3 py-1 rounded-xl text-xs font-black shadow-lg shadow-teal-600/20">
                      {row.totalHours.toFixed(0)}h
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {weekColumns
                      .filter((w) => (row.weekAllocations[w.weekStartDate.toISOString()]?.hours || 0) > 0)
                      .slice(0, 4)
                      .map((week) => {
                        const weekKey = week.weekStartDate.toISOString();
                        const allocation = row.weekAllocations[weekKey];
                        const hours = allocation?.hours || 0;
                        return (
                          <div key={weekKey} className="bg-white p-3 rounded-xl border border-teal-50">
                            <p className="text-[8px] font-black uppercase text-gray-400 mb-1">{week.weekLabel}</p>
                            <div className="mb-2">
                              <span className="font-black text-gray-900 text-sm">{hours.toFixed(1)}h</span>
                            </div>
                            {allocation?.projects.map((proj, idx) => (
                              <div 
                                key={idx} 
                                className="text-[8px] text-gray-600 mt-1 cursor-move bg-white rounded border border-gray-200 p-1 hover:border-teal-400 hover:bg-teal-50 transition-colors"
                                draggable
                                onDragStart={() => handleDragStart(proj.jobKey, proj.scopeOfWork)}
                              >
                                <div className="font-bold truncate">{proj.scopeOfWork}</div>
                                <div className="text-gray-400 truncate">{proj.jobKey.split('~')[2] || proj.jobKey}</div>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

    </main>
  );
}
