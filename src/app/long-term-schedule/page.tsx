"use client";

import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/firebase";

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
  const [weekColumns, setWeekColumns] = useState<WeekColumn[]>([]);
  const [jobRows, setJobRows] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSchedules();
  }, []);

  function getMonthWeekDates(monthStr: string): Date[] {
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
      
      // Calculate the date range for next 12 weeks (including current week)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Find the Monday of the current week
      const currentWeekStart = new Date(today);
      const dayOfWeek = currentWeekStart.getDay();
      const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // If Sunday, go back 6 days; otherwise go to Monday
      currentWeekStart.setDate(currentWeekStart.getDate() + daysToMonday);
      currentWeekStart.setHours(0, 0, 0, 0);
      
      const twelveWeeksFromStart = new Date(currentWeekStart);
      twelveWeeksFromStart.setDate(twelveWeeksFromStart.getDate() + (12 * 7));
      
      // Build week columns and job data
      const weekMap = new Map<string, WeekColumn>();
      const jobMap = new Map<string, JobRow>();
      
      snapshot.docs.forEach((doc) => {
        const docData = doc.data();
        if (doc.id === "_placeholder" || !docData.jobKey) return;
        
        const month = docData.month || "";
        const weeks = docData.weeks || [];
        const weekDates = getMonthWeekDates(month);
        
        weeks.forEach((week: WeekData) => {
          const weekDate = weekDates[week.weekNumber - 1];
          
          if (!weekDate || weekDate < currentWeekStart || weekDate >= twelveWeeksFromStart) return;
          
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
            <p className="text-gray-600 mt-1">Next 12 weeks - Hours and FTE by project</p>
          </div>
          <div className="flex gap-3">
            <a href="/dashboard" className="px-4 py-2 bg-blue-800 text-white rounded-lg font-medium hover:bg-blue-900 transition-colors">
              Dashboard
            </a>
            <a href="/scheduling" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors">
              Scheduling
            </a>
            <a href="/wip" className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors">
              WIP Report
            </a>
          </div>
        </div>

        {weekColumns.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            No schedules found for the next 12 weeks.
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gradient-to-r from-blue-600 to-blue-700">
                    <th className="sticky left-0 z-20 bg-blue-600 text-left py-4 px-4 text-sm font-bold text-white border-r border-blue-500">
                      Project
                    </th>
                    <th className="sticky left-0 z-20 bg-blue-600 text-left py-4 px-4 text-sm font-bold text-white border-r border-blue-500" style={{left: '200px'}}>
                      Customer
                    </th>
                    {weekColumns.map((week) => (
                      <th key={week.weekStartDate.toISOString()} className="text-center py-4 px-3 text-sm font-bold text-white border-r border-blue-500">
                        <div>{week.weekLabel}</div>
                        <div className="text-xs font-normal text-blue-100">Week of</div>
                      </th>
                    ))}
                    <th className="text-center py-4 px-4 text-sm font-bold text-white bg-blue-800">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {jobRows.map((job, idx) => (
                    <tr key={job.jobKey} className={`border-b border-gray-200 hover:bg-blue-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                      <td className="sticky left-0 z-10 bg-inherit py-3 px-4 text-sm font-medium text-gray-900 border-r border-gray-200">
                        {job.projectName}
                      </td>
                      <td className="sticky z-10 bg-inherit py-3 px-4 text-sm text-gray-600 border-r border-gray-200" style={{left: '200px'}}>
                        {job.customer}
                      </td>
                      {weekColumns.map((week) => {
                        const weekKey = week.weekStartDate.toISOString();
                        const hours = job.weekHours[weekKey] || 0;
                        const fte = hours / 10;
                        return (
                          <td key={weekKey} className={`text-center py-3 px-3 text-sm border-r border-gray-200 ${hours > 0 ? 'bg-blue-50' : ''}`}>
                            {hours > 0 ? (
                              <div>
                                <div className="font-semibold text-gray-900">{hours.toFixed(1)}</div>
                                <div className="text-xs text-purple-600">{fte.toFixed(1)} FTE</div>
                              </div>
                            ) : (
                              <span className="text-gray-300">-</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="text-center py-3 px-4 text-sm font-bold bg-gray-100">
                        <div className="text-gray-900">{job.totalHours.toFixed(1)}</div>
                        <div className="text-xs text-purple-600">{(job.totalHours / 10).toFixed(1)} FTE</div>
                      </td>
                    </tr>
                  ))}
                  
                  {/* Totals Row */}
                  <tr className="bg-gradient-to-r from-blue-700 to-blue-800 font-bold">
                    <td className="sticky left-0 z-10 bg-blue-700 py-4 px-4 text-sm text-white border-r border-blue-600" colSpan={2}>
                      TOTAL PER WEEK
                    </td>
                    {weekTotals.map((total, idx) => (
                      <td key={idx} className="text-center py-4 px-3 text-sm text-white border-r border-blue-600">
                        <div className="font-bold">{total.toFixed(1)}</div>
                        <div className="text-xs text-blue-200">{(total / 10).toFixed(1)} FTE</div>
                      </td>
                    ))}
                    <td className="text-center py-4 px-4 text-sm text-white bg-blue-900">
                      <div className="font-bold text-lg">{grandTotal.toFixed(1)}</div>
                      <div className="text-xs text-blue-200">{(grandTotal / 10).toFixed(1)} FTE</div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

