"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/hooks/useAuth";
import { hasPageAccess } from "@/lib/permissions";

interface Announcement {
  id: string;
  title: string;
  content: string;
  date: string;
  author: string;
  important?: boolean;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  hireDate?: string;
  role?: string;
  jobTitle?: string | null;
  email?: string | null;
  workEmail?: string | null;
  personalEmail?: string | null;
}

interface WeatherData {
  temp: number;
  condition: string;
  icon: string;
  location: string;
  hourly: { time: string; temp: number; icon: string }[];
  daily: { date: string; low: number; high: number; icon: string }[];
}

type ActiveScheduleEntry = {
  id: string;
  jobKey: string;
  scopeOfWork: string;
  date: string;
  hours: number;
  foreman: string | null;
  manpower: number | null;
  source: string;
  customer?: string;
  projectNumber?: string;
  projectName?: string;
};

type TimeOffEntry = {
  id: string;
  employeeId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  type: string;
  dates: string[];
  status: string;
};

type ConcreteOrder = {
  id: string;
  jobKey: string;
  projectName: string;
  concreteCompany: string;
  date: string;
  time: string;
  totalYards: number;
};

type PMAssignment = {
  assignmentKey?: string;
  jobKey: string;
  pmId: string;
  updatedAt: string;
};

type CrewTemplate = {
  id: string;
  name: string;
  foremanId?: string | null;
  rightHandManId?: string | null;
  crewMemberIds?: string[];
};

type StoredScheduleDay = {
  dayNumber: number;
  hours: number;
  foreman?: string;
  employees?: string[];
};

type StoredScheduleWeek = {
  weekNumber: number;
  days: StoredScheduleDay[];
};

type StoredScheduleDoc = {
  jobKey: string;
  customer: string;
  projectNumber: string;
  projectName: string;
  month: string;
  weeks: StoredScheduleWeek[];
};

type ManagerProjectDetail = {
  crewMembers: string[];
  dates: string[];
};

type Persona = "manager" | "pm" | "foreman" | "generic";

const SAFETY_TOPICS = [
  {
    month: "January",
    title: "Silica Dust Exposure Protection",
    content:
      "When cutting, grinding, or drilling concrete, always use water-fed tools or HEPA-filtered vacuums. Ensure respirators are worn when required.",
    source: "OSHA Concrete Safety",
  },
  {
    month: "February",
    title: "Cold Weather Concrete Placement",
    content:
      "Protect concrete from freezing until it reaches 500 psi. Use insulating blankets and heated enclosures when temperatures drop below 40°F.",
    source: "ACI 306R-16",
  },
  {
    month: "March",
    title: "Fall Protection & Guardrails",
    content:
      "Guardrails or personal fall arrest systems are required for heights over 6 feet. Inspect all harnesses and lanyards before use.",
    source: "Safety Standards",
  },
  {
    month: "April",
    title: "Safe Operation of Power Trowels",
    content:
      "Keep hands and feet away from rotating blades. Always wear proper footwear and ensure the 'dead-man' switch is functioning correctly.",
    source: "Equipment Safety Manual",
  },
  {
    month: "May",
    title: "Proper Lifting Techniques",
    content:
      "Lift with your legs, not your back. Get help for loads over 50 lbs. Keep the load close to your body while moving.",
    source: "OSHA Guidelines",
  },
  {
    month: "June",
    title: "Heat Stress Prevention",
    content:
      "Drink water every 15 minutes, even if not thirsty. Wear light-colored clothing and take breaks in the shade. Watch for signs of heat exhaustion.",
    source: "NIOSH Heat Safety",
  },
  {
    month: "July",
    title: "Personal Protective Equipment (PPE)",
    content:
      "Hard hats, safety glasses, and high-visibility vests are mandatory at all times. Use gloves when handling wet concrete to prevent skin burns.",
    source: "Company Policy",
  },
  {
    month: "August",
    title: "Electrical Safety on Site",
    content:
      "Inspect extension cords for damage. Use GFCI protection for all power tools. Keep electrical equipment away from wet concrete areas.",
    source: "Electrical Standards",
  },
  {
    month: "September",
    title: "Trenching and Excavation",
    content:
      "Ensure proper shoring or sloping for trenches deeper than 5 feet. Keep excavated materials at least 2 feet away from the edge.",
    source: "OSHA Subpart P",
  },
  {
    month: "October",
    title: "Fire Prevention & Extinguishers",
    content:
      "Keep flammable liquids in approved containers. Know the location of the nearest fire extinguisher and how to use the PASS method.",
    source: "Fire Safety",
  },
  {
    month: "November",
    title: "Hand & Power Tool Safety",
    content:
      "Use the right tool for the job. Never remove safety guards. Disconnect tools before changing bits or blades.",
    source: "General Safety",
  },
  {
    month: "December",
    title: "Ladder and Scaffold Safety",
    content:
      "Maintain 3 points of contact on ladders. Scaffolds must be level and fully planked. Never use a damaged ladder.",
    source: "Scaffolding Safety",
  },
];

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRollingDateKeys(days: number): string[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return toDateKey(d);
  });
}

function normalizeEmail(value?: string | null): string {
  return (value || "").trim().toLowerCase();
}

function isForemanLikeTitle(title?: string | null): boolean {
  if (!title) return false;
  const normalized = title.toLowerCase().replace(/\s+/g, " ").trim();
  return normalized === "foreman" || normalized === "lead foreman";
}

function isGeneralManagerTitle(title?: string | null): boolean {
  if (!title) return false;
  const normalized = title.toLowerCase().replace(/\s+/g, " ").trim();
  return normalized === "general manager" || normalized === "gm";
}

function isPmLikeTitle(title?: string | null): boolean {
  if (!title) return false;
  const normalized = title.toLowerCase().replace(/\s+/g, " ").trim();
  return normalized === "pm" || normalized === "project manager" || normalized.includes("project manager");
}

function formatDayLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatProjectLabel(row: ActiveScheduleEntry): string {
  const customer = row.customer || "";
  const number = row.projectNumber || "";
  const name = row.projectName || "";
  if (!customer && !number && !name) return row.jobKey || "Unassigned Project";
  return [customer, number, name].filter(Boolean).join(" | ");
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

function getWeekDates(weekStart: Date): Date[] {
  const dates: Date[] = [];
  for (let i = 0; i < 5; i++) {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    dates.push(date);
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

const QUICK_LINKS: Array<{ label: string; href: string; page: string; color: string }> = [
  { label: "Dashboard", href: "/dashboard", page: "dashboard", color: "bg-stone-50 text-stone-700 hover:bg-stone-100" },
  { label: "WIP Report", href: "/wip", page: "wip", color: "bg-red-50 text-red-900 hover:bg-red-100" },
  { label: "Project Gantt", href: "/project-schedule", page: "project-schedule", color: "bg-gray-50 text-gray-700 hover:bg-gray-100" },
  { label: "Equipment", href: "/equipment", page: "equipment", color: "bg-stone-50 text-stone-700 hover:bg-stone-100" },
  { label: "Field Log", href: "/field", page: "field", color: "bg-red-50 text-red-900 hover:bg-red-100" },
  { label: "Employees", href: "/employees", page: "employees", color: "bg-neutral-50 text-neutral-600 hover:bg-neutral-100" },
];

const TODAY_KEY = toDateKey(new Date());

export default function Home() {
  return <HomeContent />;
}

function HomeContent() {
  const { user, loading: authLoading } = useAuth();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [activeSchedules, setActiveSchedules] = useState<ActiveScheduleEntry[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOffEntry[]>([]);
  const [concreteOrders, setConcreteOrders] = useState<ConcreteOrder[]>([]);
  const [pmAssignments, setPmAssignments] = useState<PMAssignment[]>([]);
  const [crewTemplates, setCrewTemplates] = useState<CrewTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCallOffModal, setShowCallOffModal] = useState(false);
  const [showTimeOffModal, setShowTimeOffModal] = useState(false);
  const [submittingQuickAction, setSubmittingQuickAction] = useState(false);
  const [quickActionMessage, setQuickActionMessage] = useState<string | null>(null);
  const [expandedManagerProjectKey, setExpandedManagerProjectKey] = useState<string | null>(null);
  const [managerProjectDetails, setManagerProjectDetails] = useState<Record<string, ManagerProjectDetail>>({});
  const [managerDetailLoadingKey, setManagerDetailLoadingKey] = useState<string | null>(null);
  const [callOffForm, setCallOffForm] = useState({
    date: TODAY_KEY,
    type: "Sick" as "Sick" | "Personal" | "Late" | "No Show",
    reason: "",
  });
  const [timeOffForm, setTimeOffForm] = useState({
    startDate: TODAY_KEY,
    endDate: TODAY_KEY,
    type: "Vacation" as "Vacation" | "Sick" | "Personal" | "Other",
    hours: 10,
    reason: "",
  });

  const dateKeys = useMemo(() => getRollingDateKeys(7), []);
  const startDate = dateKeys[0];
  const endDate = dateKeys[dateKeys.length - 1];

  useEffect(() => {
    async function fetchWeather() {
      try {
        const lat = 40.06;
        const lon = -76.2;
        const weatherRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=temperature_2m,weathercode&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto`
        );
        const weatherData = await weatherRes.json();
        if (!weatherData.current_weather) return;

        const tempF = Math.round((weatherData.current_weather.temperature * 9) / 5 + 32);
        const code = weatherData.current_weather.weathercode;

        const getIcon = (c: number) => {
          if (c === 0) return "☀";
          if (c >= 1 && c <= 3) return "⛅";
          if (c >= 45 && c <= 48) return "🌫";
          if (c >= 51 && c <= 67) return "🌧";
          if (c >= 71 && c <= 77) return "❄";
          if (c >= 80 && c <= 82) return "🌦";
          if (c >= 95) return "⛈";
          return "☁";
        };

        const getCondition = (c: number) => {
          if (c === 0) return "Clear";
          if (c >= 1 && c <= 3) return "Partly Cloudy";
          if (c >= 45 && c <= 48) return "Foggy";
          if (c >= 51 && c <= 67) return "Raining";
          if (c >= 71 && c <= 77) return "Snowing";
          if (c >= 80 && c <= 82) return "Showers";
          if (c >= 95) return "Stormy";
          return "Cloudy";
        };

        const now = new Date();
        now.setMinutes(0, 0, 0);
        let startIndex = weatherData.hourly.time.findIndex((t: string) => new Date(t) >= now);
        if (startIndex === -1) startIndex = new Date().getHours();

        const hourly = weatherData.hourly.time.slice(startIndex, startIndex + 8).map((t: string, i: number) => ({
          time: new Date(t).toLocaleTimeString([], { hour: "numeric" }),
          temp: Math.round((weatherData.hourly.temperature_2m[startIndex + i] * 9) / 5 + 32),
          icon: getIcon(weatherData.hourly.weathercode[startIndex + i]),
        }));

        const daily = weatherData.daily.time.map((t: string, i: number) => ({
          date: new Date(t).toLocaleDateString([], { weekday: "short" }),
          high: Math.round((weatherData.daily.temperature_2m_max[i] * 9) / 5 + 32),
          low: Math.round((weatherData.daily.temperature_2m_min[i] * 9) / 5 + 32),
          icon: getIcon(weatherData.daily.weathercode[i]),
        }));

        setWeather({
          temp: tempF,
          condition: getCondition(code),
          icon: getIcon(code),
          location: "Quarryville, PA",
          hourly,
          daily,
        });
      } catch (error) {
        console.error("Weather fetch failed:", error);
      }
    }

    fetchWeather();
  }, []);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        setAnnouncements([]);

        const [employeesRes, scheduleRes, timeOffRes, concreteRes, pmRes, crewTemplatesRes] = await Promise.all([
          fetch("/api/employees?isActive=true&page=1&pageSize=500", { cache: "no-store" }),
          fetch(`/api/short-term-schedule?action=active-schedule&startDate=${startDate}&endDate=${endDate}`, {
            cache: "no-store",
          }),
          fetch("/api/time-off", { cache: "no-store" }),
          fetch(`/api/concrete-orders?startDate=${startDate}&endDate=${endDate}`, { cache: "no-store" }),
          fetch("/api/long-term-schedule/pm-assignments", { cache: "no-store" }),
          fetch("/api/crew-templates", { cache: "no-store" }),
        ]);

        const [employeesJson, scheduleJson, timeOffJson, concreteJson, pmJson, crewTemplatesJson] = await Promise.all([
          employeesRes.json().catch(() => ({ success: false, data: [] })),
          scheduleRes.json().catch(() => ({ success: false, data: [] })),
          timeOffRes.json().catch(() => ({ success: false, data: [] })),
          concreteRes.json().catch(() => ({ success: false, data: [] })),
          pmRes.json().catch(() => ({ success: false, data: [] })),
          crewTemplatesRes.json().catch(() => ({ success: false, data: [] })),
        ]);

        setEmployees(Array.isArray(employeesJson?.data) ? employeesJson.data : []);
        setActiveSchedules(Array.isArray(scheduleJson?.data) ? scheduleJson.data : []);
        setTimeOff(Array.isArray(timeOffJson?.data) ? timeOffJson.data : []);
        setConcreteOrders(Array.isArray(concreteJson?.data) ? concreteJson.data : []);
        setPmAssignments(Array.isArray(pmJson?.data) ? pmJson.data : []);
        setCrewTemplates(Array.isArray(crewTemplatesJson?.data) ? crewTemplatesJson.data : []);
      } catch (error) {
        console.error("Error fetching home page data:", error);
        setEmployees([]);
        setActiveSchedules([]);
        setTimeOff([]);
        setConcreteOrders([]);
        setPmAssignments([]);
        setCrewTemplates([]);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [startDate, endDate]);

  const currentMonthIdx = new Date().getMonth();
  const currentSafetyTopic = SAFETY_TOPICS[currentMonthIdx];

  const anniversaries = useMemo(() => {
    const today = new Date();
    const currentMonth = today.getMonth();

    return employees
      .filter((emp) => {
        if (!emp.hireDate) return false;
        const hireDate = new Date(emp.hireDate);
        return hireDate.getMonth() === currentMonth;
      })
      .map((emp) => {
        const hireDate = new Date(emp.hireDate || "");
        const years = today.getFullYear() - hireDate.getFullYear();
        return { ...emp, years };
      })
      .filter((emp) => emp.years > 0)
      .sort((a, b) => {
        const dateA = new Date(a.hireDate || "").getDate();
        const dateB = new Date(b.hireDate || "").getDate();
        return dateA - dateB;
      });
  }, [employees]);

  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>();
    for (const emp of employees) map.set(emp.id, emp);
    return map;
  }, [employees]);

  const me = useMemo(() => {
    const myEmail = normalizeEmail(user?.email);
    if (!myEmail) return null;

    return (
      employees.find((emp) => {
        const options = [normalizeEmail(emp.email), normalizeEmail(emp.workEmail), normalizeEmail(emp.personalEmail)];
        return options.includes(myEmail);
      }) || null
    );
  }, [employees, user?.email]);

  const persona = useMemo<Persona>(() => {
    const userEmail = normalizeEmail(user?.email);
    if (userEmail === "john@pmcdecor.com") return "manager";
    if (isGeneralManagerTitle(me?.jobTitle)) return "manager";
    if (isForemanLikeTitle(me?.jobTitle)) return "foreman";
    if (isPmLikeTitle(me?.jobTitle)) return "pm";
    return "generic";
  }, [me?.jobTitle, user?.email]);

  const isJohnFullSnapshot = useMemo(() => normalizeEmail(user?.email) === "john@pmcdecor.com", [user?.email]);

  const offEntriesInWindow = useMemo(() => {
    const dateSet = new Set(dateKeys);
    const rows: Array<{ key: string; employeeName: string; date: string; type: string }> = [];

    for (const entry of timeOff) {
      if (entry.status && entry.status.toLowerCase() === "denied") continue;
      for (const d of entry.dates || []) {
        if (!dateSet.has(d)) continue;
        rows.push({
          key: `${entry.employeeId}:${d}`,
          employeeName: entry.employeeName || "Unknown",
          date: d,
          type: entry.type || "Time Off",
        });
      }
    }

    const deduped = Array.from(new Map(rows.map((r) => [r.key, r])).values());
    deduped.sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName));
    return deduped;
  }, [dateKeys, timeOff]);

  const pmByJobKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of pmAssignments) {
      if (row.jobKey && row.pmId) map.set(row.jobKey, row.pmId);
    }
    return map;
  }, [pmAssignments]);

  const myScheduleRows = useMemo(() => {
    if (!me?.id) return [] as ActiveScheduleEntry[];

    if (persona === "foreman") {
      return activeSchedules
        .filter((row) => row.foreman === me.id)
        .sort((a, b) => a.date.localeCompare(b.date));
    }

    if (persona === "pm") {
      return activeSchedules
        .filter((row) => pmByJobKey.get(row.jobKey) === me.id)
        .sort((a, b) => a.date.localeCompare(b.date));
    }

    return [] as ActiveScheduleEntry[];
  }, [activeSchedules, me?.id, persona, pmByJobKey]);

  const pmProjectSummary = useMemo(() => {
    if (persona !== "pm") return [];
    const grouped = new Map<
      string,
      {
        jobKey: string;
        projectLabel: string;
        totalHours: number;
        days: Set<string>;
        foremen: Set<string>;
        foremanIds: Set<string>;
      }
    >();

    for (const row of myScheduleRows) {
      const current = grouped.get(row.jobKey) || {
        jobKey: row.jobKey,
        projectLabel: formatProjectLabel(row),
        totalHours: 0,
        days: new Set<string>(),
        foremen: new Set<string>(),
        foremanIds: new Set<string>(),
      };
      current.totalHours += Number(row.hours || 0);
      current.days.add(row.date);
      if (row.foreman) {
        current.foremanIds.add(row.foreman);
        const foreman = employeeById.get(row.foreman);
        current.foremen.add(foreman ? `${foreman.firstName} ${foreman.lastName}`.trim() : "Unassigned");
      }
      grouped.set(row.jobKey, current);
    }

    return Array.from(grouped.entries())
      .map(([jobKey, row]) => ({
        jobKey,
        projectLabel: row.projectLabel,
        totalHours: row.totalHours,
        dayCount: row.days.size,
        foremen: Array.from(row.foremen).filter(Boolean),
        foremanIdList: Array.from(row.foremanIds),
      }))
      .sort((a, b) => b.totalHours - a.totalHours);
  }, [employeeById, myScheduleRows, persona]);

  const pmSnapshotTotals = useMemo(() => {
    const totalHours = pmProjectSummary.reduce((sum, row) => sum + row.totalHours, 0);
    const totalProjects = pmProjectSummary.length;
    const totalDays = pmProjectSummary.reduce((sum, row) => sum + row.dayCount, 0);
    return { totalHours, totalProjects, totalDays };
  }, [pmProjectSummary]);

  const foremanProjectSummary = useMemo(() => {
    if (persona !== "foreman") return [];
    const grouped = new Map<
      string,
      {
        jobKey: string;
        projectLabel: string;
        totalHours: number;
        days: Set<string>;
      }
    >();

    for (const row of myScheduleRows) {
      const current = grouped.get(row.jobKey) || {
        jobKey: row.jobKey,
        projectLabel: formatProjectLabel(row),
        totalHours: 0,
        days: new Set<string>(),
      };
      current.totalHours += Number(row.hours || 0);
      current.days.add(row.date);
      grouped.set(row.jobKey, current);
    }

    return Array.from(grouped.values())
      .map((row) => ({
        jobKey: row.jobKey,
        projectLabel: row.projectLabel,
        totalHours: row.totalHours,
        dayCount: row.days.size,
      }))
      .sort((a, b) => b.totalHours - a.totalHours);
  }, [myScheduleRows, persona]);

  const managerPmSummary = useMemo(() => {

    const grouped = new Map<
      string,
      {
        pmName: string;
        jobs: Map<
          string,
          {
            projectLabel: string;
            totalHours: number;
            days: Set<string>;
            foremen: Set<string>;
            foremanIds: Set<string>;
            crewTarget: number;
          }
        >;
      }
    >();

    for (const row of activeSchedules) {
      const pmId = pmByJobKey.get(row.jobKey);
      if (!pmId) continue;

      const pmEmployee = employeeById.get(pmId);
      const pmName = pmEmployee ? `${pmEmployee.firstName} ${pmEmployee.lastName}`.trim() : "Unassigned PM";
      const currentPm = grouped.get(pmId) || { pmName, jobs: new Map() };
      const currentJob = currentPm.jobs.get(row.jobKey) || {
        projectLabel: formatProjectLabel(row),
        totalHours: 0,
        days: new Set<string>(),
        foremen: new Set<string>(),
        foremanIds: new Set<string>(),
        crewTarget: 0,
      };

      currentJob.totalHours += Number(row.hours || 0);
      currentJob.days.add(row.date);
      currentJob.crewTarget = Math.max(currentJob.crewTarget, Number(row.manpower || 0));
      if (row.foreman) {
        const foreman = employeeById.get(row.foreman);
        currentJob.foremen.add(foreman ? `${foreman.firstName} ${foreman.lastName}`.trim() : "Unassigned");
        currentJob.foremanIds.add(row.foreman);
      }

      currentPm.jobs.set(row.jobKey, currentJob);
      grouped.set(pmId, currentPm);
    }

    return Array.from(grouped.entries())
      .map(([pmId, value]) => ({
        pmId,
        pmName: value.pmName,
        totalHours: Array.from(value.jobs.values()).reduce((sum, job) => sum + job.totalHours, 0),
        jobs: Array.from(value.jobs.entries())
          .map(([jobKey, job]) => ({
            jobKey,
            projectLabel: job.projectLabel,
            totalHours: job.totalHours,
            dayCount: job.days.size,
            foremen: Array.from(job.foremen).filter(Boolean),
            foremanIds: Array.from(job.foremanIds).filter(Boolean),
            crewTarget: job.crewTarget,
          }))
          .sort((a, b) => b.totalHours - a.totalHours),
      }))
      .sort((a, b) => a.pmName.localeCompare(b.pmName));
  }, [activeSchedules, employeeById, pmByJobKey]);

  const managerWorkloadTotals = useMemo(() => {
    const totalHours = managerPmSummary.reduce((sum, pm) => sum + pm.totalHours, 0);
    const totalJobs = managerPmSummary.reduce((sum, pm) => sum + pm.jobs.length, 0);
    return {
      pmCount: managerPmSummary.length,
      totalHours,
      totalJobs,
    };
  }, [managerPmSummary]);

  const activeScheduleDatesByJobKey = useMemo(() => {
    const windowDateSet = new Set(dateKeys);
    const map = new Map<string, string[]>();

    for (const row of activeSchedules) {
      if (!row.jobKey || !windowDateSet.has(row.date)) continue;
      const existing = map.get(row.jobKey) || [];
      if (!existing.includes(row.date)) {
        existing.push(row.date);
        existing.sort();
        map.set(row.jobKey, existing);
      }
    }

    return map;
  }, [activeSchedules, dateKeys]);

  const concreteOrderTotals = useMemo(() => {
    return {
      count: concreteOrders.length,
      totalYards: concreteOrders.reduce((sum, pour) => sum + Number(pour.totalYards || 0), 0),
    };
  }, [concreteOrders]);

  const loadManagerProjectDetail = async (jobKey: string, foremanIds: string[]) => {
    if (managerProjectDetails[jobKey]) return;

    setManagerDetailLoadingKey(jobKey);
    try {
      const months = Array.from(new Set(dateKeys.map((dateKey) => dateKey.slice(0, 7))));
      const docs = await Promise.all(
        months.map(async (month) => {
          const response = await fetch(`/api/short-term-schedule?jobKey=${encodeURIComponent(jobKey)}&month=${encodeURIComponent(month)}`, {
            cache: "no-store",
          });
          if (!response.ok) return null;
          return (await response.json()) as StoredScheduleDoc;
        })
      );

      const crewIds = new Set<string>();
      const usedDates = new Set<string>();

      for (const dateKey of dateKeys) {
        const month = dateKey.slice(0, 7);
        const doc = docs.find((entry) => entry?.month === month);
        if (!doc) continue;

        const targetDate = new Date(`${dateKey}T00:00:00`);
        const position = getWeekDayPositionForDate(month, targetDate);
        if (!position) continue;

        const week = doc.weeks.find((entry) => entry.weekNumber === position.weekNumber);
        const day = week?.days.find((entry) => entry.dayNumber === position.dayNumber);
        if (!day) continue;

        usedDates.add(dateKey);
        (day.employees || []).forEach((employeeId) => crewIds.add(employeeId));
      }

      if (crewIds.size === 0 && foremanIds.length > 0) {
        foremanIds.forEach((foremanId) => {
          const template = crewTemplates.find((entry) => entry.foremanId === foremanId);
          if (!template) return;
          if (template.rightHandManId) crewIds.add(template.rightHandManId);
          (template.crewMemberIds || []).forEach((employeeId) => crewIds.add(employeeId));
        });
      }

      const crewMembers = Array.from(crewIds)
        .map((employeeId) => {
          const employee = employeeById.get(employeeId);
          return employee ? `${employee.firstName} ${employee.lastName}`.trim() : null;
        })
        .filter((name): name is string => Boolean(name))
        .sort((a, b) => a.localeCompare(b));

      const fallbackDates = activeScheduleDatesByJobKey.get(jobKey) || [];
      const resolvedDates = usedDates.size > 0 ? Array.from(usedDates).sort() : fallbackDates;

      setManagerProjectDetails((prev) => ({
        ...prev,
        [jobKey]: {
          crewMembers,
          dates: resolvedDates,
        },
      }));
    } catch (error) {
      console.error("Failed to load manager project detail:", error);
      setManagerProjectDetails((prev) => ({
        ...prev,
        [jobKey]: {
          crewMembers: [],
          dates: [],
        },
      }));
    } finally {
      setManagerDetailLoadingKey((current) => (current === jobKey ? null : current));
    }
  };

  const personalRelatedPours = useMemo(() => {
    if (persona === "generic") return concreteOrders;
    const myJobKeys = new Set(myScheduleRows.map((r) => r.jobKey));
    return concreteOrders.filter((row) => myJobKeys.has(row.jobKey));
  }, [concreteOrders, myScheduleRows, persona]);

  const personalPourNote = useMemo(() => {
    if (persona === "generic") return null;
    if (personalRelatedPours.length > 0) {
      return `${personalRelatedPours.length} tied to your scheduled work.`;
    }
    return "Showing all company pours for the next 7 days.";
  }, [persona, personalRelatedPours.length]);

  const personalTitle = useMemo(() => {
    if (persona === "manager") return "General Manager Update (Next 7 Days)";
    if (persona === "pm") return "My PM Update (Next 7 Days)";
    if (persona === "foreman") return "My Foreman Update (Next 7 Days)";
    return "My Personal Update (Next 7 Days)";
  }, [persona]);

  const loadingState = loading || authLoading;
  const hasDispatchAccess = useMemo(() => {
    if (!user?.email) return false;
    return hasPageAccess(user.email, "crew-dispatch");
  }, [user?.email]);

  const visibleQuickLinks = useMemo(() => {
    if (!user?.email) return [] as typeof QUICK_LINKS;
    return QUICK_LINKS.filter((link) => hasPageAccess(user.email, link.page));
  }, [user?.email]);

  const refreshTimeOff = async () => {
    const timeOffRes = await fetch("/api/time-off", { cache: "no-store" });
    const timeOffJson = await timeOffRes.json().catch(() => ({ success: false, data: [] }));
    setTimeOff(Array.isArray(timeOffJson?.data) ? timeOffJson.data : []);
  };

  const submitCallOff = async () => {
    if (!me?.id) {
      setQuickActionMessage("No employee profile found for your login.");
      return;
    }

    setSubmittingQuickAction(true);
    setQuickActionMessage(null);
    try {
      const mappedType = callOffForm.type === "Sick" ? "Sick" : callOffForm.type === "Personal" ? "Personal" : "Other";
      const reasonPrefix = callOffForm.type === "Late" || callOffForm.type === "No Show" ? `${callOffForm.type}: ` : "";
      const response = await fetch("/api/time-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: me.id,
          startDate: callOffForm.date,
          endDate: callOffForm.date,
          type: mappedType,
          hours: 10,
          reason: `${reasonPrefix}${callOffForm.reason || "Call off request from Home"}`,
        }),
      });

      if (!response.ok) {
        throw new Error("Unable to submit call off request");
      }

      await refreshTimeOff();
      setShowCallOffModal(false);
      setQuickActionMessage("Call off request submitted.");
    } catch (error) {
      console.error(error);
      setQuickActionMessage("Could not submit call off request.");
    } finally {
      setSubmittingQuickAction(false);
    }
  };

  const submitTimeOff = async () => {
    if (!me?.id) {
      setQuickActionMessage("No employee profile found for your login.");
      return;
    }

    setSubmittingQuickAction(true);
    setQuickActionMessage(null);
    try {
      const response = await fetch("/api/time-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: me.id,
          startDate: timeOffForm.startDate,
          endDate: timeOffForm.endDate,
          type: timeOffForm.type,
          hours: Number(timeOffForm.hours) > 0 ? Number(timeOffForm.hours) : 10,
          reason: timeOffForm.reason,
        }),
      });

      if (!response.ok) {
        throw new Error("Unable to submit time off request");
      }

      await refreshTimeOff();
      setShowTimeOffModal(false);
      setQuickActionMessage("Time off request submitted.");
    } catch (error) {
      console.error(error);
      setQuickActionMessage("Could not submit time off request.");
    } finally {
      setSubmittingQuickAction(false);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-100 text-slate-900 font-sans p-2 md:p-4">
      <div className="w-full flex flex-col min-h-[calc(100vh-2rem)] bg-white shadow-2xl rounded-3xl overflow-hidden border border-gray-200 p-4 md:p-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 md:mb-10 border-b border-gray-100 pb-8">
          <div className="flex items-center gap-6">
            <div className="relative w-32 h-16 md:w-48 md:h-24">
              <Image src="/logo.png" alt="Paradise Masonry Logo" fill className="object-contain" priority />
            </div>
            <div className="h-12 w-px bg-gray-200 hidden md:block"></div>
            <div>
              <h1 className="text-red-900 text-2xl md:text-3xl font-black tracking-tighter uppercase italic leading-none">
                Hub <span className="text-stone-800">Central</span>
              </h1>
              <p className="text-gray-500 font-bold italic text-[9px] md:text-[11px] mt-1.5 max-w-xs md:max-w-md border-l-2 border-red-900/20 pl-3">
                &quot;Shaping the world we live in, by pouring into the foundation of our community.&quot;
              </p>
            </div>
          </div>
          <Navigation currentPage="home" />
        </div>

        <section className="bg-gradient-to-r from-red-900 via-stone-800 to-stone-900 rounded-3xl p-6 md:p-8 shadow-xl mb-8 md:mb-10 text-white border border-stone-700">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <div>
              <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight">{personalTitle}</h2>
              <p className="text-white/70 text-xs md:text-sm font-bold">
                {me ? `${me.firstName} ${me.lastName}${me.jobTitle ? ` • ${me.jobTitle}` : ""}` : "No employee profile match found for your email."}
              </p>
            </div>
            <div className="text-[10px] md:text-xs font-black uppercase tracking-widest text-white/70">Window: {formatDayLabel(startDate)} - {formatDayLabel(endDate)}</div>
          </div>

          {loadingState ? (
            <div className="text-sm font-bold italic text-white/80">Loading personal update...</div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 md:gap-6">
              <div className="xl:col-span-7 bg-white/10 rounded-2xl p-4 md:p-5 border border-white/10">
                {Boolean(user?.email) ? (
                  <>
                    {isJohnFullSnapshot && (
                      <>
                        <h3 className="text-xs md:text-xs font-black uppercase tracking-widest text-white/80 mb-3 leading-relaxed">
                          <span className="block">PM Workload And Foreman Coverage</span>
                          <span className="block mt-1 text-red-200 md:inline md:mt-0 md:ml-2">{managerWorkloadTotals.totalHours.toFixed(1)} hrs total</span>
                          <span className="block text-white/55 md:inline md:ml-2">• {managerWorkloadTotals.pmCount} PMs • {managerWorkloadTotals.totalJobs} jobs</span>
                        </h3>
                        {managerPmSummary.length === 0 ? (
                          <p className="text-sm text-white/70 font-medium">No PM-assigned jobs are scheduled in the next 7 days.</p>
                        ) : (
                          <div className="space-y-4">
                            {managerPmSummary.map((pm) => (
                              <div key={pm.pmId} className="bg-white/10 rounded-xl p-3 border border-white/10">
                                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                                  <div className="font-black text-base text-white uppercase tracking-tight">{pm.pmName}</div>
                                  <div className="text-xs md:text-xs font-black uppercase tracking-wide text-red-200">
                                    {pm.totalHours.toFixed(1)} hrs total
                                  </div>
                                </div>
                                <div className="mt-3 space-y-2">
                                  {pm.jobs.map((job) => (
                                    <button
                                      key={`${pm.pmId}-${job.jobKey}`}
                                      type="button"
                                      onClick={() => {
                                        setExpandedManagerProjectKey((current) => current === job.jobKey ? null : job.jobKey);
                                        if (expandedManagerProjectKey !== job.jobKey) {
                                          void loadManagerProjectDetail(job.jobKey, job.foremanIds);
                                        }
                                      }}
                                      className="block w-full text-left bg-white/10 rounded-xl p-3.5 md:p-3 border border-white/10 hover:bg-white/15 transition-colors min-h-[56px]"
                                    >
                                      <div className="font-black text-sm md:text-base text-white leading-tight">{job.projectLabel}</div>
                                      <div className="mt-1 text-xs md:text-xs font-bold text-white/70 uppercase tracking-wide">
                                        {job.totalHours.toFixed(1)} hrs • {job.dayCount} day{job.dayCount === 1 ? "" : "s"}
                                      </div>
                                      {expandedManagerProjectKey === job.jobKey && (
                                        <div className="mt-3 rounded-xl bg-black/10 border border-white/10 p-3 space-y-2">
                                          <div className="text-xs md:text-[11px] font-black uppercase tracking-widest text-red-200">Foremen</div>
                                          <div className="text-xs md:text-xs text-white/90">
                                            {job.foremen.length > 0 ? job.foremen.join(", ") : "Unassigned"}
                                          </div>
                                          <div className="text-xs md:text-[11px] font-black uppercase tracking-widest text-red-200 pt-1">Crew Members</div>
                                          {managerDetailLoadingKey === job.jobKey ? (
                                            <div className="text-xs md:text-xs text-white/75">Loading crew...</div>
                                          ) : (
                                            <div className="text-xs md:text-xs text-white/90">
                                              {(managerProjectDetails[job.jobKey]?.crewMembers || []).length > 0
                                                ? managerProjectDetails[job.jobKey].crewMembers.join(", ")
                                                : "No saved crew members found"}
                                            </div>
                                          )}
                                          <div className="text-xs md:text-[11px] font-black uppercase tracking-widest text-red-200 pt-1">Scheduled Dates</div>
                                          <div className="text-xs md:text-xs text-white/90">
                                            {(managerProjectDetails[job.jobKey]?.dates || []).length > 0
                                              ? managerProjectDetails[job.jobKey].dates.map(formatDayLabel).join(", ")
                                              : "No saved schedule dates found"}
                                          </div>
                                          <div className="text-xs md:text-[11px] font-black uppercase tracking-widest text-red-200 pt-1">Crew Target</div>
                                          <div className="text-xs md:text-xs text-white/90">
                                            {job.crewTarget > 0 ? `${job.crewTarget} total workers planned` : "No crew target stored"}
                                          </div>
                                        </div>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    <div className={isJohnFullSnapshot ? "mt-5 pt-4 border-t border-white/10" : ""}>
                      {persona === "pm" ? (
                        <>
                          <h3 className="text-[10px] md:text-xs font-black uppercase tracking-widest text-white/80 mb-3 leading-relaxed">
                            <span className="block">My Projects Scheduled</span>
                            <span className="block mt-1 text-red-200 md:inline md:mt-0 md:ml-2">{pmSnapshotTotals.totalHours.toFixed(1)} hrs total</span>
                            <span className="block text-white/55 md:inline md:ml-2">• {pmSnapshotTotals.totalProjects} projects • {pmSnapshotTotals.totalDays} days</span>
                          </h3>
                          {pmProjectSummary.length === 0 ? (
                            <p className="text-sm text-white/70 font-medium">No projects scheduled for you in the next 7 days.</p>
                          ) : (
                            <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                              {pmProjectSummary.slice(0, 8).map((row) => (
                                <button
                                  key={row.jobKey}
                                  type="button"
                                  onClick={() => {
                                    setExpandedManagerProjectKey((current) => current === row.jobKey ? null : row.jobKey);
                                    if (expandedManagerProjectKey !== row.jobKey) {
                                      void loadManagerProjectDetail(row.jobKey, row.foremanIdList);
                                    }
                                  }}
                                  className="block w-full text-left bg-white/10 rounded-xl p-3 border border-white/10 hover:bg-white/15 transition-colors"
                                >
                                  <div className="font-black text-sm md:text-base text-white leading-tight">{row.projectLabel}</div>
                                  <div className="mt-1 text-[11px] md:text-xs font-bold text-white/70 uppercase tracking-wide">
                                    {row.totalHours.toFixed(1)} hrs • {row.dayCount} day{row.dayCount === 1 ? "" : "s"}
                                  </div>
                                  <div className="mt-1 text-[11px] md:text-xs text-white/80">
                                    Foremen: {row.foremen.length > 0 ? row.foremen.join(", ") : "Unassigned"}
                                  </div>
                                  {expandedManagerProjectKey === row.jobKey && (
                                    <div className="mt-3 rounded-xl bg-black/10 border border-white/10 p-3 space-y-2">
                                      <div className="text-xs md:text-[11px] font-black uppercase tracking-widest text-red-200">Crew Members</div>
                                      {managerDetailLoadingKey === row.jobKey ? (
                                        <div className="text-xs text-white/75">Loading crew...</div>
                                      ) : (
                                        <div className="text-xs text-white/90">
                                          {(managerProjectDetails[row.jobKey]?.crewMembers || []).length > 0
                                            ? managerProjectDetails[row.jobKey].crewMembers.join(", ")
                                            : "No saved crew members found"}
                                        </div>
                                      )}
                                      <div className="text-xs md:text-[11px] font-black uppercase tracking-widest text-red-200 pt-1">Scheduled Dates</div>
                                      <div className="text-xs text-white/90">
                                        {(managerProjectDetails[row.jobKey]?.dates || []).length > 0
                                          ? managerProjectDetails[row.jobKey].dates.map(formatDayLabel).join(", ")
                                          : "No saved schedule dates found"}
                                      </div>
                                    </div>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      ) : persona === "foreman" ? (
                        <>
                          <h3 className="text-[10px] md:text-xs font-black uppercase tracking-widest text-white/80 mb-3">My Schedule Assignments</h3>
                          {foremanProjectSummary.length === 0 ? (
                            <p className="text-sm text-white/70 font-medium">No assignments scheduled for you in the next 7 days.</p>
                          ) : (
                            <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                              {foremanProjectSummary.map((row) => (
                                <button
                                  key={row.jobKey}
                                  type="button"
                                  onClick={() => {
                                    setExpandedManagerProjectKey((current) => current === row.jobKey ? null : row.jobKey);
                                    if (expandedManagerProjectKey !== row.jobKey && me?.id) {
                                      void loadManagerProjectDetail(row.jobKey, [me.id]);
                                    }
                                  }}
                                  className="block w-full text-left bg-white/10 rounded-xl p-3 border border-white/10 hover:bg-white/15 transition-colors"
                                >
                                  <div className="font-black text-sm md:text-base text-white leading-tight">{row.projectLabel}</div>
                                  <div className="mt-1 text-[11px] md:text-xs font-bold text-white/70 uppercase tracking-wide">
                                    {row.totalHours.toFixed(1)} hrs • {row.dayCount} day{row.dayCount === 1 ? "" : "s"}
                                  </div>
                                  {expandedManagerProjectKey === row.jobKey && (
                                    <div className="mt-3 rounded-xl bg-black/10 border border-white/10 p-3 space-y-2">
                                      <div className="text-xs md:text-[11px] font-black uppercase tracking-widest text-red-200">Crew Members</div>
                                      {managerDetailLoadingKey === row.jobKey ? (
                                        <div className="text-xs md:text-xs text-white/75">Loading crew...</div>
                                      ) : (
                                        <div className="text-xs md:text-xs text-white/90">
                                          {(managerProjectDetails[row.jobKey]?.crewMembers || []).length > 0
                                            ? managerProjectDetails[row.jobKey].crewMembers.join(", ")
                                            : "No saved crew members found"}
                                        </div>
                                      )}
                                      <div className="text-xs md:text-[11px] font-black uppercase tracking-widest text-red-200 pt-1">Scheduled Dates</div>
                                      <div className="text-xs md:text-xs text-white/90">
                                        {(managerProjectDetails[row.jobKey]?.dates || []).length > 0
                                          ? managerProjectDetails[row.jobKey].dates.map(formatDayLabel).join(", ")
                                          : "No saved schedule dates found"}
                                      </div>
                                    </div>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      ) : persona === "manager" ? (
                        <>
                          <h3 className="text-[10px] md:text-xs font-black uppercase tracking-widest text-white/80 mb-3">Leadership Snapshot</h3>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="bg-white/10 rounded-xl p-3 border border-white/10">
                              <div className="text-[10px] uppercase tracking-widest text-white/60 font-black">PMs</div>
                              <div className="text-2xl font-black text-white mt-1">{managerWorkloadTotals.pmCount}</div>
                            </div>
                            <div className="bg-white/10 rounded-xl p-3 border border-white/10">
                              <div className="text-[10px] uppercase tracking-widest text-white/60 font-black">Jobs</div>
                              <div className="text-2xl font-black text-white mt-1">{managerWorkloadTotals.totalJobs}</div>
                            </div>
                            <div className="bg-white/10 rounded-xl p-3 border border-white/10">
                              <div className="text-[10px] uppercase tracking-widest text-white/60 font-black">Crew Off</div>
                              <div className="text-2xl font-black text-white mt-1">{offEntriesInWindow.length}</div>
                            </div>
                            <div className="bg-white/10 rounded-xl p-3 border border-white/10">
                              <div className="text-[10px] uppercase tracking-widest text-white/60 font-black">Pours</div>
                              <div className="text-2xl font-black text-white mt-1">{concreteOrders.length}</div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <h3 className="text-[10px] md:text-xs font-black uppercase tracking-widest text-white/80 mb-3">Generic Personal Snapshot</h3>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            <div className="bg-white/10 rounded-xl p-3 border border-white/10">
                              <div className="text-[10px] uppercase tracking-widest text-white/60 font-black">My Assignments</div>
                              <div className="text-2xl font-black text-white mt-1">{myScheduleRows.length}</div>
                            </div>
                            <div className="bg-white/10 rounded-xl p-3 border border-white/10">
                              <div className="text-[10px] uppercase tracking-widest text-white/60 font-black">Crew Members Off</div>
                              <div className="text-2xl font-black text-white mt-1">{offEntriesInWindow.length}</div>
                            </div>
                            <div className="bg-white/10 rounded-xl p-3 border border-white/10">
                              <div className="text-[10px] uppercase tracking-widest text-white/60 font-black">Upcoming Pours</div>
                              <div className="text-2xl font-black text-white mt-1">{concreteOrders.length}</div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-white/70 font-medium">Sign in to view workload and personal scheduling details.</p>
                )}
              </div>

              <div className="xl:col-span-5 space-y-4">
                <div className="bg-white/10 rounded-2xl p-4 border border-white/10">
                  <h3 className="text-[10px] md:text-xs font-black uppercase tracking-widest text-white/80 mb-2">Crew Members Off</h3>
                  {offEntriesInWindow.length === 0 ? (
                    <p className="text-sm text-white/70 font-medium">No approved time off in the next 7 days.</p>
                  ) : (
                    <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                      {offEntriesInWindow.slice(0, 8).map((entry) => (
                        <div key={entry.key} className="text-xs md:text-sm text-white/90">
                          <span className="font-black">{entry.employeeName}</span> • {formatDayLabel(entry.date)} • {entry.type}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-white/10 rounded-2xl p-4 border border-white/10">
                  <h3 className="text-xs md:text-xs font-black uppercase tracking-widest text-white/80 mb-2 leading-relaxed">
                    Upcoming Pours
                    <span className="block mt-1 text-red-200 md:inline md:mt-0 md:ml-2">{concreteOrderTotals.count}</span>
                    <span className="block text-white/55 md:inline md:ml-2">• {concreteOrderTotals.totalYards.toFixed(1)} yd</span>
                  </h3>
                  {personalPourNote ? <p className="text-[11px] md:text-xs text-white/65 font-bold mb-2">{personalPourNote}</p> : null}
                  {concreteOrders.length === 0 ? (
                    <p className="text-sm text-white/70 font-medium">No concrete pours scheduled in the next 7 days.</p>
                  ) : (
                    <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                      {concreteOrders.slice(0, 8).map((pour) => (
                        <div key={pour.id} className="text-xs md:text-sm text-white/90">
                          <span className="font-black">{formatDayLabel(pour.date)}</span> • {pour.projectName || "Project"} • {Number(pour.totalYards || 0).toFixed(1)} yd
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        <div className="bg-stone-800 rounded-3xl shadow-xl mb-8 md:mb-10 overflow-hidden relative group border border-stone-700">
          <div className="absolute top-0 right-0 w-64 h-64 bg-red-900/10 rounded-full -mr-32 -mt-32 blur-3xl group-hover:bg-red-900/20 transition-colors duration-700"></div>
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-red-900/5 rounded-full -ml-32 -mb-32 blur-3xl"></div>

          <div className="relative p-6 md:p-10">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 md:gap-12">
              <div className="lg:col-span-7 space-y-8 md:space-y-10">
                <div>
                  <h3 className="text-red-500 text-[10px] md:text-[11px] font-black uppercase tracking-[0.3em] mb-4 flex items-center gap-3">
                    <span className="w-8 h-px bg-red-900"></span>
                    Our Mission
                  </h3>
                  <p className="text-xl md:text-3xl font-black text-white italic leading-tight tracking-tight">
                    &quot;Shaping the world we live in, by pouring into the foundation of our community.&quot;
                  </p>
                </div>

                <div className="pt-8 border-t border-stone-700/50">
                  <h3 className="text-stone-400 text-[10px] md:text-[11px] font-black uppercase tracking-[0.3em] mb-4 flex items-center gap-3">
                    <span className="w-8 h-px bg-stone-600"></span>
                    Company Vision
                  </h3>
                  <div className="space-y-4">
                    <p className="text-xs md:text-lg font-bold text-stone-100 leading-relaxed">
                      To continue growth in both culture and business, empowering employees to provide for themselves and their families while striving to be the preferred concrete contractor in the region.
                    </p>
                    <p className="text-[10px] md:text-xs text-stone-400 font-medium leading-relaxed max-w-2xl italic">
                      Applying the Serving Leadership model to fulfill dreams and glorifying God by being faithful stewards of all that is entrusted to us.
                    </p>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5 bg-black/20 rounded-3xl p-6 md:p-8 border border-white/5 backdrop-blur-sm">
                <h3 className="text-white text-[10px] md:text-[11px] font-black uppercase tracking-[0.3em] mb-6 flex items-center justify-between">
                  Core Values
                </h3>
                <div className="space-y-3 md:space-y-4">
                  {[
                    { id: "1", title: "Serving Leadership", sub: "Christian Values" },
                    { id: "2", title: "Safety", sub: "Zero Compromise" },
                    { id: "3", title: "Quality", sub: "Standard of Excellence" },
                    { id: "4", title: "Excellent Experience", sub: "For our people" },
                    { id: "5", title: "Efficiency", sub: "Profitability" },
                  ].map((v) => (
                    <div key={v.id} className="flex items-center gap-4 group/item">
                      <div className="w-8 h-8 rounded-xl bg-red-900/30 flex items-center justify-center text-red-500 font-black text-xs group-hover/item:bg-red-900 group-hover/item:text-white transition-all">
                        {v.id}
                      </div>
                      <div>
                        <div className="text-white font-black text-[11px] md:text-sm uppercase tracking-wide">{v.title}</div>
                        <div className="text-[8px] md:text-[10px] font-bold text-stone-500 uppercase tracking-widest mt-0.5">{v.sub}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-8 pt-6 border-t border-white/5">
                  <p className="text-[9px] md:text-[10px] font-black uppercase text-stone-500 tracking-[0.2em] leading-relaxed italic">
                    Built on the bedrock of integrity, honest feedback, & continuous Innovation.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6 md:gap-8 flex-1">
          <div className="order-2 lg:order-1 lg:col-span-8 xl:col-span-9 space-y-6 md:space-y-8">
            <section className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-gray-100 overflow-hidden relative group">
              <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                <svg className="w-40 h-40 text-red-900" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 4.946-2.597 9.181-6.5 11.5a11.954 11.954 0 01-3.5-2.001c-3.903-2.319-6.5-6.554-6.5-11.5 0-.68.056-1.35.166-2.001zM10 2a1 1 0 00-1 1v1h2V3a1 1 0 00-1-1zM4 6h12v1H4V6zm2 2v7h1V8H6zm3 0v7h1V8H9zm3 0v7h1V8h-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="relative">
                <div className="flex items-center gap-3 mb-4 md:mb-6">
                  <div className="px-3 py-1 bg-red-900 text-white text-[9px] md:text-[10px] font-black uppercase tracking-widest rounded-full whitespace-nowrap shadow-sm">
                    Monthly Safety Topic
                  </div>
                  <div className="text-red-900/40 font-black italic text-sm md:text-base">{currentSafetyTopic.month}</div>
                </div>
                <h2 className="text-2xl md:text-3xl font-black text-stone-800 uppercase tracking-tight mb-3 md:mb-4">
                  {currentSafetyTopic.title}
                </h2>
                <p className="text-base md:text-lg text-gray-600 leading-relaxed max-w-2xl mb-6 font-medium">{currentSafetyTopic.content}</p>
                <div className="flex items-center gap-2 text-[10px] md:text-xs font-bold text-gray-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-600"></span>
                  Source: {currentSafetyTopic.source}
                </div>
              </div>
            </section>

            <section className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-gray-100">
              <div className="flex justify-between items-center mb-6 md:mb-8">
                <h2 className="text-xl md:text-2xl font-black text-stone-800 uppercase tracking-tight flex items-center gap-2 md:gap-3">
                  <div className="w-1.5 md:w-2 h-6 md:h-8 bg-red-900 rounded-full"></div>
                  Company Communication
                </h2>
                <button className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-red-700 hover:text-red-900 transition-colors">
                  View All
                </button>
              </div>

              {loadingState ? (
                <div className="flex items-center gap-3 italic text-gray-400 font-medium py-4">
                  <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div>
                  Loading...
                </div>
              ) : announcements.length === 0 ? (
                <div className="bg-gray-50 rounded-2xl p-8 md:p-10 text-center border-2 border-dashed border-gray-100">
                  <div className="text-gray-400 font-bold italic mb-2 text-sm md:text-base">No recent announcements.</div>
                  <p className="text-[9px] md:text-xs text-gray-400 uppercase tracking-widest font-black">Innovation in Concrete</p>
                </div>
              ) : (
                <div className="space-y-4 md:space-y-6">
                  {announcements.map((ann) => (
                    <div key={ann.id} className="p-5 md:p-6 bg-gray-50 rounded-2xl border border-transparent hover:border-red-100 transition-all group">
                      <div className="flex justify-between items-start mb-2 md:mb-3">
                        <h3 className="text-lg md:text-xl font-black text-stone-800 group-hover:text-red-700 transition-colors">{ann.title}</h3>
                        {ann.important && (
                          <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[7px] md:text-[8px] font-black uppercase tracking-widest rounded shadow-sm">
                            Important
                          </span>
                        )}
                      </div>
                      <p className="text-gray-600 leading-relaxed mb-4 text-xs md:text-sm font-medium">{ann.content}</p>
                      <div className="flex items-center gap-3 md:gap-4 text-[9px] md:text-[10px] font-black uppercase tracking-widest text-gray-400">
                        <span>{ann.author}</span>
                        <span className="w-1 h-1 rounded-full bg-gray-200"></span>
                        <span>{new Date(ann.date).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="order-1 lg:order-2 lg:col-span-4 xl:col-span-3 space-y-6 md:space-y-8">
            <section className="bg-stone-800 rounded-3xl p-6 md:p-8 shadow-xl text-white relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-red-900/10 rounded-full -mr-16 -mt-16"></div>
              <div className="relative">
                <h2 className="text-lg md:text-xl font-black uppercase tracking-tight mb-6 flex items-center gap-3 italic">
                  <span className="text-red-700 text-xl md:text-2xl">★</span>
                  Anniversaries
                </h2>

                {anniversaries.length === 0 ? (
                  <div className="text-stone-400 font-bold italic text-xs md:text-sm">No anniversaries this month.</div>
                ) : (
                  <div className="space-y-4">
                    {anniversaries.map((emp) => (
                      <div key={emp.id} className="flex items-center gap-3 md:gap-4 p-3 md:p-4 bg-white/5 rounded-2xl border border-white/5">
                        <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-gradient-to-br from-red-700 to-red-950 flex items-center justify-center font-black text-lg md:text-xl shadow-lg border-2 border-white/10 flex-shrink-0">
                          {emp.firstName[0]}
                          {emp.lastName[0]}
                        </div>
                        <div className="min-w-0">
                          <p className="font-black text-base md:text-lg leading-none mb-1 truncate">
                            {emp.firstName} {emp.lastName}
                          </p>
                          <p className="text-red-400 text-[9px] md:text-[10px] font-black uppercase tracking-widest">
                            {emp.years} {emp.years === 1 ? "Year" : "Years"} Service
                          </p>
                        </div>
                        <div className="ml-auto text-stone-400 font-black italic text-[10px] md:text-xs">
                          {new Date(emp.hireDate || "").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-gray-100">
              <h2 className="text-lg md:text-xl font-black text-stone-800 uppercase tracking-tight mb-5 md:mb-6 flex items-center gap-2 md:gap-3">
                <div className="w-1.5 md:w-2 h-5 md:h-6 bg-red-900 rounded-full"></div>
                Quick Access
              </h2>
              {hasDispatchAccess && (
                <div className="grid grid-cols-2 gap-2 md:gap-3 mb-4">
                  <button
                    type="button"
                    onClick={() => setShowCallOffModal(true)}
                    className="p-3 md:p-4 rounded-2xl font-black text-xs md:text-xs uppercase tracking-tight leading-tight text-center break-words transition-all hover:scale-105 active:scale-95 bg-red-900 text-white hover:bg-red-950 min-h-[52px]"
                  >
                    Call Off Request
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTimeOffModal(true)}
                    className="p-3 md:p-4 rounded-2xl font-black text-xs md:text-xs uppercase tracking-tight leading-tight text-center break-words transition-all hover:scale-105 active:scale-95 bg-stone-800 text-white hover:bg-stone-900 min-h-[52px]"
                  >
                    Time Off Request
                  </button>
                </div>
              )}
              {quickActionMessage && (
                <div className="mb-4 bg-gray-50 rounded-xl p-3 text-xs md:text-sm font-bold text-gray-600 border border-gray-100">
                  {quickActionMessage}
                </div>
              )}
              {visibleQuickLinks.length === 0 ? (
                <div className="bg-gray-50 rounded-2xl p-6 text-center border border-gray-100">
                  <div className="text-gray-400 font-bold italic text-xs md:text-sm">No quick links available for your access level.</div>
                </div>
              ) : (
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-2 md:gap-3">
                  {visibleQuickLinks.map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    className={`p-3 md:p-4 rounded-2xl font-black text-xs md:text-xs uppercase tracking-tight leading-tight text-center break-words transition-all hover:scale-105 active:scale-95 min-h-[52px] ${link.color}`}
                  >
                    {link.label}
                  </Link>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

        <section className="mt-8 md:mt-10">
          <div
            className={`rounded-3xl p-6 md:p-8 shadow-lg transition-all ${
              weather?.condition.includes("Rain") || weather?.condition.includes("Storm") ? "bg-blue-600" : "bg-orange-600"
            } text-white`}
          >
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 md:gap-12">
              <div className="flex items-center gap-4 md:gap-6">
                <div className="text-6xl md:text-8xl drop-shadow-md">{weather?.icon || "☀"}</div>
                <div>
                  <div className="flex items-center gap-3">
                    <p className="font-black text-4xl md:text-6xl tracking-tighter">{weather?.temp ?? "--"}°F</p>
                    <span className="text-[10px] md:text-xs bg-white/20 px-2 py-1 rounded font-black uppercase tracking-widest">
                      {weather?.condition ?? "..."}
                    </span>
                  </div>
                  <p className="text-white/70 text-[10px] md:text-xs font-bold uppercase tracking-widest leading-none mt-2">
                    {weather?.location ?? "Local Site"}
                  </p>
                </div>
              </div>

              <div className="flex-1 w-full overflow-hidden">
                <p className="text-[10px] md:text-xs font-black uppercase tracking-widest text-white/50 mb-4 italic flex items-center gap-2">
                  <span className="w-4 h-px bg-white/20"></span>
                  Next 8 Hours
                </p>
                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none snap-x justify-between">
                  {weather?.hourly?.map((h, i) => (
                    <div
                      key={i}
                      className="flex flex-col items-center min-w-[60px] md:min-w-[80px] bg-white/10 rounded-2xl py-3 px-2 border border-white/5 snap-center transition-transform hover:scale-110"
                    >
                      <span className="text-[10px] font-black uppercase text-white/60 mb-1">{h.time}</span>
                      <span className="text-2xl mb-1">{h.icon}</span>
                      <span className="text-sm md:text-base font-black">{h.temp}°</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="w-full md:w-auto md:min-w-[280px] pt-6 md:pt-0 border-t md:border-t-0 md:border-l border-white/10 md:pl-8">
                <p className="text-[10px] md:text-xs font-black uppercase tracking-widest text-white/50 mb-4 italic flex items-center gap-2">
                  <span className="w-4 h-px bg-white/20"></span>
                  7-Day Outlook
                </p>
                <div className="space-y-3">
                  {weather?.daily?.map((d, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="w-10 font-black uppercase text-white/60">{d.date}</span>
                      <span className="text-xl">{d.icon}</span>
                      <div className="flex gap-3 w-20 justify-end">
                        <span className="font-black text-white">{d.high}°</span>
                        <span className="font-bold text-white/40">{d.low}°</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-12 md:mt-16 pt-6 md:pt-8 border-t border-gray-200 flex flex-col md:flex-row justify-between items-center gap-4 text-[9px] md:text-[10px] font-black uppercase tracking-widest text-gray-400 italic text-center">
          <div className="flex items-center gap-2">
            <span className="text-red-900">PARADISE MASONRY</span>
            <span className="w-1 h-1 rounded-full bg-gray-200"></span>
            <span>Innovation in Concrete</span>
          </div>
          <div className="flex gap-4 md:gap-6">
            <span className="hover:text-red-900 cursor-pointer">Safety Manual</span>
            <span className="hover:text-red-900 cursor-pointer">HR Portal</span>
          </div>
        </div>
      </div>

      {showCallOffModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => !submittingQuickAction && setShowCallOffModal(false)}></div>
          <div className="relative w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-2xl p-5">
            <h3 className="text-lg font-black text-stone-800 uppercase tracking-tight mb-4">Call Off Request</h3>
            <div className="space-y-3">
              <label className="block text-xs font-black uppercase tracking-widest text-gray-500">
                Date
                <input
                  type="date"
                  value={callOffForm.date}
                  onChange={(e) => setCallOffForm((prev) => ({ ...prev, date: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold"
                />
              </label>
              <label className="block text-xs font-black uppercase tracking-widest text-gray-500">
                Type
                <select
                  value={callOffForm.type}
                  onChange={(e) => setCallOffForm((prev) => ({ ...prev, type: e.target.value as "Sick" | "Personal" | "Late" | "No Show" }))}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold"
                >
                  <option value="Sick">Sick</option>
                  <option value="Personal">Personal</option>
                  <option value="Late">Late</option>
                  <option value="No Show">No Show</option>
                </select>
              </label>
              <label className="block text-xs font-black uppercase tracking-widest text-gray-500">
                Notes
                <textarea
                  value={callOffForm.reason}
                  onChange={(e) => setCallOffForm((prev) => ({ ...prev, reason: e.target.value }))}
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCallOffModal(false)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 font-bold text-sm"
                disabled={submittingQuickAction}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitCallOff}
                className="px-4 py-2 rounded-xl bg-red-900 text-white font-black text-sm hover:bg-red-950"
                disabled={submittingQuickAction}
              >
                {submittingQuickAction ? "Submitting..." : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTimeOffModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => !submittingQuickAction && setShowTimeOffModal(false)}></div>
          <div className="relative w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-2xl p-5">
            <h3 className="text-lg font-black text-stone-800 uppercase tracking-tight mb-4">Time Off Request</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-black uppercase tracking-widest text-gray-500">
                  Start Date
                  <input
                    type="date"
                    value={timeOffForm.startDate}
                    onChange={(e) => setTimeOffForm((prev) => ({ ...prev, startDate: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold"
                  />
                </label>
                <label className="block text-xs font-black uppercase tracking-widest text-gray-500">
                  End Date
                  <input
                    type="date"
                    value={timeOffForm.endDate}
                    onChange={(e) => setTimeOffForm((prev) => ({ ...prev, endDate: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-black uppercase tracking-widest text-gray-500">
                  Type
                  <select
                    value={timeOffForm.type}
                    onChange={(e) => setTimeOffForm((prev) => ({ ...prev, type: e.target.value as "Vacation" | "Sick" | "Personal" | "Other" }))}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold"
                  >
                    <option value="Vacation">Vacation</option>
                    <option value="Sick">Sick</option>
                    <option value="Personal">Personal</option>
                    <option value="Other">Other</option>
                  </select>
                </label>
                <label className="block text-xs font-black uppercase tracking-widest text-gray-500">
                  Hours
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={timeOffForm.hours}
                    onChange={(e) => setTimeOffForm((prev) => ({ ...prev, hours: Number(e.target.value) || 10 }))}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold"
                  />
                </label>
              </div>
              <label className="block text-xs font-black uppercase tracking-widest text-gray-500">
                Reason
                <textarea
                  value={timeOffForm.reason}
                  onChange={(e) => setTimeOffForm((prev) => ({ ...prev, reason: e.target.value }))}
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowTimeOffModal(false)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 font-bold text-sm"
                disabled={submittingQuickAction}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitTimeOff}
                className="px-4 py-2 rounded-xl bg-stone-800 text-white font-black text-sm hover:bg-stone-900"
                disabled={submittingQuickAction}
              >
                {submittingQuickAction ? "Submitting..." : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
