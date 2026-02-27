"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";

import { db } from "@/firebase";
import { Scope, Project } from "@/types";
import { syncProjectWIP } from "@/utils/scheduleSync";

interface DayData {
  dayNumber: number;
  hours: number;
  foreman?: string;
  employees?: string[];
}

interface WeekData {
  weekNumber: number;
  days: DayData[];
}

interface ScheduleDoc {
  jobKey: string;
  customer: string;
  projectNumber: string;
  projectName: string;
  month: string;
  weeks: WeekData[];
}

interface ProjectShortTermDrawerProps {
  project: {
    id: string;
    jobKey: string;
    projectName: string;
    customer: string;
    projectNumber: string;
  };
  onClose: () => void;
  onOpenGantt: () => void;
}

export default function ProjectShortTermDrawer({ project, onClose, onOpenGantt }: ProjectShortTermDrawerProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeMonth, setActiveMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [scheduleData, setScheduleData] = useState<ScheduleDoc | null>(null);

  const loadMonthData = useCallback(async (monthStr: string) => {
    setLoading(true);
    try {
      const q = query(
        collection(db, "short term schedual"),
        where("jobKey", "==", project.jobKey),
        where("month", "==", monthStr)
      );
      const snap = await getDocs(q);
      
      if (!snap.empty) {
        setScheduleData(snap.docs[0].data() as ScheduleDoc);
      } else {
        // Initialize empty structure for the month
        setScheduleData({
          jobKey: project.jobKey,
          customer: project.customer,
          projectNumber: project.projectNumber,
          projectName: project.projectName,
          month: monthStr,
          weeks: [1, 2, 3, 4, 5, 6].map(w => ({
            weekNumber: w,
            days: [1, 2, 3, 4, 5, 6, 7].map(d => ({ dayNumber: d, hours: 0 }))
          }))
        });
      }
    } catch (error) {
      console.error("Error loading short term data:", error);
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    loadMonthData(activeMonth);
  }, [activeMonth, loadMonthData]);

  const handleHourChange = (weekNum: number, dayNum: number, val: string) => {
    if (!scheduleData) return;
    const hours = parseFloat(val) || 0;
    
    const newWeeks = scheduleData.weeks.map(w => {
      if (w.weekNumber === weekNum) {
        return {
          ...w,
          days: w.days.map(d => d.dayNumber === dayNum ? { ...d, hours } : d)
        };
      }
      return w;
    });

    setScheduleData({ ...scheduleData, weeks: newWeeks });
  };

  const saveChanges = async () => {
    if (!scheduleData) return;
    setSaving(true);
    try {
      const docId = `${project.jobKey.replace(/[^a-zA-Z0-9_-]/g, "_")}_${activeMonth}`;
      await setDoc(doc(db, "short term schedual", docId), scheduleData);
      await syncProjectWIP(project.jobKey);
      onClose();
    } catch (error) {
      alert("Error saving schedule");
    } finally {
      setSaving(false);
    }
  };

  const monthLabel = useMemo(() => {
    const [y, m] = activeMonth.split('-');
    return new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }, [activeMonth]);

  const weekHeaders = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="fixed inset-y-0 right-0 w-[90%] md:w-[60%] max-w-4xl bg-white/95 backdrop-blur-3xl shadow-2xl z-[120] flex flex-col border-l border-gray-200 animate-in slide-in-from-right duration-500">
      <div className="p-6 border-b border-gray-100 bg-gray-950 text-white flex justify-between items-center">
        <div>
          <span className="text-[10px] font-black text-orange-400 uppercase tracking-widest mb-1 block">Short Term Schedule</span>
          <h2 className="text-xl font-black uppercase tracking-tight">{project.projectName}</h2>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={onOpenGantt}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
          >
            Switch to Gantt
          </button>
          <button onClick={onClose} className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center text-xl hover:bg-gray-700 transition-colors">
            ×
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 bg-gray-50/50">
        <div className="flex items-center justify-between mb-8 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <button 
            onClick={() => {
              const [y, m] = activeMonth.split('-').map(Number);
              const prev = new Date(y, m - 2, 1);
              setActiveMonth(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`);
            }}
            className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50"
          >
            ←
          </button>
          <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">{monthLabel}</h3>
          <button 
            onClick={() => {
              const [y, m] = activeMonth.split('-').map(Number);
              const next = new Date(y, m, 1);
              setActiveMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
            }}
            className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50"
          >
            →
          </button>
        </div>

        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full"></div>
          </div>
        ) : (
          <div className="grid grid-cols-8 gap-1 mb-8">
            <div className="col-span-1"></div>
            {weekHeaders.map(h => (
              <div key={h} className="text-center py-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                {h}
              </div>
            ))}

            {scheduleData?.weeks.map((week, wIdx) => (
              <React.Fragment key={wIdx}>
                <div className="flex items-center justify-end pr-4 text-[9px] font-black text-gray-400 uppercase">
                  W{week.weekNumber}
                </div>
                {week.days.map((day, dIdx) => (
                  <div key={dIdx} className="aspect-square bg-white border border-gray-100 rounded-xl p-1 shadow-sm focus-within:ring-2 focus-within:ring-orange-500 transition-all">
                    <input 
                      type="number"
                      value={day.hours || ""}
                      onChange={(e) => handleHourChange(week.weekNumber, day.dayNumber, e.target.value)}
                      placeholder="0"
                      className="w-full h-full text-center text-sm font-black text-gray-900 focus:outline-none bg-transparent"
                    />
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>
        )}

        <div className="bg-orange-50 border border-orange-100 p-6 rounded-2xl">
          <h4 className="text-[10px] font-black text-orange-800 uppercase tracking-widest mb-2">Instructions</h4>
          <p className="text-xs font-bold text-orange-950 leading-relaxed">
            Enter the daily manpower hours for this project. These numbers will override the high-level Gantt estimates for this month in the WIP calculations.
          </p>
        </div>
      </div>

      <div className="p-6 border-t border-gray-100 flex gap-4 bg-white">
        <button 
          onClick={onClose}
          className="flex-1 px-6 py-4 border-2 border-gray-100 text-gray-600 text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-gray-50 transition-all"
        >
          Cancel
        </button>
        <button 
          onClick={saveChanges}
          disabled={saving}
          className="flex-1 px-6 py-4 bg-orange-600 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-orange-700 transition-all shadow-lg shadow-orange-900/20 disabled:bg-gray-400"
        >
          {saving ? "Saving..." : "Save Daily Assignments"}
        </button>
      </div>
    </div>
  );
}
