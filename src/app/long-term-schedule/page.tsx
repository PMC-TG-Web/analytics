"use client";

import { useEffect, useState } from "react";
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-full mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Long-Term Schedule</h1>
          <div className="text-center py-12">Loading schedules...</div>
        </div>
      </div>
    );
  }

  // Calculate totals per week
  const weekTotals = weekColumns.map(week => {
    const weekKey = week.weekStartDate.toISOString();
    const total = jobRows.reduce((sum, job) => sum + (job.weekHours[weekKey] || 0), 0);
    return total;
  });

  const grandTotal = jobRows.reduce((sum, job) => sum + job.totalHours, 0);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-full mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Long-Term Schedule</h1>
            <p className="text-gray-600 mt-1">Next 15 weeks - Hours and Weekly FTE by project</p>
          </div>
          <Navigation currentPage="long-term-schedule" />
        </div>

        {weekColumns.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            No schedules found for the next 15 weeks.
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gradient-to-r from-teal-600 to-teal-700">
                    <th className="sticky left-0 z-20 bg-teal-600 text-left py-4 px-4 text-sm font-bold text-white border-r border-teal-500">
                      Project
                    </th>
                    <th className="sticky left-0 z-20 bg-teal-600 text-left py-4 px-4 text-sm font-bold text-white border-r border-teal-500" style={{left: '200px'}}>
                      Customer
                    </th>
                    {weekColumns.map((week) => (
                      <th key={week.weekStartDate.toISOString()} className="text-center py-4 px-3 text-sm font-bold text-white border-r border-teal-500">
                        <div>{week.weekLabel}</div>
                        <div className="text-xs font-normal text-teal-100">Week of</div>
                      </th>
                    ))}
                    <th className="text-center py-4 px-4 text-sm font-bold text-white bg-teal-800">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {jobRows.map((job, idx) => (
                    <tr 
                      key={job.jobKey} 
                      className={`border-b border-gray-200 hover:bg-teal-50 cursor-pointer ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                      onClick={() => openGanttModal(job.customer, job.projectName, job.projectNumber)}
                    >
                      <td className="sticky left-0 z-10 bg-inherit py-3 px-4 text-sm font-medium text-gray-900 border-r border-gray-200">
                        {job.projectName}
                      </td>
                      <td className="sticky z-10 bg-inherit py-3 px-4 text-sm text-gray-600 border-r border-gray-200" style={{left: '200px'}}>
                        {job.customer}
                      </td>
                      {weekColumns.map((week) => {
                        const weekKey = week.weekStartDate.toISOString();
                        const hours = job.weekHours[weekKey] || 0;
                        const fte = hours / 50;
                        return (
                          <td key={weekKey} className={`text-center py-3 px-3 text-sm border-r border-gray-200 ${hours > 0 ? 'bg-teal-50' : ''}`}>
                            {hours > 0 ? (
                              <div>
                                <div className="font-semibold text-gray-900">{hours.toFixed(1)}</div>
                                <div className="text-xs text-orange-600">{fte.toFixed(1)} Weekly FTE</div>
                              </div>
                            ) : (
                              <span className="text-gray-300">-</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="text-center py-3 px-4 text-sm font-bold bg-gray-100">
                        <div className="text-gray-900">{job.totalHours.toFixed(1)}</div>
                        <div className="text-xs text-orange-600">{(job.totalHours / 50).toFixed(1)} Weekly FTE</div>
                      </td>
                    </tr>
                  ))}
                  
                  {/* Totals Row */}
                  <tr className="bg-gradient-to-r from-teal-700 to-teal-800 font-bold">
                    <td className="sticky left-0 z-10 bg-teal-700 py-4 px-4 text-sm text-white border-r border-teal-600" colSpan={2}>
                      TOTAL PER WEEK
                    </td>
                    {weekTotals.map((total, idx) => (
                      <td key={idx} className="text-center py-4 px-3 text-sm text-white border-r border-teal-600">
                        <div className="font-bold">{total.toFixed(1)}</div>
                      <div className="text-xs text-teal-200">{(total / 50).toFixed(1)} Weekly FTE</div>
                    </td>
                  ))}
                  <td className="text-center py-4 px-4 text-sm text-white bg-teal-900">
                    <div className="font-bold text-lg">{grandTotal.toFixed(1)}</div>
                    <div className="text-xs text-teal-200">{(grandTotal / 50).toFixed(1)} Weekly FTE</div>
                    </td>
                  </tr>
                </tbody>
              </table>
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
    </div>
  );
}


