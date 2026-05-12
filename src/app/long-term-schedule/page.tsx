"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ProjectScopesModal } from "@/app/project-schedule/components/ProjectScopesModal";
import { type ProjectInfo, type Scope, type ScheduleTask } from "@/types";
import { fetchJsonWithRetry } from "@/utils/fetchJsonWithRetry";

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
  dayAllocations: Record<string, WeekAllocation>;
  totalHours: number;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  isActive?: boolean;
}

interface Holiday {
  id: string;
  date: string;
  name: string;
  isPaid: boolean;
}

interface ActiveScheduleEntry {
  jobKey: string;
  scopeOfWork?: string;
  date: string;
  hours: number;
  manpower?: number | null;
  foreman?: string | null;
  source?: string | null;
}

interface ScheduleAllocationEntry {
  period: string;
  periodType?: string | null;
  hours: number;
  schedule?: {
    jobKey?: string | null;
    customer?: string | null;
    projectNumber?: string | null;
    projectName?: string | null;
  } | null;
}

interface ProjectSummary {
  id?: string;
  customer?: string | null;
  projectNumber?: string | null;
  procoreId?: string | null;
  projectName?: string | null;
  projectManager?: string | null;
}

interface GanttV2ScopeSummary {
  id: string;
  title: string;
  startDate?: string | null;
  endDate?: string | null;
  totalHours?: number | null;
  crewSize?: number | null;
  tasks?: Array<string | ScheduleTask>;
  color?: string;
  taskColors?: Record<string, string>;
}

interface GanttV2ProjectSummary {
  id: string;
  customer?: string | null;
  projectNumber?: string | null;
  projectName?: string | null;
  sourceExternalId?: string | null;
  sourceProjectId?: string | null;
  scopes?: GanttV2ScopeSummary[];
}

interface PMGroup {
  pmId: string;
  pmName: string;
  foremanRows: ForemanRow[];
  totalHours: number;
}

interface PMAssignment {
  assignmentKey?: string;
  jobKey: string;
  pmId: string;
}

type ProjectSummariesResponse = {
  data?: ProjectSummary[];
  hasNextPage?: boolean;
};

type GanttV2ProjectsResponse = {
  data?: GanttV2ProjectSummary[];
};

type AllocationProject = { jobKey: string; scopeOfWork: string; hours: number };

type DisplayProject = AllocationProject & {
  groupKey: string;
  jobKeys: string[];
  scopeCount: number;
  scopeTitles: string[];
};

interface TimeOffRequest {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  hours?: number;
}

interface RawTimeOffRecord {
  id?: string;
  employeeId?: string;
  startDate?: string;
  endDate?: string;
  dates?: string[];
  hours?: number | string;
}

type ColDef =
  | { type: "week"; weekKey: string; weekLabel: string }
  | {
      type: "day";
      weekKey: string;
      dateKey: string;
      dateLabel: string;
      holiday?: Holiday;
    };

const PM_TITLES = ["Project Manager", "Lead Foreman / Project Manager", "Superintendent"];
const HOURS_PER_FTE_DAY = 10;
const HOURS_PER_FTE_WEEK = 50;

function getHoursFromScheduleEntry(entry: ActiveScheduleEntry): number {
  const hours = Number(entry.hours || 0);
  if (Number.isFinite(hours) && hours > 0) {
    return hours;
  }

  const manpower = Number(entry.manpower || 0);
  if (Number.isFinite(manpower) && manpower > 0) {
    return manpower * HOURS_PER_FTE_DAY;
  }
  return 0;
}

function getFteFromHours(hours: number, granularity: "day" | "week") {
  return hours / (granularity === "week" ? HOURS_PER_FTE_WEEK : HOURS_PER_FTE_DAY);
}

function getScopeSpecificDayHours(scope: Scope | null | undefined, dateKey: string): number | null {
  if (!scope || !Array.isArray(scope.selectedDays) || !dateKey) return null;
  const match = scope.selectedDays.find((entry) => String(entry?.date || "").trim() === dateKey);
  const hours = Number(match?.hours || 0);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return hours;
}

function normalizeTaskForLongTerm(task: string | ScheduleTask): ScheduleTask | null {
  if (!task) return null;
  if (typeof task === "object" && !Array.isArray(task)) {
    const name = String(task.name || "").trim();
    if (!name) return null;
    const daysRaw = Number(task.days);
    const manpowerRaw = Number(task.manpower);
    const yardsRaw = Number(task.yards);
       const startDate = String(task.startDate || "").trim();
       const endDate = String(task.endDate || "").trim();
   
       // Calculate days from endDate if days not provided
       let calculatedDays: number | null = null;
       if (Number.isFinite(daysRaw) && daysRaw > 0) {
         calculatedDays = daysRaw;
       } else if (startDate && endDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
         const start = new Date(`${startDate}T00:00:00`);
         const end = new Date(`${endDate}T00:00:00`);
         if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
           const diffMs = end.getTime() - start.getTime();
           calculatedDays = Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
         }
       }
   
    return {
      name,
      startDate,
      endDate,
      days: calculatedDays,
      manpower: Number.isFinite(manpowerRaw) && manpowerRaw >= 0 ? manpowerRaw : null,
      yards: Number.isFinite(yardsRaw) && yardsRaw >= 0 ? yardsRaw : null,
    };
  }

  const raw = String(task).trim();
  if (!raw) return null;
  return { name: raw };
}

function getScopeTaskDayHours(scope: Scope | null | undefined, dateKey: string): number | null {
  if (!scope || !Array.isArray(scope.tasks) || !dateKey) return null;

  let totalHours = 0;

  for (const rawTask of scope.tasks) {
    const task = normalizeTaskForLongTerm(rawTask);
    if (!task) continue;

    const startDate = String(task.startDate || "").trim();
    const days = Number(task.days || 0);
    const manpower = Number(task.manpower || 0);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) continue;
    if (!Number.isFinite(days) || days <= 0) continue;
    if (!Number.isFinite(manpower) || manpower <= 0) continue;

    const start = new Date(`${startDate}T00:00:00`);
    if (isNaN(start.getTime())) continue;

    for (let offset = 0; offset < days; offset += 1) {
      const current = new Date(start);
      current.setDate(current.getDate() + offset);
      if (formatDateKey(current) === dateKey) {
        totalHours += manpower * HOURS_PER_FTE_DAY;
      }
    }
  }

  return totalHours > 0 ? totalHours : null;
}

function getScopeContiguousDayHours(
  scope: Scope | null | undefined,
  dateKey: string,
  paidHolidayByDate: Record<string, Holiday>
): number | null {
  if (!scope || scope.schedulingMode === "specific-days") return null;
  const startDate = String(scope.startDate || "").trim();
  const endDate = String(scope.endDate || "").trim();
  const totalHours = Number(scope.hours || 0);

  if (!startDate || !endDate) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null;
  if (!Number.isFinite(totalHours) || totalHours <= 0) return null;
  if (dateKey < startDate || dateKey > endDate) return null;

  const workingDates: string[] = [];
  const current = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  while (current <= end) {
    const weekday = current.getDay();
    const key = formatDateKey(current);
    if (weekday >= 1 && weekday <= 5 && !paidHolidayByDate[key]) {
      workingDates.push(key);
    }
    current.setDate(current.getDate() + 1);
  }

  if (workingDates.length === 0) return null;
  if (!workingDates.includes(dateKey)) return 0;

  return totalHours / workingDates.length;
}

function isWeekdayDateKey(dateKey: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  const date = new Date(`${dateKey}T00:00:00`);
  if (isNaN(date.getTime())) return false;
  const dayOfWeek = date.getDay();
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

function getWorkingDateKeysForMonth(
  period: string,
  rangeStartKey: string,
  rangeEndKey: string,
  paidHolidayByDate: Record<string, Holiday>
): string[] {
  const match = period.match(/^(\d{4})-(\d{2})$/);
  if (!match) return [];

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return [];

  const current = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  const dateKeys: string[] = [];

  while (current <= end) {
    const dateKey = formatDateKey(current);
    if (dateKey >= rangeStartKey && dateKey <= rangeEndKey && isWeekdayDateKey(dateKey) && !paidHolidayByDate[dateKey]) {
      dateKeys.push(dateKey);
    }
    current.setDate(current.getDate() + 1);
  }

  return dateKeys;
}

function getWorkingDateCountForMonth(period: string, paidHolidayByDate: Record<string, Holiday>): number {
  const match = period.match(/^(\d{4})-(\d{2})$/);
  if (!match) return 0;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return 0;

  const current = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  let count = 0;

  while (current <= end) {
    const dateKey = formatDateKey(current);
    if (isWeekdayDateKey(dateKey) && !paidHolidayByDate[dateKey]) {
      count += 1;
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
}

function getScopeDisplayDateKeys(
  scope: Scope | null | undefined,
  rangeStartKey: string | null | undefined,
  rangeEndKey: string | null | undefined,
  paidHolidayByDate: Record<string, Holiday>
): string[] {
  if (!scope) return [];

  const dateKeys = new Set<string>();

  const pushDate = (dateKey: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
    if (rangeStartKey && dateKey < rangeStartKey) return;
    if (rangeEndKey && dateKey > rangeEndKey) return;
    if (!isWeekdayDateKey(dateKey)) return;
    if (paidHolidayByDate[dateKey]) return;
    dateKeys.add(dateKey);
  };

  if (scope.schedulingMode === "specific-days" && Array.isArray(scope.selectedDays)) {
    scope.selectedDays.forEach((entry) => {
      const hours = Number(entry?.hours || 0);
      if (!Number.isFinite(hours) || hours <= 0) return;
      pushDate(String(entry?.date || "").trim());
    });
    return Array.from(dateKeys).sort();
  }

  let hasTaskDates = false;
  if (Array.isArray(scope.tasks)) {
    scope.tasks.forEach((rawTask) => {
      const task = normalizeTaskForLongTerm(rawTask);
      if (!task) return;

      const startDate = String(task.startDate || "").trim();
      const days = Number(task.days || 0);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return;
      if (!Number.isFinite(days) || days <= 0) return;

      hasTaskDates = true;
      const start = new Date(`${startDate}T00:00:00`);
      if (isNaN(start.getTime())) return;

      for (let offset = 0; offset < days; offset += 1) {
        const current = new Date(start);
        current.setDate(current.getDate() + offset);
        pushDate(formatDateKey(current));
      }
    });
  }

  if (hasTaskDates) {
    return Array.from(dateKeys).sort();
  }

  const startDate = String(scope.startDate || "").trim();
  const endDate = String(scope.endDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return [];
  }

  const current = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (isNaN(current.getTime()) || isNaN(end.getTime())) return [];

  while (current <= end) {
    pushDate(formatDateKey(current));
    current.setDate(current.getDate() + 1);
  }

  return Array.from(dateKeys).sort();
}

function normalizeScopeTitle(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeJobKey(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const parts = raw.split("~");
  if (parts.length < 3) {
    return raw;
  }

  const [customer = "", projectNumber = "", ...projectNameParts] = parts;
  return [customer.trim(), projectNumber.trim(), projectNameParts.join("~").trim()].join("~");
}

function getJobKeyLookupCandidates(value?: string | null): string[] {
  const raw = String(value || "").trim();
  const normalized = normalizeJobKey(value);
  const normalizedLower = normalized.toLowerCase();
  return Array.from(new Set([raw, normalized, normalizedLower].filter(Boolean)));
}

function getProjectJobKeyLookupCandidates(project: ProjectSummary): string[] {
  const customer = String(project.customer || "").trim();
  const projectName = String(project.projectName || "").trim();
  const projectNumber = String(project.projectNumber || "").trim();
  const procoreId = String(project.procoreId || "").trim();

  const keys = [
    projectNumber ? `${customer}~${projectNumber}~${projectName}` : "",
    procoreId && procoreId !== projectNumber ? `${customer}~${procoreId}~${projectName}` : "",
  ].filter(Boolean);

  return Array.from(new Set(keys.flatMap((key) => getJobKeyLookupCandidates(key))));
}

function getGanttProjectJobKeys(project: GanttV2ProjectSummary): string[] {
  const customer = String(project.customer || "").trim();
  const projectName = String(project.projectName || "").trim();
  if (!customer || !projectName) return [];

  const projectNumbers = [project.projectNumber, project.sourceExternalId, project.sourceProjectId]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return Array.from(new Set(projectNumbers.map((projectNumber) => normalizeJobKey(`${customer}~${projectNumber}~${projectName}`))));
}

function getGanttProjectJobKeyLookupCandidates(project: GanttV2ProjectSummary): string[] {
  return Array.from(new Set(getGanttProjectJobKeys(project).flatMap((key) => getJobKeyLookupCandidates(key))));
}

function accAssignAlias(aliasMap: Record<string, string[]>, candidate: string, aliases: string[]) {
  const existing = aliasMap[candidate] || [];
  aliasMap[candidate] = Array.from(new Set([...existing, ...aliases]));
}

function mapGanttScopeToScheduleScope(scope: GanttV2ScopeSummary, jobKey: string): Scope {
  const startDate = String(scope.startDate || "").trim();
  const endDate = String(scope.endDate || "").trim();
  const hours = Number(scope.totalHours || 0);
  const manpower = Number(scope.crewSize || 0);

  return {
    id: scope.id,
    title: String(scope.title || "Unnamed Scope").trim() || "Unnamed Scope",
    jobKey,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    hours: Number.isFinite(hours) && hours > 0 ? hours : 0,
    manpower: Number.isFinite(manpower) && manpower > 0 ? manpower : undefined,
    tasks: Array.isArray(scope.tasks) ? scope.tasks : [],
    color: scope.color,
    taskColors: scope.taskColors,
    schedulingMode: "contiguous",
    selectedDays: [],
  };
}

function addScopeToLookup(acc: Record<string, Scope[]>, scope: Scope) {
  const jobKey = normalizeJobKey(scope.jobKey || "");
  if (!jobKey) return;

  getJobKeyLookupCandidates(jobKey).forEach((candidate) => {
    if (!acc[candidate]) acc[candidate] = [];
    const exists = acc[candidate].some((existing) => {
      if (existing.id && scope.id && existing.id === scope.id) return true;
      return (
        normalizeJobKey(existing.jobKey || "") === jobKey &&
        normalizeScopeTitle(existing.title) === normalizeScopeTitle(scope.title) &&
        String(existing.startDate || "") === String(scope.startDate || "") &&
        String(existing.endDate || "") === String(scope.endDate || "")
      );
    });
    if (!exists) acc[candidate].push({ ...scope, jobKey });
  });
}

function getScopesForJobKey(scopesByJobKey: Record<string, Scope[]>, jobKey: string): Scope[] {
  const seen = new Set<string>();
  const scopes: Scope[] = [];

  getJobKeyLookupCandidates(jobKey).forEach((candidate) => {
    (scopesByJobKey[candidate] || []).forEach((scope) => {
      const key = [scope.id || "", scope.jobKey || "", scope.title || "", scope.startDate || "", scope.endDate || ""].join("|");
      if (seen.has(key)) return;
      seen.add(key);
      scopes.push(scope);
    });
  });

  return scopes;
}

async function fetchLongTermProjectSummaries(): Promise<{ data?: ProjectSummary[] }> {
  const projects: ProjectSummary[] = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage && page <= 20) {
    const response = await fetchJsonWithRetry<ProjectSummariesResponse>(
      `/api/projects?summary=true&page=${page}&pageSize=500`,
      {
        fallback: { data: [], hasNextPage: false },
        label: `long-term projects page ${page}`,
      }
    );

    if (Array.isArray(response.data)) {
      projects.push(...response.data);
    }

    hasNextPage = response.hasNextPage === true;
    page += 1;
  }

  return { data: projects };
}

function findMatchingScopeForScheduleEntry(
  scopesByJobKey: Record<string, Scope[]>,
  entry: Pick<ActiveScheduleEntry, "jobKey" | "scopeOfWork" | "date">
): Scope | null {
  const assignmentScopes = getScopesForJobKey(scopesByJobKey, entry.jobKey);
  const matchingScopeByTitleAndDate = assignmentScopes.find((scope) => {
    const sameTitle = normalizeScopeTitle(scope.title) === normalizeScopeTitle(entry.scopeOfWork || "Unnamed Scope");
    if (!sameTitle) return false;
    const start = String(scope.startDate || "").trim();
    const end = String(scope.endDate || "").trim();
    if (!start && !end) return true;
    const rangeStart = start || entry.date;
    const rangeEnd = end || entry.date;
    return entry.date >= rangeStart && entry.date <= rangeEnd;
  });
  const matchingScopeByTitleOnly = assignmentScopes.find(
    (scope) => normalizeScopeTitle(scope.title) === normalizeScopeTitle(entry.scopeOfWork || "Unnamed Scope")
  );
  const dateScopedMatches = assignmentScopes.filter((scope) => {
    const start = String(scope.startDate || "").trim();
    const end = String(scope.endDate || "").trim();
    if (!start && !end) return false;
    const rangeStart = start || entry.date;
    const rangeEnd = end || entry.date;
    return entry.date >= rangeStart && entry.date <= rangeEnd;
  });
  const matchingScopeByDateOnly = dateScopedMatches.length === 1 ? dateScopedMatches[0] : null;

  return matchingScopeByTitleAndDate || matchingScopeByTitleOnly || matchingScopeByDateOnly || (assignmentScopes.length === 1 ? assignmentScopes[0] : null);
}

function getScopeDisplayHoursForDate(
  scope: Scope | null | undefined,
  dateKey: string,
  paidHolidayByDate: Record<string, Holiday>
): number | null {
  if (!scope || !dateKey) return null;

  const taskDayHours = getScopeTaskDayHours(scope, dateKey);
  if (Number.isFinite(taskDayHours || 0) && (taskDayHours || 0) > 0) {
    return Number(taskDayHours);
  }

  const specificDayHours = getScopeSpecificDayHours(scope, dateKey);
  if (Number.isFinite(specificDayHours || 0) && (specificDayHours || 0) > 0) {
    return Number(specificDayHours);
  }

  const contiguousDayHours = getScopeContiguousDayHours(scope, dateKey, paidHolidayByDate);
  if (Number.isFinite(contiguousDayHours || 0) && (contiguousDayHours || 0) > 0) {
    return Number(contiguousDayHours);
  }

  const manpower = Number(scope.manpower || 0);
  if (Number.isFinite(manpower) && manpower > 0) {
    return manpower * HOURS_PER_FTE_DAY;
  }

  return null;
}

function getBestSpecificDayHours(
  scopes: Scope[],
  dateKey: string,
  preferredScopeTitle?: string | null
): number | null {
  if (!Array.isArray(scopes) || scopes.length === 0 || !dateKey) return null;

  const normalizedPreferred = String(preferredScopeTitle || "").trim().toLowerCase();
  const scopesWithSpecificDay = scopes
    .map((scope) => ({ scope, hours: getScopeSpecificDayHours(scope, dateKey) }))
    .filter((row): row is { scope: Scope; hours: number } => Number.isFinite(row.hours || 0) && (row.hours || 0) > 0);

  if (scopesWithSpecificDay.length === 0) return null;

  const exactTitleMatch = normalizedPreferred
    ? scopesWithSpecificDay.find((row) => String(row.scope.title || "").trim().toLowerCase() === normalizedPreferred)
    : null;

  if (exactTitleMatch) return exactTitleMatch.hours;

  // If we cannot disambiguate by title, prefer the highest explicit day-hours to avoid under-allocation.
  return scopesWithSpecificDay.reduce((max, row) => Math.max(max, row.hours), 0);
}

function isForemanRole(jobTitle?: string) {
  return (
    jobTitle === "Foreman" ||
    jobTitle === "Lead foreman" ||
    jobTitle === "Lead Foreman" ||
    jobTitle === "Lead Foreman / Project Manager"
  );
}

function isDispatchCapacityFieldRole(jobTitle?: string) {
  const title = (jobTitle || "").toLowerCase();
  return (
    title === "laborer" ||
    title === "right hand men" ||
    title === "right hand man" ||
    title === "right hand man/ sealhard crew leader"
  );
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

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addProjectToAllocation(
  allocation: WeekAllocation,
  jobKey: string,
  scopeOfWork: string,
  hours: number
) {
  allocation.hours += hours;
  const projectKey = `${jobKey}|${scopeOfWork}`;
  let projectEntry = allocation.projects.find((p) => `${p.jobKey}|${p.scopeOfWork}` === projectKey);
  if (!projectEntry) {
    projectEntry = { jobKey, scopeOfWork, hours: 0 };
    allocation.projects.push(projectEntry);
  }
  projectEntry.hours += hours;
}

function getAssignmentKey(jobKey: string, scopeOfWork: string): string {
  return `${jobKey}||${scopeOfWork || "Unnamed Scope"}`;
}

function getProjectNameFromJobKey(jobKey: string): string {
  const parts = jobKey.split("~");
  return parts.slice(2).join("~").trim() || jobKey;
}

function getProjectNumberFromJobKey(jobKey: string): string {
  return String(jobKey.split("~")[1] || "").trim();
}

function shouldPreferJobKey(candidateJobKey: string, currentJobKey: string): boolean {
  const candidateProjectNumber = getProjectNumberFromJobKey(candidateJobKey);
  const currentProjectNumber = getProjectNumberFromJobKey(currentJobKey);
  const candidateLooksLikeProcoreId = /^\d{8,}$/.test(candidateProjectNumber);
  const currentLooksLikeProcoreId = /^\d{8,}$/.test(currentProjectNumber);

  if (candidateLooksLikeProcoreId !== currentLooksLikeProcoreId) {
    return !candidateLooksLikeProcoreId;
  }

  return candidateJobKey.localeCompare(currentJobKey) < 0;
}

function normalizeDisplayKeySegment(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getProjectDisplayGroupKey(jobKey: string): string {
  const parts = jobKey.split("~");
  const customer = normalizeDisplayKeySegment(parts[0] || "");
  const projectName = normalizeDisplayKeySegment(parts.slice(2).join("~") || "");

  if (customer && projectName) {
    return `project:${customer}:${projectName}`;
  }

  return `job:${normalizeJobKey(jobKey) || jobKey}`;
}

function getDisplayProjects(projects: AllocationProject[]): DisplayProject[] {
  const grouped = new Map<string, DisplayProject>();

  projects.forEach((project) => {
    const key = getProjectDisplayGroupKey(project.jobKey);
    const scopeTitle = String(project.scopeOfWork || "Unnamed Scope").trim() || "Unnamed Scope";
    const normalizedJobKey = normalizeJobKey(project.jobKey) || project.jobKey;
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        ...project,
        groupKey: key,
        scopeOfWork: scopeTitle,
        jobKeys: [normalizedJobKey],
        scopeCount: 1,
        scopeTitles: [scopeTitle],
      });
      return;
    }

    existing.hours += project.hours;
    if (!existing.jobKeys.includes(normalizedJobKey)) {
      existing.jobKeys.push(normalizedJobKey);
    }
    if (!existing.scopeTitles.includes(scopeTitle)) {
      existing.scopeTitles.push(scopeTitle);
      existing.scopeCount = existing.scopeTitles.length;
    }
  });

  return Array.from(grouped.values()).sort((a, b) => getProjectNameFromJobKey(a.jobKey).localeCompare(getProjectNameFromJobKey(b.jobKey)));
}

export default function LongTermSchedulePage() {
  const [weekColumns, setWeekColumns] = useState<WeekColumn[]>([]);
  const [foremanRows, setForemanRows] = useState<ForemanRow[]>([]);
  const [activeForemen, setActiveForemen] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [draggedProject, setDraggedProject] = useState<{
    jobKey: string;
    scopeOfWork: string;
    sourceDateKey?: string;
    sourceForemanId?: string;
    hours?: number;
  } | null>(null);

  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [paidHolidayByDate, setPaidHolidayByDate] = useState<Record<string, Holiday>>({});

  const [pmEmployees, setPmEmployees] = useState<Employee[]>([]);
  const [pmOverrides, setPmOverrides] = useState<Record<string, string>>({});
  const [jobKeyToProjectPM, setJobKeyToProjectPM] = useState<Record<string, string>>({});
  const [removingAssignmentKey, setRemovingAssignmentKey] = useState<string | null>(null);
  const [removeSuccessMessage, setRemoveSuccessMessage] = useState<string | null>(null);
  const [collapsedPMGroups, setCollapsedPMGroups] = useState<Set<string>>(new Set());
  const [dispatchCapacityStaff, setDispatchCapacityStaff] = useState<Employee[]>([]);
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);

  // Scope modal state
  const [selectedModalProject, setSelectedModalProject] = useState<ProjectInfo | null>(null);
  const [selectedModalScopeId, setSelectedModalScopeId] = useState<string | null>(null);
  const [selectedModalScopeTitle, setSelectedModalScopeTitle] = useState<string | null>(null);
  const [selectedModalScheduleDate, setSelectedModalScheduleDate] = useState<string | null>(null);
  const [selectedModalScheduledHours, setSelectedModalScheduledHours] = useState<number | null>(null);
  const [selectedModalForemanId, setSelectedModalForemanId] = useState<string | null>(null);
  const [scopesByJobKey, setScopesByJobKey] = useState<Record<string, Scope[]>>({});
  const [jobKeyToProjectDocId, setJobKeyToProjectDocId] = useState<Record<string, string>>({});

  useEffect(() => {
    loadSchedules();
  }, []);

  useEffect(() => {
    if (!removeSuccessMessage) return;
    const timer = setTimeout(() => setRemoveSuccessMessage(null), 2400);
    return () => clearTimeout(timer);
  }, [removeSuccessMessage]);

  async function loadSchedules() {
    try {
      setLoading(true);
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
      const startMonth = startDate.slice(0, 7);
      const endMonth = endDate.slice(0, 7);

      const [employeesJson, scheduleJson, holidaysJson, projectsJson, pmAssignmentsJson, timeOffJson, scopesJson, ganttProjectsJson, scheduleAllocationsJson] = await Promise.all([
        fetchJsonWithRetry<{ data?: Employee[] }>("/api/short-term-schedule?action=employees", {
          fallback: { data: [] },
          label: "long-term employees",
        }),
        fetchJsonWithRetry<{ data?: ActiveScheduleEntry[] }>(
          `/api/short-term-schedule?action=active-schedule&startDate=${startDate}&endDate=${endDate}`,
          {
            fallback: { data: [] },
            label: "long-term active schedule",
          }
        ),
        fetchJsonWithRetry<{ data?: Holiday[] }>("/api/holidays?page=1&pageSize=500", {
          fallback: { data: [] },
          label: "long-term holidays",
        }),
        fetchLongTermProjectSummaries(),
        fetchJsonWithRetry<{ data?: PMAssignment[] }>("/api/long-term-schedule/pm-assignments", {
          fallback: { data: [] },
          label: "long-term pm assignments",
        }),
        fetchJsonWithRetry<{ data?: RawTimeOffRecord[] }>("/api/time-off", {
          fallback: { data: [] },
          label: "long-term time off",
        }),
        fetchJsonWithRetry<{ data?: Scope[] }>("/api/project-scopes", {
          fallback: { data: [] },
          label: "long-term project scopes",
        }),
        fetchJsonWithRetry<GanttV2ProjectsResponse>("/api/gantt-v2/projects", {
          fallback: { data: [] },
          label: "long-term live gantt projects",
        }),
        fetchJsonWithRetry<{ success?: boolean; data?: ScheduleAllocationEntry[] }>(
          `/api/schedule-allocations?startMonth=${startMonth}&endMonth=${endMonth}`,
          {
            fallback: { success: false, data: [] },
            label: "long-term schedule allocations",
          }
        ),
      ]);

      const employees: Employee[] = employeesJson?.data || [];
      const activeSchedules: ActiveScheduleEntry[] = scheduleJson?.data || [];
      const projects: ProjectSummary[] = projectsJson?.data || [];
      const pmAssignments: PMAssignment[] = pmAssignmentsJson?.data || [];
      const allScopes: Scope[] = Array.isArray(scopesJson?.data) ? scopesJson.data : [];
      const ganttProjects: GanttV2ProjectSummary[] = Array.isArray(ganttProjectsJson?.data) ? ganttProjectsJson.data : [];
      const scheduleAllocations: ScheduleAllocationEntry[] = Array.isArray(scheduleAllocationsJson?.data) ? scheduleAllocationsJson.data : [];
      const getMatchingScopeForEntry = (entry: Pick<ActiveScheduleEntry, "jobKey" | "scopeOfWork" | "date">): Scope | null => {
        return findMatchingScopeForScheduleEntry(scopesByJobKeyLocal, entry);
      };

      const liveGanttScopes = ganttProjects.flatMap((project) => {
        const jobKeys = getGanttProjectJobKeys(project);
        const scopes = Array.isArray(project.scopes) ? project.scopes : [];
        return jobKeys.flatMap((jobKey) => scopes.map((scope) => mapGanttScopeToScheduleScope(scope, jobKey)));
      });

      const scopesByJobKeyLocal = [...allScopes, ...liveGanttScopes].reduce<Record<string, Scope[]>>((acc, scope) => {
        addScopeToLookup(acc, scope);
        return acc;
      }, {});
      setScopesByJobKey(scopesByJobKeyLocal);

      const paidHolidayMap: Record<string, Holiday> = {};
      (holidaysJson?.data || []).forEach((holiday: Holiday) => {
        if (holiday?.isPaid && holiday?.date) {
          paidHolidayMap[holiday.date] = holiday;
        }
      });
      setPaidHolidayByDate(paidHolidayMap);

      const projectJobKeyAliasMap = projects.reduce<Record<string, string[]>>((acc, project) => {
        const candidates = getProjectJobKeyLookupCandidates(project);
        candidates.forEach((candidate) => {
          acc[candidate] = candidates;
        });
        return acc;
      }, {});
      ganttProjects.forEach((project) => {
        const candidates = getGanttProjectJobKeyLookupCandidates(project);
        candidates.forEach((candidate) => {
          accAssignAlias(projectJobKeyAliasMap, candidate, candidates);
        });
      });

      const pmOverrideMap: Record<string, string> = {};
      pmAssignments.forEach((a) => {
        const projectKey = normalizeJobKey(a?.jobKey || a?.assignmentKey || "");
        if (projectKey && a?.pmId) {
          const assignmentCandidates = Array.from(new Set(
            getJobKeyLookupCandidates(projectKey).flatMap((candidate) => projectJobKeyAliasMap[candidate] || [candidate])
          ));
          assignmentCandidates.forEach((candidate) => {
            // Keep the first (newest) assignment encountered for this project key,
            // even if the row came from a legacy scope-level assignment key.
            if (!pmOverrideMap[candidate]) {
              pmOverrideMap[candidate] = a.pmId;
            }
          });
        }
      });
      setPmOverrides(pmOverrideMap);

      const projectPMMap: Record<string, string> = {};
      projects.forEach((project) => {
        if (project.projectManager) {
          getProjectJobKeyLookupCandidates(project).forEach((candidate) => {
            projectPMMap[candidate] = project.projectManager as string;
          });
        }
      });
      setJobKeyToProjectPM(projectPMMap);

      const docIdMap: Record<string, string> = {};
      projects.forEach((project) => {
        if (project.id) {
          getProjectJobKeyLookupCandidates(project).forEach((candidate) => {
            docIdMap[candidate] = project.id as string;
          });
        }
      });
      ganttProjects.forEach((project) => {
        if (project.id) {
          getGanttProjectJobKeyLookupCandidates(project).forEach((candidate) => {
            docIdMap[candidate] = project.id;
          });
        }
      });
      setJobKeyToProjectDocId(docIdMap);

      const pmEmployeeList = employees.filter((emp) => emp.isActive && PM_TITLES.includes(emp.jobTitle));
      setPmEmployees(pmEmployeeList);

      const foremen = employees.filter((emp) => emp.isActive && isForemanRole(emp.jobTitle));
      setActiveForemen(foremen);

      const dispatchStaff = employees.filter(
        (emp) => emp.isActive && (isForemanRole(emp.jobTitle) || isDispatchCapacityFieldRole(emp.jobTitle))
      );
      setDispatchCapacityStaff(dispatchStaff);

      const rawTimeOffRows = (timeOffJson?.data || []) as RawTimeOffRecord[];
      const normalizedTimeOffs: TimeOffRequest[] = rawTimeOffRows.flatMap((t: RawTimeOffRecord) => {
        const dates = Array.isArray(t?.dates)
          ? t.dates.filter((d: unknown) => typeof d === "string" && d)
          : [];

        if (typeof t?.startDate === "string" && typeof t?.endDate === "string") {
          return [{
            id: t.id,
            employeeId: t.employeeId,
            startDate: t.startDate,
            endDate: t.endDate,
            hours: Number(t.hours) > 0 ? Number(t.hours) : undefined,
          }];
        }

        if (dates.length === 0) return [];
        const sortedDates = [...dates].sort();
        return [{
          id: t.id,
          employeeId: t.employeeId,
          startDate: sortedDates[0],
          endDate: sortedDates[sortedDates.length - 1],
          hours: Number(t.hours) > 0 ? Number(t.hours) : undefined,
        }];
      });
      setTimeOffRequests(normalizedTimeOffs);

      const scopeIdentityKey = (scope: Scope): string => [
        String(scope.id || "").trim(),
        normalizeJobKey(scope.jobKey || ""),
        normalizeScopeTitle(scope.title || ""),
        String(scope.startDate || "").trim(),
        String(scope.endDate || "").trim(),
      ].join("|");

      const uniqueScopesByIdentity = new Map<string, Scope>();
      Object.values(scopesByJobKeyLocal).forEach((scopeList) => {
        (scopeList || []).forEach((scope) => {
          const key = scopeIdentityKey(scope);
          if (!key) return;
          if (!uniqueScopesByIdentity.has(key)) {
            uniqueScopesByIdentity.set(key, scope);
          }
        });
      });

      const scopeDateKeysByIdentity = new Map<string, Set<string>>();
      const jobsWithExplicitScopeDates = new Set<string>();
      uniqueScopesByIdentity.forEach((scope) => {
        const normalizedJobKey = normalizeJobKey(scope.jobKey || "");
        if (!normalizedJobKey) return;

        const dateKeys = getScopeDisplayDateKeys(scope, startDate, endDate, paidHolidayMap);
        if (dateKeys.length === 0) return;

        jobsWithExplicitScopeDates.add(normalizedJobKey);
        scopeDateKeysByIdentity.set(scopeIdentityKey(scope), new Set(dateKeys));
      });

      const ganttInitiatedSchedules = activeSchedules
        .filter((entry) => {
          const source = (entry.source || "").toLowerCase();
          return source === "gantt" || source === "wip-page" || source === "schedules";
        })
        .filter((entry) => {
          const source = (entry.source || "").toLowerCase();
          if (source !== "schedules") return true;

          const normalizedJobKey = normalizeJobKey(entry.jobKey || "");
          if (!normalizedJobKey) return false;
          if (!jobsWithExplicitScopeDates.has(normalizedJobKey)) return true;

          const assignmentScopes = getScopesForJobKey(scopesByJobKeyLocal, normalizedJobKey);
          if (assignmentScopes.length === 0) return true;

          const titleKey = normalizeScopeTitle(entry.scopeOfWork || "Unnamed Scope");
          const titleMatches = assignmentScopes.filter(
            (scope) => normalizeScopeTitle(scope.title || "") === titleKey
          );
          const candidateScopes = titleMatches.length > 0 ? titleMatches : assignmentScopes;

          return candidateScopes.some((scope) => {
            const dateKeys = scopeDateKeysByIdentity.get(scopeIdentityKey(scope));
            return Boolean(dateKeys && dateKeys.has(entry.date));
          });
        });

      const coveredAssignmentDates = new Set(
        ganttInitiatedSchedules.map((entry) => `${getAssignmentKey(entry.jobKey, entry.scopeOfWork || "Unnamed Scope")}|${entry.date}`)
      );
      const scopeSeedMap = new Map<string, {
        scope: Scope;
        foremanByDate: Map<string, string>;
        defaultForeman: string | null;
      }>();

      ganttInitiatedSchedules.forEach((entry) => {
        const matchingScope = getMatchingScopeForEntry(entry);
        if (!matchingScope) return;

        const scopeSeedKey = matchingScope.id || `${entry.jobKey}|${matchingScope.title}|${matchingScope.startDate || ""}|${matchingScope.endDate || ""}`;
        if (!scopeSeedMap.has(scopeSeedKey)) {
          scopeSeedMap.set(scopeSeedKey, {
            scope: matchingScope,
            foremanByDate: new Map<string, string>(),
            defaultForeman: null,
          });
        }

        const scopeSeed = scopeSeedMap.get(scopeSeedKey)!;
        if (entry.foreman) {
          scopeSeed.foremanByDate.set(entry.date, entry.foreman);
          if (!scopeSeed.defaultForeman) {
            scopeSeed.defaultForeman = entry.foreman;
          }
        }
      });

      const derivedScopeSchedules: ActiveScheduleEntry[] = [];
      scopeSeedMap.forEach(({ scope, foremanByDate, defaultForeman }) => {
        const dateKeys = getScopeDisplayDateKeys(scope, startDate, endDate, paidHolidayMap);

        dateKeys.forEach((dateKey) => {
          const assignmentDateKey = `${getAssignmentKey(scope.jobKey || "", scope.title || "Unnamed Scope")}|${dateKey}`;
          if (coveredAssignmentDates.has(assignmentDateKey)) return;

          const derivedHours = getScopeDisplayHoursForDate(scope, dateKey, paidHolidayMap);
          if (!Number.isFinite(derivedHours || 0) || (derivedHours || 0) <= 0) return;

          const selectedDayForeman = Array.isArray(scope.selectedDays)
            ? scope.selectedDays.find((entry) => String(entry?.date || "").trim() === dateKey)?.foreman || null
            : null;

          derivedScopeSchedules.push({
            jobKey: String(scope.jobKey || "").trim(),
            scopeOfWork: scope.title || "Unnamed Scope",
            date: dateKey,
            hours: Number(derivedHours),
            manpower: Number(scope.manpower || 0) || null,
            foreman: selectedDayForeman || foremanByDate.get(dateKey) || defaultForeman || null,
            source: "gantt",
          });
        });
      });

      const displayScheduleMonthKeys = new Set(
        [...ganttInitiatedSchedules, ...derivedScopeSchedules]
          .filter((entry) => entry.jobKey && /^\d{4}-\d{2}-\d{2}$/.test(entry.date || ""))
          .map((entry) => `${normalizeJobKey(entry.jobKey)}|${entry.date.slice(0, 7)}`)
      );

      const allocationFallbackSchedules: ActiveScheduleEntry[] = [];
      scheduleAllocations.forEach((allocation) => {
        const jobKey = normalizeJobKey(allocation.schedule?.jobKey || "");
        const period = String(allocation.period || "").trim();
        const hours = Number(allocation.hours || 0);

        if (!jobKey || !/^\d{4}-\d{2}$/.test(period)) return;
        if ((allocation.periodType || "month") !== "month") return;
        if (!Number.isFinite(hours) || hours <= 0) return;
        if (displayScheduleMonthKeys.has(`${jobKey}|${period}`)) return;

        const workingDateCount = getWorkingDateCountForMonth(period, paidHolidayMap);
        if (workingDateCount <= 0) return;

        const visibleDateKeys = getWorkingDateKeysForMonth(period, startDate, endDate, paidHolidayMap);
        if (visibleDateKeys.length === 0) return;

        const dailyHours = hours / workingDateCount;
        visibleDateKeys.forEach((dateKey) => {
          allocationFallbackSchedules.push({
            jobKey,
            scopeOfWork: "Scheduled work",
            date: dateKey,
            hours: dailyHours,
            manpower: null,
            foreman: null,
            source: "schedules",
          });
        });
      });

      const displaySchedules = [...ganttInitiatedSchedules, ...derivedScopeSchedules, ...allocationFallbackSchedules];

      const hasUnassignedEntries = displaySchedules.some((entry) => !entry.foreman);

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
        const dayAllocations: Record<string, WeekAllocation> = {};

        generatedWeeks.forEach((week) => {
          weekAllocations[week.weekStartDate.toISOString()] = { hours: 0, projects: [] };
        });

        displaySchedules.forEach((entry) => {
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
          const weekAllocation = weekAllocations[weekKey];
          const dayKey = formatDateKey(entryDate);
          if (!dayAllocations[dayKey]) {
            dayAllocations[dayKey] = { hours: 0, projects: [] };
          }
          const dayAllocation = dayAllocations[dayKey];

          const scopeOfWork = entry.scopeOfWork || "Unnamed Scope";
          const assignmentScopes = scopesByJobKeyLocal[entry.jobKey] || [];
          const matchingScope = getMatchingScopeForEntry(entry);

          const fallbackManpower = Number(matchingScope?.manpower || 0);
          const taskDayHours =
            getScopeTaskDayHours(matchingScope, entry.date) ||
            assignmentScopes
              .map((scope) => getScopeTaskDayHours(scope, entry.date))
              .find((hours): hours is number => Number.isFinite(hours || 0) && (hours || 0) > 0) ||
            null;
          const specificDayHours =
            getBestSpecificDayHours(assignmentScopes, entry.date, entry.scopeOfWork || "") ||
            getScopeSpecificDayHours(matchingScope, entry.date);
          const contiguousDayHours =
            getScopeContiguousDayHours(matchingScope, entry.date, paidHolidayMap) ||
            assignmentScopes
              .map((scope) => getScopeContiguousDayHours(scope, entry.date, paidHolidayMap))
              .find((hours): hours is number => Number.isFinite(hours || 0) && (hours || 0) >= 0) ||
            null;
          const scheduleHours = getHoursFromScheduleEntry(entry);
          const hours = (Number.isFinite(taskDayHours || 0) && (taskDayHours || 0) > 0)
            ? Number(taskDayHours)
            : (Number.isFinite(specificDayHours || 0) && (specificDayHours || 0) > 0)
            ? Number(specificDayHours)
            : (Number.isFinite(contiguousDayHours || 0) && (contiguousDayHours || 0) > 0)
              ? Number(contiguousDayHours)
            : (Number.isFinite(scheduleHours) && scheduleHours > 0)
              ? scheduleHours
              : (Number.isFinite(fallbackManpower) && fallbackManpower > 0)
                ? fallbackManpower * HOURS_PER_FTE_DAY
                : 0;
          addProjectToAllocation(weekAllocation, entry.jobKey, scopeOfWork, hours);
          addProjectToAllocation(dayAllocation, entry.jobKey, scopeOfWork, hours);
        });

        const totalHours = Object.values(weekAllocations).reduce((sum, alloc) => sum + alloc.hours, 0);
        return {
          id: foreman.id,
          name: `${foreman.firstName || ""} ${foreman.lastName || ""}`.trim() || "Foreman",
          weekAllocations,
          dayAllocations,
          totalHours,
        };
      });

      setForemanRows(rows);
    } catch (error) {
      console.error("Failed to load long-term schedule:", error);
      setForemanRows([]);
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  }

  async function assignProjectToForeman(jobKey: string, scopeOfWork: string, foremanId: string) {
    try {
      const res = await fetch("/api/gantt-v2/long-term/assign", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobKey,
          scopeOfWork,
          foreman: foremanId === "__unassigned__" ? null : foremanId,
        }),
      });

      const data = await res.json();
      if (data.success && Number(data?.data?.updatedCount || 0) > 0) {
        await loadSchedules();
      } else {
        const errorMessage = data?.error || "No matching schedule rows were updated";
        console.error("Failed to assign foreman:", errorMessage);
        alert("Failed to assign foreman: " + errorMessage);
      }
    } catch (err) {
      console.error("Error assigning foreman:", err);
      alert("Error assigning foreman");
    }
  }

  const getResolvedPMId = useCallback((jobKey: string): string => {
    for (const candidate of getJobKeyLookupCandidates(jobKey)) {
      const override = pmOverrides[candidate];
      if (override) return override;
    }

    let projectPMName = "";
    for (const candidate of getJobKeyLookupCandidates(jobKey)) {
      const mappedName = (jobKeyToProjectPM[candidate] || "").trim().toLowerCase();
      if (mappedName) {
        projectPMName = mappedName;
        break;
      }
    }

    if (projectPMName) {
      const match = pmEmployees.find((emp) => `${emp.firstName} ${emp.lastName}`.trim().toLowerCase() === projectPMName);
      if (match) return match.id;
    }

    return "__no_pm__";
  }, [pmOverrides, jobKeyToProjectPM, pmEmployees]);

  const getResolvedPMName = useCallback((pmId: string): string => {
    if (pmId === "__no_pm__") return "No PM Assigned";
    const pm = pmEmployees.find((emp) => emp.id === pmId);
    return pm ? `${pm.firstName} ${pm.lastName}`.trim() : "Unknown PM";
  }, [pmEmployees]);

  const getResolvedForemanName = useCallback((foremanId: string | null | undefined): string => {
    if (!foremanId || foremanId === "__unassigned__") return "Unassigned";
    const foreman = activeForemen.find((emp) => emp.id === foremanId);
    return foreman ? `${foreman.firstName} ${foreman.lastName}`.trim() : "Unknown Foreman";
  }, [activeForemen]);

  function handleDragStart(
    e: React.DragEvent,
    jobKey: string,
    scopeOfWork: string,
    sourceDateKey?: string,
    sourceForemanId?: string,
    hours?: number
  ) {
    // Ensure drag/drop consistently works across browsers.
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${jobKey}|${scopeOfWork}`);

    setDraggedProject({ jobKey, scopeOfWork, sourceDateKey, sourceForemanId, hours });
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  async function handleDrop(e: React.DragEvent, targetForemanId: string, targetDateKey?: string) {
    e.preventDefault();
    if (!draggedProject) return;

    const sourceDateKey = draggedProject.sourceDateKey || null;
    const resolvedTargetDateKey = targetDateKey || sourceDateKey;
    const normalizedSourceForemanId = draggedProject.sourceForemanId === "__unassigned__" ? null : (draggedProject.sourceForemanId || null);
    const normalizedTargetForemanId = targetForemanId === "__unassigned__" ? null : targetForemanId;

    try {
      if (sourceDateKey && resolvedTargetDateKey) {
        if (sourceDateKey === resolvedTargetDateKey && normalizedSourceForemanId === normalizedTargetForemanId) {
          return;
        }

        const response = await fetch('/api/short-term-schedule/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobKey: draggedProject.jobKey,
            scopeOfWork: draggedProject.scopeOfWork,
            sourceDateKey,
            sourceForemanId: normalizedSourceForemanId,
            targetDateKey: resolvedTargetDateKey,
            targetForemanId: normalizedTargetForemanId,
            hours: Number.isFinite(Number(draggedProject.hours)) ? Number(draggedProject.hours) : 10,
          }),
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result?.success) {
          throw new Error(result?.error || 'Failed to move project assignment');
        }

        await loadSchedules();
        return;
      }

      // Week-level cards are summary rows without a concrete date.
      // Fall back to foreman reassignment behavior for those drops.
      await assignProjectToForeman(draggedProject.jobKey, draggedProject.scopeOfWork, targetForemanId);
    } catch (error) {
      console.error('Error moving long-term schedule project:', error);
      alert(error instanceof Error ? error.message : 'Failed to move project');
    } finally {
      setDraggedProject(null);
    }
  }

  async function removeProjectFromDay(jobKey: string, scopeOfWork: string, dateKey: string) {
    const normalizedScopeOfWork = (scopeOfWork || '').trim();
    if (!jobKey || !normalizedScopeOfWork || !dateKey) return;

    const matchingScope = findMatchingScopeForScheduleEntry(scopesByJobKey, {
      jobKey,
      scopeOfWork: normalizedScopeOfWork,
      date: dateKey,
    });

    if (matchingScope?.id) {
      const currentDateKeys = getScopeDisplayDateKeys(matchingScope, null, null, paidHolidayByDate);
      const nextSelectedDays = currentDateKeys
        .filter((currentDateKey) => currentDateKey !== dateKey)
        .map((currentDateKey) => {
          const hours = getScopeDisplayHoursForDate(matchingScope, currentDateKey, paidHolidayByDate);
          if (!Number.isFinite(hours || 0) || (hours || 0) <= 0) return null;

          const existingSelectedDay = Array.isArray(matchingScope.selectedDays)
            ? matchingScope.selectedDays.find((entry) => String(entry?.date || '').trim() === currentDateKey)
            : null;

          const foremanRow = foremanRows.find((row) => {
            const allocation = row.dayAllocations[currentDateKey];
            return allocation?.projects?.some(
              (project) => project.jobKey === jobKey && String(project.scopeOfWork || '').trim() === normalizedScopeOfWork
            );
          });

          return {
            date: currentDateKey,
            hours: Number(hours),
            foreman: existingSelectedDay?.foreman ?? (foremanRow?.id && foremanRow.id !== '__unassigned__' ? foremanRow.id : null),
          };
        })
        .filter((entry): entry is { date: string; hours: number; foreman: string | null } => entry !== null);

      if (nextSelectedDays.length === 0) {
        throw new Error('Cannot remove the last scheduled day from this scope here. Open the scope editor to change the full scope schedule.');
      }

      const response = await fetch('/api/project-scopes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: matchingScope.id,
          schedulingMode: 'specific-days',
          selectedDays: nextSelectedDays,
          startDate: nextSelectedDays[0].date,
          endDate: nextSelectedDays[nextSelectedDays.length - 1].date,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || 'Failed to update scope schedule');
      }

      return;
    }

    const response = await fetch('/api/short-term-schedule/move', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobKey,
        scopeOfWork: normalizedScopeOfWork,
        date: dateKey,
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.success) {
      throw new Error(result?.error || 'Failed to remove assignment from day');
    }
  }

  function toggleWeek(weekKey: string) {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(weekKey)) {
        next.delete(weekKey);
      } else {
        next.add(weekKey);
      }
      return next;
    });
  }

  function togglePMGroup(pmId: string) {
    setCollapsedPMGroups((prev) => {
      const next = new Set(prev);
      if (next.has(pmId)) {
        next.delete(pmId);
      } else {
        next.add(pmId);
      }
      return next;
    });
  }

  const pmGroups = useMemo<PMGroup[]>(() => {
    const allRows = foremanRows;
    const pmIdToRows = new Map<string, ForemanRow[]>();

    const weekKeys = weekColumns.map((week) => week.weekStartDate.toISOString());

    allRows.forEach((row) => {
      const pmRowMap = new Map<string, ForemanRow>();

      weekKeys.forEach((weekKey) => {
        const allocation = row.weekAllocations[weekKey];
        if (!allocation || allocation.projects.length === 0) return;

        allocation.projects.forEach((project) => {
          const pmId = getResolvedPMId(project.jobKey);
          if (!pmRowMap.has(pmId)) {
            const emptyWeekAllocations: Record<string, WeekAllocation> = {};
            weekKeys.forEach((wk) => {
              emptyWeekAllocations[wk] = { hours: 0, projects: [] };
            });

            pmRowMap.set(pmId, {
              id: row.id,
              name: row.name,
              weekAllocations: emptyWeekAllocations,
              dayAllocations: {},
              totalHours: 0,
            });
          }

          const pmScopedRow = pmRowMap.get(pmId)!;
          addProjectToAllocation(pmScopedRow.weekAllocations[weekKey], project.jobKey, project.scopeOfWork, project.hours);
        });
      });

      Object.entries(row.dayAllocations).forEach(([dayKey, allocation]) => {
        allocation.projects.forEach((project) => {
          const pmId = getResolvedPMId(project.jobKey);
          const pmScopedRow = pmRowMap.get(pmId);
          if (!pmScopedRow) return;

          if (!pmScopedRow.dayAllocations[dayKey]) {
            pmScopedRow.dayAllocations[dayKey] = { hours: 0, projects: [] };
          }

          addProjectToAllocation(pmScopedRow.dayAllocations[dayKey], project.jobKey, project.scopeOfWork, project.hours);
        });
      });

      pmRowMap.forEach((pmRow, pmId) => {
        pmRow.totalHours = Object.values(pmRow.weekAllocations).reduce((sum, alloc) => sum + alloc.hours, 0);
        if (pmRow.totalHours <= 0) return;

        if (!pmIdToRows.has(pmId)) {
          pmIdToRows.set(pmId, []);
        }
        pmIdToRows.get(pmId)!.push(pmRow);
      });
    });

    const groups: PMGroup[] = Array.from(pmIdToRows.entries()).map(([pmId, rows]) => ({
      pmId,
      pmName: getResolvedPMName(pmId),
      foremanRows: rows,
      totalHours: rows.reduce((sum, row) => sum + row.totalHours, 0),
    }));

    return groups.sort((a, b) => {
      if (a.pmId === "__no_pm__") return 1;
      if (b.pmId === "__no_pm__") return -1;
      return a.pmName.localeCompare(b.pmName);
    });
  }, [foremanRows, weekColumns, getResolvedPMId, getResolvedPMName]);

  const columnDefs = useMemo<ColDef[]>(() => {
    const cols: ColDef[] = [];

    weekColumns.forEach((week) => {
      const weekKey = week.weekStartDate.toISOString();
      if (!expandedWeeks.has(weekKey)) {
        cols.push({ type: "week", weekKey, weekLabel: week.weekLabel });
        return;
      }

      for (let i = 0; i < 5; i++) {
        const day = new Date(week.weekStartDate);
        day.setDate(day.getDate() + i);
        const dateKey = formatDateKey(day);

        cols.push({
          type: "day",
          weekKey,
          dateKey,
          dateLabel: day.toLocaleDateString("en-US", {
            weekday: "short",
            month: "numeric",
            day: "numeric",
          }),
          holiday: paidHolidayByDate[dateKey],
        });
      }
    });

    return cols;
  }, [weekColumns, expandedWeeks, paidHolidayByDate]);

  const globalColumnTotals = useMemo(() => {
    return columnDefs.map((col) => {
      return foremanRows.reduce((sum, row) => {
        if (col.type === "week") {
          return sum + (row.weekAllocations[col.weekKey]?.hours || 0);
        }
        return sum + (row.dayAllocations[col.dateKey]?.hours || 0);
      }, 0);
    });
  }, [columnDefs, foremanRows]);

  const grandTotal = useMemo(
    () => foremanRows.reduce((sum, row) => sum + row.totalHours, 0),
    [foremanRows]
  );

  function openScopeModal(
    jobKey: string,
    scopeTitle?: string,
    dateKey?: string,
    scheduleHours?: number,
    foremanId?: string
  ) {
    const pickBestScope = (candidates: Scope[]): Scope | null => {
      if (!Array.isArray(candidates) || candidates.length === 0) return null;

      const score = (scope: Scope): number => {
        const taskCount = Array.isArray(scope.tasks) ? scope.tasks.length : 0;
        const selectedDayCount = Array.isArray(scope.selectedDays) ? scope.selectedDays.length : 0;
        const hasHours = Number(scope.hours || 0) > 0 ? 1 : 0;
        return (taskCount * 1000) + (selectedDayCount * 10) + hasHours;
      };

      return [...candidates].sort((a, b) => score(b) - score(a))[0] || null;
    };

    const parts = jobKey.split("~");
    const normalizedScopeTitle = (scopeTitle || "").trim().toLowerCase();
    const scopeCandidates = getScopesForJobKey(scopesByJobKey, jobKey);
    const titleMatches = normalizedScopeTitle
      ? scopeCandidates.filter((scope) => (scope.title || "").trim().toLowerCase() === normalizedScopeTitle)
      : [];

    const dateScopedMatch = dateKey
      ? titleMatches.find((scope) => {
          const scopeStart = (scope.startDate || "").trim();
          const scopeEnd = (scope.endDate || "").trim();
          if (!scopeStart && !scopeEnd) return false;
          const start = scopeStart || dateKey;
          const end = scopeEnd || dateKey;
          return dateKey >= start && dateKey <= end;
        })
      : null;

    const resolvedScopeId =
      dateScopedMatch?.id ||
        (!normalizedScopeTitle ? pickBestScope(scopeCandidates)?.id || null : null) ||
      (titleMatches.length === 1 ? titleMatches[0].id : null) ||
      (titleMatches[0]?.id ?? null);

    const isDebugTarget =
      /veritas academy/i.test(String(parts[2] || "")) ||
      /todd test 1/i.test(String(scopeTitle || ""));
    if (isDebugTarget) {
      console.log("[LongTermModalDebug] openScopeModal", {
        jobKey,
        scopeTitle,
        dateKey,
        resolvedScopeId,
        scopeCandidateCount: scopeCandidates.length,
        titleMatchCount: titleMatches.length,
        pickedDefaultScopeId: !normalizedScopeTitle ? pickBestScope(scopeCandidates)?.id || null : null,
        scopeCandidates: scopeCandidates.map((scope) => ({
          id: scope.id,
          title: scope.title,
          startDate: scope.startDate,
          endDate: scope.endDate,
          taskCount: Array.isArray(scope.tasks) ? scope.tasks.length : 0,
          schedulingMode: scope.schedulingMode,
        })),
      });
    }

    setSelectedModalScopeId(resolvedScopeId);
    setSelectedModalScopeTitle((scopeTitle || "").trim() || null);
    setSelectedModalScheduleDate(dateKey || null);
    setSelectedModalScheduledHours(Number.isFinite(Number(scheduleHours)) ? Number(scheduleHours) : null);
    setSelectedModalForemanId(foremanId || null);
    setSelectedModalProject({
      jobKey,
      customer: parts[0] || "",
      projectNumber: parts[1] || "",
      projectName: parts[2] || "",
      projectDocId: jobKeyToProjectDocId[jobKey] || "",
      projectManager: jobKeyToProjectPM[jobKey] || "",
    });
  }

  function renderProjects(
    projects: AllocationProject[],
    isCompact = false,
    granularity: "day" | "week" = "week",
    dragContext?: { sourceDateKey?: string; sourceForemanId?: string }
  ) {
    return getDisplayProjects(projects).map((proj, idx) => {
      const hasSingleScope = proj.scopeCount === 1;
      const hasSingleJobKey = proj.jobKeys.length === 1;
      const canEditSingleAssignment = hasSingleScope && hasSingleJobKey;
      const scopeTitle = canEditSingleAssignment ? proj.scopeOfWork : "";
      const assignmentKey = getAssignmentKey(proj.jobKey, proj.scopeOfWork);
      const resolvedForemanId = dragContext?.sourceForemanId || "__unassigned__";
      const canDrag = Boolean(dragContext?.sourceDateKey) && canEditSingleAssignment;
      const canRemoveFromDay = Boolean(dragContext?.sourceDateKey) && canEditSingleAssignment;
      const projectName = getProjectNameFromJobKey(proj.jobKey);
      const combinedLabels = [
        !hasSingleScope ? `${proj.scopeCount} scopes` : null,
        !hasSingleJobKey ? `${proj.jobKeys.length} project keys` : null,
      ].filter(Boolean).join(", ");
      const title = canEditSingleAssignment
        ? `${projectName} - ${proj.scopeOfWork}`
        : `${projectName} - ${combinedLabels || "combined entries"}: ${proj.scopeTitles.join(", ")}`;

      return (
        <div
          key={`${proj.groupKey}-${idx}`}
          className={`text-[9px] text-left text-gray-700 mt-1 ${isCompact ? "p-1" : "px-1.5 py-1"} ${canDrag ? "cursor-move" : "cursor-pointer"} bg-white rounded-sm border border-gray-300 hover:border-orange-500 hover:bg-orange-50 transition-colors`}
          draggable={canDrag}
          onDragStart={(e) =>
            handleDragStart(
              e,
              proj.jobKey,
              proj.scopeOfWork,
              dragContext?.sourceDateKey,
              dragContext?.sourceForemanId,
              proj.hours
            )
          }
          onClick={() => {
            openScopeModal(
              proj.jobKey,
              scopeTitle,
              dragContext?.sourceDateKey,
              proj.hours,
              resolvedForemanId
            );
          }}
          title={title}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 font-black text-gray-900 whitespace-normal break-words leading-tight">
              {projectName}
              {!canEditSingleAssignment && (
                <span className="ml-1 text-[7px] font-black text-gray-500 uppercase whitespace-nowrap">
                  {combinedLabels || "combined"}
                </span>
              )}
            </div>
            <div className="shrink-0 text-right text-[8px] font-black text-orange-700 leading-none whitespace-nowrap">
              <div>{proj.hours.toFixed(0)}H</div>
              <div className="mt-0.5 text-[7px] text-orange-600/90">{getFteFromHours(proj.hours, granularity).toFixed(1)} MP</div>
            </div>
          </div>
          {canRemoveFromDay && removingAssignmentKey === assignmentKey && (
            <div className="mt-0.5 text-[8px] font-black text-red-700 leading-none">Updating...</div>
          )}
        </div>
      );
    });
  }

  function getPMGroupAllocation(group: PMGroup, col: ColDef): WeekAllocation {
    const allocation: WeekAllocation = { hours: 0, projects: [] };

    group.foremanRows.forEach((row) => {
      const source = col.type === "week"
        ? row.weekAllocations[col.weekKey]
        : row.dayAllocations[col.dateKey];

      if (!source) return;

      source.projects.forEach((project) => {
        addProjectToAllocation(allocation, project.jobKey, project.scopeOfWork, project.hours);
      });
    });

    return allocation;
  }

  return (
    <main className="min-h-screen bg-neutral-100 p-1.5 md:p-2 font-sans text-slate-900">
      <div className="w-full flex flex-col min-h-[calc(100vh-1rem)] bg-white shadow-2xl rounded-2xl overflow-hidden border border-gray-200 p-3 md:p-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 mb-2 pb-2 border-b border-gray-100">
          <div>
            <h1 className="text-xl md:text-2xl font-black tracking-tight text-gray-900 uppercase italic leading-none">
              Long-Term <span className="text-orange-600">Schedule</span>
            </h1>
          </div>
        </div>

        {loading && hasLoadedOnce && (
          <div className="pointer-events-none fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2">
            <div className="inline-flex items-center gap-3 rounded-full border border-white/60 bg-orange-500/70 px-5 py-2 text-xs font-black uppercase tracking-[0.18em] text-white shadow-2xl backdrop-blur-md">
              <span className="h-2.5 w-2.5 rounded-full bg-white/90 animate-pulse" aria-hidden="true" />
              Updating Schedule
            </div>
          </div>
        )}

        {removeSuccessMessage && (
          <div className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-700">
            {removeSuccessMessage}
          </div>
        )}

        {loading && !hasLoadedOnce ? (
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
              <div className="overflow-x-auto h-full lt-visible-scrollbar">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-30">
                    <tr className="bg-stone-800">
                      <th className="sticky left-0 z-40 bg-stone-800 text-left py-3 px-3 text-sm font-black text-white uppercase tracking-[0.12em] italic border-r border-stone-700 w-48 shadow-lg">
                        Project Manager
                      </th>
                      {columnDefs.map((col) => {
                        const isWeekCol = col.type === "week";
                        const uniqueJobs = new Set<string>();
                        const allocatedHours = foremanRows.reduce((sum, row) => {
                          if (isWeekCol) {
                            const alloc = row.weekAllocations[col.weekKey];
                            (alloc?.projects || []).forEach((p) => uniqueJobs.add(p.jobKey));
                            return sum + (alloc?.hours || 0);
                          }
                          const alloc = row.dayAllocations[col.dateKey];
                          (alloc?.projects || []).forEach((p) => uniqueJobs.add(p.jobKey));
                          return sum + (alloc?.hours || 0);
                        }, 0);
                        const baseDispatchCapacity = dispatchCapacityStaff.length * 10;

                        const getDayCapacity = (dateKey: string) => {
                          if (paidHolidayByDate[dateKey]) {
                            return 0;
                          }

                          let totalHoursOff = 0;
                          dispatchCapacityStaff.forEach((employee) => {
                            const req = timeOffRequests.find(
                              (r) => r.employeeId === employee.id && dateKey >= r.startDate && dateKey <= r.endDate
                            );
                            if (req) {
                              totalHoursOff += req.hours || 10;
                            }
                          });

                          return Math.max(baseDispatchCapacity - totalHoursOff, 0);
                        };

                        let capacityHours = 0;
                        let activeHeadcount = 0;
                        const allocatedFTE = isWeekCol ? allocatedHours / 50 : allocatedHours / 10;

                        if (isWeekCol) {
                          const weekStart = weekColumns.find((w) => w.weekStartDate.toISOString() === col.weekKey)?.weekStartDate;
                          if (weekStart) {
                            for (let i = 0; i < 5; i++) {
                              const day = new Date(weekStart);
                              day.setDate(day.getDate() + i);
                              const dayCapacity = getDayCapacity(formatDateKey(day));
                              capacityHours += dayCapacity;
                            }
                          }
                          activeHeadcount = capacityHours / 50;
                        } else {
                          capacityHours = getDayCapacity(col.dateKey);
                          activeHeadcount = capacityHours / 10;
                        }

                        if (col.type === "week") {
                          const isExpanded = expandedWeeks.has(col.weekKey);
                          return (
                            <th
                              key={col.weekKey}
                              className="text-center py-2.5 px-2 text-sm font-black text-white border-r border-stone-700 min-w-[150px] cursor-pointer hover:bg-stone-700/80 transition-colors"
                              onClick={() => toggleWeek(col.weekKey)}
                            >
                              <div className="text-[10px] text-orange-400 uppercase tracking-widest mb-0.5 flex items-center justify-center gap-1">
                                Week Of
                                <span
                                  aria-hidden="true"
                                  className={`inline-block h-0 w-0 border-y-[4px] border-y-transparent border-l-[6px] border-l-current text-orange-300 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                />
                              </div>
                              <div className="text-lg italic tracking-tight text-white leading-none">{col.weekLabel}</div>
                              <div className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1">
                                <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest gap-2 leading-none">
                                  <span className="text-stone-300">Headcount</span>
                                  <span className="text-orange-300">{Number.isInteger(activeHeadcount) ? activeHeadcount : activeHeadcount.toFixed(1)}</span>
                                  <span className="text-stone-500">|</span>
                                  <span className="text-orange-200">Man Power {allocatedFTE.toFixed(1)}</span>
                                </div>
                                <div className="mt-0.5 flex items-center justify-between text-[10px] font-black leading-none">
                                  <span className="text-orange-200">{allocatedHours.toFixed(0)}H</span>
                                  <span className="text-stone-400">/</span>
                                  <span className="text-stone-300">{capacityHours}H</span>
                                </div>
                                <div className="mt-0.5 text-[9px] font-black text-stone-300 uppercase tracking-wider text-left leading-none">
                                  {uniqueJobs.size} Jobs
                                </div>
                              </div>
                            </th>
                          );
                        }

                        const isDayOff = Boolean(col.holiday);
                        return (
                          <th
                            key={`${col.weekKey}-${col.dateKey}`}
                            className={`text-center py-2 px-1.5 text-sm font-black text-white border-r border-stone-600 min-w-[96px] cursor-pointer hover:bg-indigo-900/70 transition-colors ${
                              isDayOff ? "bg-rose-900/60" : "bg-indigo-950/80"
                            }`}
                            onClick={() => toggleWeek(col.weekKey)}
                            title="Click to collapse this week"
                          >
                            <div className="text-[10px] uppercase tracking-wider text-orange-200 leading-none">{col.dateLabel}</div>
                            <div className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-1.5 py-1">
                              <div className="flex items-center justify-between text-[8px] font-black uppercase tracking-widest gap-1.5 leading-none">
                                <span className="text-stone-300">Headcount</span>
                                <span className="text-orange-300">{Number.isInteger(activeHeadcount) ? activeHeadcount : activeHeadcount.toFixed(1)}</span>
                                <span className="text-stone-500">|</span>
                                <span className="text-orange-200">Man Power {allocatedFTE.toFixed(1)}</span>
                              </div>
                              <div className="mt-0.5 flex items-center justify-between text-[9px] font-black leading-none">
                                <span className="text-orange-200">{allocatedHours.toFixed(0)}H</span>
                                <span className="text-stone-400">/</span>
                                <span className="text-stone-300">{capacityHours}H</span>
                              </div>
                              <div className="mt-0.5 text-[8px] font-black text-stone-300 uppercase tracking-wider text-left leading-none">
                                {uniqueJobs.size} Jobs
                              </div>
                            </div>
                            {isDayOff && (
                              <div className="mt-1 inline-flex items-center px-1.5 py-0.5 rounded bg-rose-500/20 border border-rose-300/40 text-[9px] text-rose-100 uppercase tracking-widest leading-none">
                                Day Off
                              </div>
                            )}
                          </th>
                        );
                      })}
                      <th className="text-center py-3 px-3 text-sm font-black text-white bg-stone-800 border-l border-stone-700 uppercase tracking-widest">
                        Total Sum
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pmGroups.map((group) => (
                      <tr key={`pm-row-${group.pmId}`} className="border-t-[3px] border-orange-300 border-b border-stone-200 transition-colors bg-white">
                        <td className="sticky left-0 z-20 bg-white py-2.5 px-3 text-xs font-black text-gray-900 uppercase tracking-wide italic border-r border-gray-100 border-l-[4px] border-l-orange-400 shadow-md">
                          <button
                            type="button"
                            onClick={() => togglePMGroup(group.pmId)}
                            className="w-full flex items-center justify-between text-left"
                            title={collapsedPMGroups.has(group.pmId) ? "Expand PM projects" : "Collapse PM projects"}
                          >
                            <span>PM: {group.pmName}</span>
                            <span
                              aria-hidden="true"
                              className={`inline-block h-0 w-0 border-y-[4px] border-y-transparent border-l-[6px] border-l-current text-orange-500 transition-transform ${collapsedPMGroups.has(group.pmId) ? "" : "rotate-90"}`}
                            />
                          </button>
                        </td>
                        {columnDefs.map((col) => {
                          const allocation = getPMGroupAllocation(group, col);
                          const hours = allocation.hours || 0;
                          const isDayOff = col.type === "day" && Boolean(col.holiday);

                          return (
                            <td
                              key={`pm-${group.pmId}-${col.type === "week" ? col.weekKey : `${col.weekKey}-${col.dateKey}`}`}
                              className={`text-center py-1.5 px-1.5 text-xs border-r transition-all align-top ${
                                col.type === "day"
                                  ? isDayOff
                                    ? "bg-rose-50/50 border-indigo-100"
                                    : hours > 0
                                      ? "bg-indigo-50/60 border-indigo-100"
                                      : "bg-slate-50/70 border-indigo-100"
                                  : isDayOff
                                    ? "bg-rose-50/50 border-gray-100"
                                    : hours > 0
                                      ? "bg-orange-50/30 border-gray-100"
                                      : "border-gray-100"
                              }`}
                              onDragOver={isDayOff ? undefined : handleDragOver}
                              onDrop={isDayOff ? undefined : (e) => handleDrop(e, draggedProject?.sourceForemanId || "__unassigned__", col.type === "day" ? col.dateKey : undefined)}
                            >
                              {isDayOff && (
                                <div className="mb-0.5 text-[8px] font-black uppercase tracking-widest text-rose-600 leading-none">
                                  {col.holiday?.name || "Day Off"}
                                </div>
                              )}
                              {hours > 0 && (
                                <div className="space-y-1">
                                  <div className="font-black text-gray-900 text-sm tracking-tight leading-none">
                                    {getFteFromHours(hours, col.type === "week" ? "week" : "day").toFixed(1)}
                                    <span className="text-[9px] opacity-50 ml-0.5">Man Power</span>
                                  </div>
                                  <div className="text-[9px] text-gray-500 font-black leading-none">{hours.toFixed(1)}H</div>
                                  {!collapsedPMGroups.has(group.pmId) && renderProjects(
                                    allocation.projects,
                                    col.type === "day",
                                    col.type === "week" ? "week" : "day",
                                    col.type === "day" ? { sourceDateKey: col.dateKey } : undefined
                                  )}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        <td className="text-center py-2.5 px-3 text-sm font-black bg-stone-50 border-l border-gray-200">
                          <div className="text-gray-900 leading-none">{group.totalHours.toFixed(1)}H</div>
                          <div className="text-[9px] font-black text-orange-700 uppercase leading-none mt-0.5">
                            {(group.totalHours / 50).toFixed(1)} Total Man Power
                          </div>
                        </td>
                      </tr>
                    ))}

                    <tr className="bg-stone-800 text-white font-black uppercase tracking-widest italic">
                      <td className="sticky left-0 z-20 bg-stone-800 py-3 px-3 text-[10px] border-r border-stone-700 shadow-lg">
                        Weekly Cumulative Load
                      </td>
                      {globalColumnTotals.map((total, idx) => (
                        <td key={idx} className="text-center py-3 px-2 text-xs border-r border-stone-700">
                          <div className="text-sm tracking-tight text-orange-300 leading-none">{getFteFromHours(total, columnDefs[idx]?.type === "week" ? "week" : "day").toFixed(1)} Man Power</div>
                          <div className="text-[9px] text-stone-300 opacity-80 leading-none mt-0.5">{total.toFixed(0)}H</div>
                        </td>
                      ))}
                      <td className="text-center py-3 px-3 text-xs bg-stone-800 border-l border-stone-700">
                        <div className="text-base text-orange-300 leading-none">{grandTotal.toFixed(0)}H</div>
                        <div className="text-[9px] text-stone-300 opacity-80 leading-none mt-0.5">Total Lifecycle</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="md:hidden flex-1 overflow-y-auto space-y-6 lt-visible-scrollbar pb-10">
              {pmGroups.map((group) => (
                <div key={group.pmId} className="space-y-3">
                  <div className="bg-stone-800 text-white rounded-xl px-4 py-2 border border-stone-700">
                    <button
                      type="button"
                      onClick={() => togglePMGroup(group.pmId)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-[9px] font-black uppercase tracking-widest text-orange-300">Project Manager</div>
                        <span
                          aria-hidden="true"
                          className={`inline-block h-0 w-0 border-y-[4px] border-y-transparent border-l-[6px] border-l-current text-orange-300 transition-transform ${collapsedPMGroups.has(group.pmId) ? "" : "rotate-90"}`}
                        />
                      </div>
                      <div className="text-sm font-black uppercase italic">{group.pmName}</div>
                      <div className="text-[9px] font-bold text-orange-200 mt-1">{group.totalHours.toFixed(0)}h <span className="text-orange-400">|</span> {(group.totalHours / 50).toFixed(1)} Man Power</div>
                    </button>
                  </div>

                  {!collapsedPMGroups.has(group.pmId) && (
                    <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100 shadow-sm">
                      <div className="grid grid-cols-1 gap-3">
                        {weekColumns
                          .map((week) => {
                            const weekKey = week.weekStartDate.toISOString();
                            const allocation = getPMGroupAllocation(group, { type: "week", weekKey, weekLabel: week.weekLabel });
                            const hours = allocation.hours || 0;
                            if (hours <= 0) return null;
                            const expanded = expandedWeeks.has(weekKey);

                            return (
                              <div key={weekKey} className="bg-white p-3 rounded-xl border border-orange-100">
                                <button
                                  type="button"
                                  className="w-full flex items-center justify-between"
                                  onClick={() => toggleWeek(weekKey)}
                                >
                                  <p className="text-[8px] font-black uppercase text-gray-400 mb-1">{week.weekLabel}</p>
                                  <span
                                    aria-hidden="true"
                                    className={`inline-block h-0 w-0 border-y-[4px] border-y-transparent border-l-[6px] border-l-current text-gray-400 transition-transform ${expanded ? "rotate-90" : ""}`}
                                  />
                                </button>

                                <div className="mb-2">
                                  <span className="font-black text-gray-900 text-sm">{getFteFromHours(hours, "week").toFixed(1)} Man Power</span>
                                  <span className="text-[10px] text-gray-500 ml-2">{hours.toFixed(1)}h</span>
                                </div>

                                {!expanded ? (
                                  renderProjects(allocation.projects || [], true, "week")
                                ) : (
                                  <div className="space-y-2">
                                    {Array.from({ length: 5 }).map((_, i) => {
                                      const day = new Date(week.weekStartDate);
                                      day.setDate(day.getDate() + i);
                                      const dayKey = formatDateKey(day);
                                      const dayAllocation = getPMGroupAllocation(group, {
                                        type: "day",
                                        weekKey,
                                        dateKey: dayKey,
                                        dateLabel: day.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" }),
                                        holiday: paidHolidayByDate[dayKey],
                                      });
                                      const dayHours = dayAllocation.hours || 0;
                                      const holiday = paidHolidayByDate[dayKey];

                                      return (
                                        <div
                                          key={dayKey}
                                          className={`rounded-lg border px-2 py-1 ${holiday ? "border-rose-200 bg-rose-50" : "border-gray-200 bg-gray-50"}`}
                                          onDragOver={holiday ? undefined : handleDragOver}
                                          onDrop={holiday ? undefined : (e) => handleDrop(e, draggedProject?.sourceForemanId || "__unassigned__", dayKey)}
                                        >
                                          <div className="text-[8px] font-black text-gray-500 uppercase tracking-wider">
                                            {day.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" })}
                                          </div>
                                          {holiday && (
                                            <div className="text-[8px] font-black text-rose-600 uppercase tracking-widest mt-0.5">
                                              Day Off: {holiday.name}
                                            </div>
                                          )}
                                          {dayHours > 0 && (
                                            <div className="space-y-1">
                                              <div className="text-[10px] font-black text-gray-800 mt-1">{getFteFromHours(dayHours, "day").toFixed(1)} Man Power</div>
                                              <div className="text-[9px] text-gray-500">{dayHours.toFixed(1)}h</div>
                                              {renderProjects(dayAllocation.projects || [], true, "day", { sourceDateKey: dayKey })}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })
                          .filter(Boolean)}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {selectedModalProject && (
        <ProjectScopesModal
          project={selectedModalProject}
          scopes={getScopesForJobKey(scopesByJobKey, selectedModalProject.jobKey)}
          allScopes={scopesByJobKey}
          selectedScopeId={selectedModalScopeId}
          selectedScopeTitle={selectedModalScopeTitle}
          selectedScheduleDate={selectedModalScheduleDate}
          selectedScheduledHours={selectedModalScheduledHours}
          selectedForemanId={selectedModalForemanId}
          dayEditMode={Boolean(selectedModalScheduleDate)}
          onLongTermAssignmentSaved={async () => {
            await loadSchedules();
          }}
          onClose={() => {
            setSelectedModalProject(null);
            setSelectedModalScopeId(null);
            setSelectedModalScopeTitle(null);
            setSelectedModalScheduleDate(null);
            setSelectedModalScheduledHours(null);
            setSelectedModalForemanId(null);
          }}
          onScopesUpdated={(jobKey, updatedScopes) => {
            const isDebugTarget = /veritas academy/i.test(String(selectedModalProject.projectName || '')) || /todd test 1/i.test(String(selectedModalScopeTitle || ''));
            if (isDebugTarget) {
              console.log('[LongTermModalDebug] onScopesUpdated', {
                jobKey,
                updatedScopeCount: updatedScopes.length,
                updatedScopes: updatedScopes.map((scope) => ({
                  id: scope.id,
                  title: scope.title,
                  startDate: scope.startDate,
                  endDate: scope.endDate,
                  taskCount: Array.isArray(scope.tasks) ? scope.tasks.length : 0,
                  selectedDayCount: Array.isArray(scope.selectedDays) ? scope.selectedDays.length : 0,
                })),
              });
            }
            setScopesByJobKey((prev) => {
              const previousScopes = getScopesForJobKey(prev, jobKey);
              const previousById = new Map(previousScopes.map((scope) => [scope.id, scope]));

              const mergedScopes = updatedScopes.map((scope) => {
                const previous = previousById.get(scope.id);
                if (!previous) return scope;

                const nextTasks = Array.isArray(scope.tasks) ? scope.tasks : [];
                const preservedTasks = nextTasks.length > 0 ? nextTasks : (Array.isArray(previous.tasks) ? previous.tasks : []);
                const nextSelectedDays = Array.isArray(scope.selectedDays) ? scope.selectedDays : [];
                const preservedSelectedDays = nextSelectedDays.length > 0 ? nextSelectedDays : (Array.isArray(previous.selectedDays) ? previous.selectedDays : []);

                return {
                  ...previous,
                  ...scope,
                  tasks: preservedTasks,
                  selectedDays: preservedSelectedDays,
                  schedulingMode: scope.schedulingMode || previous.schedulingMode,
                };
              });

              return { ...prev, [jobKey]: mergedScopes };
            });
            // Scope date changes can resync active schedule rows; refresh the board immediately.
            void loadSchedules();
          }}
        />
      )}
      <style>{`
        .lt-visible-scrollbar {
          scrollbar-width: auto;
          scrollbar-color: #f97316 #e7e5e4;
        }

        .lt-visible-scrollbar::-webkit-scrollbar {
          width: 12px;
          height: 12px;
        }

        .lt-visible-scrollbar::-webkit-scrollbar-track {
          background: #e7e5e4;
          border-radius: 9999px;
        }

        .lt-visible-scrollbar::-webkit-scrollbar-thumb {
          background: #f97316;
          border-radius: 9999px;
          border: 2px solid #e7e5e4;
        }

        .lt-visible-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #ea580c;
        }
      `}</style>
    </main>
  );
}

