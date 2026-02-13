"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { collection, getDocs, doc, setDoc, getDoc, query, where } from "firebase/firestore";
import { db } from "@/firebase";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";
import { Scope, Project } from "@/types";
import { getEnrichedScopes, getProjectKey } from "@/utils/projectUtils";
import { syncProjectWIP, syncGanttWithShortTerm } from "@/utils/scheduleSync";
import { useAuth } from "@/hooks/useAuth";

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
  employees?: string[]; 
  month: string;
  weekNumber: number;
  dayNumber: number;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  email?: string;
  phone?: string;
  isActive?: boolean;
}

interface TimeOffRequest {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  type: "Vacation" | "Sick" | "Personal" | "Other" | "Company timeoff";
  hours?: number;
}

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function DailyCrewDispatchBoardPage() {
  return (
    <ProtectedPage page="short-term-schedule">
      <DailyCrewDispatchBoardContent />
    </ProtectedPage>
  );
}

function DailyCrewDispatchBoardContent() {
  const { user } = useAuth();
  const [dayColumns, setDayColumns] = useState<DayColumn[]>([]);
  const [foremanDateProjects, setForemanDateProjects] = useState<Record<string, Record<string, DayProject[]>>>({}); // foremanId -> dateKey -> projects
  const [foremen, setForemen] = useState<Employee[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [crewAssignments, setCrewAssignments] = useState<Record<string, Record<string, string[]>>>({}); // dateKey -> foremanId -> employee IDs
  const [personnelSearch, setPersonnelSearch] = useState<Record<string, string>>({}); // foremanId -> search string
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Absence Alert State
  const [showSickModal, setShowSickModal] = useState(false);
  const [sickEmployeeId, setSickEmployeeId] = useState("");
  const [sickReason, setSickReason] = useState<"Sick" | "Personal" | "Late" | "No Show">("Sick");
  const [sickNotes, setSickNotes] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);

  useEffect(() => {
    loadSchedules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getWeekDates(weekStart: Date): Date[] {
    const dates: Date[] = [];
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
    const startDate = new Date(year, month - 1, 1);
    while (startDate.getDay() !== 1) {
      startDate.setDate(startDate.getDate() + 1);
    }
    while (startDate.getMonth() === month - 1) {
      dates.push(new Date(startDate));
      startDate.setDate(startDate.getDate() + 7);
    }
    return dates;
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
      const employeesSnapshot = await getDocs(collection(db, "employees"));
      const allEmps = employeesSnapshot.docs
        .map(doc => ({ 
          id: doc.id, 
          firstName: doc.data().firstName || '',
          lastName: doc.data().lastName || '',
          role: doc.data().role || '',
          email: doc.data().email || '',
          phone: doc.data().phone || '',
          isActive: doc.data().isActive !== false
        } as Employee))
        .sort((a, b) => {
          const nameA = `${a.firstName} ${a.lastName}`;
          const nameB = `${b.firstName} ${b.lastName}`;
          return nameA.localeCompare(nameB);
        });
      setAllEmployees(allEmps);
      const foremenList = allEmps.filter((emp) => emp.isActive && (emp.role === "Foreman" || emp.role === "Lead foreman"));
      setForemen(foremenList);

      const [shortTermSnapshot, projectScopesSnapshot, projectsSnapshot, longTermSnapshot, timeOffSnapshot] = await Promise.all([
        getDocs(collection(db, "short term schedual")),
        getDocs(collection(db, "projectScopes")),
        getDocs(query(
          collection(db, "projects"),
          where("status", "not-in", ["Bid Submitted", "Lost", "Complete"]),
          where("projectArchived", "==", false)
        )),
        getDocs(collection(db, "long term schedual")),
        getDocs(collection(db, "timeOffRequests"))
      ]);

      const requests = timeOffSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as TimeOffRequest[];
      setTimeOffRequests(requests);
      
      const projs = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Project);
      
      const rawScopes = projectScopesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Scope));
      const enrichedScopes = getEnrichedScopes(rawScopes, projs);
      const scopesObj: Record<string, Scope[]> = {};
      enrichedScopes.forEach(scope => {
        if (scope.jobKey) {
          if (!scopesObj[scope.jobKey]) scopesObj[scope.jobKey] = [];
          scopesObj[scope.jobKey].push(scope);
        }
      });

      const today = new Date();
      today.setHours(today.getHours(), today.getMinutes(), today.getSeconds(), today.getMilliseconds());
      const displayDate = new Date(today);
      displayDate.setHours(0, 0, 0, 0);
      
      const currentWeekStart = new Date(displayDate);
      const fiveWeeksFromStart = new Date(displayDate);
      fiveWeeksFromStart.setDate(fiveWeeksFromStart.getDate() + 1);

      const dayMap = new Map<string, DayColumn>();
      const projectsByDay: Record<string, DayProject[]> = {};
      const projectsWithGanttData = new Set<string>();

      const dateKey = formatDateKey(displayDate);
      dayMap.set(dateKey, {
        date: displayDate,
        dayLabel: displayDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        weekNumber: 1,
      });
      projectsByDay[dateKey] = [];

      Object.entries(scopesObj).forEach(([jobKey, scopes]) => {
        const jobProjects = projs.filter(p => {
          const pKey = getProjectKey(p);
          return pKey === jobKey;
        });
        if (jobProjects.length === 0) return;
        const validScopes = scopes.filter(s => s.startDate && s.endDate);
        if (validScopes.length > 0) {
          projectsWithGanttData.add(jobKey);
          validScopes.forEach(scope => {
              // Parse YYYY-MM-DD as local date to avoid timezone shift
              const [sY, sM, sD] = scope.startDate!.split('-').map(Number);
              const [eY, eM, eD] = scope.endDate!.split('-').map(Number);
              const start = new Date(sY, sM - 1, sD);
              const end = new Date(eY, eM - 1, eD);
              
            if (isNaN(start.getTime()) || isNaN(end.getTime())) return;
            const title = (scope.title || "Scope").trim().toLowerCase();
            const titleWithoutQty = title.replace(/^[\d,]+\s*(sq\s*ft\.?|ln\s*ft\.?|each|lf)?\s*[-–]\s*/i, "").trim();
            const projectCostItems = jobProjects.map(p => ({
              costitems: (p.costitems || "").toLowerCase(),
              hours: typeof p.hours === "number" ? p.hours : 0,
              costType: typeof p.costType === "string" ? p.costType : "",
            }));
            const matchedItems = projectCostItems.filter((item) => item.costitems.includes(titleWithoutQty) || titleWithoutQty.includes(item.costitems));
            const scopeHours = matchedItems.reduce((acc, item) => !item.costType.toLowerCase().includes("management") ? acc + item.hours : acc, 0) || (typeof scope.hours === "number" ? scope.hours : 0);
            if (scopeHours <= 0) return;
            let workDaysInRange = 0;
            let current = new Date(start);
            while (current <= end) {
              if (current.getDay() !== 0 && current.getDay() !== 6) workDaysInRange++;
              current.setDate(current.getDate() + 1);
            }
            if (workDaysInRange === 0) return;
            const dailyHours = scopeHours / workDaysInRange;
            current = new Date(start);
            while (current <= end) {
              if (current.getDay() !== 0 && current.getDay() !== 6) {
                const dKey = formatDateKey(current);
                if (projectsByDay[dKey]) {
                  const monthStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
                  const position = getWeekDayPositionForDate(monthStr, current);
                  projectsByDay[dKey].push({
                    jobKey,
                    customer: jobProjects[0].customer || "",
                    projectNumber: jobProjects[0].projectNumber || "",
                    projectName: jobProjects[0].projectName || "",
                    hours: dailyHours,
                    foreman: "",
                    employees: [],
                    month: monthStr,
                    weekNumber: position?.weekNumber || 1,
                    dayNumber: position?.dayNumber || (current.getDay() || 7),
                  });
                }
              }
              current.setDate(current.getDate() + 1);
            }
          });
        }
      });

      shortTermSnapshot.docs.forEach((doc) => {
        const docData = doc.data() as ScheduleDoc;
        if (doc.id === "_placeholder" || !docData.jobKey) return;
        const normalizedJobKey = docData.jobKey.replace(/\s+/g, ' '); // Ensure consistent key format
        const weeks = docData.weeks || [];
        const monthWeekStarts = getMonthWeekStarts(docData.month);
        weeks.forEach((week: WeekData) => {
          const weekStart = monthWeekStarts[week.weekNumber - 1];
          if (!weekStart) return;
          const weekDates = getWeekDates(weekStart);
          (week.days || []).forEach((day: DayData) => {
            const dayDate = weekDates[day.dayNumber - 1];
            if (!dayDate || dayDate < currentWeekStart || dayDate >= fiveWeeksFromStart) return;
            const dKey = formatDateKey(dayDate);
            if (projectsByDay[dKey]) {
              // Update ALL matching scopes for this project on this day
              let foundExisting = false;
              projectsByDay[dKey].forEach(p => {
                if (p.jobKey === normalizedJobKey || p.jobKey === docData.jobKey) {
                  p.foreman = day.foreman || "";
                  p.employees = day.employees || [];
                  // Only override hours if manually scheduled hours are provided (> 0)
                  if (day.hours > 0) p.hours = day.hours;
                  foundExisting = true;
                }
              });

              if (!foundExisting) {
                projectsByDay[dKey].push({
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
            }
          });
        });
      });

      longTermSnapshot.docs.forEach((doc) => {
        const docData = doc.data();
        if (doc.id === "_placeholder" || !docData.jobKey) return;
        if (projectsWithGanttData.has(docData.jobKey)) return;
        const weeks = docData.weeks || [];
        const monthWeekStarts = getMonthWeekStarts(docData.month);
        weeks.forEach((week: { weekNumber: number; hours: number }) => {
          const weekStart = monthWeekStarts[week.weekNumber - 1];
          if (!weekStart) return;
          const weekDates = getWeekDates(weekStart);
          const hoursPerDay = (week.hours || 0) / 5;
          if (hoursPerDay <= 0) return;
          weekDates.forEach((dayDate, dayIndex) => {
            if (dayDate < currentWeekStart || dayDate >= fiveWeeksFromStart) return;
            const dKey = formatDateKey(dayDate);
            if (projectsByDay[dKey]) {
              const exists = projectsByDay[dKey].some(p => p.jobKey === docData.jobKey);
              if (!exists) {
                projectsByDay[dKey].push({
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

      const columns = Array.from(dayMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
      setDayColumns(columns);

      const foremanDateMap: Record<string, Record<string, DayProject[]>> = {};
      foremenList.forEach(foreman => {
        foremanDateMap[foreman.id] = {};
        columns.forEach(col => {
          const dateKey = col.date.toISOString().split('T')[0];
          foremanDateMap[foreman.id][dateKey] = [];
        });
      });
      foremanDateMap.__unassigned__ = {};
      columns.forEach(col => {
        const dateKey = col.date.toISOString().split('T')[0];
        foremanDateMap.__unassigned__[dateKey] = [];
      });

      Object.entries(projectsByDay).forEach(([dateKey, projects]) => {
        projects.forEach(project => {
          if (project.foreman) {
            if (!foremanDateMap[project.foreman]) foremanDateMap[project.foreman] = {};
            if (!foremanDateMap[project.foreman][dateKey]) foremanDateMap[project.foreman][dateKey] = [];
            foremanDateMap[project.foreman][dateKey].push(project);
          } else {
            foremanDateMap.__unassigned__[dateKey].push(project);
          }
        });
      });
      setForemanDateProjects(foremanDateMap);

      const crewMap: Record<string, Record<string, string[]>> = {};
      Object.entries(projectsByDay).forEach(([dateKey, projects]) => {
        if (!crewMap[dateKey]) crewMap[dateKey] = {};
        projects.forEach(project => {
          const foremanId = project.foreman;
          if (foremanId) {
            if (!crewMap[dateKey][foremanId]) crewMap[dateKey][foremanId] = [];
            if (project.employees && Array.isArray(project.employees)) {
              project.employees.forEach((empId: string) => {
                if (!crewMap[dateKey][foremanId].includes(empId)) crewMap[dateKey][foremanId].push(empId);
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

  function getAssignedEmployeesForDate(dateKey: string): string[] {
    const assigned: string[] = [];
    if (crewAssignments[dateKey]) {
      Object.values(crewAssignments[dateKey]).forEach(employees => {
        employees.forEach(empId => {
          if (!assigned.includes(empId)) assigned.push(empId);
        });
      });
    }
    return assigned;
  }

  function getAvailableEmployeesForForeman(dateKey: string, currentForemanId: string): Employee[] {
    const assignedToOthers: string[] = [];
    if (crewAssignments[dateKey]) {
      Object.entries(crewAssignments[dateKey]).forEach(([foremanId, employees]) => {
        if (foremanId !== currentForemanId) {
          employees.forEach(empId => {
            if (!assignedToOthers.includes(empId)) assignedToOthers.push(empId);
          });
        }
      });
    }

    return allEmployees.filter(e => {
      const isBasicFilter = e.isActive && (e.role === "Field Worker" || e.role === "Field worker") && !assignedToOthers.includes(e.id);
      if (!isBasicFilter) return false;

      // Check time off
      const totalHoursOff = timeOffRequests
        .filter(req => req.employeeId === e.id && dateKey >= req.startDate && dateKey <= req.endDate)
        .reduce((sum, req) => sum + (req.hours || 10), 0);

      return totalHoursOff < 10; // Only hide if they are off for the full day (10h+)
    });
  }

  async function updateCrewAssignment(dateKey: string, foremanId: string, selectedEmployeeIds: string[]) {
    const assignedToOthers: string[] = [];
    if (crewAssignments[dateKey]) {
      Object.entries(crewAssignments[dateKey]).forEach(([fId, employees]) => {
        if (fId !== foremanId) {
          employees.forEach(empId => {
            if (!assignedToOthers.includes(empId)) assignedToOthers.push(empId);
          });
        }
      });
    }
    const validEmployeeIds = selectedEmployeeIds.filter(empId => !assignedToOthers.includes(empId));
    setCrewAssignments((prev) => ({
      ...prev,
      [dateKey]: { ...prev[dateKey], [foremanId]: validEmployeeIds }
    }));

    setSaving(true);
    try {
      const projects = foremanDateProjects[foremanId]?.[dateKey] || [];
      for (const project of projects) {
        const { jobKey, customer, projectNumber, projectName, month, weekNumber, dayNumber, hours, foreman } = project;
        const docId = `${jobKey}_${month}`.replace(/[^a-zA-Z0-9_-]/g, "_");
        const docRef = doc(db, "short term schedual", docId);
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
                if (day.dayNumber === dayNumber) return { ...day, hours, foreman: foreman || "", employees: selectedEmployeeIds };
                return day;
              });
              if (!updatedDays.some((d: DayData) => d.dayNumber === dayNumber)) {
                updatedDays.push({ dayNumber, hours, foreman: foreman || "", employees: selectedEmployeeIds });
              }
              return { ...week, days: updatedDays };
            }
            return week;
          });
          if (!weekFound) docData.weeks.push({ weekNumber, days: [{ dayNumber, hours, foreman: foreman || "", employees: selectedEmployeeIds }] });
        } else {
          docData = { jobKey, customer, projectNumber, projectName, month, weeks: [{ weekNumber, days: [{ dayNumber, hours, foreman: foreman || "", employees: selectedEmployeeIds }] }] };
        }
        docData.updatedAt = new Date().toISOString();
        await setDoc(docRef, docData, { merge: true });
        await syncProjectWIP(jobKey);
        await syncGanttWithShortTerm(jobKey);
      }
    } catch (error) {
      console.error("Failed to save crew assignment:", error);
    } finally {
      setSaving(false);
    }
  }

  async function sendAbsenceNotification() {
    if (!sickEmployeeId) {
      alert("Please select an employee.");
      return;
    }

    const employee = allEmployees.find(e => e.id === sickEmployeeId);
    if (!employee) return;

    setSendingEmail(true);
    try {
      // Find recipients: Management, PMs, Office, Foremen
      const recipientRoles = ["Office Staff", "Foreman", "Lead foreman", "Project Manager", "Executive", "General Manager"];
      
      console.log("Debug - All active employees:", allEmployees.filter(e => e.isActive).length);
      console.log("Debug - Searching for roles:", recipientRoles);
      
      // FOR TESTING: Distro restricted to Todd only
      const recipients = ["todd@pmcdecor.com"];

      const recipientPhones = Array.from(new Set(
        recipients
          .map(email => allEmployees.find(e => e.email?.toLowerCase() === email.toLowerCase())?.phone)
          .filter((phone): phone is string => !!phone)
      ));
      
      /* 
      // Original dynamic distribution logic (Re-enable after testing)
      const dynamicRecipients = allEmployees
        .filter(e => {
          const roleNormalized = (e.role || "").toLowerCase();
          const hasRole = recipientRoles.some(r => r.toLowerCase() === roleNormalized);
          const hasEmail = !!e.email && e.email.includes("@");
          const isActive = e.isActive !== false;
          return isActive && hasEmail && hasRole;
        })
        .map(e => e.email!);
      */

      if (recipients.length === 0) {
        // Fallback: If no managers found, at least notify the current user if they have an email
        if (user?.email) {
          console.log("No recipients found, falling back to current user:", user.email);
          recipients.push(user.email);
        } else {
          throw new Error("No recipients found with valid emails. Please check employee records for roles like Office, Foreman, or PM.");
        }
      }

      const response = await fetch("/api/notify-absence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeName: `${employee.firstName} ${employee.lastName}`,
          reason: sickReason,
          notes: sickNotes,
          recipients: recipients,
          recipientPhones: recipientPhones,
          reportedBy: user?.email || "Unknown User"
        }),
      });

      const responseData = await response.json();
      if (!response.ok) {
        throw new Error(responseData.error || "Failed to send email");
      }

      const smsSent = responseData?.sms?.sent || 0;
      const smsError = responseData?.sms?.error;
      const smsSummary = smsSent > 0 ? ` and texted ${smsSent} number${smsSent > 1 ? "s" : ""}` : "";
      const smsWarning = smsError ? ` SMS error: ${smsError}` : "";
      alert(`Notification sent to ${recipients.length} team members${smsSummary}.${smsWarning}`);
      setShowSickModal(false);
      setSickEmployeeId("");
      setSickNotes("");
    } catch (error) {
      console.error("Error sending absence notification:", error);
      alert("Error: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setSendingEmail(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-xl font-semibold text-gray-600 italic">Initializing Dispatch Board...</div>
      </div>
    );
  }

  const today = dayColumns[0];
  const dateKey = today ? formatDateKey(today.date) : "";
  
  // Totals for the whole company today
  let globalScheduledHours = 0;
  Object.values(foremanDateProjects).forEach(dateMap => {
    if (dateMap[dateKey]) {
      dateMap[dateKey].forEach(proj => {
        globalScheduledHours += proj.hours;
      });
    }
  });
  
  let totalHoursOff = 0;
  let workersOffCount = 0;
  const peopleOffToday: { name: string, hours: number, type: string }[] = [];
  const fieldWorkers = allEmployees.filter(e => (e.role === "Field Worker" || e.role === "Field worker") && e.isActive);

  fieldWorkers.forEach(worker => {
    const matchingReq = timeOffRequests.find(req => 
      req.employeeId === worker.id && dateKey >= req.startDate && dateKey <= req.endDate
    );
    if (matchingReq) {
      const hrs = matchingReq.hours || 10;
      totalHoursOff += hrs;
      workersOffCount++;
      peopleOffToday.push({ 
        name: `${worker.firstName} ${worker.lastName}`, 
        hours: hrs,
        type: matchingReq.type 
      });
    }
  });
  
  const globalCapacityHours = (fieldWorkers.length * 10) - totalHoursOff;
  const globalAssignedCount = getAssignedEmployeesForDate(dateKey).length;
  const globalActualHours = globalAssignedCount * 10;

  return (
    <div className="h-screen overflow-hidden bg-gray-50 flex flex-col p-2 md:p-4 text-gray-900">
      <div className="max-w-full mx-auto w-full flex flex-col h-full bg-white shadow-2xl rounded-3xl overflow-hidden border border-gray-200">

        <div className="md:hidden border-b border-gray-200 bg-gray-50 px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-center justify-center bg-teal-600 px-4 py-2 rounded-2xl shadow-lg shadow-teal-600/20">
                <span className="text-[9px] font-black uppercase tracking-widest opacity-80 leading-none mb-1 text-teal-50">
                  {today?.date.toLocaleDateString("en-US", { month: "short" })}
                </span>
                <span className="text-2xl font-black leading-none text-white">{today?.date.getDate()}</span>
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tight text-gray-900 uppercase italic">Crew Dispatch</h1>
                <div className="text-[10px] font-bold text-teal-600 uppercase tracking-widest">
                  {today?.date.toLocaleDateString("en-US", { weekday: "long" })}
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowSickModal(true)}
              className="bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-lg shadow-sm transition-all"
            >
              Report
            </button>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="px-3 py-2 rounded-xl bg-white border border-gray-200 flex flex-col items-center justify-center shadow-sm">
              <span className="text-[8px] uppercase font-black text-gray-400 tracking-widest mb-1">Away</span>
              <span className="text-lg font-black text-gray-400">{workersOffCount}</span>
            </div>
            <div className="px-3 py-2 rounded-xl bg-white border border-gray-200 flex flex-col items-center justify-center shadow-sm">
              <span className="text-[8px] uppercase font-black text-gray-400 tracking-widest mb-1">Total</span>
              <span className="text-lg font-black text-teal-600">{globalScheduledHours.toFixed(0)}h</span>
            </div>
            <div className="px-3 py-2 rounded-xl bg-white border border-gray-200 flex flex-col items-center justify-center shadow-sm">
              <span className="text-[8px] uppercase font-black text-gray-400 tracking-widest mb-1">Manpower</span>
              <span className="text-lg font-black text-orange-600">{globalActualHours.toFixed(0)}h</span>
            </div>
          </div>
        </div>

        {/* Kiosk-Style Header - Ultra Compact */}
        <div className="hidden md:flex flex-row justify-between items-center px-4 py-2 bg-gray-100/50 border-b border-gray-200">
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-center justify-center bg-teal-600 px-3 py-1 rounded-xl shadow-lg shadow-teal-600/20">
              <span className="text-[8px] font-black uppercase tracking-widest opacity-80 leading-none mb-0.5 text-teal-50">{today?.date.toLocaleDateString("en-US", { month: "short" })}</span>
              <span className="text-xl font-black leading-none text-white">{today?.date.getDate()}</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black tracking-tighter text-gray-900 uppercase italic">Daily Crew Dispatch</h1>
                <button
                  onClick={() => setShowSickModal(true)}
                  className="bg-red-600 hover:bg-red-700 text-white text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-md shadow-sm transition-all"
                >
                  Report Absence
                </button>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] font-bold text-teal-600 uppercase tracking-widest">{today?.date.toLocaleDateString("en-US", { weekday: "long" })}</span>
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest leading-none">| Active Ops</span>
              </div>
            </div>
          </div>
          
          <div className="flex gap-2">
            <div className="px-3 py-1 rounded-xl bg-white border border-gray-200 flex flex-col items-center justify-center min-w-[60px] shadow-sm">
              <span className="text-[8px] uppercase font-black text-gray-400 tracking-widest mb-0.5">Away</span>
              <span className="text-lg font-black text-gray-400">{workersOffCount}</span>
            </div>
            <div className="px-4 py-1 rounded-xl bg-white border border-gray-200 flex flex-col items-center justify-center min-w-[90px] shadow-sm">
              <span className="text-[8px] uppercase font-black text-gray-400 tracking-widest mb-0.5">Total Sched</span>
              <span className="text-lg font-black text-teal-600">{globalScheduledHours.toFixed(0)} <span className="text-[10px] font-bold opacity-40">H</span></span>
            </div>
            <div className="px-4 py-1 rounded-xl bg-white border border-gray-200 flex flex-col items-center justify-center min-w-[100px] shadow-sm">
              <span className="text-[8px] uppercase font-black text-gray-400 tracking-widest mb-0.5">Manpower</span>
              <span className="text-lg font-black text-orange-600">{globalActualHours.toFixed(0)}<span className="text-[10px] font-bold opacity-40">/{globalCapacityHours}</span></span>
            </div>
            <div className="w-px bg-gray-200 mx-1"></div>
            <Navigation currentPage="daily-crew-dispatch-board" />
          </div>
        </div>

        <div className="md:hidden flex-1 overflow-auto p-3 bg-gray-50 custom-scrollbar">
          <div className="space-y-4">
            {foremen.map((foreman) => {
              const projects = (foremanDateProjects[foreman.id]?.[dateKey] || []).filter(p => p.hours > 0);
              const scheduledHrs = projects.reduce((sum, p) => sum + p.hours, 0);
              const currentEmployees = crewAssignments[dateKey]?.[foreman.id] || [];
              const actualHrs = currentEmployees.length * 10;
              const diff = actualHrs - scheduledHrs;
              const statusColor = Math.abs(diff) < 2 ? 'bg-green-500' : diff > 0 ? 'bg-blue-500' : 'bg-red-500';
              const crewList = currentEmployees
                .map(empId => allEmployees.find(e => e.id === empId))
                .filter((emp): emp is Employee => !!emp)
                .map(emp => `${emp.firstName} ${emp.lastName}`);

              return (
                <div key={foreman.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
                    <div>
                      <div className="text-lg font-black text-gray-900">{foreman.firstName} {foreman.lastName}</div>
                      <div className="text-[10px] font-black uppercase text-gray-400">Actual {actualHrs}h · Sched {scheduledHrs}h</div>
                    </div>
                    <div className={`w-2.5 h-2.5 rounded-full ${statusColor}`}></div>
                  </div>
                  <div className="p-4 space-y-3">
                    <div>
                      <div className="text-[10px] uppercase font-black text-gray-400 tracking-widest mb-2">Job Assignments</div>
                      <div className="space-y-2">
                        {projects.map((p, pIdx) => (
                          <div key={pIdx} className="bg-gray-50 px-3 py-2 rounded-xl flex justify-between items-center border border-gray-100">
                            <div className="overflow-hidden">
                              <div className="font-black text-gray-800 text-xs truncate leading-tight uppercase">{p.projectName}</div>
                              <div className="text-[10px] text-teal-600 font-bold tracking-tight opacity-70 truncate uppercase">{p.customer}</div>
                            </div>
                            <div className="bg-white px-2 py-1 rounded-lg text-teal-600 font-black text-[10px] ml-2 border border-teal-50">
                              {p.hours.toFixed(0)} <span className="opacity-50 uppercase">h</span>
                            </div>
                          </div>
                        ))}
                        {projects.length === 0 && <div className="text-xs text-gray-400 italic">No projects assigned</div>}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase font-black text-gray-400 tracking-widest mb-2">Crew</div>
                      {crewList.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {crewList.map((name) => (
                            <span key={name} className="px-2 py-1 text-[10px] font-bold bg-gray-100 rounded-full text-gray-700">
                              {name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-gray-400 italic">No crew assigned</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {foremanDateProjects.__unassigned__?.[dateKey]?.filter(p => p.hours > 0).length > 0 && (
              <div className="p-3 bg-orange-50 border border-orange-100 rounded-2xl">
                <div className="text-[10px] font-black uppercase tracking-widest text-orange-600 mb-2">Unassigned</div>
                <div className="flex flex-col gap-2">
                  {foremanDateProjects.__unassigned__[dateKey].filter(p => p.hours > 0).map((p, pIdx) => (
                    <Link 
                      key={pIdx} 
                      href={`/short-term-schedule?search=${encodeURIComponent(p.projectName)}`}
                      className="bg-white border border-orange-200 rounded-xl px-3 py-2 flex items-center justify-between gap-3 shadow-sm hover:border-orange-500 transition-colors"
                    >
                      <span className="text-xs font-black text-gray-800">{p.projectName}</span>
                      <span className="text-[10px] font-black text-orange-600 bg-orange-50 px-1.5 rounded-lg">{p.hours.toFixed(0)}h</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Dispatch Grid - Compressed "No-Scroll" Layout */}
        <div className="hidden md:block flex-1 overflow-hidden p-2 bg-gray-50">
          <div 
            className="grid grid-rows-2 grid-flow-col gap-2 h-full"
            style={{ gridTemplateColumns: `repeat(${Math.ceil(foremen.length / 2)}, minmax(0, 1fr))` }}
          >
            {foremen.map((foreman) => {
              const projects = (foremanDateProjects[foreman.id]?.[dateKey] || []).filter(p => p.hours > 0);
              const scheduledHrs = projects.reduce((sum, p) => sum + p.hours, 0);
              const currentEmployees = crewAssignments[dateKey]?.[foreman.id] || [];
              const actualHrs = currentEmployees.length * 10;
              const availableEmployees = getAvailableEmployeesForForeman(dateKey, foreman.id);
              
              const diff = actualHrs - scheduledHrs;
              const statusColor = Math.abs(diff) < 2 ? 'bg-green-500' : diff > 0 ? 'bg-blue-500' : 'bg-red-500';
              const statusBorder = Math.abs(diff) < 2 ? 'border-green-500/30' : diff > 0 ? 'border-blue-500/30' : 'border-red-500/40';

              return (
                <div 
                  key={foreman.id} 
                  className={`bg-white rounded-xl border-2 ${statusBorder} flex flex-col overflow-hidden shadow-sm h-full`}
                >
                  {/* Card Header - Ultra Compact */}
                  <div className="px-2 py-1.5 flex justify-between items-center bg-gray-50 border-b border-gray-100">
                    <h3 className="text-sm font-black text-gray-900 truncate max-w-[100px]">{foreman.firstName}</h3>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div className="text-sm font-black text-gray-900 leading-none">{actualHrs}</div>
                      </div>
                      <div className="w-px h-4 bg-gray-300"></div>
                      <div className="text-right">
                        <div className="text-sm font-black text-gray-500 leading-none">{scheduledHrs}</div>
                      </div>
                    </div>
                  </div>

                  <div className="p-2 space-y-2 flex-1 flex flex-col min-h-0">
                    {/* Projects Section - More Pronounced */}
                    <div className="flex-none pb-1">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <div className={`w-2 h-2 rounded-full ${statusColor} shadow-sm`}></div>
                        <h4 className="text-[10px] uppercase font-black text-gray-500 tracking-widest">Assignments</h4>
                      </div>
                      <div className="space-y-1 max-h-[120px] overflow-y-auto no-scrollbar">
                        {projects.map((p, pIdx) => (
                          <div key={pIdx} className="bg-gray-100/50 px-2 py-2 rounded-lg flex justify-between items-center border border-gray-200">
                            <div className="overflow-hidden">
                              <div className="font-black text-gray-900 text-xs truncate max-w-[150px] uppercase leading-tight">{p.projectName}</div>
                              <div className="text-[9px] font-bold text-teal-600 truncate uppercase opacity-70 tracking-tighter mt-0.5">{p.customer}</div>
                            </div>
                            <div className="bg-white px-1.5 py-1 rounded shadow-sm border border-teal-50 text-teal-600 font-black text-[10px] ml-2">
                              {p.hours.toFixed(0)}h
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Personnel Selection - Interactive Toggle UI */}
                    <div className="flex-1 flex flex-col min-h-0">
                      <div className="flex justify-between items-center mb-1">
                        <h4 className="text-[8px] uppercase font-black text-gray-400">Crew ({currentEmployees.length})</h4>
                      </div>
                      
                      <div className="flex-1 bg-gray-50 border border-gray-100 rounded-lg overflow-hidden flex flex-col min-h-0">
                        <div className="px-1.5 py-1 border-b border-gray-100 bg-white">
                          <div className="relative">
                            <input 
                              type="text"
                              placeholder="Search..."
                              value={personnelSearch[foreman.id] || ""}
                              onChange={(e) => setPersonnelSearch(prev => ({ ...prev, [foreman.id]: e.target.value }))}
                              className="w-full pl-6 pr-2 py-0.5 text-[10px] font-bold bg-gray-50 border border-gray-100 rounded focus:outline-none"
                            />
                            <svg className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-400" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                          </div>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar p-1 space-y-0.5 bg-gray-50/50">
                          {/* Currently Assigned */}
                          {currentEmployees.map(empId => {
                            const emp = allEmployees.find(e => e.id === empId);
                            if (!emp) return null;
                            return (
                              <button
                                key={emp.id}
                                onClick={() => {
                                  const newSelected = currentEmployees.filter(id => id !== empId);
                                  updateCrewAssignment(dateKey, foreman.id, newSelected);
                                }}
                                disabled={saving}
                                className="w-full flex items-center justify-between px-1.5 py-1 bg-teal-600 text-white rounded text-[10px] font-black hover:bg-teal-700 transition-all text-left"
                              >
                                <span className="truncate">{emp.firstName} {emp.lastName}</span>
                                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              </button>
                            );
                          })}
                          
                          {/* Available to Assign */}
                          {availableEmployees
                            .filter(emp => !currentEmployees.includes(emp.id))
                            .filter(emp => {
                              const search = (personnelSearch[foreman.id] || "").toLowerCase();
                              if (!search) return true;
                              return `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(search);
                            })
                            .map(emp => {
                              const hoursOff = timeOffRequests
                                .filter(req => req.employeeId === emp.id && dateKey >= req.startDate && dateKey <= req.endDate)
                                .reduce((sum, req) => sum + (req.hours || 10), 0);
                              
                              return (
                                <button
                                  key={emp.id}
                                  onClick={() => {
                                    const newSelected = [...currentEmployees, emp.id];
                                    updateCrewAssignment(dateKey, foreman.id, newSelected);
                                  }}
                                  disabled={saving}
                                  className="w-full flex items-center justify-between px-1.5 py-1 bg-white border border-gray-200 text-gray-700 rounded text-[10px] font-bold hover:border-teal-500 hover:text-teal-600 transition-all text-left group"
                                >
                                  <div className="flex flex-col truncate">
                                    <span className="truncate">{emp.firstName} {emp.lastName}</span>
                                    {hoursOff > 0 && <span className="text-[7px] text-orange-600 font-extrabold leading-none">OFF</span>}
                                  </div>
                                  <svg className="opacity-0 group-hover:opacity-100 text-teal-600" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                                  </svg>
                                </button>
                              );
                            })
                          }
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Utilization Indicator */}
                  <div className="h-1 w-full bg-gray-100">
                    <div 
                      className={`h-full opacity-80 ${statusColor}`} 
                      style={{ width: `${Math.min(100, (actualHrs / (scheduledHrs || 1)) * 100)}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Unassigned Projects - Compact Tray */}
        {foremanDateProjects.__unassigned__?.[dateKey]?.filter(p => p.hours > 0).length > 0 && (
          <div className="hidden md:flex p-1.5 bg-orange-50 border-t border-orange-100 items-center gap-2">
            <span className="text-[8px] font-black uppercase tracking-widest bg-orange-500 text-white px-1.5 py-0.5 rounded shadow-sm">Unassigned</span>
            <div className="flex-1 flex gap-2 overflow-x-auto no-scrollbar">
              {foremanDateProjects.__unassigned__[dateKey].filter(p => p.hours > 0).map((p, pIdx) => (
                <Link 
                  key={pIdx} 
                  href={`/short-term-schedule?search=${encodeURIComponent(p.projectName)}`}
                  className="bg-white border border-orange-200 rounded-lg px-2 py-0.5 flex items-center gap-2 flex-shrink-0 shadow-sm hover:border-orange-500 transition-colors group"
                >
                  <span className="text-[9px] font-black text-gray-800 group-hover:text-orange-600 truncate max-w-[150px]">{p.projectName}</span>
                  <span className="text-[9px] font-black text-orange-600 bg-orange-50 px-1 rounded-md">{p.hours.toFixed(0)}h</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* People Off Today - Ultra-small footer */}
      {peopleOffToday.length > 0 && (
        <div className="mt-1 px-4 flex flex-wrap gap-x-2 gap-y-0.5 items-center justify-center opacity-40">
          <span className="text-[8px] font-black uppercase tracking-tighter text-gray-500 mr-1">Away:</span>
          {peopleOffToday.map((person, idx) => (
            <span key={idx} className="text-[8px] font-bold text-gray-500 leading-none">
              {person.name}{idx < peopleOffToday.length - 1 ? "," : ""}
            </span>
          ))}
        </div>
      )}

      {/* Sick Call Modal */}
      {showSickModal && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={() => !sendingEmail && setShowSickModal(false)}></div>
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-100">
            <div className="bg-red-600 p-6 text-white text-center">
              <h2 className="text-2xl font-black uppercase italic tracking-tight">Report Personnel Absence</h2>
              <p className="text-red-100 text-xs font-bold uppercase tracking-widest mt-1">This will notify the distribution list</p>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-1.5 block">Select Employee</label>
                <select
                  value={sickEmployeeId}
                  onChange={(e) => setSickEmployeeId(e.target.value)}
                  className="w-full bg-gray-50 border-2 border-gray-100 rounded-2xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-red-500 appearance-none"
                >
                  <option value="">-- Choose Employee --</option>
                  {allEmployees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-1.5 block">Reason</label>
                  <select
                    value={sickReason}
                    onChange={(e) => setSickReason(e.target.value as "Sick" | "Personal" | "Late" | "No Show")}
                    className="w-full bg-gray-50 border-2 border-gray-100 rounded-2xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-red-500 appearance-none"
                  >
                    <option value="Sick">Sick</option>
                    <option value="Personal">Personal</option>
                    <option value="Late">Late</option>
                    <option value="No Show">No Show</option>
                  </select>
                </div>
                <div className="flex flex-col justify-end">
                   <div className="text-[10px] font-bold text-gray-400 italic mb-2 leading-tight">* Email will be sent to Management & Foremen</div>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-1.5 block">Additional Notes</label>
                <textarea
                  value={sickNotes}
                  onChange={(e) => setSickNotes(e.target.value)}
                  placeholder="e.g. 'Clinic visit at 10am', 'Car won't start'"
                  className="w-full bg-gray-50 border-2 border-gray-100 rounded-2xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-red-500 h-24 resize-none"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  disabled={sendingEmail}
                  onClick={() => setShowSickModal(false)}
                  className="flex-1 px-4 py-3 rounded-2xl font-black uppercase tracking-widest text-xs text-gray-400 hover:bg-gray-100 transition-all"
                >
                  Cancel
                </button>
                <button
                  disabled={sendingEmail || !sickEmployeeId}
                  onClick={sendAbsenceNotification}
                  className={`flex-[2] px-4 py-3 rounded-2xl font-black uppercase tracking-widest text-xs text-white shadow-lg transition-all flex items-center justify-center gap-2 ${
                    sendingEmail || !sickEmployeeId ? 'bg-gray-300 shadow-none' : 'bg-red-600 hover:bg-red-700 shadow-red-600/20'
                  }`}
                >
                  {sendingEmail ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Sending...
                    </>
                  ) : 'Send Notification'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>
    </div>
  );
}
