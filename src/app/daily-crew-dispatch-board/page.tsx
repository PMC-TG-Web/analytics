"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./dispatch-responsive.module.css";

import { Scope, Project, Holiday } from "@/types";
import { getEnrichedScopes, getProjectKey } from "@/utils/projectUtils";
import { useAuth } from "@/hooks/useAuth";
import { loadActiveScheduleForDateRange } from "@/utils/activeScheduleLoader";
import { addDays, formatDateInput, parseDateInput } from "@/utils/dateUtils";

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

const isForemanRole = (jobTitle?: string) => {
  const title = (jobTitle || '').toLowerCase().trim();
  return (
    title.includes('foreman') ||
    title.includes('forman') ||
    title.includes('project manager')
  );
};

const DISPATCH_TIME_ZONE = "America/New_York";
const DISPATCH_ROLLOVER_HOUR = 12;

function getTimeZoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const getPartValue = (type: string) => parts.find((part) => part.type === type)?.value || "00";

  return {
    year: getPartValue("year"),
    month: getPartValue("month"),
    day: getPartValue("day"),
    hour: Number(getPartValue("hour")),
  };
}

function getDefaultDispatchDate(now = new Date()) {
  const easternParts = getTimeZoneParts(now, DISPATCH_TIME_ZONE);
  let dispatchDate = parseDateInput(`${easternParts.year}-${easternParts.month}-${easternParts.day}`) || now;

  if (easternParts.hour >= DISPATCH_ROLLOVER_HOUR) {
    dispatchDate = addDays(dispatchDate, 1);
  }

  while (dispatchDate.getDay() === 0 || dispatchDate.getDay() === 6) {
    dispatchDate = addDays(dispatchDate, 1);
  }

  return formatDateInput(dispatchDate);
}

export default function DailyCrewDispatchBoardPage() {
  return <DailyCrewDispatchBoardContent />;
}

function DailyCrewDispatchBoardContent() {
  const { user } = useAuth();
  const [dayColumns, setDayColumns] = useState<DayColumn[]>([]);
  const [selectedDispatchDate, setSelectedDispatchDate] = useState("");
  const [usesAutoDispatchDate, setUsesAutoDispatchDate] = useState(true);
  const [foremanDateProjects, setForemanDateProjects] = useState<Record<string, Record<string, DayProject[]>>>({}); // foremanId -> dateKey -> projects
  const [foremen, setForemen] = useState<Employee[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [crewAssignments, setCrewAssignments] = useState<Record<string, Record<string, string[]>>>({}); // dateKey -> foremanId -> employee IDs
  const [personnelSearch, setPersonnelSearch] = useState<Record<string, string>>({}); // foremanId -> search string
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [holidays, setHolidays] = useState<Holiday[]>([]);

  const selectedDispatchDateRef = React.useRef("");
  const usesAutoDispatchDateRef = React.useRef(true);

  const isHoliday = React.useMemo(() => {
    if (!selectedDispatchDate || holidays.length === 0) return null;
    const dateStr = selectedDispatchDate;
    return holidays.find(h => h.date === dateStr);
  }, [selectedDispatchDate, holidays]);

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
    selectedDispatchDateRef.current = selectedDispatchDate;
  }, [selectedDispatchDate]);

  useEffect(() => {
    usesAutoDispatchDateRef.current = usesAutoDispatchDate;
  }, [usesAutoDispatchDate]);

  useEffect(() => {
    setSelectedDispatchDate(getDefaultDispatchDate());
    setUsesAutoDispatchDate(true);
  }, []);

  useEffect(() => {
    if (!selectedDispatchDate) return;
    loadSchedules(selectedDispatchDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDispatchDate]);

  useEffect(() => {
    const syncAutomaticDispatchDate = () => {
      if (!usesAutoDispatchDateRef.current) return false;
      const nextAutoDate = getDefaultDispatchDate();
      if (nextAutoDate !== selectedDispatchDateRef.current) {
        setSelectedDispatchDate(nextAutoDate);
        return true;
      }
      return false;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const dateChanged = syncAutomaticDispatchDate();
      if (!dateChanged && selectedDispatchDateRef.current) {
        loadSchedules(selectedDispatchDateRef.current);
      }
    };

    const intervalId = window.setInterval(syncAutomaticDispatchDate, 60_000);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDispatchDateChange = (nextDate: string) => {
    if (!nextDate) return;
    setSelectedDispatchDate(nextDate);
    setUsesAutoDispatchDate(nextDate === getDefaultDispatchDate());
  };

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

  async function loadSchedules(dispatchDateKey = selectedDispatchDateRef.current) {
    try {
      if (!dispatchDateKey) return;
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
      
      // Fetch data from API endpoints instead of Firebase
      const safeJsonFetch = async (url: string) => {
        try {
          const res = await fetch(url);
          if (!res.ok) {
            console.warn(`[DispatchBoard] API endpoint not available: ${url}`);
            return null;
          }
          return await res.json();
        } catch (error) {
          console.warn(`[DispatchBoard] Error fetching ${url}:`, error);
          return null;
        }
      };

      const [
        employeesPayload,
        projectScopesPayload,
        projectsPayload,
        timeOffPayload,
        holidaysPayload,
        crewsPayload
      ] = await Promise.all([
        cachedEmployees ? Promise.resolve(cachedEmployees) : safeJsonFetch('/api/employees'),
        cachedScopes ? Promise.resolve(cachedScopes) : safeJsonFetch('/api/project-scopes'),
        safeJsonFetch('/api/projects'),
        safeJsonFetch('/api/time-off'),
        cachedHolidays ? Promise.resolve(cachedHolidays) : safeJsonFetch('/api/holidays'),
        safeJsonFetch('/api/crew-templates')
      ]);

      const employeesData = Array.isArray(employeesPayload)
        ? employeesPayload
        : (employeesPayload?.data || []);
      const projectScopesData = Array.isArray(projectScopesPayload)
        ? projectScopesPayload
        : (projectScopesPayload?.scopes || projectScopesPayload?.data || []);
      const projectsData = Array.isArray(projectsPayload)
        ? projectsPayload
        : (projectsPayload?.data || []);
      const timeOffData = Array.isArray(timeOffPayload)
        ? timeOffPayload
        : (timeOffPayload?.data || []);
      const holidaysData = Array.isArray(holidaysPayload)
        ? holidaysPayload
        : (holidaysPayload?.data || []);
      const crewsData = Array.isArray(crewsPayload)
        ? crewsPayload
        : (crewsPayload?.data || []);

      const allEmps = cachedEmployees || (employeesData || [])
        .filter((emp: any) => emp.isActive !== false)
        .sort((a: any, b: any) => {
          const nameA = `${a.firstName} ${a.lastName}`;
          const nameB = `${b.firstName} ${b.lastName}`;
          return nameA.localeCompare(nameB);
        });
      
      if (!cachedEmployees) setCache('dispatch_employees', allEmps);
      
      setAllEmployees(allEmps);
      let foremenList = allEmps.filter((emp: any) => emp.isActive !== false && isForemanRole(emp.jobTitle));

      const requests = (timeOffData || []) as TimeOffRequest[];
      setTimeOffRequests(requests);

      const holidayListData = cachedHolidays || (holidaysData || []);
      if (!cachedHolidays && holidaysData) setCache('dispatch_holidays', holidayListData);
      setHolidays(holidayListData);
      
      const projs = (projectsData || []).filter((p: any) => 
        !["Bid Submitted", "Lost", "Complete"].includes(p.status) && 
        p.projectArchived !== true
      ) as Project[];
      
      const rawScopes = cachedScopes || (projectScopesData || []);
      if (!cachedScopes && projectScopesData) setCache('dispatch_projectScopes', rawScopes);
      
      const enrichedScopes = getEnrichedScopes(rawScopes, projs);
      const scopesObj: Record<string, Scope[]> = {};
      enrichedScopes.forEach(scope => {
        if (scope.jobKey) {
          if (!scopesObj[scope.jobKey]) scopesObj[scope.jobKey] = [];
          scopesObj[scope.jobKey].push(scope);
        }
      });

      const displayDate = parseDateInput(dispatchDateKey) || new Date(`${dispatchDateKey}T00:00:00`);
      displayDate.setHours(0, 0, 0, 0);
      const localDateKey = formatDateKey(displayDate);
      const utcDateKey = displayDate.toISOString().split('T')[0];

      // Load schedule data from activeSchedule for the selected local date, with UTC-safe fallback
      const rangeStart = localDateKey <= utcDateKey ? new Date(`${localDateKey}T00:00:00`) : new Date(`${utcDateKey}T00:00:00`);
      const rangeEnd = localDateKey >= utcDateKey ? new Date(`${localDateKey}T00:00:00`) : new Date(`${utcDateKey}T00:00:00`);
      const { projectsByDate } = await loadActiveScheduleForDateRange(rangeStart, rangeEnd);
      
      const dayMap = new Map<string, DayColumn>();
      const projectsByDay: Record<string, DayProject[]> = {};

      const dateKey = localDateKey;
      dayMap.set(dateKey, {
        date: displayDate,
        dayLabel: displayDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        weekNumber: 1,
      });

      // Initialize projectsByDay from activeSchedule using both local and UTC keys
      const activeScheduleProjects = [
        ...(projectsByDate[localDateKey] || []),
        ...(utcDateKey !== localDateKey ? (projectsByDate[utcDateKey] || []) : []),
      ];

      if (foremenList.length === 0 && activeScheduleProjects.length > 0) {
        const foremanIds = Array.from(
          new Set(
            activeScheduleProjects
              .map((p) => (p.foreman || '').trim())
              .filter(Boolean)
          )
        );

        const recoveredForemen = foremanIds.map((foremanId) => {
          const employee = allEmps.find((emp: any) => emp.id === foremanId);
          if (employee) return employee;
          return {
            id: foremanId,
            firstName: 'Foreman',
            lastName: foremanId.slice(0, 6),
            jobTitle: 'Foreman',
            isActive: true,
          } as Employee;
        });

        if (recoveredForemen.length > 0) {
          foremenList = recoveredForemen;
        }
      }

      setForemen(foremenList);
      const foremanIdSet = new Set(foremenList.map((f: any) => f.id));
      const foremanNameToId = new Map(
        foremenList.map((f: any) => [`${f.firstName} ${f.lastName}`.trim().toLowerCase(), f.id])
      );

      const resolveForemanId = (rawForeman?: string) => {
        if (!rawForeman) return "";
        if (foremanIdSet.has(rawForeman)) return rawForeman;
        return foremanNameToId.get(rawForeman.trim().toLowerCase()) || "";
      };
      projectsByDay[dateKey] = activeScheduleProjects.map(p => ({
        jobKey: p.jobKey,
        customer: p.customer,
        projectNumber: p.projectNumber,
        projectName: p.projectName,
        hours: p.hours,
        foreman: p.foreman || "",
        employees: p.employees || [],
        month: dateKey.substring(0, 7), // YYYY-MM
        weekNumber: 1,
        dayNumber: displayDate.getDay() || 7,
      }));

      const columns = Array.from(dayMap.values()).sort((a: any, b: any) => a.date.getTime() - b.date.getTime());
      setDayColumns(columns);

      const foremanDateMap: Record<string, Record<string, DayProject[]>> = {};
      foremenList.forEach((foreman: any) => {
        foremanDateMap[foreman.id] = {};
        columns.forEach((col: any) => {
          const dateKey = formatDateKey(col.date);
          foremanDateMap[foreman.id][dateKey] = [];
        });
      });
      foremanDateMap.__unassigned__ = {};
      columns.forEach((col: any) => {
        const dateKey = formatDateKey(col.date);
        foremanDateMap.__unassigned__[dateKey] = [];
      });

      Object.entries(projectsByDay).forEach(([dateKey, projects]: any) => {
        projects.forEach((project: any) => {
          const resolvedForemanId = resolveForemanId(project.foreman) as string | null;
          if (resolvedForemanId) {
            project.foreman = resolvedForemanId;
            if (!foremanDateMap[resolvedForemanId]) foremanDateMap[resolvedForemanId] = {};
            if (!foremanDateMap[resolvedForemanId][dateKey]) foremanDateMap[resolvedForemanId][dateKey] = [];
            foremanDateMap[resolvedForemanId][dateKey].push(project);
          } else {
            if (!foremanDateMap.__unassigned__[dateKey]) foremanDateMap.__unassigned__[dateKey] = [];
            foremanDateMap.__unassigned__[dateKey].push(project);
          }
        });
      });
      setForemanDateProjects(foremanDateMap);

      // Load saved crew templates from API, indexed by foremanId
      // Match crews to foremen by template name pattern: "Crew - FirstName LastName"
      const savedCrews: Record<string, { rightHandManId?: string; crewMemberIds: string[] }> = {};
      foremenList.forEach((foreman: any) => {
        const templateName = `Crew - ${foreman.firstName} ${foreman.lastName}`;
        const matchingCrew = (crewsData || []).find((crew: any) => crew.name === templateName);
        if (matchingCrew) {
          savedCrews[foreman.id] = {
            rightHandManId: matchingCrew.rightHandManId,
            crewMemberIds: matchingCrew.crewMemberIds || matchingCrew.members || []
          };
        }
      });
      
      const crewMap: Record<string, Record<string, string[]>> = {};
      Object.entries(projectsByDay).forEach(([dateKey, projects]) => {
        if (!crewMap[dateKey]) crewMap[dateKey] = {};
        projects.forEach(project => {
          const foremanId = resolveForemanId(project.foreman) as string | null;
          if (foremanId) {
            if (!crewMap[dateKey][foremanId]) {
              crewMap[dateKey][foremanId] = [];
              
              // Apply default crew for this foreman on this day (first time we see them)
              if (savedCrews[foremanId]) {
                const defaultCrew = savedCrews[foremanId];
                
                // Add right hand man if assigned
                if (defaultCrew.rightHandManId) {
                  crewMap[dateKey][foremanId].push(defaultCrew.rightHandManId);
                }
                // Add crew members
                defaultCrew.crewMemberIds.forEach((empId: string) => {
                  if (!crewMap[dateKey][foremanId].includes(empId)) {
                    crewMap[dateKey][foremanId].push(empId);
                  }
                });
              }
            }
            
            // Also add any employees already assigned to this specific project
            if (project.employees && Array.isArray(project.employees) && project.employees.length > 0) {
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
      console.warn("[DispatchBoard] Failed to load schedules:", error);
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
        
        // Fetch existing schedule data from API
        let existingData = null;
        try {
          const existingResponse = await fetch(`/api/short-term-schedule?jobKey=${encodeURIComponent(jobKey)}`);
          if (existingResponse.ok) {
            existingData = await existingResponse.json();
          } else {
            console.warn("[DispatchBoard] short-term-schedule API endpoint not available");
          }
        } catch (error) {
          console.warn("[DispatchBoard] Error fetching short-term-schedule:", error);
        }
        
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
        
        // Save to API
        try {
          const response = await fetch('/api/short-term-schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobKey, docId, scheduleData: docData })
          });
          if (!response.ok) {
            console.warn("[DispatchBoard] short-term-schedule API endpoint not available");
          }
        } catch (error) {
          console.warn("[DispatchBoard] Error saving schedule:", error);
        }
      }
    } catch (error) {
      console.warn("[DispatchBoard] Failed to save crew assignment:", error);
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
          recipients.push(user.email);
        } else {
          console.warn("[DispatchBoard] No recipients found with valid emails");
        }
      }

      if (recipients.length === 0) {
        console.warn("[DispatchBoard] No recipients to notify");
        setShowSickModal(false);
        setSickEmployeeId("");
        setSickNotes("");
        return;
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

      if (!response.ok) {
        console.warn("[DispatchBoard] notify-absence API endpoint not available");
      } else {
        await response.json();
      }

      setShowSickModal(false);
      setSickEmployeeId("");
      setSickNotes("");
    } catch (error) {
      console.warn("[DispatchBoard] Error sending absence notification:", error);
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
      // Save time off request via API
      const response = await fetch('/api/time-off', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: selectedPersonnelId,
          employeeName: allEmployees.find(e => e.id === selectedPersonnelId)?.firstName + ' ' + allEmployees.find(e => e.id === selectedPersonnelId)?.lastName,
          dates: [newTimeOff.startDate, newTimeOff.endDate],
          reason: newTimeOff.reason,
          status: 'pending'
        })
      });

      if (response.ok) {
        const savedRequest = await response.json();

        const newRequest: TimeOffRequest = {
          id: savedRequest.id,
          employeeId: selectedPersonnelId,
          startDate: newTimeOff.startDate,
          endDate: newTimeOff.endDate,
          type: newTimeOff.type,
          hours: newTimeOff.hours
        };

        setTimeOffRequests(prev => [newRequest, ...prev]);
      } else {
        console.warn("[DispatchBoard] time-off API endpoint not available");
      }

      setShowTimeOffModal(false);
      setSelectedPersonnelId("");
      setNewTimeOff({
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        type: "Vacation",
        hours: 10,
        reason: ""
      });
    } catch (error) {
      console.warn("[DispatchBoard] Error saving time off:", error);
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

  const activeDay = dayColumns[0];
  const activeDate = activeDay?.date || (selectedDispatchDate ? parseDateInput(selectedDispatchDate) : null);
  const dateKey = selectedDispatchDate || (activeDay ? formatDateKey(activeDay.date) : "");
  
  // Totals for the selected dispatch day
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
  const peopleOffForDate: { name: string, hours: number, type: string }[] = [];
  const fieldWorkers = allEmployees.filter(e => {
    const title = e.jobTitle?.toLowerCase() || "";
    return (title === "laborer" || title === "right hand men" || title === "right hand man" || title === "right hand man/ sealhard crew leader") && e.isActive;
  });

  fieldWorkers.forEach(worker => {
    const matchingReq = timeOffRequests.find(req => 
      req.employeeId === worker.id && dateKey >= req.startDate && dateKey <= req.endDate
    );
    if (matchingReq) {
      const hrs = matchingReq.hours || 10;
      totalHoursOff += hrs;
      workersOffCount++;
      peopleOffForDate.push({ 
        name: `${worker.firstName} ${worker.lastName}`, 
        hours: hrs,
        type: matchingReq.type 
      });
    }
  });
  
  const globalCapacityHours = ((foremen.length + fieldWorkers.length) * 10) - totalHoursOff;
  const globalAssignedCount = getAssignedEmployeesForDate(dateKey).length;
  const globalActualHours = (foremen.length + globalAssignedCount) * 10; // foremen + crew members

  return (
    <main className={`${styles.dispatchResponsive} h-screen bg-neutral-100 p-2 md:p-4 lg:p-6 font-sans text-slate-900 overflow-hidden flex flex-col`}>
      <div className="max-w-full mx-auto w-full flex-1 flex flex-col bg-white shadow-2xl rounded-3xl overflow-hidden border border-gray-200" style={{borderRadius: 'var(--radius-lg)'}}>
        
        {/* Mobile Mini Header */}
        <div className="md:hidden border-b border-gray-100 bg-white px-4 py-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-center justify-center bg-red-900 px-4 py-2 rounded-2xl shadow-lg shadow-red-900/20" style={{borderRadius: 'var(--radius-md)', padding: 'var(--space-4)'}}>
                <span className="text-[9px] font-black uppercase tracking-widest opacity-80 leading-none mb-1 text-red-50" style={{fontSize: 'var(--text-xs)', marginBottom: 'var(--space-1)'}}>
                  {activeDate?.toLocaleDateString("en-US", { month: "short" })}
                </span>
                <span className="text-2xl font-black leading-none text-white">{activeDate?.getDate()}</span>
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tight text-gray-900 uppercase italic">Crew <span className="text-red-900">Dispatch</span></h1>
                <div className="text-[10px] font-bold text-red-900/40 uppercase tracking-widest">
                  {activeDate?.toLocaleDateString("en-US", { weekday: "long" })}
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
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Dispatch Date</span>
            <input
              type="date"
              value={selectedDispatchDate}
              onChange={(e) => handleDispatchDateChange(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-700 focus:border-red-900/30 focus:outline-none"
            />
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

        {/* Kiosk-Style Header - Branded with TV-responsive scaling */}
        <div className="hidden md:flex flex-row justify-between items-center px-6 py-4 bg-white border-b border-gray-100 lg:px-8 lg:py-6">
          <div className="flex items-center gap-6">
            <div className="flex flex-col items-center justify-center bg-red-900 px-4 py-2 rounded-2xl shadow-xl shadow-red-900/30 lg:px-6 lg:py-4">
              <span className="text-[9px] font-black uppercase tracking-widest opacity-80 leading-none mb-1 text-red-50">{activeDate?.toLocaleDateString("en-US", { month: "short" })}</span>
              <span className="text-2xl font-black leading-none text-white lg:text-4xl">{activeDate?.getDate()}</span>
            </div>
            <div className="h-10 w-px bg-gray-100 lg:h-16"></div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-black tracking-tighter text-gray-900 uppercase italic leading-none lg:text-4xl">
                  Crew Dispatch <span className="text-red-900">Board</span>
                </h1>
                {isHoliday && (
                  <div className="bg-orange-500 text-white px-3 py-1 rounded-lg flex items-center gap-2 animate-bounce shadow-lg shadow-orange-500/20 lg:px-5 lg:py-2">
                    <span className="text-[10px] font-black uppercase tracking-widest lg:text-sm">{isHoliday.name}</span>
                    {isHoliday.isPaid && <span className="bg-white/20 text-[8px] px-1 rounded font-bold">PAID</span>}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] font-black text-red-900 uppercase tracking-[0.2em]">{activeDate?.toLocaleDateString("en-US", { weekday: "long" })}</span>
                <span className="text-[10px] font-bold text-gray-300 uppercase tracking-widest leading-none">|</span>
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest italic opacity-60">Paradise Masonry Field Operations</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Dispatch Date</span>
              <input
                type="date"
                value={selectedDispatchDate}
                onChange={(e) => handleDispatchDateChange(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-bold text-gray-700 focus:border-red-900/30 focus:outline-none"
              />
            </div>
            <Link href="/short-term-schedule" className="px-4 py-2 bg-red-900 hover:bg-red-800 text-white rounded-xl font-black text-sm uppercase tracking-widest transition-all flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              Back
            </Link>
          </div>
        </div>

        <div className="md:hidden flex-1 overflow-auto p-3 bg-gray-50 custom-scrollbar">
          <div className="space-y-4">
            {foremen.map((foreman) => {
              const projects = (foremanDateProjects[foreman.id]?.[dateKey] || []).filter(p => p.hours > 0);
              const scheduledHrs = projects.reduce((sum, p) => sum + p.hours, 0);
              const currentEmployees = crewAssignments[dateKey]?.[foreman.id] || [];
              const actualHrs = (1 + currentEmployees.length) * 10; // 10h for foreman + crew
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
                          <div key={pIdx} className="bg-gradient-to-r from-blue-50 to-blue-25 px-4 py-4 rounded-lg flex justify-between items-start border-2 border-blue-200 shadow-md hover:shadow-lg transition-shadow">
                            <div className="overflow-hidden flex-1">
                              <div className="text-sm font-black text-blue-900 uppercase tracking-wider leading-tight mb-2">{p.projectName}</div>
                              <div className="text-xs text-blue-600 font-semibold">{p.customer}</div>
                            </div>
                            <div className="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-black ml-3 shadow-md whitespace-nowrap">
                              {p.hours.toFixed(0)} <span className="text-xs opacity-75">HRS</span>
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
            style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.ceil(foremen.length / 2))}, minmax(0, 1fr))` }}
          >
            {foremen.map((foreman) => {
              const projects = (foremanDateProjects[foreman.id]?.[dateKey] || []).filter(p => p.hours > 0);
              const scheduledHrs = projects.reduce((sum, p) => sum + p.hours, 0);
              const currentEmployees = crewAssignments[dateKey]?.[foreman.id] || [];
              const actualHrs = (1 + currentEmployees.length) * 10; // 10h for foreman + crew
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
                  <div className="px-2 py-1.5 flex justify-between items-center bg-stone-800 border-b border-stone-700">
                    <h3 className="text-[14px] font-black text-white uppercase italic tracking-wider truncate max-w-[120px]">{foreman.firstName} {foreman.lastName[0]}.</h3>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div className="text-[10px] font-black text-red-500 leading-none">{actualHrs}</div>
                        <div className="text-[5px] font-black text-white/40 uppercase tracking-tighter">ACT</div>
                      </div>
                      <div className="w-px h-5 bg-stone-700"></div>
                      <div className="text-right">
                        <div className="text-[10px] font-black text-stone-400 leading-none">{scheduledHrs}</div>
                        <div className="text-[5px] font-black text-white/40 uppercase tracking-tighter">SCH</div>
                      </div>
                    </div>
                  </div>

                  <div className="p-1.5 space-y-2 flex-1 flex flex-col min-h-0 bg-white">
                    {/* Projects Section - Branded */}
                    <div className="flex-none pb-0.5">
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${statusColor} shadow-lg shadow-black/10`}></div>
                        <h4 className="text-[7px] uppercase font-black text-stone-400 tracking-[0.2em] italic">Project Assignments</h4>
                      </div>
                      <div className="space-y-1 max-h-[80px] overflow-y-auto no-scrollbar">
                        {projects.map((p, pIdx) => (
                          <div key={pIdx} className="bg-gradient-to-r from-blue-600 to-blue-700 px-2 py-2 rounded-lg flex justify-between items-center border border-blue-800 shadow-sm hover:shadow-md transition-all hover:from-blue-700 hover:to-blue-800">
                            <div className="overflow-hidden pr-2 flex-1">
                              <div className="font-black text-white text-[13px] truncate uppercase leading-tight">{p.projectName}</div>
                            </div>
                            <div className="bg-white px-2 py-0.5 rounded-lg shadow-sm text-blue-700 font-black text-[9px] ml-auto whitespace-nowrap">
                              {p.hours.toFixed(0)}h
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Personnel Selection - Interactive Toggle UI */}
                    <div className="flex-1 flex flex-col min-h-0">
                      <div className="flex justify-between items-center mb-1 px-0.5">
                        <h4 className="text-[7px] uppercase font-black text-stone-400 tracking-[0.2em] italic">Crew ({currentEmployees.length})</h4>
                        <div className="w-1 h-1 rounded-full bg-red-900 shadow-sm animate-pulse"></div>
                      </div>
                      
                      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-0.5">
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
                                className="w-full flex items-center justify-between px-1.5 py-0.5 bg-red-900 text-white rounded-lg text-[11px] font-black hover:bg-red-800 transition-all text-left shadow-md shadow-red-900/20 active:scale-95 border border-red-800"
                              >
                                <span className="truncate uppercase tracking-tight italic">{emp.firstName} {emp.lastName}</span>
                                <svg className="shrink-0" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              </button>
                            );
                          })}
                          
                          {/* Available to Assign */}
                          {availableEmployees
                            .filter(emp => !currentEmployees.includes(emp.id))
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
                                  className="w-full flex items-center justify-between px-1.5 py-0.5 bg-white border border-gray-100 text-stone-600 rounded-lg text-[11px] font-black hover:border-red-900/40 hover:text-red-900 transition-all text-left group shadow-sm active:scale-95"
                                >
                                  <div className="flex flex-col truncate">
                                    <span className="truncate uppercase tracking-tight">{emp.firstName} {emp.lastName}</span>
                                    {hoursOff > 0 && <span className="text-[6px] text-orange-600 font-black leading-none italic tracking-widest">ABSENT</span>}
                                  </div>
                                  <svg className="opacity-0 group-hover:opacity-100 text-red-900 shrink-0 transform group-hover:rotate-90 transition-all" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                                  </svg>
                                </button>
                              );
                            })
                          }
                      </div>
                    </div>
                  </div>

                  {/* Utilization Indicator */}
                  <div className="h-1 w-full bg-gray-100 mt-auto">
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

        {/* Unassigned Projects tray */}
        {foremanDateProjects.__unassigned__?.[dateKey]?.filter(p => p.hours > 0).length > 0 && (
          <div className="hidden md:flex px-6 py-2.5 bg-stone-50 border-t border-stone-200 items-center gap-4">
            <span className="text-[9px] font-black uppercase tracking-[0.2em] bg-stone-800 text-white px-3 py-1 rounded-lg shadow-md italic">Unassigned Projects</span>
            <div className="flex-1 flex gap-3 overflow-x-auto no-scrollbar py-1">
              {foremanDateProjects.__unassigned__[dateKey].filter(p => p.hours > 0).map((p, pIdx) => (
                <Link 
                  key={pIdx} 
                  href={`/short-term-schedule?search=${encodeURIComponent(p.projectName)}`}
                  className="bg-white border border-stone-200 rounded-xl px-4 py-1.5 flex items-center gap-3 flex-shrink-0 shadow-sm hover:border-red-900/40 hover:shadow-md transition-all group"
                >
                  <span className="text-[10px] font-black text-stone-800 group-hover:text-red-900 truncate max-w-[200px] uppercase italic tracking-tight">{p.projectName}</span>
                  <span className="text-[10px] font-black text-red-900 bg-red-50 px-2 rounded-lg py-0.5">{p.hours.toFixed(0)}H</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* People Off - Selected dispatch day */}
      {peopleOffForDate.length > 0 && (
        <div className="mt-1 px-4 flex flex-wrap gap-x-2 gap-y-0.5 items-center justify-center opacity-40">
          <span className="text-[8px] font-black uppercase tracking-tighter text-gray-500 mr-1">Away:</span>
          {peopleOffForDate.map((person, idx) => (
            <span key={idx} className="text-[8px] font-bold text-gray-500 leading-none">
              {person.name}{idx < peopleOffForDate.length - 1 ? "," : ""}
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
    </main>
  );
}
