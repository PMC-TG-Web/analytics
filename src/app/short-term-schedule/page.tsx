"use client";

import React, { useEffect, useState } from "react";
import { collection, getDocs, doc, setDoc, getDoc } from "firebase/firestore";
import { db } from "@/firebase";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";

interface DayData {
  dayNumber: number; // 1-7 for Mon-Sun
  hours: number;
  foreman?: string; // Employee ID of assigned foreman
  employees?: string[]; // Employee IDs assigned to this day
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

interface DayColumn {
  date: Date;
  dayLabel: string;
  weekNumber: number;
}

interface DayProject {
  jobKey: string;
  customer: string;
  projectNumber: string;
  projectName: string;
  hours: number;
  foreman?: string;
  employees?: string[]; // Employee IDs assigned to this day
  month: string;
  weekNumber: number;
  dayNumber: number;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

export default function ShortTermSchedulePage() {
  return (
    <ProtectedPage page="short-term-schedule">
      <ShortTermScheduleContent />
    </ProtectedPage>
  );
}

function ShortTermScheduleContent() {
  const [dayColumns, setDayColumns] = useState<DayColumn[]>([]);
  const [foremanDateProjects, setForemanDateProjects] = useState<Record<string, Record<string, DayProject[]>>>({}); // foremanId -> dateKey -> projects
  const [foremen, setForemen] = useState<Employee[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [crewAssignments, setCrewAssignments] = useState<Record<string, Record<string, string[]>>>({}); // dateKey -> foremanId -> employee IDs
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSchedules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getWeekDates(weekStart: Date): Date[] {
    const dates: Date[] = [];
    // Monday to Friday (5 work days)
    for (let i = 0; i < 5; i++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + i);
      dates.push(date);
    }
    return dates;
  }

  function getMonthWeekStarts(monthStr: string): Date[] {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthStr)) return [];
    const [year, month] = monthStr.split("-").map(Number);
    const dates: Date[] = [];
    
    // Find first Monday of the month
    const startDate = new Date(year, month - 1, 1);
    while (startDate.getDay() !== 1) {
      startDate.setDate(startDate.getDate() + 1);
    }
    
    // Collect all Mondays in this month
    while (startDate.getMonth() === month - 1) {
      dates.push(new Date(startDate));
      startDate.setDate(startDate.getDate() + 7);
    }
    
    return dates;
  }

  function getFirstWorkdayOfMonth(monthStr: string): Date | null {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthStr)) return null;
    const [year, month] = monthStr.split("-").map(Number);
    const date = new Date(year, month - 1, 1);

    while (date.getDay() === 0 || date.getDay() === 6) {
      date.setDate(date.getDate() + 1);
    }

    return date;
  }

  function getWeekDayPositionForDate(monthStr: string, targetDate: Date): { weekNumber: number; dayNumber: number } | null {
    const monthWeekStarts = getMonthWeekStarts(monthStr);

    for (let i = 0; i < monthWeekStarts.length; i++) {
      const weekDates = getWeekDates(monthWeekStarts[i]);
      for (let d = 0; d < weekDates.length; d++) {
        if (weekDates[d].toDateString() === targetDate.toDateString()) {
          return { weekNumber: i + 1, dayNumber: d + 1 };
        }
      }
    }

    return null;
  }

  async function loadSchedules() {
    try {
      // Load employees to get foremen
      const employeesSnapshot = await getDocs(collection(db, "employees"));
      
      const allEmps = employeesSnapshot.docs
        .map(doc => ({ 
          id: doc.id, 
          firstName: doc.data().firstName || '',
          lastName: doc.data().lastName || '',
          role: doc.data().role || ''
        } as Employee))
        .sort((a, b) => {
          const nameA = `${a.firstName} ${a.lastName}`;
          const nameB = `${b.firstName} ${b.lastName}`;
          return nameA.localeCompare(nameB);
        });
      
      setAllEmployees(allEmps);
      
      const foremenList = allEmps.filter((emp) => emp.role === "Foreman" || emp.role === "Lead foreman");
      setForemen(foremenList);
      
      // Load from both collections
      const longTermSnapshot = await getDocs(collection(db, "long term schedual"));
      const shortTermSnapshot = await getDocs(collection(db, "short term schedual"));
      
      // Calculate the date range for next 5 weeks (including current week)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Find the Monday of the current week
      const currentWeekStart = new Date(today);
      const dayOfWeek = currentWeekStart.getDay();
      const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      currentWeekStart.setDate(currentWeekStart.getDate() + daysToMonday);
      currentWeekStart.setHours(0, 0, 0, 0);
      
      const fiveWeeksFromStart = new Date(currentWeekStart);
      fiveWeeksFromStart.setDate(fiveWeeksFromStart.getDate() + (5 * 7));
      
      // Build day columns for next 5 weeks
      const dayMap = new Map<string, DayColumn>();
      const projectsByDay: Record<string, DayProject[]> = {};
      const dailyScheduleKeys = new Set<string>();
      
      // Generate all work days (Mon-Fri) for next 5 weeks
      for (let weekNum = 0; weekNum < 5; weekNum++) {
        const weekStart = new Date(currentWeekStart);
        weekStart.setDate(weekStart.getDate() + (weekNum * 7));
        
        const weekDates = getWeekDates(weekStart);
        weekDates.forEach((date) => {
          const dateKey = date.toISOString().split('T')[0];
          dayMap.set(dateKey, {
            date,
            dayLabel: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
            weekNumber: weekNum + 1,
          });
          projectsByDay[dateKey] = [];
        });
      }
      
      // Load existing short-term schedules (daily) with foreman assignments
      shortTermSnapshot.docs.forEach((doc) => {
        const docData = doc.data() as ScheduleDoc;
        if (doc.id === "_placeholder" || !docData.jobKey) return;

        const scheduleKey = `${docData.jobKey}_${docData.month}`;
        let hasAnyDay = false;
        
        const weeks = docData.weeks || [];
        const monthWeekStarts = getMonthWeekStarts(docData.month);
        
        weeks.forEach((week: WeekData) => {
          const weekStart = monthWeekStarts[week.weekNumber - 1];
          if (!weekStart) return;
          
          const weekDates = getWeekDates(weekStart);
          
          (week.days || []).forEach((day: DayData) => {
            const dayDate = weekDates[day.dayNumber - 1];
            if (!dayDate || dayDate < currentWeekStart || dayDate >= fiveWeeksFromStart) return;

            hasAnyDay = true;
            
            const dateKey = dayDate.toISOString().split('T')[0];
            
            if (projectsByDay[dateKey]) {
              projectsByDay[dateKey].push({
                jobKey: docData.jobKey,
                customer: docData.customer || "",
                projectNumber: docData.projectNumber || "",
                projectName: docData.projectName || "",
                hours: day.hours,
                foreman: day.foreman || "",
                employees: day.employees || [],
                month: docData.month,
                weekNumber: week.weekNumber,
                dayNumber: day.dayNumber,
              });
            }
          });
        });

        if (hasAnyDay) {
          dailyScheduleKeys.add(scheduleKey);
        }
      });
      
      // Then, distribute weekly hours from long-term schedule if no daily data exists
      longTermSnapshot.docs.forEach((doc) => {
        const docData = doc.data();
        if (doc.id === "_placeholder" || !docData.jobKey) return;

        const scheduleKey = `${docData.jobKey}_${docData.month || ""}`;
        
        const weeks = docData.weeks || [];
        const hasWeeklyHours = Array.isArray(weeks) && weeks.some((week: { weekNumber: number; hours: number }) => (week.hours || 0) > 0);

        if (!hasWeeklyHours && docData.month && !dailyScheduleKeys.has(scheduleKey)) {
          const firstWorkday = getFirstWorkdayOfMonth(docData.month);
          if (firstWorkday && firstWorkday >= currentWeekStart && firstWorkday < fiveWeeksFromStart) {
            const dateKey = firstWorkday.toISOString().split("T")[0];
            const position = getWeekDayPositionForDate(docData.month, firstWorkday);
            const alreadyExists = projectsByDay[dateKey]?.some(p => p.jobKey === docData.jobKey);

            if (projectsByDay[dateKey] && position && !alreadyExists) {
              projectsByDay[dateKey].push({
                jobKey: docData.jobKey,
                customer: docData.customer || "",
                projectNumber: docData.projectNumber || "",
                projectName: docData.projectName || "",
                hours: docData.totalHours || 0,
                foreman: "",
                employees: [],
                month: docData.month,
                weekNumber: position.weekNumber,
                dayNumber: position.dayNumber,
              });
            }
          }
        }
        const monthWeekStarts = getMonthWeekStarts(docData.month);
        
        weeks.forEach((week: { weekNumber: number; hours: number }) => {
          const weekStart = monthWeekStarts[week.weekNumber - 1];
          if (!weekStart) return;
          
          const weekDates = getWeekDates(weekStart);
          const weekHours = week.hours || 0;
          const hoursPerDay = weekHours / 5; // Distribute evenly across 5 work days
          
          weekDates.forEach((dayDate, dayIndex) => {
            if (dayDate < currentWeekStart || dayDate >= fiveWeeksFromStart) return;
            
            const dateKey = dayDate.toISOString().split('T')[0];
            
            // Only add if no daily data exists for this project on this day
            if (projectsByDay[dateKey]) {
              const exists = projectsByDay[dateKey].some(
                p => p.jobKey === docData.jobKey
              );
              
              if (!exists) {
                projectsByDay[dateKey].push({
                  jobKey: docData.jobKey,
                  customer: docData.customer || "",
                  projectNumber: docData.projectNumber || "",
                  projectName: docData.projectName || "",
                  hours: hoursPerDay,
                  foreman: "",
                  employees: [],
                  month: docData.month,
                  weekNumber: week.weekNumber,
                  dayNumber: dayIndex + 1,
                });
              }
            }
          });
        });
      });
      
      // Convert to arrays and sort
      const columns = Array.from(dayMap.values()).sort((a, b) => 
        a.date.getTime() - b.date.getTime()
      );
      
      setDayColumns(columns);
      
      // Reorganize projects by foreman and date for table view
      const foremanDateMap: Record<string, Record<string, DayProject[]>> = {};
      foremenList.forEach(foreman => {
        foremanDateMap[foreman.id] = {};
        columns.forEach(col => {
          const dateKey = col.date.toISOString().split('T')[0];
          foremanDateMap[foreman.id][dateKey] = [];
        });
      });
      // Unassigned bucket for projects without a foreman
      foremanDateMap.__unassigned__ = {};
      columns.forEach(col => {
        const dateKey = col.date.toISOString().split('T')[0];
        foremanDateMap.__unassigned__[dateKey] = [];
      });
      
      // Populate with assigned projects
      Object.entries(projectsByDay).forEach(([dateKey, projects]) => {
        projects.forEach(project => {
          if (project.foreman) {
            if (!foremanDateMap[project.foreman]) {
              foremanDateMap[project.foreman] = {};
            }
            if (!foremanDateMap[project.foreman][dateKey]) {
              foremanDateMap[project.foreman][dateKey] = [];
            }
            foremanDateMap[project.foreman][dateKey].push(project);
          } else {
            foremanDateMap.__unassigned__[dateKey].push(project);
          }
        });
      });
      
      setForemanDateProjects(foremanDateMap);
      
      // Load crew assignments from projects
      const crewMap: Record<string, Record<string, string[]>> = {};
      Object.entries(projectsByDay).forEach(([dateKey, projects]) => {
        if (!crewMap[dateKey]) crewMap[dateKey] = {};
        
        projects.forEach(project => {
          const foremanId = project.foreman;
          if (foremanId) {
            if (!crewMap[dateKey][foremanId]) {
              crewMap[dateKey][foremanId] = [];
            }
            // Merge employees from all projects for this foreman on this date
            if (project.employees && Array.isArray(project.employees)) {
              project.employees.forEach((empId: string) => {
                if (!crewMap[dateKey][foremanId].includes(empId)) {
                  crewMap[dateKey][foremanId].push(empId);
                }
              });
            }
          }
        });
      });
      setCrewAssignments(crewMap);
    } catch (error) {
      console.error("Failed to load schedules:", error);
    } finally {
      setLoading(false);
    }
  }

  // Get all employees already assigned on a specific date (across all foremen)
  function getAssignedEmployeesForDate(dateKey: string): string[] {
    const assigned: string[] = [];
    if (crewAssignments[dateKey]) {
      Object.values(crewAssignments[dateKey]).forEach(employees => {
        employees.forEach(empId => {
          if (!assigned.includes(empId)) {
            assigned.push(empId);
          }
        });
      });
    }
    return assigned;
  }

  // Get available employees for a specific foreman/date (excludes those assigned to OTHER foremen)
  function getAvailableEmployeesForForeman(dateKey: string, currentForemanId: string): Employee[] {
    const assignedToOthers: string[] = [];
    
    if (crewAssignments[dateKey]) {
      Object.entries(crewAssignments[dateKey]).forEach(([foremanId, employees]) => {
        if (foremanId !== currentForemanId) {
          employees.forEach(empId => {
            if (!assignedToOthers.includes(empId)) {
              assignedToOthers.push(empId);
            }
          });
        }
      });
    }
    
    return allEmployees.filter(e => 
      e.role === "Field Worker" && !assignedToOthers.includes(e.id)
    );
  }

  async function updateCrewAssignment(dateKey: string, foremanId: string, selectedEmployeeIds: string[]) {
    // Validate that selected employees are not assigned to other foremen on this date
    const assignedToOthers: string[] = [];
    if (crewAssignments[dateKey]) {
      Object.entries(crewAssignments[dateKey]).forEach(([fId, employees]) => {
        if (fId !== foremanId) {
          employees.forEach(empId => {
            if (!assignedToOthers.includes(empId)) {
              assignedToOthers.push(empId);
            }
          });
        }
      });
    }
    
    // Filter out employees that are assigned elsewhere
    const validEmployeeIds = selectedEmployeeIds.filter(empId => !assignedToOthers.includes(empId));
    
    if (validEmployeeIds.length !== selectedEmployeeIds.length) {
      console.warn('Some employees are already assigned to other foremen on this date and were excluded');
    }
    
    // Update local state
    setCrewAssignments((prev) => ({
      ...prev,
      [dateKey]: { ...prev[dateKey], [foremanId]: validEmployeeIds }
    }));

    // Save to Firestore - update all projects for this foreman on this date
    setSaving(true);
    try {
      const projects = foremanDateProjects[foremanId]?.[dateKey] || [];
      
      for (const project of projects) {
        const { jobKey, customer, projectNumber, projectName, month, weekNumber, dayNumber, hours, foreman } = project;
        
        const docId = `${jobKey}_${month}`.replace(/[^a-zA-Z0-9_-]/g, "_");
        const docRef = doc(db, "short term schedual", docId);
        
        // Get the existing document
        const docSnapshot = await getDoc(docRef);
        const existingData = docSnapshot.exists() ? (docSnapshot.data() as ScheduleDoc) : null;
        
        let docData: ScheduleDoc & { updatedAt?: string };
        if (existingData) {
          docData = { ...existingData };
          if (!docData.weeks) docData.weeks = [];
          
          let weekFound = false;
          docData.weeks = docData.weeks.map((week: WeekData) => {
            if (week.weekNumber === weekNumber) {
              weekFound = true;
              const updatedDays = (week.days || []).map((day: DayData) => {
                if (day.dayNumber === dayNumber) {
                  return { ...day, hours, foreman: foreman || "", employees: selectedEmployeeIds };
                }
                return day;
              });
              
              if (!updatedDays.some((d: DayData) => d.dayNumber === dayNumber)) {
                updatedDays.push({ dayNumber, hours, foreman: foreman || "", employees: selectedEmployeeIds });
              }
              
              return { ...week, days: updatedDays };
            }
            return week;
          });
          
          if (!weekFound) {
            docData.weeks.push({
              weekNumber,
              days: [{ dayNumber, hours, foreman: foreman || "", employees: selectedEmployeeIds }]
            });
          }
        } else {
          docData = {
            jobKey,
            customer,
            projectNumber,
            projectName,
            month,
            weeks: [{
              weekNumber,
              days: [{
                dayNumber,
                hours,
                foreman: foreman || "",
                employees: selectedEmployeeIds
              }]
            }],
          };
        }
        
        docData.updatedAt = new Date().toISOString();
        await setDoc(docRef, docData, { merge: true });
      }
    } catch (error) {
      console.error("Failed to save crew assignment:", error);
    } finally {
      setSaving(false);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function saveProjectToFirestore(project: DayProject) {
    const { jobKey, customer, projectNumber, projectName, month, weekNumber, dayNumber, hours, foreman } = project;
    
    const docId = `${jobKey}_${month}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    const docRef = doc(db, "short term schedual", docId);
    
    // Get the existing document to preserve all weeks
    const docSnapshot = await getDoc(docRef);
    const existingData = docSnapshot.exists() ? (docSnapshot.data() as ScheduleDoc) : null;
    
    // If document exists, update the specific day; otherwise create new
    let docData: ScheduleDoc & { updatedAt?: string };
    if (existingData) {
      docData = { ...existingData };
      // Find and update the specific week and day
      if (!docData.weeks) docData.weeks = [];
      
      let weekFound = false;
      docData.weeks = docData.weeks.map((week: WeekData) => {
        if (week.weekNumber === weekNumber) {
          weekFound = true;
          const updatedDays = (week.days || []).map((day: DayData) => {
            if (day.dayNumber === dayNumber) {
              return { ...day, hours, foreman: foreman || "" };
            }
            return day;
          });
          
          // If day wasn't found, add it
          if (!updatedDays.some((d: DayData) => d.dayNumber === dayNumber)) {
            updatedDays.push({ dayNumber, hours, foreman: foreman || "" });
          }
          
          return { ...week, days: updatedDays };
        }
        return week;
      });
      
      // If week wasn't found, add it
      if (!weekFound) {
        docData.weeks.push({
          weekNumber,
          days: [{ dayNumber, hours, foreman: foreman || "" }]
        });
      }
    } else {
      docData = {
        jobKey,
        customer,
        projectNumber,
        projectName,
        month,
        weeks: [{
          weekNumber,
          days: [{
            dayNumber,
            hours,
            foreman: foreman || "",
          }]
        }],
      };
    }
    
    docData.updatedAt = new Date().toISOString();
    await setDoc(docRef, docData, { merge: true });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-full mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Short-Term Schedule</h1>
          <div className="text-center py-12">Loading schedules...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-full mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Short-Term Schedule</h1>
            <p className="text-gray-600 mt-1">Foremen and projects by date - Assign employees to jobs</p>
          </div>
          <Navigation currentPage="short-term-schedule" />
        </div>

        {dayColumns.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            No schedules found for the next 5 weeks.
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-lg overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gradient-to-r from-orange-600 to-orange-700">
                  <th className="sticky left-0 z-20 bg-orange-600 text-left py-3 px-4 text-sm font-bold text-white border-r border-orange-500 w-40">
                    Foreman / Date
                  </th>
                  {dayColumns.map((day) => (
                    <th 
                      key={day.date.toISOString()} 
                      className="text-center py-3 px-3 text-sm font-bold text-white border-r border-orange-500 min-w-[250px]"
                    >
                      <div>{day.dayLabel}</div>
                      <div className="text-xs font-normal text-orange-100">
                        {day.date.toLocaleDateString("en-US", { weekday: "short" })}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...foremen, { id: "__unassigned__", firstName: "Unassigned", lastName: "" }].map((foreman, foremanIdx) => {
                  const foremanProjects = foremanDateProjects[foreman.id] || {};
                  
                  return (
                    <React.Fragment key={foreman.id}>
                      {/* Foreman Row */}
                      <tr className={`border-b border-gray-300 ${foremanIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                        <td className="sticky left-0 z-10 bg-inherit py-3 px-4 text-sm font-bold text-gray-900 border-r border-gray-300">
                          {foreman.firstName} {foreman.lastName}
                        </td>
                        {dayColumns.map((day) => {
                          const dateKey = day.date.toISOString().split('T')[0];
                          const projects = (foremanProjects[dateKey] || []).filter(p => p.hours > 0);
                          const dayTotal = projects.reduce((sum, p) => sum + p.hours, 0);
                          const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
                          
                          return (
                            <td
                              key={dateKey}
                              className={`py-3 px-3 text-xs border-r border-gray-300 align-top ${isWeekend ? 'bg-gray-100' : ''}`}
                            >
                              {projects.length > 0 ? (
                                <div className="space-y-2">
                                  {projects.map((project, projIdx) => (
                                    <div key={projIdx} className="bg-orange-50 border border-orange-200 rounded p-2">
                                      <div className="font-semibold text-gray-900 text-xs truncate" title={project.projectName}>
                                        {project.projectName}
                                      </div>
                                      <div className="text-gray-600 text-xs truncate" title={project.customer}>
                                        {project.customer}
                                      </div>
                                      <div className="text-orange-600 font-bold text-xs mt-1">
                                        {project.hours.toFixed(1)} hrs
                                      </div>
                                    </div>
                                  ))}
                                  <div className="text-center py-1 font-bold text-orange-700 bg-orange-100 rounded">
                                    Total: {dayTotal.toFixed(1)} hrs
                                  </div>
                                </div>
                              ) : (
                                <div className="text-gray-300 text-xs text-center py-4">—</div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                      
                      {/* Employees Sub-Row */}
                      <tr className={`border-b border-gray-200 ${foremanIdx % 2 === 0 ? 'bg-gray-50' : 'bg-gray-100'}`}>
                        <td className="sticky left-0 z-10 bg-inherit py-2 px-4 text-xs font-semibold text-gray-600 border-r border-gray-300">
                          Crew
                        </td>
                        {dayColumns.map((day) => {
                          const dateKey = day.date.toISOString().split('T')[0];
                          const isUnassigned = foreman.id === "__unassigned__";
                          const currentEmployees = crewAssignments[dateKey]?.[foreman.id] || [];
                          const availableEmployees = getAvailableEmployeesForForeman(dateKey, foreman.id);
                          const totalAssigned = getAssignedEmployeesForDate(dateKey).length;
                          const totalFieldWorkers = allEmployees.filter(e => e.role === "Field Worker").length;
                          
                          return (
                            <td key={dateKey} className="py-2 px-3 text-xs border-r border-gray-300">
                              <div className="space-y-1">
                                <div className={`text-xs font-semibold text-center px-1 py-0.5 rounded ${
                                  totalAssigned === totalFieldWorkers 
                                    ? 'bg-red-100 text-red-700' 
                                    : totalAssigned > 0 
                                    ? 'bg-yellow-100 text-yellow-700'
                                    : 'bg-gray-100 text-gray-500'
                                }`}>
                                  {totalAssigned}/{totalFieldWorkers} assigned
                                </div>
                                {isUnassigned ? (
                                  <div className="text-xs text-gray-400 text-center py-2">
                                    Assign foreman first
                                  </div>
                                ) : (availableEmployees.length > 0 || currentEmployees.length > 0 ? (
                                  <select
                                    multiple
                                    size={3}
                                    value={currentEmployees}
                                    onChange={(e) => {
                                      const selected = Array.from(e.target.selectedOptions, option => option.value);
                                      updateCrewAssignment(dateKey, foreman.id, selected);
                                    }}
                                    disabled={saving}
                                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50"
                                  >
                                    {availableEmployees.length === 0 && currentEmployees.length === 0 && (
                                      <option disabled>No employees available</option>
                                    )}
                                    {availableEmployees.map((emp) => (
                                      <option key={emp.id} value={emp.id}>
                                        {emp.firstName} {emp.lastName}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <div className="text-xs text-red-500 text-center py-2">
                                    All crew assigned
                                  </div>
                                ))}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
