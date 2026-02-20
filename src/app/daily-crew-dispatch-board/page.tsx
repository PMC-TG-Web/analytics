"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { collection, getDocs, doc, setDoc, getDoc, query, where, addDoc } from "firebase/firestore";
import { db } from "@/firebase";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";
import { Scope, Project, Holiday } from "@/types";
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
  jobTitle: string;
  email?: string;
  personalEmail?: string;
  phone?: string;
  workPhone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
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
    <ProtectedPage page="crew-dispatch">
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
  const [holidays, setHolidays] = useState<Holiday[]>([]);

  const isHoliday = React.useMemo(() => {
    if (!dayColumns[0] || holidays.length === 0) return null;
    const dateStr = formatDateKey(dayColumns[0].date);
    return holidays.find(h => h.date === dateStr);
  }, [dayColumns, holidays]);

  // Find the employee record for the logged-in user
  const currentUserEmployee = React.useMemo(() => {
    if (!user?.email || allEmployees.length === 0) return null;
    return allEmployees.find(e => e.email?.toLowerCase() === user.email.toLowerCase());
  }, [user, allEmployees]);

  // Absence Alert State
  const [showSickModal, setShowSickModal] = useState(false);
  const [sickEmployeeId, setSickEmployeeId] = useState("");
  const [sickReason, setSickReason] = useState<"Sick" | "Personal" | "Late" | "No Show">("Sick");
  const [sickNotes, setSickNotes] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);

  // Time Off Request State
  const [showTimeOffModal, setShowTimeOffModal] = useState(false);
  const [newTimeOff, setNewTimeOff] = useState({
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    type: "Vacation" as const,
    hours: 10,
    reason: ""
  });
  const [selectedPersonnelId, setSelectedPersonnelId] = useState("");

  useEffect(() => {
    if (showSickModal && currentUserEmployee) {
      setSickEmployeeId(currentUserEmployee.id);
    }
  }, [showSickModal, currentUserEmployee]);

  useEffect(() => {
    if (showTimeOffModal && currentUserEmployee) {
      setSelectedPersonnelId(currentUserEmployee.id);
    }
  }, [showTimeOffModal, currentUserEmployee]);

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
      setLoading(true);
      const start = Date.now();
      
      // Helper: Get cached data (5 min cache)
      const getCache = (key: string) => {
        try {
          const cached = sessionStorage.getItem(key);
          if (!cached) return null;
          const { data, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < 5 * 60 * 1000) return data;
          sessionStorage.removeItem(key);
        } catch (e) {
          sessionStorage.removeItem(key);
        }
        return null;
      };

      const setCache = (key: string, data: any) => {
        try {
          sessionStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
        } catch (e) {}
      };

      // Check cache for static data
      let cachedEmployees: Employee[] | null = getCache('dispatch_employees');
      let cachedScopes = getCache('dispatch_projectScopes');
      let cachedHolidays = getCache('dispatch_holidays');
      
      const [
        employeesSnapshot,
        shortTermSnapshot, 
        projectScopesSnapshot, 
        projectsSnapshot, 
        longTermSnapshot, 
        timeOffSnapshot, 
        holidaysSnapshot
      ] = await Promise.all([
        cachedEmployees ? Promise.resolve(null) : getDocs(collection(db, "employees")),
        getDocs(collection(db, "short term schedual")),
        cachedScopes ? Promise.resolve(null) : getDocs(collection(db, "projectScopes")),
        getDocs(query(
          collection(db, "projects"),
          where("status", "not-in", ["Bid Submitted", "Lost", "Complete"]),
          where("projectArchived", "==", false)
        )),
        getDocs(collection(db, "long term schedual")),
        getDocs(collection(db, "timeOffRequests")),
        cachedHolidays ? Promise.resolve(null) : getDocs(collection(db, "holidays"))
      ]);

      console.log(`[DispatchBoard] Fetched all snapshots in ${Date.now() - start}ms`);

      const allEmps = cachedEmployees || (employeesSnapshot ? employeesSnapshot.docs
        .map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            firstName: data.firstName || '',
            lastName: data.lastName || '',
            jobTitle: data.jobTitle || data.role || '',
            email: data.email || '',
            phone: data.phone || '',
            isActive: data.isActive !== false
          } as Employee;
        })
        .sort((a, b) => {
          const nameA = `${a.firstName} ${a.lastName}`;
          const nameB = `${b.firstName} ${b.lastName}`;
          return nameA.localeCompare(nameB);
        }) : []);
      
      if (!cachedEmployees) setCache('dispatch_employees', allEmps);
      
      setAllEmployees(allEmps);
      const foremenList = allEmps.filter((emp) => emp.isActive && (emp.jobTitle === "Foreman" || emp.jobTitle === "Forman" || emp.jobTitle === "Lead Foreman" || emp.jobTitle === "Lead foreman" || emp.jobTitle === "Lead Foreman / Project Manager"));
      setForemen(foremenList);

      const requests = timeOffSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as TimeOffRequest[];
      setTimeOffRequests(requests);

      const holidayListData = cachedHolidays || (holidaysSnapshot ? holidaysSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) : []) as Holiday[];
      if (!cachedHolidays && holidaysSnapshot) setCache('dispatch_holidays', holidayListData);
      setHolidays(holidayListData);
      
      const projs = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Project);
      
      const rawScopes = cachedScopes || (projectScopesSnapshot ? projectScopesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Scope)) : []);
      if (!cachedScopes && projectScopesSnapshot) setCache('dispatch_projectScopes', rawScopes);
      
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
      const isBasicFilter = e.isActive && (e.jobTitle === "Laborer" || e.jobTitle === "Trainer" || e.jobTitle === "Field Worker" || e.jobTitle === "Field worker" || e.jobTitle === "Right Hand Man" || e.jobTitle === "Right Hand Man/ Sealhard Crew Leader") && !assignedToOthers.includes(e.id);
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
          const roleNormalized = (e.jobTitle || "").toLowerCase();
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

  async function submitTimeOff() {
    if (!selectedPersonnelId) {
      alert("Please select an employee.");
      return;
    }

    setSaving(true);
    try {
      const docRef = await addDoc(collection(db, "timeOffRequests"), {
        employeeId: selectedPersonnelId,
        startDate: newTimeOff.startDate,
        endDate: newTimeOff.endDate,
        type: newTimeOff.type,
        hours: newTimeOff.hours,
        reason: newTimeOff.reason,
        createdAt: new Date().toISOString()
      });

      const newRequest: TimeOffRequest = {
        id: docRef.id,
        employeeId: selectedPersonnelId,
        startDate: newTimeOff.startDate,
        endDate: newTimeOff.endDate,
        type: newTimeOff.type,
        hours: newTimeOff.hours
      };

      setTimeOffRequests(prev => [newRequest, ...prev]);
      setShowTimeOffModal(false);
      setSelectedPersonnelId("");
      setNewTimeOff({
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        type: "Vacation",
        hours: 10,
        reason: ""
      });
      alert("Time off request recorded successfully.");
    } catch (error) {
      console.error("Error saving time off:", error);
      alert("Failed to save time off request.");
    } finally {
      setSaving(false);
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
  const fieldWorkers = allEmployees.filter(e => (e.jobTitle === "Field Worker" || e.jobTitle === "Field worker") && e.isActive);

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
    <main className="h-screen bg-neutral-100 p-2 md:p-4 font-sans text-slate-900 overflow-hidden flex flex-col">
      <div className="max-w-full mx-auto w-full flex-1 flex flex-col bg-white shadow-2xl rounded-3xl overflow-hidden border border-gray-200">
        
        {/* Mobile Mini Header */}
        <div className="md:hidden border-b border-gray-100 bg-white px-4 py-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-center justify-center bg-red-900 px-4 py-2 rounded-2xl shadow-lg shadow-red-900/20">
                <span className="text-[9px] font-black uppercase tracking-widest opacity-80 leading-none mb-1 text-red-50">
                  {today?.date.toLocaleDateString("en-US", { month: "short" })}
                </span>
                <span className="text-2xl font-black leading-none text-white">{today?.date.getDate()}</span>
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tight text-gray-900 uppercase italic">Crew <span className="text-red-900">Dispatch</span></h1>
                <div className="text-[10px] font-bold text-red-900/40 uppercase tracking-widest">
                  {today?.date.toLocaleDateString("en-US", { weekday: "long" })}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setShowTimeOffModal(true)}
                className="bg-stone-800 hover:bg-stone-900 text-white text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-xl shadow-md transition-all font-sans"
              >
                Time Off
              </button>
              <button
                onClick={() => setShowSickModal(true)}
                className="bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-xl shadow-md shadow-red-600/20 transition-all font-sans"
              >
                Report
              </button>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3">
            <div className="px-3 py-2.5 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col items-center justify-center shadow-sm">
              <span className="text-[8px] uppercase font-black text-gray-400 tracking-widest mb-1 italic">Away</span>
              <span className="text-lg font-black text-gray-400">{workersOffCount}</span>
            </div>
            <div className="px-3 py-2.5 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col items-center justify-center shadow-sm">
              <span className="text-[8px] uppercase font-black text-gray-400 tracking-widest mb-1 italic">Total Sched</span>
              <span className="text-lg font-black text-red-900">{globalScheduledHours.toFixed(0)}h</span>
            </div>
            <div className="px-3 py-2.5 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col items-center justify-center shadow-sm">
              <span className="text-[8px] uppercase font-black text-gray-400 tracking-widest mb-1 italic">Capacity</span>
              <span className="text-lg font-black text-orange-600">{globalActualHours.toFixed(0)}h</span>
            </div>
          </div>
        </div>

        {/* Kiosk-Style Header - Branded */}
        <div className="hidden md:flex flex-row justify-between items-center px-6 py-4 bg-white border-b border-gray-100">
          <div className="flex items-center gap-6">
            <div className="flex flex-col items-center justify-center bg-red-900 px-4 py-2 rounded-2xl shadow-xl shadow-red-900/30">
              <span className="text-[9px] font-black uppercase tracking-widest opacity-80 leading-none mb-1 text-red-50">{today?.date.toLocaleDateString("en-US", { month: "short" })}</span>
              <span className="text-2xl font-black leading-none text-white">{today?.date.getDate()}</span>
            </div>
            <div className="h-10 w-px bg-gray-100"></div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-black tracking-tighter text-gray-900 uppercase italic leading-none">
                  Crew Dispatch <span className="text-red-900">Board</span>
                </h1>
                {isHoliday && (
                  <div className="bg-orange-500 text-white px-3 py-1 rounded-lg flex items-center gap-2 animate-bounce shadow-lg shadow-orange-500/20">
                    <span className="text-[10px] font-black uppercase tracking-widest">{isHoliday.name}</span>
                    {isHoliday.isPaid && <span className="bg-white/20 text-[8px] px-1 rounded font-bold">PAID</span>}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowTimeOffModal(true)}
                    className="bg-stone-800 hover:bg-stone-900 text-white text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg shadow-lg shadow-stone-800/20 transition-all font-sans"
                  >
                    Request Time Off
                  </button>
                  <button
                    onClick={() => setShowSickModal(true)}
                    className="bg-red-600 hover:bg-red-700 text-white text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg shadow-lg shadow-red-600/30 transition-all font-sans"
                  >
                    Report Personnel Absence
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] font-black text-red-900 uppercase tracking-[0.2em]">{today?.date.toLocaleDateString("en-US", { weekday: "long" })}</span>
                <span className="text-[10px] font-bold text-gray-300 uppercase tracking-widest leading-none">|</span>
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest italic opacity-60">Paradise Masonry Field Operations</span>
              </div>
            </div>
          </div>
          
          <div className="flex gap-3">
            <div className="px-5 py-2 rounded-2xl bg-stone-800 flex flex-col items-center justify-center min-w-[70px] shadow-lg shadow-stone-800/10">
              <span className="text-[8px] uppercase font-black text-stone-500 tracking-widest mb-1 italic">Away</span>
              <span className="text-xl font-black text-white">{workersOffCount}</span>
            </div>
            <div className="px-5 py-2 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col items-center justify-center min-w-[100px] shadow-sm">
              <span className="text-[8px] uppercase font-black text-gray-400 tracking-widest mb-1 italic">Total Sched</span>
              <span className="text-xl font-black text-red-900">{globalScheduledHours.toFixed(0)} <span className="text-[10px] font-bold opacity-30">H</span></span>
            </div>
            <div className="px-5 py-2 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col items-center justify-center min-w-[120px] shadow-sm">
              <span className="text-[8px] uppercase font-black text-gray-400 tracking-widest mb-1 italic">Capacity Used</span>
              <span className="text-xl font-black text-orange-600">{globalActualHours.toFixed(0)}<span className="text-[10px] font-bold opacity-30">/{globalCapacityHours}</span></span>
            </div>
            <div className="w-px bg-gray-100 mx-1"></div>
            <Navigation currentPage="crew-dispatch" />
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
                <div key={foreman.id} className="bg-white rounded-3xl border border-gray-100 shadow-xl shadow-gray-200/50 overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-4 bg-stone-800 border-b border-stone-700">
                    <div>
                      <div className="text-base font-black text-white uppercase italic tracking-tight">{foreman.firstName} {foreman.lastName}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] font-black uppercase text-red-500 tracking-widest leading-none">Actual {actualHrs}h</span>
                        <span className="text-[10px] font-bold text-stone-500 leading-none">/</span>
                        <span className="text-[10px] font-black uppercase text-stone-400 tracking-widest leading-none">Sched {scheduledHrs}h</span>
                      </div>
                    </div>
                    <div className={`w-3 h-3 rounded-full ${statusColor} shadow-lg shadow-black/20 animate-pulse`}></div>
                  </div>
                  <div className="p-5 space-y-5">
                    <div>
                      <div className="text-[9px] uppercase font-black text-stone-400 tracking-[0.2em] mb-3 italic">Assigned Projects</div>
                      <div className="space-y-3">
                        {projects.map((p, pIdx) => (
                          <div key={pIdx} className="bg-gray-50 px-4 py-3 rounded-2xl flex justify-between items-center border border-gray-100 shadow-sm">
                            <div className="overflow-hidden">
                              <div className="font-black text-stone-800 text-xs truncate leading-tight uppercase italic">{p.projectName}</div>
                              <div className="text-[10px] text-red-900 font-bold tracking-widest opacity-60 truncate uppercase mt-0.5">{p.customer}</div>
                            </div>
                            <div className="bg-white px-3 py-1.5 rounded-xl text-red-900 font-black text-xs ml-2 border border-red-50 shadow-sm">
                              {p.hours.toFixed(0)} <span className="opacity-30 uppercase text-[8px]">H</span>
                            </div>
                          </div>
                        ))}
                        {projects.length === 0 && (
                          <div className="py-6 flex items-center justify-center border-2 border-dashed border-gray-100 rounded-2xl">
                             <span className="text-[10px] font-bold text-gray-300 uppercase tracking-widest italic">No deployments found</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase font-black text-stone-400 tracking-[0.2em] mb-3 italic">Crew Members ({crewList.length})</div>
                      {crewList.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {crewList.map((name) => (
                            <span key={name} className="px-3 py-1.5 text-[10px] font-black uppercase tracking-tight bg-stone-100 text-stone-600 rounded-xl border border-stone-200">
                              {name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-gray-400 italic font-bold">Awaiting personnel assignment</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
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
                  className={`bg-white rounded-2xl border-2 ${statusBorder} flex flex-col overflow-hidden shadow-xl shadow-gray-200/20 group h-full transition-all duration-300`}
                >
                  {/* Card Header - Branded */}
                  <div className="px-3 py-2 flex justify-between items-center bg-stone-800 border-b border-stone-700">
                    <h3 className="text-xs font-black text-white uppercase italic tracking-wider truncate max-w-[120px]">{foreman.firstName} {foreman.lastName[0]}.</h3>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-xs font-black text-red-500 leading-none">{actualHrs}</div>
                        <div className="text-[6px] font-black text-white/40 uppercase tracking-tighter mt-0.5">ACT</div>
                      </div>
                      <div className="w-px h-6 bg-stone-700"></div>
                      <div className="text-right">
                        <div className="text-xs font-black text-stone-400 leading-none">{scheduledHrs}</div>
                        <div className="text-[6px] font-black text-white/40 uppercase tracking-tighter mt-0.5">SCH</div>
                      </div>
                    </div>
                  </div>

                  <div className="p-2 space-y-3 flex-1 flex flex-col min-h-0 bg-white">
                    {/* Projects Section - Branded */}
                    <div className="flex-none pb-1">
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-2 h-2 rounded-full ${statusColor} shadow-lg shadow-black/10`}></div>
                        <h4 className="text-[8px] uppercase font-black text-stone-400 tracking-[0.2em] italic">Project Assignments</h4>
                      </div>
                      <div className="space-y-1.5 max-h-[140px] overflow-y-auto no-scrollbar">
                        {projects.map((p, pIdx) => (
                          <div key={pIdx} className="bg-gray-50 px-2 py-2 rounded-xl flex justify-between items-center border border-gray-100 shadow-sm hover:border-red-900/20 transition-all">
                            <div className="overflow-hidden pr-2">
                              <div className="font-black text-stone-800 text-[10px] truncate max-w-[150px] uppercase leading-tight italic">{p.projectName}</div>
                              <div className="text-[8px] font-bold text-red-900 truncate uppercase opacity-40 tracking-widest mt-0.5">{p.customer}</div>
                            </div>
                            <div className="bg-white px-2 py-1 rounded-lg shadow-sm border border-red-50 text-red-900 font-extrabold text-[10px] ml-auto">
                              {p.hours.toFixed(0)}h
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Personnel Selection - Interactive Toggle UI */}
                    <div className="flex-1 flex flex-col min-h-0">
                      <div className="flex justify-between items-center mb-1.5 px-1">
                        <h4 className="text-[8px] uppercase font-black text-stone-400 tracking-[0.2em] italic">Assigned Crew ({currentEmployees.length})</h4>
                        <div className="w-1.5 h-1.5 rounded-full bg-red-900 shadow-sm animate-pulse"></div>
                      </div>
                      
                      <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl overflow-hidden flex flex-col min-h-0 shadow-inner">
                        <div className="px-2 py-1.5 border-b border-gray-100 bg-white">
                          <div className="relative">
                            <input 
                              type="text"
                              placeholder="SEARCH EMPLOYEES..."
                              value={personnelSearch[foreman.id] || ""}
                              onChange={(e) => setPersonnelSearch(prev => ({ ...prev, [foreman.id]: e.target.value }))}
                              className="w-full pl-7 pr-2 py-1 text-[9px] font-black bg-gray-50 border-none rounded-lg focus:outline-none focus:ring-1 focus:ring-red-900 uppercase tracking-widest placeholder:text-gray-300 transition-all"
                            />
                            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-red-900 opacity-30" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                          </div>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-1 bg-gray-50/50">
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
                                className="w-full flex items-center justify-between px-2.5 py-1.5 bg-red-900 text-white rounded-lg text-[9px] font-black hover:bg-red-800 transition-all text-left shadow-lg shadow-red-900/20 active:scale-95 border border-red-800"
                              >
                                <span className="truncate uppercase tracking-tight italic">{emp.firstName} {emp.lastName}</span>
                                <svg className="shrink-0" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
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
                                  className="w-full flex items-center justify-between px-2.5 py-1.5 bg-white border border-gray-100 text-stone-600 rounded-lg text-[9px] font-black hover:border-red-900/40 hover:text-red-900 transition-all text-left group shadow-sm active:scale-95"
                                >
                                  <div className="flex flex-col truncate">
                                    <span className="truncate uppercase tracking-tight">{emp.firstName} {emp.lastName}</span>
                                    {hoursOff > 0 && <span className="text-[7px] text-orange-600 font-black leading-none italic tracking-widest mt-0.5">ABSENT</span>}
                                  </div>
                                  <svg className="opacity-0 group-hover:opacity-100 text-red-900 shrink-0 transform group-hover:rotate-90 transition-all" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
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
                  <div className="h-1.5 w-full bg-gray-100 mt-auto">
                    <div 
                      className={`h-full transition-all duration-500 ease-out shadow-sm ${statusColor}`} 
                      style={{ width: `${Math.min(100, (actualHrs / (scheduledHrs || 1)) * 100)}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
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
            <div className="bg-red-900 p-8 text-white text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.1),transparent)] pointer-events-none"></div>
              <h2 className="text-2xl font-black uppercase italic tracking-tighter">Report <span className="text-red-400">Absence</span></h2>
              <p className="text-red-200/60 text-[10px] font-black uppercase tracking-[0.3em] mt-2">Field Operations</p>
            </div>
            
            <div className="p-8 space-y-6">
              <div>
                <label className="text-[10px] font-black uppercase text-stone-400 tracking-[0.2em] mb-3 block italic">Select Employee</label>
                <div className="relative">
                  <select
                    value={sickEmployeeId}
                    onChange={(e) => setSickEmployeeId(e.target.value)}
                    disabled={!!currentUserEmployee}
                    className="w-full bg-gray-50 border-2 border-gray-100 rounded-[1.5rem] px-5 py-4 text-sm font-black text-stone-800 focus:outline-none focus:border-red-900/30 focus:bg-white appearance-none transition-all uppercase tracking-tight disabled:opacity-75"
                  >
                    {!currentUserEmployee && <option value="">-- CHOOSE EMPLOYEE --</option>}
                    {allEmployees
                      .filter(emp => !currentUserEmployee || emp.id === currentUserEmployee.id)
                      .sort((a,b) => a.firstName.localeCompare(b.firstName))
                      .map(emp => (
                        <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName}</option>
                      ))
                    }
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-[10px] font-black uppercase text-stone-400 tracking-[0.2em] mb-3 block italic">Reason</label>
                  <div className="grid grid-cols-2 gap-2">
                    {["Sick", "Personal", "Late", "No Show"].map((reason) => (
                      <button
                        key={reason}
                        onClick={() => setSickReason(reason as "Sick" | "Personal" | "Late" | "No Show")}
                        className={`px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border-2 ${
                          sickReason === reason 
                            ? "bg-stone-800 border-stone-800 text-white shadow-lg shadow-stone-900/20 scale-[1.02]" 
                            : "bg-white border-gray-100 text-stone-400 hover:border-gray-200"
                        }`}
                      >
                        {reason}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-stone-400 tracking-[0.2em] mb-3 block italic">Notes</label>
                <textarea
                  value={sickNotes}
                  onChange={(e) => setSickNotes(e.target.value)}
                  placeholder="ADDITIONAL NOTES..."
                  className="w-full bg-gray-50 border-2 border-gray-100 rounded-2xl px-5 py-4 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-red-900 h-24 resize-none uppercase tracking-tight"
                />
              </div>

              <div className="flex flex-col gap-3 pt-2">
                <button
                  disabled={sendingEmail || !sickEmployeeId}
                  onClick={sendAbsenceNotification}
                  className={`w-full py-5 rounded-[1.5rem] font-black uppercase tracking-[0.2em] text-sm text-white shadow-xl transition-all flex items-center justify-center gap-3 italic ${
                    sendingEmail || !sickEmployeeId ? 'bg-gray-300 shadow-none' : 'bg-red-900 hover:bg-red-800 shadow-red-900/30 active:scale-95'
                  }`}
                >
                  {sendingEmail ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Sending...
                    </>
                  ) : 'Send Notification'}
                </button>
                <button
                  disabled={sendingEmail}
                  onClick={() => setShowSickModal(false)}
                  className="w-full py-2 text-[10px] font-black uppercase tracking-widest text-stone-400 hover:text-stone-600 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Time Off Request Modal */}
      {showTimeOffModal && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={() => !saving && setShowTimeOffModal(false)}></div>
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-100">
            <div className="bg-stone-800 p-8 text-white text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.1),transparent)] pointer-events-none"></div>
              <h2 className="text-2xl font-black uppercase italic tracking-tighter">Time Off <span className="text-red-600">Request</span></h2>
              <p className="text-stone-400 text-[10px] font-black uppercase tracking-[0.3em] mt-2">Personnel Planning</p>
            </div>
            
            <div className="p-8 space-y-6">
              <div>
                <label className="text-[10px] font-black uppercase text-stone-400 tracking-[0.2em] mb-3 block italic">Select Employee</label>
                <select
                  value={selectedPersonnelId}
                  onChange={(e) => setSelectedPersonnelId(e.target.value)}
                  disabled={!!currentUserEmployee}
                  className="w-full bg-gray-50 border-2 border-gray-100 rounded-2xl px-5 py-3 text-sm font-black text-stone-800 focus:outline-none focus:border-stone-800/30 appearance-none uppercase tracking-tight transition-all disabled:opacity-75"
                >
                  {!currentUserEmployee && <option value="">-- CHOOSE EMPLOYEE --</option>}
                  {allEmployees
                    .filter(emp => !currentUserEmployee || emp.id === currentUserEmployee.id)
                    .sort((a,b) => a.firstName.localeCompare(b.firstName))
                    .map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName}</option>
                    ))
                  }
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-stone-400 tracking-[0.2em] mb-2 block italic">Start Date</label>
                  <input
                    type="date"
                    value={newTimeOff.startDate}
                    onChange={(e) => setNewTimeOff(prev => ({ ...prev, startDate: e.target.value }))}
                    className="w-full bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-2 text-xs font-bold focus:outline-none focus:border-stone-800/30"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-stone-400 tracking-[0.2em] mb-2 block italic">End Date</label>
                  <input
                    type="date"
                    value={newTimeOff.endDate}
                    onChange={(e) => setNewTimeOff(prev => ({ ...prev, endDate: e.target.value }))}
                    className="w-full bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-2 text-xs font-bold focus:outline-none focus:border-stone-800/30"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-stone-400 tracking-[0.2em] mb-2 block italic">Category</label>
                  <select
                    value={newTimeOff.type}
                    onChange={(e) => setNewTimeOff(prev => ({ ...prev, type: e.target.value as any }))}
                    className="w-full bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-2 text-xs font-bold focus:outline-none focus:border-stone-800/30"
                  >
                    <option value="Vacation">Vacation</option>
                    <option value="Sick">Sick</option>
                    <option value="Personal">Personal</option>
                    <option value="Company timeoff">Company timeoff</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-stone-400 tracking-[0.2em] mb-2 block italic">Daily Hours</label>
                  <input
                    type="number"
                    value={newTimeOff.hours}
                    onChange={(e) => setNewTimeOff(prev => ({ ...prev, hours: parseInt(e.target.value) }))}
                    className="w-full bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-2 text-xs font-bold focus:outline-none focus:border-stone-800/30"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-stone-400 tracking-[0.2em] mb-2 block italic">Internal Notes</label>
                <textarea
                  value={newTimeOff.reason}
                  onChange={(e) => setNewTimeOff(prev => ({ ...prev, reason: e.target.value }))}
                  placeholder="REASON FOR TIME OFF..."
                  className="w-full bg-gray-50 border-2 border-gray-100 rounded-2xl px-5 py-3 text-sm font-bold focus:outline-none h-20 resize-none uppercase tracking-tight"
                />
              </div>

              <div className="flex flex-col gap-3 pt-2">
                <button
                  disabled={saving || !selectedPersonnelId}
                  onClick={submitTimeOff}
                  className={`w-full py-4 rounded-2xl font-black uppercase tracking-[0.2em] text-sm text-white shadow-xl transition-all flex items-center justify-center gap-3 italic ${
                    saving || !selectedPersonnelId ? 'bg-gray-300 shadow-none' : 'bg-stone-800 hover:bg-stone-900 shadow-stone-900/30 active:scale-95'
                  }`}
                >
                  {saving ? 'Processing...' : 'Record Time Off'}
                </button>
                <button
                  disabled={saving}
                  onClick={() => setShowTimeOffModal(false)}
                  className="w-full py-2 text-[10px] font-black uppercase tracking-widest text-stone-400 hover:text-stone-600 transition-all font-sans"
                >
                  Cancel
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
    </main>
  );
}
