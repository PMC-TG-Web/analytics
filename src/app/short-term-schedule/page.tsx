"use client";

import React, { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { db, setDoc, getDocs, collection, query, doc, where, orderBy, deleteDoc, serverTimestamp, getDoc } from "@/firebase";


import Navigation from "@/components/Navigation";
import { Scope, Project, ProjectInfo } from "@/types";
import { ProjectScopesModal } from "@/app/project-schedule/components/ProjectScopesModal";
import { getEnrichedScopes, getProjectKey } from "@/utils/projectUtils";
import { syncProjectWIP, syncGanttWithShortTerm } from "@/utils/scheduleSync";
import { getActiveScheduleDocId, recalculateScopeTracking } from "@/utils/activeScheduleUtils";

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
  scopeOfWork?: string; // Which scope these hours belong to
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

interface TimeOffRequest {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  type: "Vacation" | "Sick" | "Personal" | "Other" | "Company timeoff";
  hours?: number;
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

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function ShortTermSchedulePage() {
  return (
    <Suspense fallback={<div className="h-screen bg-gray-50 flex items-center justify-center font-black text-gray-400 p-6 animate-pulse uppercase tracking-[0.2em]">Loading Schedule...</div>}>
      <ShortTermScheduleContent />
    </Suspense>
  );
}

function ShortTermScheduleContent() {
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const tableScrollRef = React.useRef<HTMLDivElement>(null);
  const [dayColumns, setDayColumns] = useState<DayColumn[]>([]);
  const [foremanDateProjects, setForemanDateProjects] = useState<Record<string, Record<string, DayProject[]>>>({}); // foremanId -> dateKey -> projects
  const [foremen, setForemen] = useState<Employee[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [companyCapacity, setCompanyCapacity] = useState<number>(210); // Standard 210, will be dynamic
  const [dailyCapacity, setDailyCapacity] = useState<Record<string, number>>({});
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [scopesByJobKey, setScopesByJobKey] = useState<Record<string, Scope[]>>({});
  const [crewAssignments, setCrewAssignments] = useState<Record<string, Record<string, string[]>>>({}); // dateKey -> foremanId -> employee IDs
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedGanttProject, setSelectedGanttProject] = useState<ProjectInfo | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [isAddingProject, setIsAddingProject] = useState<boolean>(false);
  const [scopeSelectionModal, setScopeSelectionModal] = useState<{ jobKey: string; projects: Project[] } | null>(null);
  const [targetingCell, setTargetingCell] = useState<{ date: Date; foremanId: string } | null>(null);
  const [draggedProject, setDraggedProject] = useState<{
    project: DayProject | Project;
    sourceDateKey?: string;
    sourceForemanId?: string;
    isNew?: boolean;
  } | null>(null);

  const scheduledHoursByJobKeyDate = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    Object.values(foremanDateProjects).forEach((dateMap) => {
      Object.entries(dateMap).forEach(([dateKey, projects]) => {
        projects.forEach((project) => {
          if (!project.jobKey) return;
          if (!map[project.jobKey]) map[project.jobKey] = {};
          map[project.jobKey][dateKey] = (map[project.jobKey][dateKey] || 0) + (project.hours || 0);
        });
      });
    });
    return map;
  }, [foremanDateProjects]);
  const autoScrollIntervalRef = React.useRef<NodeJS.Timeout | null>(null);

  // Set mounted on client side to prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const search = searchParams.get("search");
    if (search) {
      setProjectSearch(search);
      setIsAddingProject(true); // Ensure the search tray is open when clicking from the dispatch board
      // Wait for render, then find and scroll to highlighted elements
      setTimeout(() => {
        const highlighted = document.querySelector('.ring-yellow-400');
        if (highlighted) {
          highlighted.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 800);
    }
  }, [searchParams]);

  useEffect(() => {
    loadSchedules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup auto-scroll interval on unmount
  useEffect(() => {
    return () => {
      if (autoScrollIntervalRef.current) {
        clearInterval(autoScrollIntervalRef.current);
      }
    };
  }, []);

  function openGanttModal(customer: string, projectName: string, projectNumber: string) {
    const jobKey = getProjectKey({ customer, projectName, projectNumber } as Project);
    const project = allProjects.find((p) => {
      const pKey = getProjectKey(p);
      return pKey === jobKey;
    });

    if (project) {
      setSelectedGanttProject({
        jobKey,
        customer: project.customer || "",
        projectName: project.projectName || "",
        projectNumber: project.projectNumber || "",
        projectDocId: project.id
      });
    } else {
      console.warn("Project not found for key:", jobKey);
    }
  }

  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    // Global drag handler for scrolling
    const handleGlobalDragOver = (e: DragEvent) => {
      if (!draggedProject || !tableScrollRef.current) return;
      
      const container = tableScrollRef.current;
      const rect = container.getBoundingClientRect();
      const scrollThreshold = 100;
      
      // Only scroll if drag is over the table container
      if (e.clientY < rect.top || e.clientY > rect.bottom) {
        if (autoScrollIntervalRef.current) {
          clearInterval(autoScrollIntervalRef.current);
          autoScrollIntervalRef.current = null;
        }
        return;
      }
      
      // Clear existing scroll
      if (autoScrollIntervalRef.current) {
        clearInterval(autoScrollIntervalRef.current);
        autoScrollIntervalRef.current = null;
      }
      
      let scrollSpeed = 0;
      
      // Check if near top
      if (e.clientY - rect.top < scrollThreshold && container.scrollTop > 0) {
        scrollSpeed = -1;
      }
      // Check if near bottom
      else if (rect.bottom - e.clientY < scrollThreshold && container.scrollTop < container.scrollHeight - container.clientHeight) {
        scrollSpeed = 1;
      }
      
      if (scrollSpeed !== 0) {
        autoScrollIntervalRef.current = setInterval(() => {
          container.scrollTop += scrollSpeed * 15;
        }, 16);
      }
    };

    if (draggedProject) {
      document.addEventListener('dragover', handleGlobalDragOver);
      return () => document.removeEventListener('dragover', handleGlobalDragOver);
    }
  }, [draggedProject]);

  function handleDragOverScroll(e: React.DragEvent) {
    setDragOver(true);
    if (!tableScrollRef.current) return;
    
    const container = tableScrollRef.current;
    const rect = container.getBoundingClientRect();
    const scrollThreshold = 100; // pixels from edge to trigger scroll
    
    // Clear any existing scroll interval
    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }
    
    let scrollSpeed = 0;
    
    // Check if mouse is near top
    if (e.clientY - rect.top < scrollThreshold && container.scrollTop > 0) {
      scrollSpeed = -1;
    } 
    // Check if mouse is near bottom
    else if (rect.bottom - e.clientY < scrollThreshold && container.scrollTop < container.scrollHeight - container.clientHeight) {
      scrollSpeed = 1;
    }
    
    if (scrollSpeed !== 0) {
      autoScrollIntervalRef.current = setInterval(() => {
        if (container) {
          container.scrollTop += scrollSpeed * 12; // Scroll 12px per interval
        }
      }, 16); // ~60fps
    }
  }

  function handleDragEnd() {
    setDragOver(false);
    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }
  }

  // Helper: Get manpower for a scope
  function getScopeManpower(jobKey: string, scopeName: string): number {
    const scopes = scopesByJobKey[jobKey] || [];
    const scope = scopes.find(s => (s.title || '').trim() === scopeName.trim());
    return scope?.manpower || 0;
  }

  // Helper: Calculate hours to schedule based on manpower
  function calculateScheduledHours(jobKey: string, scopeName: string): number {
    const manpower = getScopeManpower(jobKey, scopeName);
    return manpower * 10; // 10 hours per person per day
  }

  function handleDragStart(project: DayProject | Project, dateKey?: string, foremanId?: string) {
    if ('jobKey' in project && dateKey && foremanId) {
      // It's an existing DayProject
      setDraggedProject({ project, sourceDateKey: dateKey, sourceForemanId: foremanId, isNew: false });
    } else {
      // It's a raw Project from the search list
      setDraggedProject({ project, isNew: true });
    }
  }

  async function handleDrop(e: React.DragEvent, targetDate: Date, targetForemanId: string) {
    e.preventDefault();
    if (!draggedProject) return;

    const targetDateKey = formatDateKey(targetDate);

    // Case 1: Dragging from Search List (New Entry)
    if (draggedProject.isNew) {
      const p = draggedProject.project as Project;
      const jobKey = getProjectKey(p);
      
      // Find all projects with this jobKey (all scopes)
      const matchingProjects = allProjects.filter(proj => getProjectKey(proj) === jobKey);
      
      // Deduplicate by scopeOfWork
      const uniqueScopes = new Map<string, Project>();
      matchingProjects.forEach(proj => {
        const scopeKey = proj.scopeOfWork || 'default';
        if (!uniqueScopes.has(scopeKey)) {
          uniqueScopes.set(scopeKey, proj);
        }
      });
      const uniqueProjects = Array.from(uniqueScopes.values());
      
      // Show scope selection modal
      setTargetingCell({ date: targetDate, foremanId: targetForemanId });
      setScopeSelectionModal({ jobKey, projects: uniqueProjects });
      setDraggedProject(null);
      return;
    }

    // Case 2: Rescheduling existing card
    const sourceProject = draggedProject.project as DayProject;
    const { sourceDateKey, sourceForemanId } = draggedProject;

    if (sourceDateKey === targetDateKey && sourceForemanId === targetForemanId) {
      setDraggedProject(null);
      return;
    }

    setSaving(true);
    try {
      const targetMonthStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
      const position = getWeekDayPositionForDate(targetMonthStr, targetDate);

      await moveProject(
        sourceProject, 
        sourceDateKey!, 
        sourceForemanId!, 
        targetDateKey, 
        targetForemanId, 
        position?.weekNumber || 1, 
        position?.dayNumber || 1
      );

      await loadSchedules();
    } catch (error) {
      console.error("Failed to move project:", error);
    } finally {
      setSaving(false);
      setDraggedProject(null);
    }
  }

  async function handleSearchProjectClick(p: Project) {
    const jobKey = getProjectKey(p);
    // Find all projects with this jobKey (all scopes)
    const matchingProjects = allProjects.filter(proj => getProjectKey(proj) === jobKey);
    
    // Deduplicate by scopeOfWork
    const uniqueScopes = new Map<string, Project>();
    matchingProjects.forEach(proj => {
      const scopeKey = proj.scopeOfWork || 'default';
      if (!uniqueScopes.has(scopeKey)) {
        uniqueScopes.set(scopeKey, proj);
      }
    });
    const uniqueProjects = Array.from(uniqueScopes.values());
    
    // Always show scope selection modal when targeting a cell (improves UX)
    if (targetingCell) {
      setScopeSelectionModal({ jobKey, projects: uniqueProjects });
      return;
    }
    
    // If not targeting a cell, show the Gantt modal for editing
    openGanttModal(p.customer || "", p.projectName || "", p.projectNumber || "");
  }

  async function handleScopeSelect(p: Project) {
    if (!targetingCell) return;
    
    const { date, foremanId } = targetingCell;
    const dateKey = formatDateKey(date);
    const jobKey = getProjectKey(p);
    const targetMonthStr = dateKey.substring(0, 7);
    const position = getWeekDayPositionForDate(targetMonthStr, date);

    if (position) {
      setSaving(true);
      try {
        // Get the manpower for this scope to calculate hours
        const manpower = p.manpower || 0;
        const hoursToSchedule = manpower > 0 ? manpower * 10 : 8; // Calculate from manpower, or fallback to 8
        const scopeOfWork = (p.scopeOfWork || "Scheduled Work").trim();
        
        const newProject: DayProject = {
          jobKey,
          scopeOfWork,
          customer: p.customer || "",
          projectNumber: p.projectNumber || "",
          projectName: p.projectName || "",
          hours: hoursToSchedule,
          foreman: foremanId === "__unassigned__" ? "" : foremanId,
          employees: [],
          month: targetMonthStr,
          weekNumber: position.weekNumber,
          dayNumber: position.dayNumber
        };
        await updateProjectAssignment(newProject, dateKey, foremanId, foremanId, hoursToSchedule);
        await loadSchedules();
        setTargetingCell(null);
        setIsAddingProject(false);
        setScopeSelectionModal(null);
      } finally {
        setSaving(false);
      }
    }
  }

  async function moveProject(
    project: DayProject,
    sourceDateKey: string,
    sourceForemanId: string,
    targetDateKey: string,
    targetForemanId: string,
    targetWeekNum: number,
    targetDayNum: number
  ) {
    const { jobKey, hours, scopeOfWork: scopeFromProject } = project;
    const scopeOfWork = scopeFromProject || "Scheduled Work";
    const foremanValue = targetForemanId === "__unassigned__" || !targetForemanId ? "" : targetForemanId;
    
    // Delete old entry on source date
    const sourceDocId = getActiveScheduleDocId(jobKey, scopeOfWork, sourceDateKey);
    const sourceDocRef = doc(db, 'activeSchedule', sourceDocId);
    try {
      await deleteDoc(sourceDocRef);
    } catch (e) {
      // May not exist, that's okay
    }
    
    // Create new entry on target date
    const targetDocId = getActiveScheduleDocId(jobKey, scopeOfWork, targetDateKey);
    const targetDocRef = doc(db, 'activeSchedule', targetDocId);
    
    await setDoc(targetDocRef, {
      jobKey,
      scopeOfWork,
      date: targetDateKey,
      hours,
      foreman: foremanValue,
      source: 'short-term',
      lastModified: serverTimestamp()
    }, { merge: true });
    
    // Update scopeTracking
    await recalculateScopeTracking(jobKey, { [scopeOfWork]: 0 });
    await syncProjectWIP(jobKey);
    await syncGanttWithShortTerm(jobKey);
  }

  async function updateProjectAssignment(
    project: DayProject, 
    dateKey: string, 
    currentForemanId: string,
    newForemanId: string | null,
    newHours: number
  ) {
    const { jobKey, scopeOfWork: scopeFromProject } = project;
    const scopeOfWork = scopeFromProject || "Scheduled Work";
    const foremanValue = newForemanId === "__unassigned__" || !newForemanId ? "" : newForemanId;
    
    // Delete old entry if hours are being removed (newHours <= 0)
    if (newHours <= 0) {
      const docId = getActiveScheduleDocId(jobKey, scopeOfWork, dateKey);
      const docRef = doc(db, 'activeSchedule', docId);
      try {
        await deleteDoc(docRef);
      } catch (e) {
        // Doc may not exist, that's okay
      }
    } else {
      // Write to activeSchedule
      const docId = getActiveScheduleDocId(jobKey, scopeOfWork, dateKey);
      const docRef = doc(db, 'activeSchedule', docId);
      
      await setDoc(docRef, {
        jobKey,
        scopeOfWork,
        date: dateKey,
        hours: newHours,
        foreman: foremanValue,
        source: 'short-term',
        lastModified: serverTimestamp()
      }, { merge: true });
    }
    
    // Update scopeTracking
    await recalculateScopeTracking(jobKey, { [scopeOfWork]: 0 }); // Pass empty scope totals - it will sum from activeSchedule
    await syncProjectWIP(jobKey);
    await syncGanttWithShortTerm(jobKey);
  }

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
      // Helper: Get cached data
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
        } catch (e) {
          console.error('Cache error:', e);
        }
      };

      // Load employees to get foremen
      let allEmps: Employee[] = getCache('schedule_employees') || [];
      if (allEmps.length === 0) {
        const employeesSnapshot = await getDocs(collection(db, "employees"));
        allEmps = employeesSnapshot.docs
          .map((doc: any) => {
            const data = doc.data();
            return {
              id: doc.id,
              firstName: data.firstName || '',
              lastName: data.lastName || '',
              jobTitle: data.jobTitle || data.role || '',
              isActive: data.isActive !== false
            } as Employee;
          })
          .sort((a, b) => {
            const nameA = `${a.firstName} ${a.lastName}`;
            const nameB = `${b.firstName} ${b.lastName}`;
            return nameA.localeCompare(nameB);
          });
        setCache('schedule_employees', allEmps);
      }
      
      setAllEmployees(allEmps);

      // Dynamic Capacity: Count active field staff (foremen + workers)
      const activeFieldStaff = allEmps.filter(e => 
        e.isActive && (
          e.jobTitle === "Foreman" || 
          e.jobTitle === "Lead foreman" || 
          e.jobTitle === "Lead Foreman" || 
          e.jobTitle === "Lead Foreman / Project Manager" || 
          e.jobTitle === "Field Worker" || 
          e.jobTitle === "Field worker"
        )
      );
      setCompanyCapacity(activeFieldStaff.length * 10);
      
      const foremenList = allEmps.filter((emp) => 
        emp.isActive && (emp.jobTitle === "Foreman" || emp.jobTitle === "Lead foreman" || emp.jobTitle === "Lead Foreman" || emp.jobTitle === "Lead Foreman / Project Manager")
      );
      setForemen(foremenList);
      
      // Cache projectScopes since they don't change often (needed for scope modal)
      let rawScopes: Scope[] = getCache('schedule_projectScopes') || [];
      let scopesNeedRefresh = rawScopes.length === 0;
      
      const [projectScopesSnapshot, timeOffSnapshot] = await Promise.all([
        scopesNeedRefresh ? getDocs(collection(db, "projectScopes")) : Promise.resolve(null),
        getDocs(collection(db, "timeOffRequests"))
      ]);

      if (projectScopesSnapshot) {
        rawScopes = projectScopesSnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as Scope));
        setCache('schedule_projectScopes', rawScopes);
      }

      const timeOffRequests = timeOffSnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })) as TimeOffRequest[];

      // Fetch active projects for scope lookup
      const projectsSnapshot = await getDocs(query(
        collection(db, "projects"),
        where("status", "not-in", ["Bid Submitted", "Lost"]),
        where("projectArchived", "==", false)
      ));
      
      const projs = projectsSnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }) as Project);
      setAllProjects(projs);
      
      // Pre-group projects by JobKey for lookup
      const projectsByJobKey: Record<string, Project[]> = {};
      projs.forEach(p => {
        const pKey = getProjectKey(p);
        if (!projectsByJobKey[pKey]) projectsByJobKey[pKey] = [];
        projectsByJobKey[pKey].push(p);
      });

      // Generate scopes for the modal (keep existing logic for compatibility)
      const scopesByJobKeyAndName: Record<string, Record<string, Scope>> = {};
      projs.forEach(p => {
        const jobKey = getProjectKey(p);
        const scopeName = (p.scopeOfWork || 'Default Scope').trim();

        if (!scopesByJobKeyAndName[jobKey]) scopesByJobKeyAndName[jobKey] = {};

        const key = scopeName.toLowerCase();
        if (!scopesByJobKeyAndName[jobKey][key]) {
          scopesByJobKeyAndName[jobKey][key] = {
            id: `generated-${jobKey}-${scopeName}`,
            jobKey: jobKey,
            title: scopeName,
            hours: 0,
            manpower: 0,
            startDate: '',
            endDate: '',
            description: ''
          };
        }
        scopesByJobKeyAndName[jobKey][key].hours! += (p.hours || 0);
      });

      const generatedScopes: Scope[] = [];
      Object.values(scopesByJobKeyAndName).forEach(scopesForJob => {
        generatedScopes.push(...Object.values(scopesForJob));
      });

      const isAutoScheduledScope = (scope: Scope) =>
        (scope.title || '').trim().toLowerCase() === 'scheduled work';

      const baseScopes = rawScopes.length === 0 ? [] : getEnrichedScopes(rawScopes, projs);
      const realScopes = baseScopes.filter(scope => scope.jobKey && !isAutoScheduledScope(scope));

      const realScopeTitlesByJobKey = new Map<string, Set<string>>();
      realScopes.forEach(scope => {
        const jobKey = scope.jobKey || "";
        if (!jobKey) return;
        const titleKey = (scope.title || "").trim().toLowerCase();
        if (!realScopeTitlesByJobKey.has(jobKey)) {
          realScopeTitlesByJobKey.set(jobKey, new Set<string>());
        }
        if (titleKey) realScopeTitlesByJobKey.get(jobKey)!.add(titleKey);
      });

      const fallbackScopes = generatedScopes.filter(scope => {
        if (!scope.jobKey) return false;
        const titleKey = (scope.title || "").trim().toLowerCase();
        const existingTitles = realScopeTitlesByJobKey.get(scope.jobKey);
        return !titleKey || !existingTitles || !existingTitles.has(titleKey);
      });

      const enrichedScopes: Scope[] = [...realScopes, ...fallbackScopes];

      const scopesObj: Record<string, Scope[]> = {};
      enrichedScopes.forEach(scope => {
        if (scope.jobKey) {
          if (!scopesObj[scope.jobKey]) scopesObj[scope.jobKey] = [];
          scopesObj[scope.jobKey].push(scope);
        }
      });
      
      setScopesByJobKey(scopesObj);

      // ===== NEW: Load schedule data from activeSchedule collection =====
      // Calculate the date range for next 5 weeks
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
      
      const startDateStr = formatDateKey(currentWeekStart);
      const endDateStr = formatDateKey(new Date(fiveWeeksFromStart.getTime() - 1));
      
      // Query activeSchedule for this date range
      const activeScheduleQuery = query(
        collection(db, 'activeSchedule'),
        where('date', '>=', startDateStr),
        where('date', '<=', endDateStr)
      );
      
      const activeScheduleSnapshot = await getDocs(activeScheduleQuery);
      
      // Build day columns for next 5 weeks
      const dayMap = new Map<string, DayColumn>();
      const projectsByDay: Record<string, DayProject[]> = {};
      
      // Generate all work days (Mon-Fri) for next 5 weeks
      for (let weekNum = 0; weekNum < 5; weekNum++) {
        const weekStart = new Date(currentWeekStart);
        weekStart.setDate(weekStart.getDate() + (weekNum * 7));
        
        for (let dayOffset = 0; dayOffset < 5; dayOffset++) { // Mon-Fri only
          const date = new Date(weekStart);
          date.setDate(date.getDate() + dayOffset);
          
          const dateKey = formatDateKey(date);
          dayMap.set(dateKey, {
            date,
            dayLabel: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
            weekNumber: weekNum + 1,
          });
          projectsByDay[dateKey] = [];
        }
      }
      
      // Load data from activeSchedule
      activeScheduleSnapshot.docs.forEach(doc => {
        const entry = doc.data();
        const dateKey = entry.date;
        
        if (!projectsByDay[dateKey]) return; // Skip if outside our 5-week window
        
        const jobKey = entry.jobKey;
        const projectList = projectsByJobKey[jobKey] || [];
        
        if (projectList.length === 0) {
          // Extract from jobKey if no project found
          const parts = jobKey.split('~');
          projectList.push({
            customer: parts[0] || '',
            projectNumber: parts[1] || '',
            projectName: parts[2] || '',
          } as Project);
        }
        
        const project = projectList[0];
        
        // Aggregate hours by jobKey (multiple scopes for same project on same day = one card)
        const existing = projectsByDay[dateKey].find(p => p.jobKey === jobKey);
        
        if (existing) {
          existing.hours += entry.hours || 0;
        } else {
          projectsByDay[dateKey].push({
            jobKey,
            scopeOfWork: entry.scopeOfWork || "Scheduled Work", // Track the scope for this entry
            customer: project.customer || '',
            projectNumber: project.projectNumber || '',
            projectName: project.projectName || '',
            hours: entry.hours || 0,
            foreman: entry.foreman || '',
            employees: [],
            month: dateKey.substring(0, 7), // YYYY-MM
            weekNumber: 1,
            dayNumber: 1,
          });
        }
      });
      
      // Convert to arrays and sort
      const columns = Array.from(dayMap.values()).sort((a, b) => 
        a.date.getTime() - b.date.getTime()
      );
      
      setDayColumns(columns);
      
      // Calculate daily capacity based on time off
      const capacityMap: Record<string, number> = {};
      columns.forEach(col => {
        const dKey = formatDateKey(col.date);
        const dateStr = dKey; 
        
        let totalHoursOff = 0;
        activeFieldStaff.forEach(emp => {
          const matchingRequest = timeOffRequests.find(req => {
            if (req.employeeId !== emp.id) return false;
            return dateStr >= req.startDate && dateStr <= req.endDate;
          });
          if (matchingRequest) {
            totalHoursOff += matchingRequest.hours || 10;
          }
        });
        
        capacityMap[dKey] = (activeFieldStaff.length * 10) - totalHoursOff;
      });
      setDailyCapacity(capacityMap);
      
      // Reorganize projects by foreman and date for table view
      const foremanDateMap: Record<string, Record<string, DayProject[]>> = {};
      foremenList.forEach(foreman => {
        foremanDateMap[foreman.id] = {};
        columns.forEach(col => {
          const dateKey = formatDateKey(col.date);
          foremanDateMap[foreman.id][dateKey] = [];
        });
      });
      // Unassigned bucket for projects without a foreman
      foremanDateMap.__unassigned__ = {};
      columns.forEach(col => {
        const dateKey = formatDateKey(col.date);
        foremanDateMap.__unassigned__[dateKey] = [];
      });
      
      Object.entries(projectsByDay).forEach(([dateKey, projects]) => {
        projects.forEach(project => {
          if (project.hours <= 0) return; // SKIP zero-hour projects (deleted/moved)
          
          const fid = project.foreman || "__unassigned__";
          if (!foremanDateMap[fid]) foremanDateMap[fid] = {};
          if (!foremanDateMap[fid][dateKey]) foremanDateMap[fid][dateKey] = [];
          foremanDateMap[fid][dateKey].push(project);
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
      e.isActive && 
      (e.jobTitle === "Field Worker" || e.jobTitle === "Field worker") && 
      !assignedToOthers.includes(e.id)
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

  if (!mounted) {
    return <div className="h-screen bg-gray-50 flex items-center justify-center font-black text-gray-400 p-6 animate-pulse uppercase tracking-[0.2em]">Loading Schedule...</div>;
  }

  return (
    <main className="min-h-screen bg-neutral-100 p-2 md:p-4 font-sans text-slate-900">
      <div className="w-full flex flex-col max-h-[calc(100vh-1rem)] bg-white shadow-2xl rounded-3xl overflow-hidden border border-gray-200 p-4 md:p-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 pb-8 border-b border-gray-100">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900 uppercase italic leading-none">
              Short-Term <span className="text-orange-600">Schedule</span>
            </h1>
            <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-[0.2em] mt-2 border-l-2 border-orange-600/30 pl-3">
              Foremen & Project Assignments
            </p>
          </div>
          <div className="flex items-center gap-3 self-end md:self-center">
            <button
              onClick={async () => {
                if (!confirm('Delete all "Scope" and "Scheduled Work" scopes? This cannot be undone.')) return;
                setSaving(true);
                try {
                  const response = await fetch('/api/admin/cleanup-generic-scopes', { method: 'POST' });
                  const data = await response.json();
                  if (response.ok) {
                    alert(`✅ Cleanup complete!\n\n${data.message}`);
                    await loadSchedules();
                  } else {
                    alert(`❌ Error: ${data.error}`);
                  }
                } catch (error) {
                  alert(`❌ Failed: ${error}`);
                } finally {
                  setSaving(false);
                }
              }}
              className="px-3 py-2 rounded-xl text-[8px] font-black uppercase tracking-widest transition-all shadow-sm bg-red-100 hover:bg-red-200 text-red-700 hover:text-red-900 shadow-red-100/50"
              title="Delete generic scopes"
            >
              Cleanup
            </button>
            <button
              onClick={() => setIsAddingProject(!isAddingProject)}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm ${
                isAddingProject 
                ? 'bg-red-900 hover:bg-red-800 text-white shadow-red-900/20' 
                : 'bg-orange-600 hover:bg-orange-700 text-white shadow-orange-600/20'
              }`}
            >
              {isAddingProject ? 'Cancel' : '+ Add Project'}
            </button>
            <Navigation currentPage="short-term-schedule" />
          </div>
        </div>

        {isAddingProject && (
          <div className="mb-8 bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden transform transition-all">
            <div className={`p-4 md:p-6 border-b flex flex-col md:flex-row items-center justify-between gap-4 ${targetingCell ? 'bg-green-50 border-green-100' : 'bg-orange-50 border-orange-100'}`}>
              <h2 className="text-sm md:text-lg font-black text-gray-900 uppercase tracking-tight italic">
                {targetingCell 
                  ? `Targeting: ${targetingCell.date.toLocaleDateString()} · ${
                    [...foremen, { id: "__unassigned__", firstName: "Unassigned", lastName: "" }].find(f => f.id === targetingCell.foremanId)?.firstName
                  }`
                  : 'Search for Project'
                }
              </h2>
              <div className="relative w-full md:w-96 flex items-center gap-3">
                <div className="relative flex-1">
                  <input
                    type="text"
                    placeholder="Search name, customer, or number..."
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 rounded-xl border-2 border-orange-200 focus:border-orange-500 focus:outline-none text-sm font-bold shadow-sm"
                    autoFocus
                  />
                  <svg className="absolute left-3 top-2.5 h-4 w-4 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <button 
                  onClick={() => {
                    setIsAddingProject(false);
                    setTargetingCell(null);
                  }}
                  className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="p-4 md:p-6 max-h-[400px] overflow-y-auto">
              {projectSearch.length < 2 && !targetingCell ? (
                <div className="text-center py-10">
                   <div className="text-orange-900/20 text-4xl mb-3">🔍</div>
                   <div className="text-gray-400 font-black uppercase text-[10px] tracking-widest italic">Type to search or click Assign on a cell...</div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(() => {
                    // When targeting a cell with no search, show all active projects (filtered by status)
                    // Otherwise, filter by search term
                    const filtered = projectSearch.length >= 2
                      ? allProjects.filter(p => 
                        p.projectName?.toLowerCase().includes(projectSearch.toLowerCase()) ||
                        p.customer?.toLowerCase().includes(projectSearch.toLowerCase()) ||
                        p.projectNumber?.toLowerCase().includes(projectSearch.toLowerCase())
                      )
                      : targetingCell
                      ? allProjects.filter(p => p.status && !['Lost', 'Bid Submitted'].includes(p.status)) // Show active projects
                      : [];
                    
                    const grouped: Record<string, Project[]> = {};
                    filtered.forEach(p => {
                      const jobKey = getProjectKey(p);
                      if (!grouped[jobKey]) grouped[jobKey] = [];
                      grouped[jobKey].push(p);

                    });
                    
                    return Object.entries(grouped).slice(0, 50).map(([jobKey, projects], idx) => {
                      const p = projects[0]; // Representative project
                      
                      // Count unique scopes
                      const uniqueScopes = new Set(projects.map(proj => proj.scopeOfWork || 'default'));
                      const scopeCount = uniqueScopes.size;
                      
                      return (
                        <div
                          key={`${jobKey}-${idx}`}
                          draggable
                          onDragStart={() => handleDragStart(p)}
                          onClick={() => handleSearchProjectClick(p)}
                          className={`flex items-center p-4 border-2 rounded-2xl transition-all cursor-grab active:cursor-grabbing group shadow-sm bg-white hover:scale-[1.02] ${
                            targetingCell ? 'border-green-100 hover:border-green-500 hover:bg-green-50' : 'border-gray-50 hover:border-orange-500 hover:bg-orange-50'
                          }`}
                        >
                          <div className="flex-1 overflow-hidden">
                            <div className="font-black text-gray-900 text-sm truncate uppercase italic tracking-tight">{p.projectName}</div>
                            <div className="text-[10px] font-bold text-gray-500 truncate uppercase mt-0.5">{p.customer} · #{p.projectNumber}</div>
                            {scopeCount > 1 && (
                              <div className="text-[9px] font-black text-orange-600 mt-1 italic">{scopeCount} Unique Scopes</div>
                            )}
                          </div>
                          <div className={`ml-3 opacity-30 group-hover:opacity-100 transition-opacity ${targetingCell ? 'text-green-500' : 'text-orange-500'}`}>
                            {targetingCell ? (
                               <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
                              </svg>
                            ) : (
                              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 8h16M4 16h16" />
                              </svg>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
            <div className="bg-gray-50 p-4 text-[10px] font-black uppercase tracking-widest text-gray-400 border-t border-gray-100 italic">
              <span className="text-orange-600 ml-2">Scheduling System v2.0</span>
            </div>
          </div>
        )}

        {dayColumns.length === 0 ? (
          <div className="bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200 p-12 text-center">
             <p className="text-gray-400 font-black uppercase tracking-[0.2em]">No Data Synced</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Mobile Cards for Field Users */}
            <div className="md:hidden flex-1 overflow-y-auto space-y-6 custom-scrollbar pb-10">
              {dayColumns.slice(0, 14).map((day) => {
                const dateKey = formatDateKey(day.date);
                const dayTotal = Object.values(foremanDateProjects).reduce((sum, fMap) => {
                  return sum + (fMap[dateKey] || []).reduce((pSum, proj) => pSum + proj.hours, 0);
                }, 0);
                const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;

                return (
                  <div key={dateKey} className={`${isWeekend ? 'opacity-60' : ''}`}>
                    <div className="flex items-center justify-between mb-3 border-l-4 border-orange-600 pl-3">
                      <div>
                        <div className="text-lg font-black text-gray-900 italic uppercase leading-none">{day.dayLabel}</div>
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                          {day.date.toLocaleDateString("en-US", { weekday: "long" })}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-black text-orange-600">{dayTotal.toFixed(0)}h</div>
                        <div className="text-[8px] font-black uppercase text-gray-400 tracking-tighter">Total Allocation</div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {[...foremen, { id: "__unassigned__", firstName: "Unassigned", lastName: "" }].map((foreman) => {
                        const projects = (foremanDateProjects[foreman.id]?.[dateKey] || []).filter(p => p.hours > 0);
                        if (projects.length === 0) return null;

                        return (
                          <div key={foreman.id} className="bg-gray-50 rounded-2xl p-4 border border-gray-100 shadow-sm relative overflow-hidden group">
                             <div className="absolute top-0 right-0 p-2 opacity-5">
                               <div className="text-xs font-black uppercase italic bg-gray-200 px-2 py-0.5 rounded rotate-12">{foreman.lastName || 'PMC'}</div>
                             </div>
                             <div className="flex items-center gap-2 mb-3">
                               <div className="w-1.5 h-1.5 rounded-full bg-orange-600"></div>
                               <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest">
                                 {foreman.firstName} {foreman.lastName}
                               </h4>
                             </div>
                             <div className="space-y-2">
                               {projects.map((p, pIdx) => (
                                 <div 
                                    key={pIdx} 
                                    onClick={() => openGanttModal(p.customer, p.projectName, p.projectNumber)}
                                    className="bg-white border-2 border-orange-50 p-3 rounded-xl shadow-sm active:scale-95 transition-all"
                                  >
                                   <div className="font-black text-gray-900 text-xs uppercase leading-tight italic truncate pr-8">{p.projectName}</div>
                                   <div className="flex justify-between items-end mt-2">
                                     <div className="text-[9px] font-bold text-gray-400 uppercase tracking-tight">{p.customer}</div>
                                     <div className="bg-orange-600 text-white px-2 py-0.5 rounded-lg text-[10px] font-black shadow-sm shadow-orange-600/20">{p.hours.toFixed(0)} <span className="opacity-50">H</span></div>
                                   </div>
                                 </div>
                               ))}
                             </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table View */}
            <div 
              ref={tableScrollRef} 
              className="hidden md:block flex-1 bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden overflow-y-auto custom-scrollbar min-h-0"
            >
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-30">
                    <tr className="bg-stone-800">
                      <th className="sticky left-0 z-40 bg-stone-800 text-left py-6 px-6 text-xs font-black text-white uppercase tracking-[0.2em] italic border-r border-stone-700 w-48 shadow-lg">
                        Capacity
                      </th>
                      {dayColumns.map((day) => {
                        const dateKey = formatDateKey(day.date);
                        let totalHours = 0;
                        Object.values(foremanDateProjects).forEach(dateMap => {
                          if (dateMap[dateKey]) {
                            dateMap[dateKey].forEach(proj => { totalHours += proj.hours; });
                          }
                        });
                        const dayCapacity = dailyCapacity[dateKey] || companyCapacity;
                        const availabilityPercent = dayCapacity > 0 ? (totalHours / dayCapacity) * 100 : 0;
                        
                        let capacityColor = "bg-white/5";
                        if (availabilityPercent > 105) capacityColor = "bg-red-500/20 text-red-400";
                        else if (availabilityPercent > 90) capacityColor = "bg-yellow-500/10 text-yellow-500";

                        return (
                          <th key={dateKey} className="text-center py-5 px-4 text-xs font-black text-white border-r border-stone-700 min-w-[300px]">
                            <div className="flex flex-col items-center">
                              <span className="text-xl italic leading-none mb-1 tracking-tighter">{day.dayLabel}</span>
                              <div className="flex gap-2 items-center mb-2">
                                <span className="text-[9px] uppercase tracking-widest text-stone-500">{day.date.toLocaleDateString("en-US", { weekday: "short" })}</span>
                                <span className={`px-2 py-0.5 rounded-[4px] text-[10px] font-black border border-white/5 ${capacityColor}`}>
                                  {totalHours.toFixed(0)}<span className="opacity-30">/</span>{dayCapacity}H
                                </span>
                              </div>
                              <div className="w-32 h-1 bg-stone-700 rounded-full overflow-hidden border border-white/5">
                                <div 
                                  className={`h-full transition-all duration-700 ${
                                    availabilityPercent > 100 ? 'bg-red-500 shadow-sm shadow-red-500/50' : 
                                    availabilityPercent > 85 ? 'bg-yellow-400' : 'bg-green-500'
                                  }`}
                                  style={{ width: `${Math.min(availabilityPercent, 100)}%` }}
                                />
                              </div>
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {[...foremen, { id: "__unassigned__", firstName: "Unassigned", lastName: "" }].map((foreman, foremanIdx) => {
                      const foremanProjects = foremanDateProjects[foreman.id] || {};
                      return (
                        <tr key={foreman.id} className={`border-b border-gray-50 group hover:bg-gray-50/50 transition-colors ${foremanIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                          <td className="sticky left-0 z-20 bg-inherit py-4 px-6 text-[11px] font-black text-gray-800 uppercase tracking-wider italic border-r border-gray-100 shadow-md">
                            {foreman.firstName} <span className="text-gray-400 opacity-50">{foreman.lastName}</span>
                          </td>
                          {dayColumns.map((day) => {
                            const dateKey = formatDateKey(day.date);
                            const projects = (foremanProjects[dateKey] || []).filter(p => p.hours > 0);
                            const dayTotal = projects.reduce((sum, p) => sum + p.hours, 0);
                            const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
                            
                            return (
                              <td
                                key={dateKey}
                                className={`py-4 px-3 text-xs border-r border-gray-50 align-top transition-all ${isWeekend ? 'bg-gray-50/50' : ''} ${saving ? 'opacity-40 animate-pulse' : ''}`}
                                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('bg-orange-50/50'); }}
                                onDragLeave={(e) => { e.currentTarget.classList.remove('bg-orange-50/50'); }}
                                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('bg-orange-50/50'); handleDrop(e, day.date, foreman.id); }}
                              >
                                <div className="flex flex-col h-full min-h-[100px]">
                                  {projects.length > 0 ? (
                                    <div className="space-y-3 mb-3">
                                      {projects.map((project, projIdx) => {
                                        const isHighlighted = projectSearch && project.projectName?.toLowerCase().includes(projectSearch.toLowerCase());
                                        return (
                                          <div 
                                            key={projIdx} 
                                            draggable={!saving}
                                            onDragStart={() => handleDragStart(project, dateKey, foreman.id)}
                                            className={`relative group/proj border-2 rounded-2xl p-3 cursor-grab transition-all shadow-sm ${
                                              isHighlighted ? 'bg-yellow-50 border-yellow-400 ring-4 ring-yellow-400/20 scale-105 z-10' : 'bg-white border-orange-100 hover:border-orange-500'
                                            }`}
                                            onClick={() => openGanttModal(project.customer, project.projectName, project.projectNumber)}
                                          >
                                            <button
                                              onClick={async (e) => {
                                                e.stopPropagation();
                                                if (confirm(`Move ${project.projectName} to unassigned?`)) {
                                                  setSaving(true);
                                                  try { await updateProjectAssignment(project, dateKey, foreman.id, "", project.hours); await loadSchedules(); }
                                                  finally { setSaving(false); }
                                                }
                                              }}
                                              className="absolute -top-2 -right-2 opacity-0 group-hover/proj:opacity-100 p-1.5 bg-red-900 text-white rounded-full shadow-lg hover:scale-110 transition-all z-20"
                                            >
                                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                                <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
                                              </svg>
                                            </button>

                                            <div className="font-black text-gray-900 text-[11px] uppercase tracking-tight italic leading-tight mb-1 truncate pr-4">{project.projectName}</div>
                                            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-widest truncate">{project.customer}</div>
                                            <div className="flex items-center gap-2 mt-3 pt-2 border-t border-gray-50">
                                              <input
                                                type="number"
                                                step="0.5"
                                                defaultValue={project.hours.toFixed(1)}
                                                onBlur={async (e) => {
                                                  const newHrs = parseFloat(e.target.value);
                                                  if (!isNaN(newHrs) && newHrs !== project.hours) {
                                                    setSaving(true);
                                                    try { await updateProjectAssignment(project, dateKey, foreman.id, foreman.id, newHrs); await loadSchedules(); }
                                                    finally { setSaving(false); }
                                                  }
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                                className="w-10 bg-gray-50 text-[10px] font-black text-orange-600 focus:outline-none text-center rounded border border-transparent focus:border-orange-500"
                                              />
                                              <span className="text-[8px] font-black uppercase text-gray-400 tracking-tighter">Hrs</span>
                                            </div>
                                          </div>
                                        );
                                      })}
                                      <div className="text-center py-1.5 text-[10px] font-black text-orange-600 bg-orange-50 uppercase tracking-widest rounded-xl border border-orange-100">
                                        Σ {dayTotal.toFixed(1)} <span className="opacity-50 text-[8px]">H Total</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex-1 flex items-center justify-center opacity-5 select-none pointer-events-none">
                                      <div className="text-xl font-black italic tracking-tighter">PMC</div>
                                    </div>
                                  )}
                                  
                                  <button
                                    onClick={() => { setTargetingCell({ date: day.date, foremanId: foreman.id }); setIsAddingProject(true); setProjectSearch(""); }}
                                    className={`mt-auto py-2 border-2 border-dashed rounded-2xl transition-all flex items-center justify-center gap-2 ${
                                      targetingCell?.date.getTime() === day.date.getTime() && targetingCell?.foremanId === foreman.id
                                      ? 'border-green-500 text-green-600 bg-green-50 ring-4 ring-green-100'
                                      : 'border-transparent text-gray-300 hover:border-orange-200 hover:text-orange-500 opacity-0 group-hover:opacity-100'
                                    }`}
                                  >
                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
                                    </svg>
                                    <span className="text-[9px] font-black uppercase tracking-widest">Assign</span>
                                  </button>
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {selectedGanttProject && (
          <ProjectScopesModal
            project={selectedGanttProject}
            scopes={scopesByJobKey[selectedGanttProject.jobKey || ""] || []}
            allScopes={scopesByJobKey}
            scheduledHoursByJobKeyDate={scheduledHoursByJobKeyDate}
            selectedScopeId={null}
            companyCapacity={companyCapacity}
            onClose={() => {
              setSelectedGanttProject(null);
              setTargetingCell(null);
            }}
            onScopesUpdated={async (jobKey, updatedScopes) => {
              const enriched = getEnrichedScopes(updatedScopes, allProjects);
              setScopesByJobKey(prev => ({ ...prev, [jobKey]: enriched }));
              sessionStorage.removeItem("schedule_projectScopes");
              // Reload schedules to see updated hours
              await loadSchedules();
              if (targetingCell) {
                const { date, foremanId } = targetingCell;
                const dateKey = formatDateKey(date);
                const targetScope = updatedScopes.find(s => {
                  if (!s.startDate || !s.endDate) return false;
                  return dateKey >= s.startDate && dateKey <= s.endDate;
                }) || updatedScopes[updatedScopes.length - 1];
                
                if (targetScope?.startDate && targetScope?.endDate) {
                  const start = new Date(targetScope.startDate + 'T00:00:00');
                  const end = new Date(targetScope.endDate + 'T00:00:00');
                  if (date >= start && date <= end) {
                    const monthStr = dateKey.substring(0, 7);
                    const position = getWeekDayPositionForDate(monthStr, date);
                    if (position) {
                      const newProject: DayProject = {
                        jobKey,
                        customer: selectedGanttProject?.customer || "",
                        projectNumber: selectedGanttProject?.projectNumber || "",
                        projectName: selectedGanttProject?.projectName || "",
                        hours: 0,
                        foreman: foremanId === "__unassigned__" ? "" : foremanId,
                        employees: [],
                        month: monthStr,
                        weekNumber: position.weekNumber,
                        dayNumber: position.dayNumber
                      };
                      if (targetScope.manpower && targetScope.manpower > 0) {
                        newProject.hours = targetScope.manpower * 10;
                      } else {
                        let workDaysInRange = 0;
                        let curr = new Date(start);
                        while (curr <= end) {
                          if (curr.getDay() !== 0 && curr.getDay() !== 6) workDaysInRange++;
                          curr.setDate(curr.getDate() + 1);
                        }
                        if (workDaysInRange > 0) { newProject.hours = (targetScope.hours || 0) / workDaysInRange; }
                      }
                      if (newProject.hours > 0) { await updateProjectAssignment(newProject, dateKey, foremanId, foremanId, newProject.hours); }
                    }
                  }
                }
              }
              await loadSchedules();
            }}
          />
        )}

        {/* Scope Selection Modal */}
        {scopeSelectionModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setScopeSelectionModal(null)}>
            <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="p-6 border-b border-gray-200">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-xl font-black text-gray-900 uppercase italic tracking-tight">{scopeSelectionModal.projects[0]?.projectName}</h3>
                    <p className="text-sm font-bold text-gray-500 uppercase mt-1">{scopeSelectionModal.projects[0]?.customer} · #{scopeSelectionModal.projects[0]?.projectNumber}</p>
                  </div>
                  <button
                    onClick={() => setScopeSelectionModal(null)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="mt-3 text-xs font-black text-orange-600 uppercase tracking-widest">Select Scope of Work ({scopeSelectionModal.projects.length} unique options)</div>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {scopeSelectionModal.projects.map((project, idx) => (
                    <button
                      key={project.id || idx}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleScopeSelect(project);
                      }}
                      disabled={saving}
                      className="text-left p-4 border-2 border-gray-200 rounded-xl hover:border-orange-500 hover:bg-orange-50 transition-all group disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <div className="font-black text-gray-900 text-sm uppercase italic tracking-tight">{project.scopeOfWork || 'Unnamed Scope'}</div>
                      <div className="text-[10px] font-bold text-orange-600 uppercase mt-2 opacity-0 group-hover:opacity-100 transition-opacity">Click to Schedule →</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
      `}</style>
    </main>
  );
}
