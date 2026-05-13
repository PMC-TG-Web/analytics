import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";

import { ConcreteOrderModal, type ConcreteOrderProjectRef } from "@/components/ConcreteOrderModal";
import { ProjectInfo, Scope, ScheduleTask } from "@/types";
import { readJsonResponse } from "@/utils/readJsonResponse";

type GanttProjectResponse = {
  id: string;
  projectName: string;
  customer: string | null;
  projectNumber: string | null;
  scopes?: Array<{
    id: string;
    predecessorScopeId?: string | null;
    title: string;
    startDate: string | null;
    endDate: string | null;
    totalHours: number;
    crewSize: number | null;
    notes: string | null;
  }>;
};

const NEW_SCOPE_ID = '__new_scope__';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PM_TITLES = ["Project Manager", "Lead Foreman / Project Manager", "Superintendent"];

const isCanonicalScopeId = (value: string | null | undefined) =>
  Boolean(
    value &&
    value !== NEW_SCOPE_ID &&
    UUID_REGEX.test(value)
  );

type AssignmentOption = {
  id: string;
  label: string;
};

type LongTermAssignmentContext = {
  assignmentKey: string;
  jobKey: string;
  scopeOfWork: string;
  pmSelectionId: string;
  projectDefaultPMName?: string;
  foremanSelectionId: string;
  pmOptions: AssignmentOption[];
  foremanOptions: AssignmentOption[];
};

interface ProjectScopesModalProps {
  project: ProjectInfo;
  scopes: Scope[];
  allScopes?: Record<string, Scope[]>; // Map of jobKey -> Scope[] for company-wide capacity
  companyCapacity?: number; // Total available hours per day
  scheduledHoursByJobKeyDate?: Record<string, Record<string, number>>; // jobKey -> dateKey -> hours
  selectedScopeId: string | null;
  selectedTaskIndex?: number | null;
  selectedScopeTitle?: string | null;
  selectedScheduleDate?: string | null;
  selectedScheduledHours?: number | null;
  selectedForemanId?: string | null;
  dayEditMode?: boolean;
  allowLongTermAssignmentEditing?: boolean;
  longTermAssignmentContext?: LongTermAssignmentContext;
  onLongTermAssignmentSaved?: () => Promise<void> | void;
  onClose: () => void;
  onScopesUpdated: (jobKey: string, scopes: Scope[]) => void;
}

const parseScopeDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch;
      const d = new Date(Number(year), Number(month) - 1, Number(day));
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    const d = (value as { toDate: () => Date }).toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  return null;
};

const calculateWorkDays = (startValue?: unknown, endValue?: unknown) => {
  const start = parseScopeDate(startValue);
  const end = parseScopeDate(endValue);
  if (!start || !end) return 0;
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  
  let count = 0;
  const current = new Date(start);
  
  // Safety break for extremely long ranges (max 3 years)
  const maxDate = new Date(start);
  maxDate.setFullYear(maxDate.getFullYear() + 3);
  const actualEnd = end > maxDate ? maxDate : end;

  while (current <= actualEnd) {
    if (current.getDay() !== 0 && current.getDay() !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
};

const computeScopeHours = (scope: Partial<Scope>) => {
  const hoursRaw = scope.hours;
  const hoursValue = typeof hoursRaw === "number" ? hoursRaw : parseFloat(String(hoursRaw));
  if (Number.isFinite(hoursValue) && hoursValue > 0) return hoursValue;

  const manpowerRaw = scope.manpower;
  const manpowerValue = typeof manpowerRaw === "number" ? manpowerRaw : parseFloat(String(manpowerRaw));
  const days = calculateWorkDays(scope.startDate, scope.endDate);

  if (Number.isFinite(manpowerValue) && manpowerValue > 0 && days > 0) {
    return manpowerValue * 10 * days;
  }

  return 0;
};

const getScopeRichnessScore = (scope: Partial<Scope>) => {
  const taskCount = Array.isArray(scope.tasks) ? scope.tasks.length : 0;
  const selectedDayCount = Array.isArray(scope.selectedDays) ? scope.selectedDays.length : 0;
  const hasStart = Boolean(dateKey(scope.startDate));
  const hasEnd = Boolean(dateKey(scope.endDate));
  const hasHours = Number(scope.hours || 0) > 0;
  const hasManpower = Number(scope.manpower || 0) > 0;
  const hasDescription = String(scope.description || '').trim().length > 0;

  return (
    taskCount * 1000 +
    selectedDayCount * 100 +
    (hasStart ? 20 : 0) +
    (hasEnd ? 20 : 0) +
    (hasHours ? 10 : 0) +
    (hasManpower ? 5 : 0) +
    (hasDescription ? 1 : 0)
  );
};

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getWeekRangeFromDateKey = (dateKeyValue: string): { weekStart: string; weekEnd: string } | null => {
  const parts = String(dateKeyValue || '').trim().split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;

  const dayOfWeek = date.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() + mondayOffset);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  return {
    weekStart: formatDateKey(weekStart),
    weekEnd: formatDateKey(weekEnd),
  };
};

const normalizeText = (value: string | null | undefined) =>
  (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const isForemanRole = (jobTitle?: string) =>
  jobTitle === "Foreman" ||
  jobTitle === "Lead foreman" ||
  jobTitle === "Lead Foreman" ||
  jobTitle === "Lead Foreman / Project Manager";

const parseJobKeyParts = (jobKey: string | null | undefined): { customer: string; projectNumber: string; projectName: string } => {
  const [customer = "", projectNumber = "", projectName = ""] = String(jobKey || "").split("~");
  return { customer, projectNumber, projectName };
};

const isGiantProjectName = (projectName: string | null | undefined) =>
  normalizeText(projectName).includes("giant");

const isPlaceholderScopeTitle = (title: string | null | undefined) => {
  const normalized = normalizeText(title);
  if (!normalized) return false;
  return (
    normalized.includes('placeholder') ||
    normalized.includes('place holder') ||
    normalized.includes('tbd') ||
    normalized.includes('temp scope')
  );
};

const dateKey = (value: unknown) => {
  if (!value) return "";

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? "" : formatDateKey(value);
  }

  const raw = String(value).trim();
  if (!raw) return "";

  // Accept both date-only and ISO-like date-time strings.
  const explicitDateMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (explicitDateMatch) return explicitDateMatch[1];

  const parsed = parseScopeDate(raw);
  if (parsed) return formatDateKey(parsed);

  return raw;
};

type ParsedTaskEntry = {
  name: string;
  startDate: string;
  days: number | null;
  manpower: number | null;
  yards: number | null;
  concreteConfirmed: boolean;
};
type ConcreteOrderSummary = {
  jobKey: string;
  date: string;
  totalYards: number;
};

type SelectedDayEntry = NonNullable<Scope["selectedDays"]>[number];

type HolidayApiRow = {
  isPaid?: boolean;
  date?: string;
};

type ScopeMetadataPayload = {
  jobKey: string;
  title: string;
  startDate: string;
  endDate: string;
  description: string;
  tasks: ScheduleTask[];
  schedulingMode: "contiguous" | "specific-days";
  selectedDays: SelectedDayEntry[];
  predecessorScopeId?: string | null;
  manpower?: number;
  hours?: number;
};

const LEGACY_TASK_REGEX = /^\[(.*?)\]\s*(.+)$/;

const toOptionalPositiveNumber = (value: unknown): number | null => {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric;
};

const toPositiveWholeDays = (value: unknown): number | null => {
  const numeric = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric);
};
const parseLegacyTaskNumericMetadata = (parts: string[]): { days: number | null; yards: number | null } => {
  const daysPart = parts.find((part) => /\d+\s*d$/i.test(part));
  const daysValue = daysPart ? Number(daysPart.replace(/[^0-9]/g, '')) : null;

  let yardsValue: number | null = null;
  for (const part of parts) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(part)) continue;
    if (/\d+\s*d$/i.test(part)) continue;
    const numericMatch = part.match(/(\d+(?:\.\d+)?)/);
    if (!numericMatch) continue;
    const candidate = Number.parseFloat(numericMatch[1]);
    if (!Number.isFinite(candidate) || candidate < 0) continue;
    yardsValue = candidate;
    break;
  }

  return {
    days: Number.isFinite(daysValue || 0) && (daysValue || 0) > 0 ? Number(daysValue) : null,
    yards: toOptionalPositiveNumber(yardsValue),
  };
};

const parseTaskEntry = (taskEntry: string | ScheduleTask): ParsedTaskEntry => {
  if (taskEntry && typeof taskEntry === 'object' && !Array.isArray(taskEntry)) {
    return {
      name: String(taskEntry.name || '').trim(),
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(taskEntry.startDate || '').trim()) ? String(taskEntry.startDate || '').trim() : '',
      days: toPositiveWholeDays(taskEntry.days),
      manpower: toOptionalPositiveNumber(taskEntry.manpower),
      yards: toOptionalPositiveNumber(taskEntry.yards),
      concreteConfirmed: Boolean(taskEntry.concreteConfirmed),
    };
  }

  const taskString = String(taskEntry || '').trim();
  const match = taskString.match(LEGACY_TASK_REGEX);
  if (!match) {
    return { name: taskString, startDate: '', days: null, manpower: null, yards: null, concreteConfirmed: false };
  }

  const prefix = match[1] || '';
  const name = (match[2] || '').trim();
  const parts = prefix.split('|').map((part) => part.trim());
  const startDate = parts.find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part)) || '';
  const { days, yards } = parseLegacyTaskNumericMetadata(parts);

  return {
    name,
    startDate,
    days,
    manpower: null,
    yards,
    concreteConfirmed: false,
  };
};

const formatTaskEntry = ({ name, startDate, days, manpower, yards, concreteConfirmed }: ParsedTaskEntry): ScheduleTask => {
  const taskName = String(name || '').trim();
  const parsedDays = toPositiveWholeDays(days);
  const parsedManpower = toOptionalPositiveNumber(manpower);
  const parsedYards = toOptionalPositiveNumber(yards);
  const hasYards = Number.isFinite(parsedYards || 0) && (parsedYards || 0) > 0;

  return {
    name: taskName,
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : '',
    days: parsedDays,
    manpower: parsedManpower,
    yards: parsedYards,
    concreteConfirmed: hasYards ? Boolean(concreteConfirmed) : false,
  };
};

const normalizeTaskEntries = (tasks: Array<string | ScheduleTask> | undefined | null): ScheduleTask[] => {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .map((task) => formatTaskEntry(parseTaskEntry(task)))
    .filter((task) => String(task.name || '').trim().length > 0);
};

const getTaskHours = (task: ScheduleTask): number => {
  const manpower = toOptionalPositiveNumber(task.manpower);
  const days = toPositiveWholeDays(task.days);
  if (!Number.isFinite(manpower || 0) || !Number.isFinite(days || 0)) return 0;
  if (!manpower || !days) return 0;
  return manpower * 10 * days;
};

const calculateTaskRollups = (tasks: ScheduleTask[]): { manpower: number; hours: number } => {
  const normalized = normalizeTaskEntries(tasks);
  const manpower = normalized.reduce((sum, task) => sum + (toOptionalPositiveNumber(task.manpower) || 0), 0);
  const hours = normalized.reduce((sum, task) => sum + getTaskHours(task), 0);
  return { manpower, hours };
};

const hasCompleteTaskInputs = (tasks: ScheduleTask[]): boolean => {
  const normalized = normalizeTaskEntries(tasks);
  if (normalized.length === 0) return false;
  return normalized.every((task) => {
    const manpower = toOptionalPositiveNumber(task.manpower);
    const days = toPositiveWholeDays(task.days);
    return Number.isFinite(manpower || 0) && Number.isFinite(days || 0) && (manpower || 0) > 0 && (days || 0) > 0;
  });
};

const calculateTaskDateRange = (tasks: Array<string | ScheduleTask>): { startDate: string; endDate: string } | null => {
  const datedTasks = tasks
    .map(parseTaskEntry)
    .filter((task) => /^\d{4}-\d{2}-\d{2}$/.test(task.startDate));

  if (datedTasks.length === 0) return null;

  let minStart: string | null = null;
  let maxEnd: string | null = null;

  datedTasks.forEach((task) => {
    const start = task.startDate;
    const base = new Date(`${start}T00:00:00`);
    if (isNaN(base.getTime())) return;

    const taskDays = Number.isFinite(task.days || 0) && (task.days || 0) > 0 ? Number(task.days) : 1;
    const endDate = new Date(base);
    endDate.setDate(endDate.getDate() + taskDays - 1);
    const end = formatDateKey(endDate);

    if (!minStart || start < minStart) minStart = start;
    if (!maxEnd || end > maxEnd) maxEnd = end;
  });

  if (!minStart || !maxEnd) return null;
  return { startDate: minStart, endDate: maxEnd };
};

const getTaskIdentityKey = (task: ScheduleTask): string => {
  const parsed = parseTaskEntry(task);
  return [
    String(parsed.name || '').trim().toLowerCase(),
    String(parsed.startDate || '').trim(),
    String(parsed.days ?? ''),
  ].join('|');
};

export function ProjectScopesModal({
  project,
  scopes,
  allScopes,
  companyCapacity = 210, // Default to 210 if not provided
  scheduledHoursByJobKeyDate,
  selectedScopeId,
  selectedTaskIndex = null,
  selectedScopeTitle,
  selectedScheduleDate,
  selectedScheduledHours,
  selectedForemanId,
  dayEditMode = false,
  allowLongTermAssignmentEditing = false,
  longTermAssignmentContext,
  onLongTermAssignmentSaved,
  onClose,
  onScopesUpdated,
}: ProjectScopesModalProps) {
  const isLongTermModalContext = Boolean(onLongTermAssignmentSaved);
  const usesLegacyScopeMetadata = useMemo(
    () => isGiantProjectName(project.projectName),
    [project.projectName]
  );
  const liveGanttProjectId = useMemo(
    () => {
      const candidate = String(project.projectDocId || "").trim();
      return UUID_REGEX.test(candidate) ? candidate : null;
    },
    [project.projectDocId]
  );
  const [activeScopeId, setActiveScopeId] = useState<string | null>(selectedScopeId);
  const [isCreatingNewScope, setIsCreatingNewScope] = useState(false);
  const [ganttProjectId, setGanttProjectId] = useState<string | null>(liveGanttProjectId);
  const [canonicalScopes, setCanonicalScopes] = useState<Scope[] | null>(null);
  const [isLoadingScopes, setIsLoadingScopes] = useState(true);
  const [projectBudgetHours, setProjectBudgetHours] = useState<number | null>(null);
  const [draggedScopeId, setDraggedScopeId] = useState<string | null>(null);
  const [draggedTaskIndex, setDraggedTaskIndex] = useState<number | null>(null);
  const [expandedScopeRows, setExpandedScopeRows] = useState<Set<string>>(new Set());

  const [scopeDetail, setScopeDetail] = useState<Partial<Scope>>({
    title: "",
    predecessorScopeId: null,
    startDate: "",
    endDate: "",
    description: "",
    tasks: [],
    schedulingMode: "contiguous",
    selectedDays: [],
  });
  const [isSaving, setIsSaving] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [newTaskDate, setNewTaskDate] = useState("");
  const [newTaskDays, setNewTaskDays] = useState("");
  const [newTaskManpower, setNewTaskManpower] = useState("");
  const [newTaskYards, setNewTaskYards] = useState("");
  const [concreteModalTarget, setConcreteModalTarget] = useState<{
    mode: "new-task" | "existing-task";
    taskIndex?: number;
    taskLabel?: string;
    date?: string;
    yards?: number | null;
  } | null>(null);
  const [concreteYardsByDate, setConcreteYardsByDate] = useState<Record<string, number>>({});
  const [newSelectedDayDate, setNewSelectedDayDate] = useState("");
  const [newSelectedDayHours, setNewSelectedDayHours] = useState("10");
  const formSectionRef = useRef<HTMLDivElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const taskRowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const previousActiveScopeIdRef = useRef<string | null>(selectedScopeId);
  const previousSelectionSignatureRef = useRef<string>(
    `${selectedScopeId || ''}|${selectedScopeTitle || ''}|${selectedScheduleDate || ''}`
  );
  const onScopesUpdatedRef = useRef(onScopesUpdated);
  const lastNotifiedScopesSignatureRef = useRef<string>('');
  const suppressPopulateEffectRef = useRef(false);
  const clearedScheduleScopeIdsRef = useRef<Set<string>>(new Set());
  const lastCanonicalLoadRequestKeyRef = useRef<string>('');
  const persistedScopesByJobKeyRef = useRef<Map<string, Scope[]>>(new Map());
  const ganttProjectsCacheRef = useRef<{ expiresAt: number; data: GanttProjectResponse[] | null }>({
    expiresAt: 0,
    data: null,
  });
  const paidHolidayLoadedRef = useRef(false);
  const paidHolidayLoadPromiseRef = useRef<Promise<void> | null>(null);
  const paidHolidaySetRef = useRef<Set<string>>(new Set());
  const [highlightedTaskIndex, setHighlightedTaskIndex] = useState<number | null>(null);
  const [assignmentPmSelection, setAssignmentPmSelection] = useState<string>(
    longTermAssignmentContext?.pmSelectionId || ''
  );
  const [assignmentForemanSelection, setAssignmentForemanSelection] = useState<string>(
    longTermAssignmentContext?.foremanSelectionId || '__unassigned__'
  );
  const [savingAssignmentPm, setSavingAssignmentPm] = useState(false);
  const [savingAssignmentForeman, setSavingAssignmentForeman] = useState(false);
  const [autoLongTermAssignmentContext, setAutoLongTermAssignmentContext] = useState<LongTermAssignmentContext | null>(null);
  const [hasManualDateOverride, setHasManualDateOverride] = useState(false);

  const emptyScopeDetail = useMemo<Partial<Scope>>(() => ({
    title: "",
    predecessorScopeId: null,
    startDate: "",
    endDate: "",
    manpower: undefined,
    hours: undefined,
    description: "",
    tasks: [],
    schedulingMode: "contiguous",
    selectedDays: [],
  }), []);

  useEffect(() => {
    const assignmentContext = longTermAssignmentContext || autoLongTermAssignmentContext;
    setAssignmentPmSelection(assignmentContext?.pmSelectionId || '');
    setAssignmentForemanSelection(assignmentContext?.foremanSelectionId || '__unassigned__');
  }, [autoLongTermAssignmentContext, longTermAssignmentContext]);

  const handleLongTermPmChange = async (nextPmSelection: string) => {
    const assignmentContext = longTermAssignmentContext || autoLongTermAssignmentContext;
    if (!assignmentContext) return;
    if (!nextPmSelection || nextPmSelection === '__project_default__') {
      setAssignmentPmSelection('');
      return;
    }

    try {
      setSavingAssignmentPm(true);

      const response = await fetch('/api/long-term-schedule/pm-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentKey: assignmentContext.assignmentKey,
          jobKey: assignmentContext.jobKey,
          pmId: nextPmSelection,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || 'Failed to save PM assignment');
      }

      setAssignmentPmSelection(nextPmSelection);
      if (onLongTermAssignmentSaved) {
        void Promise.resolve(onLongTermAssignmentSaved()).catch((refreshError) => {
          console.error('Failed to refresh after long-term PM assignment save:', refreshError);
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save PM assignment';
      console.error('Failed to save long-term PM assignment:', error);
      alert(message);
    } finally {
      setSavingAssignmentPm(false);
    }
  };

  const handleLongTermForemanChange = async (nextForemanSelection: string) => {
    const assignmentContext = longTermAssignmentContext || autoLongTermAssignmentContext;
    if (!assignmentContext) return;

    const weekRange = selectedScheduleDate ? getWeekRangeFromDateKey(selectedScheduleDate) : null;

    try {
      setSavingAssignmentForeman(true);

      const response = await fetch('/api/gantt-v2/long-term/assign', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobKey: assignmentContext.jobKey,
          scopeOfWork: assignmentContext.scopeOfWork,
          foreman: nextForemanSelection === '__unassigned__' ? null : nextForemanSelection,
          applyAcrossProject: true,
          weekStart: weekRange?.weekStart,
          weekEnd: weekRange?.weekEnd,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.success || Number(result?.data?.updatedCount || 0) < 1) {
        throw new Error(result?.error || 'Failed to save foreman assignment');
      }

      setAssignmentForemanSelection(nextForemanSelection);
      if (onLongTermAssignmentSaved) {
        void Promise.resolve(onLongTermAssignmentSaved()).catch((refreshError) => {
          console.error('Failed to refresh after long-term foreman assignment save:', refreshError);
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save foreman assignment';
      console.error('Failed to save long-term foreman assignment:', error);
      alert(message);
    } finally {
      setSavingAssignmentForeman(false);
    }
  };

  const matchesProjectIdentity = useCallback((
    item: { customer?: string | null; projectNumber?: string | null; projectName?: string | null }
  ) => {
    const normalizedItemCustomer = normalizeText(item.customer);
    const normalizedProjectCustomer = normalizeText(project.customer);
    const normalizedItemNumber = normalizeText(item.projectNumber);
    const normalizedProjectNumber = normalizeText(project.projectNumber);
    const normalizedItemName = normalizeText(item.projectName);
    const normalizedProjectName = normalizeText(project.projectName);

    const customerMatch =
      normalizedItemCustomer === normalizedProjectCustomer ||
      normalizedItemCustomer.includes(normalizedProjectCustomer) ||
      normalizedProjectCustomer.includes(normalizedItemCustomer);

    const nameMatch =
      normalizedItemName === normalizedProjectName ||
      normalizedItemName.includes(normalizedProjectName) ||
      normalizedProjectName.includes(normalizedItemName);

    const projectNumberMatch =
      !normalizedProjectNumber ||
      !normalizedItemNumber ||
      normalizedItemNumber === normalizedProjectNumber;

    return customerMatch && nameMatch && projectNumberMatch;
  }, [project.customer, project.projectName, project.projectNumber]);

  const identityFallbackScopes = useMemo(() => {
    if (scopes.length > 0) return scopes;
    if (!allScopes) return scopes;

    const matched = Object.entries(allScopes).find(([jobKey]) => {
      const [customer = "", projectNumber = "", projectName = ""] = String(jobKey).split("~");
      return matchesProjectIdentity({ customer, projectNumber, projectName });
    });

    return matched ? matched[1] : scopes;
  }, [allScopes, scopes, matchesProjectIdentity]);

  const resolvedJobKey = useMemo(() => {
    const explicit = (project.jobKey || '').trim();
    if (explicit) return explicit;

    const customer = (project.customer || '').trim();
    const projectNumber = (project.projectNumber || '').trim();
    const projectName = (project.projectName || '').trim();
    if (!projectName) return '';

    return `${customer}~${projectNumber}~${projectName}`;
  }, [project.customer, project.jobKey, project.projectName, project.projectNumber]);

  const canonicalLoadRequestKey = useMemo(() => {
    const customerKey = normalizeText(project.customer || '');
    const projectNumberKey = normalizeText(project.projectNumber || '');
    const projectNameKey = normalizeText(project.projectName || '');
    return [
      (resolvedJobKey || '').trim(),
      (liveGanttProjectId || '').trim(),
      customerKey,
      projectNumberKey,
      projectNameKey,
    ].join('|');
  }, [liveGanttProjectId, project.customer, project.projectName, project.projectNumber, resolvedJobKey]);

  const concreteProjectRef = useMemo<ConcreteOrderProjectRef>(() => ({
    jobKey: resolvedJobKey || project.jobKey,
    projectName: project.projectName,
    customer: project.customer,
    projectNumber: project.projectNumber,
  }), [project.customer, project.jobKey, project.projectName, project.projectNumber, resolvedJobKey]);

  useEffect(() => {
    setCanonicalScopes(null);
    setIsLoadingScopes(true);
    setGanttProjectId(liveGanttProjectId);
    lastNotifiedScopesSignatureRef.current = '';
  }, [liveGanttProjectId, resolvedJobKey]);

  useEffect(() => {
    onScopesUpdatedRef.current = onScopesUpdated;
  }, [onScopesUpdated]);

  useEffect(() => {
    if (activeScopeId && activeScopeId !== NEW_SCOPE_ID) {
      previousActiveScopeIdRef.current = activeScopeId;
    }
  }, [activeScopeId]);

  useEffect(() => {
    const effectiveJobKey = (resolvedJobKey || project.jobKey || '').trim();
    if (!effectiveJobKey) {
      setConcreteYardsByDate({});
      return;
    }

    let cancelled = false;
    const loadConcreteOrders = async () => {
      try {
        const response = await fetch(`/api/project-schedule/concrete-yards?jobKey=${encodeURIComponent(effectiveJobKey)}`, { cache: 'no-store' });
        if (!response.ok) {
          if (!cancelled) setConcreteYardsByDate({});
          return;
        }
        const json = await response.json().catch(() => ({}));
        const rows = Array.isArray(json?.data) ? (json.data as ConcreteOrderSummary[]) : [];
        const byDate = rows.reduce<Record<string, number>>((acc, row) => {
            const dateKey = String(row?.date || '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return acc;
            const yards = Number(row?.totalYards || 0);
            if (!Number.isFinite(yards) || yards <= 0) return acc;
            acc[dateKey] = (acc[dateKey] || 0) + yards;
            return acc;
          }, {});

        if (!cancelled) {
          setConcreteYardsByDate(byDate);
        }
      } catch {
        if (!cancelled) setConcreteYardsByDate({});
      }
    };

    void loadConcreteOrders();

    return () => {
      cancelled = true;
    };
  }, [project.jobKey, resolvedJobKey]);

  const scopeMatchKey = useCallback((title: unknown, startDate: unknown, endDate: unknown) =>
    `${normalizeText(String(title || ""))}|${dateKey(startDate)}|${dateKey(endDate)}`,
  []);
  const scopeMatchesSelectedDate = useCallback((scope: Partial<Scope>, targetDate: string | null | undefined) => {
    const date = dateKey(targetDate);
    if (!date) return false;

    if (scope.schedulingMode === 'specific-days' && Array.isArray(scope.selectedDays)) {
      return scope.selectedDays.some((entry) => dateKey(entry?.date) === date);
    }

    const start = dateKey(scope.startDate);
    const end = dateKey(scope.endDate);
    if (!start && !end) return false;
    const rangeStart = start || date;
    const rangeEnd = end || date;
    return date >= rangeStart && date <= rangeEnd;
  }, []);

  // Never let a failed canonical lookup hide already-known scopes from the grid.
  const effectiveScopes =
    canonicalScopes && canonicalScopes.length > 0 ? canonicalScopes : identityFallbackScopes;

  const visibleScopes = useMemo(() => {
    const baseScopes = effectiveScopes.filter(
      (scope) =>
        !scope.id?.startsWith('fallback-') &&
        !scope.id?.startsWith('virtual-') &&
        !scope.id?.startsWith('generated-')
    );
    const activeDraftTaskRange = calculateTaskDateRange(normalizeTaskEntries(scopeDetail.tasks));
    const baseScopesWithActiveDraft = baseScopes.map((scope) => {
      if (isCreatingNewScope || !activeScopeId || scope.id !== activeScopeId) return scope;

      const draftStartDate = hasManualDateOverride
        ? (scopeDetail.startDate || "")
        : (activeDraftTaskRange?.startDate || scopeDetail.startDate || "");
      const draftEndDate = hasManualDateOverride
        ? (scopeDetail.endDate || "")
        : (activeDraftTaskRange?.endDate || scopeDetail.endDate || "");
      const draftTasks = Array.isArray(scopeDetail.tasks) ? scopeDetail.tasks : [];
      const draftSelectedDays = Array.isArray(scopeDetail.selectedDays) ? scopeDetail.selectedDays : [];
      const draftHours = computeScopeHours(scopeDetail);

      return {
        ...scope,
        title: scopeDetail.title?.trim() || scope.title,
        startDate: draftStartDate,
        endDate: draftEndDate,
        manpower: scopeDetail.manpower,
        hours: draftHours > 0 ? draftHours : scopeDetail.hours,
        description: scopeDetail.description || '',
        tasks: draftTasks,
        schedulingMode: scopeDetail.schedulingMode === 'specific-days' ? 'specific-days' : 'contiguous',
        selectedDays: draftSelectedDays,
      } as Scope;
    });

    if (!isCreatingNewScope) return baseScopesWithActiveDraft;

    return [
      {
        id: NEW_SCOPE_ID,
        jobKey: resolvedJobKey || project.jobKey,
        title: scopeDetail.title?.trim() || 'New Scope',
        startDate: scopeDetail.startDate || '',
        endDate: scopeDetail.endDate || '',
        manpower: scopeDetail.manpower,
        hours: computeScopeHours(scopeDetail),
        description: scopeDetail.description || '',
        tasks: Array.isArray(scopeDetail.tasks) ? scopeDetail.tasks : [],
        schedulingMode: scopeDetail.schedulingMode === 'specific-days' ? 'specific-days' : 'contiguous',
        selectedDays: Array.isArray(scopeDetail.selectedDays) ? scopeDetail.selectedDays : [],
      } as Scope,
      ...baseScopesWithActiveDraft,
    ];
  }, [activeScopeId, effectiveScopes, hasManualDateOverride, isCreatingNewScope, project.jobKey, resolvedJobKey, scopeDetail]);

  const activeScopeTitleForAssignment = useMemo(() => {
    if (activeScopeId) {
      const activeScope = effectiveScopes.find((scope) => scope.id === activeScopeId);
      const title = String(activeScope?.title || '').trim();
      if (title) return title;
    }

    const detailTitle = String(scopeDetail.title || '').trim();
    if (detailTitle) return detailTitle;

    return String(selectedScopeTitle || '').trim();
  }, [activeScopeId, effectiveScopes, scopeDetail.title, selectedScopeTitle]);

  const effectiveLongTermAssignmentContext = useMemo(
    () => longTermAssignmentContext || autoLongTermAssignmentContext,
    [autoLongTermAssignmentContext, longTermAssignmentContext]
  );

  useEffect(() => {
    if (longTermAssignmentContext) {
      setAutoLongTermAssignmentContext(null);
      return;
    }

    const jobKey = String(resolvedJobKey || project.jobKey || '').trim();
    const scopeOfWork = activeScopeTitleForAssignment;
    if (!jobKey) {
      setAutoLongTermAssignmentContext(null);
      return;
    }

    let cancelled = false;
    const loadAssignmentContext = async () => {
      try {
        const [employeesRes, pmAssignmentsRes, projectsRes, activeScheduleRes] = await Promise.all([
          fetch('/api/short-term-schedule?action=employees', { cache: 'no-store' }),
          fetch('/api/long-term-schedule/pm-assignments', { cache: 'no-store' }),
          fetch('/api/projects?page=1&pageSize=500', { cache: 'no-store' }),
          fetch('/api/short-term-schedule?action=active-schedule', { cache: 'no-store' }),
        ]);

        const employeesJson = await employeesRes.json().catch(() => ({}));
        const pmAssignmentsJson = await pmAssignmentsRes.json().catch(() => ({}));
        const projectsJson = await projectsRes.json().catch(() => ({}));
        const activeScheduleJson = await activeScheduleRes.json().catch(() => ({}));

        const employees = Array.isArray(employeesJson?.data) ? employeesJson.data : [];
        const pmAssignments = Array.isArray(pmAssignmentsJson?.data) ? pmAssignmentsJson.data : [];
        const projects = Array.isArray(projectsJson?.data) ? projectsJson.data : [];
        const activeSchedule = Array.isArray(activeScheduleJson?.data) ? activeScheduleJson.data : [];

        const pmOptions: AssignmentOption[] = employees
          .filter((employee) => employee?.isActive && PM_TITLES.includes(String(employee?.jobTitle || '')))
          .map((employee) => ({
            id: String(employee.id),
            label: `${String(employee.firstName || '').trim()} ${String(employee.lastName || '').trim()}`.trim() || 'Unnamed PM',
          }));

        const foremanOptions: AssignmentOption[] = employees
          .filter((employee) => employee?.isActive && isForemanRole(String(employee?.jobTitle || '')))
          .map((employee) => ({
            id: String(employee.id),
            label: `${String(employee.firstName || '').trim()} ${String(employee.lastName || '').trim()}`.trim() || 'Unnamed Foreman',
          }));

        const projectPmAssignment = pmAssignments.find((entry) =>
          String(entry?.assignmentKey || '').trim() === jobKey ||
          String(entry?.jobKey || '').trim() === jobKey
        );
        const matchingProject = projects.find((row) => {
          const rowJobKey = `${String(row?.customer || '')}~${String(row?.projectNumber || '')}~${String(row?.projectName || '')}`;
          return rowJobKey === jobKey;
        });
        const projectDefaultPMName = String(matchingProject?.projectManager || project?.projectManager || '').trim() || 'Project Default';
        // Check if projectDefaultPMName is actually a PM ID (valid in pmOptions)
        let projectDefaultPmId = pmOptions.find((pm) => pm.id === projectDefaultPMName)?.id;
        // If not found as ID, try matching by name
        if (!projectDefaultPmId) {
          projectDefaultPmId = pmOptions.find(
            (pm) => pm.label.trim().toLowerCase() === projectDefaultPMName.toLowerCase()
          )?.id;
        }

        const pmSelectionId = projectPmAssignment?.pmId || projectDefaultPmId || '';

        const matchingEntries = scopeOfWork
          ? activeSchedule.filter((entry) =>
              String(entry?.jobKey || '').trim() === jobKey &&
              String(entry?.scopeOfWork || '').trim() === scopeOfWork &&
              String(entry?.foreman || '').trim().length > 0
            )
          : [];

        const foremanCounts = matchingEntries.reduce((acc: Record<string, number>, entry) => {
          const foremanId = String(entry?.foreman || '').trim();
          if (!foremanId) return acc;
          acc[foremanId] = (acc[foremanId] || 0) + 1;
          return acc;
        }, {});

        const foremanSelectionId =
          (selectedForemanId && selectedForemanId !== '__unassigned__' ? selectedForemanId : null) ||
          Object.entries(foremanCounts).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] ||
          '__unassigned__';

        if (!cancelled) {
          setAutoLongTermAssignmentContext({
            assignmentKey: jobKey,
            jobKey,
            scopeOfWork: scopeOfWork || '',
            pmSelectionId,
            projectDefaultPMName,
            foremanSelectionId,
            pmOptions,
            foremanOptions,
          });
        }
      } catch {
        if (!cancelled) {
          setAutoLongTermAssignmentContext(null);
        }
      }
    };

    void loadAssignmentContext();

    return () => {
      cancelled = true;
    };
  }, [
    activeScopeTitleForAssignment,
    longTermAssignmentContext,
    project.jobKey,
    project.projectManager,
    resolvedJobKey,
    selectedForemanId,
  ]);

  const getEffectiveScopeHours = useCallback((scope: Partial<Scope>) => {
    const scopeHours = computeScopeHours(scope);
    if (scopeHours > 0) return scopeHours;

    // If this project is effectively single-scope and scope hours are missing,
    // fall back to schedule-level budgeted hours from the scheduling/WIP chain.
    if ((effectiveScopes?.length || 0) <= 1 && projectBudgetHours && projectBudgetHours > 0) {
      return projectBudgetHours;
    }

    return 0;
  }, [effectiveScopes?.length, projectBudgetHours]);

  const shouldExcludePlaceholderScopeHours = useMemo(() => {
    const explicitBudgetHours = Number(projectBudgetHours || 0);
    if (Number.isFinite(explicitBudgetHours) && explicitBudgetHours > 0) {
      return true;
    }

    const realScopeBudgetHours = effectiveScopes.reduce((sum, scope) => {
      if (isPlaceholderScopeTitle(scope.title)) return sum;
      return sum + getEffectiveScopeHours(scope);
    }, 0);

    return realScopeBudgetHours > 0;
  }, [effectiveScopes, getEffectiveScopeHours, projectBudgetHours]);

  const getDisplayedScopeHours = useCallback((scope: Partial<Scope>) => {
    if (shouldExcludePlaceholderScopeHours && isPlaceholderScopeTitle(scope.title)) {
      return 0;
    }

    return getEffectiveScopeHours(scope);
  }, [getEffectiveScopeHours, shouldExcludePlaceholderScopeHours]);

  const displayedTotalBudgetedHours = useMemo(() => {
    const explicitBudgetHours = Number(projectBudgetHours || 0);
    if (Number.isFinite(explicitBudgetHours) && explicitBudgetHours > 0) {
      return explicitBudgetHours;
    }

    const realScopeBudgetHours = effectiveScopes.reduce((sum, scope) => sum + getDisplayedScopeHours(scope), 0);

    if (realScopeBudgetHours > 0) {
      return realScopeBudgetHours;
    }

    // If no real/explicit budget exists yet, allow placeholder scopes to drive planning totals.
    return effectiveScopes.reduce((sum, scope) => sum + getEffectiveScopeHours(scope), 0);
  }, [effectiveScopes, getDisplayedScopeHours, getEffectiveScopeHours, projectBudgetHours]);

  const mapGanttScopes = useCallback((rows: NonNullable<GanttProjectResponse["scopes"]>): Scope[] =>
    rows.map((scope) => ({
      id: scope.id,
      predecessorScopeId: scope.predecessorScopeId || null,
      jobKey: resolvedJobKey || project.jobKey,
      title: scope.title,
      startDate: scope.startDate || "",
      endDate: scope.endDate || "",
      manpower: scope.crewSize ?? undefined,
      hours: Number(scope.totalHours || 0),
      description: scope.notes || "",
      tasks: [],
      schedulingMode: "contiguous",
      selectedDays: [],
    })), [project.jobKey, resolvedJobKey]);

  const loadPersistedProjectScopes = useCallback(async (): Promise<Scope[]> => {
    const effectiveJobKey = (resolvedJobKey || '').trim();
    if (!effectiveJobKey) return [];

    const cached = persistedScopesByJobKeyRef.current.get(effectiveJobKey);
    if (cached) {
      return cached;
    }

    const projectScopesRes = await fetch(`/api/project-scopes?jobKey=${encodeURIComponent(effectiveJobKey)}`);
    if (!projectScopesRes.ok) return [];

    const projectScopesJson = await readJsonResponse<{ data?: Scope[]; scopes?: Scope[] }>(projectScopesRes, {
      label: "Project scopes",
      fallback: { data: [], scopes: [] },
    });

    const persistedScopes: Scope[] = Array.isArray(projectScopesJson?.data)
      ? projectScopesJson.data
      : (Array.isArray(projectScopesJson?.scopes) ? projectScopesJson.scopes : []);

    persistedScopesByJobKeyRef.current.set(effectiveJobKey, persistedScopes);
    return persistedScopes;
  }, [resolvedJobKey]);

  const mergePersistedScopeMetadata = useCallback(async (scopes: Scope[]): Promise<Scope[]> => {
    try {
      const persistedScopes = await loadPersistedProjectScopes();
      if (persistedScopes.length === 0) {
        return scopes;
      }

      const persistedByComposite = new Map<string, Scope[]>();
      const persistedByTitle = new Map<string, Scope[]>();
      persistedScopes.forEach((scope) => {
        const titleKey = normalizeText(scope?.title || '');
        if (!titleKey) return;

        const compositeKey = scopeMatchKey(scope.title, scope.startDate, scope.endDate);
        const compositeBucket = persistedByComposite.get(compositeKey) || [];
        compositeBucket.push(scope);
        persistedByComposite.set(compositeKey, compositeBucket);

        const titleBucket = persistedByTitle.get(titleKey) || [];
        titleBucket.push(scope);
        persistedByTitle.set(titleKey, titleBucket);
      });

      const mergedCanonicalScopes = scopes.map((scope) => {
        const compositeMatches = persistedByComposite.get(scopeMatchKey(scope.title, scope.startDate, scope.endDate)) || [];
        const titleMatches = persistedByTitle.get(normalizeText(scope.title || '')) || [];
        const persisted =
          compositeMatches[0] ||
          (titleMatches.length === 1 ? titleMatches[0] : undefined);

        if (!persisted) return scope;

        const persistedHours = toOptionalPositiveNumber(persisted.hours);
        const persistedManpower = toOptionalPositiveNumber(persisted.manpower);

        return {
          ...scope,
          hours: persistedHours !== null ? persistedHours : scope.hours,
          manpower: persistedManpower !== null ? persistedManpower : scope.manpower,
          description: persisted.description || scope.description || '',
          tasks: Array.isArray(persisted.tasks) ? persisted.tasks : (scope.tasks || []),
          schedulingMode: persisted.schedulingMode === 'specific-days' ? 'specific-days' : (scope.schedulingMode || 'contiguous'),
          selectedDays: Array.isArray(persisted.selectedDays) ? persisted.selectedDays : (scope.selectedDays || []),
          color: persisted.color || scope.color || null,
          taskColors: (persisted.taskColors && typeof persisted.taskColors === 'object' ? persisted.taskColors : null) || scope.taskColors || null,
        };
      });

      // Also surface persisted scopes that do not exist in canonical Gantt rows yet
      // (for example newly created practice scopes saved via /api/project-scopes).
      const canonicalCompositeKeys = new Set(
        mergedCanonicalScopes.map((scope) => scopeMatchKey(scope.title, scope.startDate, scope.endDate))
      );
      const canonicalTitleKeys = new Set(
        mergedCanonicalScopes
          .map((scope) => normalizeText(scope?.title || ''))
          .filter(Boolean)
      );

      const bestCanonicalScoreByTitle = new Map<string, number>();
      mergedCanonicalScopes.forEach((scope) => {
        const titleKey = normalizeText(scope?.title || '');
        if (!titleKey) return;
        const score = getScopeRichnessScore(scope);
        const previous = bestCanonicalScoreByTitle.get(titleKey) ?? -1;
        if (score > previous) {
          bestCanonicalScoreByTitle.set(titleKey, score);
        }
      });

      const persistedOnlyScopes = persistedScopes
        .filter((scope) => {
          const titleKey = normalizeText(scope?.title || '');
          if (!titleKey) return false;

          const compositeKey = scopeMatchKey(scope.title, scope.startDate, scope.endDate);
          if (canonicalCompositeKeys.has(compositeKey)) return false;
          if (canonicalTitleKeys.has(titleKey)) return false;

          // Suppress stale duplicates (same title, weaker metadata) when a richer
          // canonical scope with that title already exists.
          const bestCanonicalScore = bestCanonicalScoreByTitle.get(titleKey);
          if (typeof bestCanonicalScore === 'number') {
            const persistedScore = getScopeRichnessScore(scope);
            if (persistedScore <= bestCanonicalScore) {
              return false;
            }
          }

          return true;
        })
        .map((scope) => {
          const persistedHours = toOptionalPositiveNumber(scope.hours);
          const persistedManpower = toOptionalPositiveNumber(scope.manpower);

          return {
            id: scope.id,
            predecessorScopeId: scope.predecessorScopeId || null,
            jobKey: scope.jobKey || resolvedJobKey || project.jobKey,
            title: scope.title || 'Scope',
            startDate: scope.startDate || '',
            endDate: scope.endDate || '',
            manpower: persistedManpower !== null ? persistedManpower : undefined,
            hours: persistedHours !== null ? persistedHours : 0,
            description: scope.description || '',
            tasks: Array.isArray(scope.tasks) ? scope.tasks : [],
            schedulingMode: scope.schedulingMode === 'specific-days' ? 'specific-days' : 'contiguous',
            selectedDays: Array.isArray(scope.selectedDays) ? scope.selectedDays : [],
            color: scope.color || null,
            taskColors: (scope.taskColors && typeof scope.taskColors === 'object' ? scope.taskColors : null) || null,
          } as Scope;
        });

      const dedupedScopes = new Map<string, Scope>();
      const dedupeScope = (scope: Scope) => {
        const titleKey = normalizeText(scope.title || '');
        const compositeKey = scopeMatchKey(scope.title, scope.startDate, scope.endDate);
        const displayKey = compositeKey || titleKey;
        if (!displayKey) return;

        const existing = dedupedScopes.get(displayKey);
        if (!existing) {
          dedupedScopes.set(displayKey, scope);
          return;
        }

        if (getScopeRichnessScore(scope) > getScopeRichnessScore(existing)) {
          dedupedScopes.set(displayKey, scope);
        }
      };

      mergedCanonicalScopes.forEach(dedupeScope);
      persistedOnlyScopes.forEach(dedupeScope);

      return Array.from(dedupedScopes.values());
    } catch (error) {
      console.warn('Failed to merge project-scope metadata into canonical scopes:', error);
      return scopes;
    }
  }, [loadPersistedProjectScopes, project.jobKey, resolvedJobKey, scopeMatchKey]);

  const loadScopesForGanttProject = useCallback(async (projectId: string): Promise<Scope[] | null> => {
    const response = await fetch(`/api/gantt-v2/projects/${projectId}/scopes`);
    const result = await readJsonResponse<{ success?: boolean; data?: NonNullable<GanttProjectResponse["scopes"]> }>(response, {
      label: "Gantt V2 project scopes",
      fallback: { success: false, data: [] },
    });

    if (!response.ok || !result?.success || !Array.isArray(result?.data)) {
      return null;
    }

    const mergedScopes = await mergePersistedScopeMetadata(mapGanttScopes(result.data));
    setGanttProjectId(projectId);
    setCanonicalScopes(mergedScopes);
    return mergedScopes;
  }, [mapGanttScopes, mergePersistedScopeMetadata]);

  const loadGanttProjectsList = useCallback(
    async (forceRefresh = false): Promise<GanttProjectResponse[] | null> => {
      const now = Date.now();
      const cache = ganttProjectsCacheRef.current;
      if (!forceRefresh && cache.data && cache.expiresAt > now) {
        return cache.data;
      }

      const response = await fetch('/api/gantt-v2/projects');
      const result = await readJsonResponse<{ success?: boolean; data?: GanttProjectResponse[] }>(response, {
        label: 'Gantt V2 projects',
        fallback: { success: false, data: [] },
      });

      if (!response.ok || !result?.success || !Array.isArray(result?.data)) {
        return null;
      }

      const data = result.data as GanttProjectResponse[];
      ganttProjectsCacheRef.current = {
        data,
        expiresAt: now + 10_000,
      };
      return data;
    },
    []
  );

  const loadCanonicalScopes = useCallback(async (): Promise<Scope[] | null> => {
    const preferredProjectId = ganttProjectId || liveGanttProjectId;

    if (preferredProjectId) {
      const projectScopes = await loadScopesForGanttProject(preferredProjectId);
      if (projectScopes) {
        return projectScopes;
      }
    }

    const projects = await loadGanttProjectsList();
    if (!projects) {
      setGanttProjectId(null);
      setCanonicalScopes(null);
      return null;
    }

    const match = projects.find((item) =>
      matchesProjectIdentity({
        customer: item.customer,
        projectNumber: item.projectNumber,
        projectName: item.projectName,
      })
    );

    if (!match) {
      setGanttProjectId(null);
      // No Gantt project match – still surface any persisted-only scopes
      // (e.g. scopes created via /api/project-scopes with no Gantt entry).
      const persistedFallback = await mergePersistedScopeMetadata([]);
      if (persistedFallback.length > 0) {
        setCanonicalScopes(persistedFallback);
        return persistedFallback;
      }
      setCanonicalScopes(null);
      return null;
    }

    const mergedScopes = await mergePersistedScopeMetadata(mapGanttScopes(match.scopes || []));
    setGanttProjectId(match.id);
    setCanonicalScopes(mergedScopes);
    return mergedScopes;
  }, [ganttProjectId, liveGanttProjectId, loadGanttProjectsList, loadScopesForGanttProject, mapGanttScopes, matchesProjectIdentity, mergePersistedScopeMetadata]);

  const resolveWritableGanttProjectId = useCallback(async (): Promise<string | null> => {
    const preferredCandidates = [ganttProjectId, liveGanttProjectId]
      .map((id) => String(id || '').trim())
      .filter((id): id is string => Boolean(id));

    // Fast path: if we already have a UUID-like project id, use it directly.
    const directCandidate = preferredCandidates.find((id) => UUID_REGEX.test(id));
    if (directCandidate) {
      if (ganttProjectId !== directCandidate) {
        setGanttProjectId(directCandidate);
      }
      return directCandidate;
    }

    const projects = await loadGanttProjectsList();
    if (!projects) {
      return null;
    }

    const candidateIds = preferredCandidates;
    const existingProjectIds = new Set(projects.map((item) => String(item.id || '').trim()).filter(Boolean));

    for (const candidateId of candidateIds) {
      if (!existingProjectIds.has(candidateId)) continue;
      if (ganttProjectId !== candidateId) {
        setGanttProjectId(candidateId);
      }
      return candidateId;
    }

    const matchedProject = projects.find((item) =>
      matchesProjectIdentity({
        customer: item.customer,
        projectNumber: item.projectNumber,
        projectName: item.projectName,
      })
    );

    if (!matchedProject?.id) {
      const createRes = await fetch('/api/gantt-v2/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: project.projectName || parseJobKeyParts(project.jobKey).projectName,
          customer: project.customer || parseJobKeyParts(project.jobKey).customer || null,
          projectNumber: project.projectNumber || parseJobKeyParts(project.jobKey).projectNumber || null,
          status: 'In Progress',
        }),
      });

      const createResult = await readJsonResponse<{ success?: boolean; data?: { id?: string | null } }>(createRes, {
        label: 'Create writable Gantt project',
        fallback: { success: false, data: { id: null } },
      });

      if (!createRes.ok || !createResult?.success || !createResult?.data?.id) {
        return null;
      }

      const newProjectId = String(createResult.data.id).trim();
      ganttProjectsCacheRef.current = { expiresAt: 0, data: null };
      setGanttProjectId(newProjectId);
      return newProjectId;
    }

    setGanttProjectId(matchedProject.id);
    return matchedProject.id;
  }, [ganttProjectId, liveGanttProjectId, loadGanttProjectsList, matchesProjectIdentity, project.customer, project.jobKey, project.projectName, project.projectNumber]);

  const sanitizePredecessorScopeId = useCallback(
    async (projectId: string, predecessorId: string | null | undefined, currentScopeId?: string | null) => {
      if (!isCanonicalScopeId(predecessorId)) return null;

      const candidate = String(predecessorId).trim();
      if (!candidate) return null;
      if (currentScopeId && candidate === currentScopeId) return null;

      // Always validate against the target project's backend scopes so cached modal state
      // from a previously opened project cannot leak a cross-project predecessor id.
      const response = await fetch(`/api/gantt-v2/projects/${projectId}/scopes`);
      const result = await readJsonResponse<{ success?: boolean; data?: Array<{ id?: string | null }> }>(response, {
        label: "Validate predecessor scope",
        fallback: { success: false, data: [] },
      });

      if (!response.ok || !result?.success || !Array.isArray(result?.data)) {
        return null;
      }

      const existsInProject = result.data.some((scope) => String(scope?.id || "").trim() === candidate);
      return existsInProject ? candidate : null;
    },
    []
  );

  const upsertProjectScopeMetadata = async (
    payload: ScopeMetadataPayload,
    options?: { activeScope?: Scope | null }
  ) => {
    const titleKey = normalizeText(payload?.title || '');
    if (!titleKey) return;

    if (!resolvedJobKey) return;

    const response = await fetch(`/api/project-scopes?jobKey=${encodeURIComponent(resolvedJobKey)}`);
    const result = await response.json().catch(() => ({}));
    const projectScopes: Scope[] = Array.isArray(result?.data)
      ? result.data
      : (Array.isArray(result?.scopes) ? result.scopes : []);

    const activeScope = options?.activeScope || null;
    const payloadStartDate = dateKey(payload?.startDate);
    const payloadEndDate = dateKey(payload?.endDate);
    const activeStartDate = dateKey(activeScope?.startDate);
    const activeEndDate = dateKey(activeScope?.endDate);

    const titleMatches = projectScopes.filter((scope) => normalizeText(scope?.title || '') === titleKey);

    let existing: Scope | undefined;

    if (activeScope?.id) {
      existing = projectScopes.find((scope) => scope.id === activeScope.id);
    }

    if (!existing && activeScope) {
      const dateOnlyMatches = projectScopes.filter(
        (scope) =>
          dateKey(scope.startDate) === activeStartDate &&
          dateKey(scope.endDate) === activeEndDate
      );

      // If exactly one persisted row matches the active scope dates, treat it as the same scope
      // even when the title has been edited (e.g., "Scope" -> "Place Holder").
      if (dateOnlyMatches.length === 1) {
        existing = dateOnlyMatches[0];
      }
    }

    if (!existing && activeScope) {
      existing = titleMatches.find(
        (scope) =>
          dateKey(scope.startDate) === activeStartDate &&
          dateKey(scope.endDate) === activeEndDate
      );
    }

    if (!existing && (payloadStartDate || payloadEndDate)) {
      existing = titleMatches.find(
        (scope) =>
          dateKey(scope.startDate) === payloadStartDate &&
          dateKey(scope.endDate) === payloadEndDate
      );
    }

    if (!existing && titleMatches.length === 1) {
      existing = titleMatches[0];
    }

    if (existing?.id) {
      const updateRes = await fetch('/api/project-scopes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobKey: resolvedJobKey,
          id: existing.id,
          ...payload,
          syncToActiveSchedule: false,
        }),
      });
      const updateResult = await updateRes.json().catch(() => ({}));
      if (!updateRes.ok || !updateResult?.success) {
        throw new Error(updateResult?.error || 'Failed to update scope metadata');
      }
      persistedScopesByJobKeyRef.current.delete(resolvedJobKey);
      return;
    }

    const createRes = await fetch('/api/project-scopes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobKey: resolvedJobKey,
        ...payload,
        syncToActiveSchedule: false,
      }),
    });
    const createResult = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !createResult?.success) {
      throw new Error(createResult?.error || 'Failed to create scope metadata');
    }
    persistedScopesByJobKeyRef.current.delete(resolvedJobKey);
  };

  const loadProjectBudgetHours = useCallback(async () => {
    // Long-term modal does not need schedule diagnostics budget hydration on open.
    // Skipping this avoids an extra 404 + paginated fallback scan that slows modal startup.
    if (isLongTermModalContext) {
      setProjectBudgetHours(null);
      return;
    }

    const params = new URLSearchParams({ jobKey: project.jobKey || '' });

    const response = await fetch(`/api/scheduling/diagnostics?${params.toString()}`);
    const result = await response.json();

    if (response.ok && result?.success) {
      const hours = Number(result?.data?.schedule?.totalHours || 0);
      if (Number.isFinite(hours) && hours > 0) {
        setProjectBudgetHours(hours);
        return;
      }
    }

    // Fallback: resolve schedule totalHours by project identity when jobKey formats drift.
    // Fallback: scan scheduling pages by identity so we don't lose hours for rows beyond page 1.
    let page = 1;
    let foundHours: number | null = null;

    while (page <= 20) {
      const schedulesRes = await fetch(`/api/scheduling?page=${page}&pageSize=500`);
      const schedulesJson = await schedulesRes.json();

      if (!schedulesRes.ok || !schedulesJson?.success || !Array.isArray(schedulesJson?.data)) {
        break;
      }

      const match = (schedulesJson.data as Array<{
        customer?: string | null;
        projectNumber?: string | null;
        projectName?: string | null;
        totalHours?: number | null;
      }>).find(matchesProjectIdentity);

      const matchHours = Number(match?.totalHours || 0);
      if (Number.isFinite(matchHours) && matchHours > 0) {
        foundHours = matchHours;
        break;
      }

      if (!schedulesJson?.hasNextPage) {
        break;
      }

      page += 1;
    }

    // Final fallback: pull Project.hours by exact identity when no Schedule exists yet.
    if (foundHours === null) {
      const projectParams = new URLSearchParams({
        customer: String(project.customer || '').trim(),
        projectName: String(project.projectName || '').trim(),
        page: '1',
        pageSize: '200',
      });

      if (String(project.projectNumber || '').trim()) {
        projectParams.set('projectNumber', String(project.projectNumber || '').trim());
      }

      const projectsRes = await fetch(`/api/projects?${projectParams.toString()}`);
      const projectsJson = await projectsRes.json().catch(() => ({}));

      if (projectsRes.ok && projectsJson?.success && Array.isArray(projectsJson?.data)) {
        const projectMatch = (projectsJson.data as Array<{ hours?: number | null }>).find((row) => {
          const hours = Number(row?.hours || 0);
          return Number.isFinite(hours) && hours > 0;
        });

        const projectHours = Number(projectMatch?.hours || 0);
        if (Number.isFinite(projectHours) && projectHours > 0) {
          foundHours = projectHours;
        }
      }
    }

    setProjectBudgetHours(foundHours);
  }, [isLongTermModalContext, matchesProjectIdentity, project.customer, project.jobKey, project.projectName, project.projectNumber]);

  const getScheduledHoursForScope = (scope: Scope) => {
    if (!scheduledHoursByJobKeyDate || !project.jobKey) return 0;
    if (!scope.startDate || !scope.endDate) return 0;

    const start = parseScopeDate(scope.startDate);
    const end = parseScopeDate(scope.endDate);
    if (!start || !end) return 0;

    // Normalize dates to YYYY-MM-DD for comparison (ignore time/timezone)
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    const perDate = scheduledHoursByJobKeyDate[project.jobKey] || {};
    let total = 0;

    Object.entries(perDate).forEach(([dateKey, hours]) => {
      // dateKey is already in YYYY-MM-DD format
      if (dateKey >= startStr && dateKey <= endStr) {
        total += hours || 0;
      }
    });

    return total;
  };

  // Keep the local modal selection in sync with incoming props, except when
  // the user explicitly clicked "+ Add Scope" and is in create mode.
  useEffect(() => {
    if (isCreatingNewScope) return;
    const selectionSignature = `${selectedScopeId || ''}|${selectedScopeTitle || ''}|${selectedScheduleDate || ''}`;
    const selectedContextChanged = previousSelectionSignatureRef.current !== selectionSignature;
    previousSelectionSignatureRef.current = selectionSignature;

    // Preserve explicit in-modal scope clicks. Only force re-sync from incoming
    // props when the selected scope context actually changes.
    const activeScopeStillExists = activeScopeId
      ? effectiveScopes.some((scope) => scope.id === activeScopeId)
      : false;
    if (!selectedContextChanged && activeScopeStillExists) {
      return;
    }

    const debugScopeSelection =
      /veritas academy/i.test(String(project.projectName || '')) ||
      /todd test 1/i.test(String(selectedScopeTitle || ''));

    const resolveToEffectiveScopeId = () => {
      const pickBestScope = (candidates: Scope[]): Scope | null => {
        if (!Array.isArray(candidates) || candidates.length === 0) return null;

        const score = (scope: Scope): number => {
          const taskCount = Array.isArray(scope.tasks) ? scope.tasks.length : 0;
          const selectedDayCount = Array.isArray(scope.selectedDays) ? scope.selectedDays.length : 0;
          const hasHours = Number(scope.hours || 0) > 0 ? 1 : 0;
          // Prefer the scope variant with the most authored schedule metadata.
          return (taskCount * 1000) + (selectedDayCount * 10) + hasHours;
        };

        return [...candidates].sort((a, b) => score(b) - score(a))[0] || null;
      };

      if (selectedScopeId) {
        const direct = effectiveScopes.find((scope) => scope.id === selectedScopeId);
        if (direct) {
          if (debugScopeSelection) {
            console.log('[LongTermModalDebug] resolve selectedScopeId direct', {
              selectedScopeId,
              selectedScopeTitle,
              selectedScheduleDate,
              direct: {
                id: direct.id,
                title: direct.title,
                taskCount: Array.isArray(direct.tasks) ? direct.tasks.length : 0,
              },
              pickedId: direct.id,
            });
          }
          return direct.id;
        }

        const sourceScope = identityFallbackScopes.find((scope) => scope.id === selectedScopeId);
        if (sourceScope) {
          const exactComposite = effectiveScopes.find(
            (scope) => scopeMatchKey(scope.title, scope.startDate, scope.endDate) === scopeMatchKey(sourceScope.title, sourceScope.startDate, sourceScope.endDate)
          );
          if (exactComposite) return exactComposite.id;

          const matchingTitles = effectiveScopes.filter(
            (scope) => normalizeText(scope.title) === normalizeText(sourceScope.title)
          );

          if (selectedScheduleDate) {
            const datedTitleCandidates = matchingTitles.filter((scope) => scopeMatchesSelectedDate(scope, selectedScheduleDate));
            const datedTitleMatch = pickBestScope(datedTitleCandidates);
            if (datedTitleMatch) return datedTitleMatch.id;
          }

          const bestTitleMatch = pickBestScope(matchingTitles);
          if (bestTitleMatch) return bestTitleMatch.id;
        }
      }

      if (selectedScopeTitle) {
        const matchingTitles = effectiveScopes.filter(
          (scope) => normalizeText(scope.title) === normalizeText(selectedScopeTitle)
        );

        if (selectedScheduleDate) {
          const datedTitleCandidates = matchingTitles.filter((scope) => scopeMatchesSelectedDate(scope, selectedScheduleDate));
          const datedTitleMatch = pickBestScope(datedTitleCandidates);
          if (datedTitleMatch) return datedTitleMatch.id;
        }

        const bestTitleMatch = pickBestScope(matchingTitles);
        if (debugScopeSelection) {
          console.log('[LongTermModalDebug] resolve selectedScopeTitle', {
            selectedScopeTitle,
            selectedScheduleDate,
            matchingTitles: matchingTitles.map((scope) => ({
              id: scope.id,
              title: scope.title,
              startDate: scope.startDate,
              endDate: scope.endDate,
              taskCount: Array.isArray(scope.tasks) ? scope.tasks.length : 0,
              selectedDayCount: Array.isArray(scope.selectedDays) ? scope.selectedDays.length : 0,
            })),
            pickedId: bestTitleMatch?.id || null,
          });
        }
        if (bestTitleMatch) return bestTitleMatch.id;
      }

      if (debugScopeSelection) {
        console.log('[LongTermModalDebug] resolve no-scope-match', {
          selectedScopeId,
          selectedScopeTitle,
          selectedScheduleDate,
          effectiveScopeCount: effectiveScopes.length,
          effectiveScopes: effectiveScopes.map((scope) => ({
            id: scope.id,
            title: scope.title,
            startDate: scope.startDate,
            endDate: scope.endDate,
            taskCount: Array.isArray(scope.tasks) ? scope.tasks.length : 0,
          })),
        });
      }

      return null;
    };

    const resolvedScopeId = resolveToEffectiveScopeId();
    if (resolvedScopeId) {
      setIsCreatingNewScope(false);
      setActiveScopeId(resolvedScopeId);
      return;
    }

    const currentActiveExists = activeScopeId
      ? effectiveScopes.some((scope) => scope.id === activeScopeId)
      : false;
    if (currentActiveExists) {
      return;
    }

    const previousActiveScopeId = previousActiveScopeIdRef.current;
    const previousActiveExists = previousActiveScopeId
      ? effectiveScopes.some((scope) => scope.id === previousActiveScopeId)
      : false;
    if (previousActiveExists) {
      setActiveScopeId(previousActiveScopeId);
      return;
    }

    if (effectiveScopes.length > 0) {
      setActiveScopeId(effectiveScopes[0].id);
      return;
    }

    setActiveScopeId(null);
  }, [
    activeScopeId,
    project.projectName,
    selectedScopeId,
    selectedScopeTitle,
    selectedScheduleDate,
    effectiveScopes,
    identityFallbackScopes,
    isCreatingNewScope,
    scopeMatchKey,
    scopeMatchesSelectedDate,
  ]);

  useEffect(() => {
    // Avoid duplicate canonical reloads caused by callback identity churn
    // (e.g., ganttProjectId updates during initial load).
    if (lastCanonicalLoadRequestKeyRef.current === canonicalLoadRequestKey) {
      return;
    }
    lastCanonicalLoadRequestKeyRef.current = canonicalLoadRequestKey;

    setIsLoadingScopes(true);
    loadCanonicalScopes()
      .catch((error) => {
        console.error('Failed to load canonical gantt scopes:', error);
        setGanttProjectId(null);
        setCanonicalScopes(null);
      })
      .finally(() => setIsLoadingScopes(false));

    loadProjectBudgetHours().catch((error) => {
      console.error('Failed to load project budget hours:', error);
      setProjectBudgetHours(null);
    });
  }, [canonicalLoadRequestKey, loadCanonicalScopes, loadProjectBudgetHours]);

  // Notify parent when canonical scopes finish loading
  useEffect(() => {
    if (!canonicalScopes || canonicalScopes.length === 0 || isLoadingScopes) return;
    if (clearedScheduleScopeIdsRef.current.size > 0) return;

    const effectiveJobKey = resolvedJobKey || project.jobKey || '';
    const signature = JSON.stringify({
      jobKey: effectiveJobKey,
      scopes: canonicalScopes.map((scope) => ({
        id: String(scope.id || ''),
        title: String(scope.title || ''),
        startDate: String(scope.startDate || ''),
        endDate: String(scope.endDate || ''),
        hours: Number(scope.hours || 0),
        manpower: Number(scope.manpower || 0),
      })),
    });

    if (signature === lastNotifiedScopesSignatureRef.current) return;
    lastNotifiedScopesSignatureRef.current = signature;

    void onScopesUpdatedRef.current(effectiveJobKey, canonicalScopes);
  }, [canonicalScopes, isLoadingScopes, resolvedJobKey, project.jobKey]);

  // Initialize blank form once when entering explicit create mode.
  useEffect(() => {
    if (!isCreatingNewScope) return;
    setHasManualDateOverride(false);
    setScopeDetail({
      ...emptyScopeDetail,
      startDate: selectedScheduleDate || "",
      endDate: selectedScheduleDate || "",
    });
    window.requestAnimationFrame(() => {
      formSectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      titleInputRef.current?.focus();
    });
  }, [emptyScopeDetail, isCreatingNewScope, selectedScheduleDate]);

  // Keep form blank when nothing is selected and not in create mode.
  useEffect(() => {
    if (isCreatingNewScope) return;
    if (activeScopeId) return;
    setHasManualDateOverride(false);
    setScopeDetail(emptyScopeDetail);
  }, [activeScopeId, emptyScopeDetail, isCreatingNewScope]);

  // Populate from selected scope only when editing an existing scope.
  useEffect(() => {
    if (isCreatingNewScope || !activeScopeId) return;
    if (suppressPopulateEffectRef.current) return;
    if (clearedScheduleScopeIdsRef.current.has(activeScopeId)) return;
    const scope = effectiveScopes.find((item) => item.id === activeScopeId);
    if (!scope) return;

    setHasManualDateOverride(false);

    const currentTaskCount = normalizeTaskEntries(scopeDetail.tasks).length;
    const nextTaskCount = normalizeTaskEntries(scope.tasks).length;
    const shouldPreserveCurrentTasks = currentTaskCount > 0 && nextTaskCount === 0;

    const debugScopeSelection =
      /veritas academy/i.test(String(project.projectName || '')) ||
      /todd test 1/i.test(String(selectedScopeTitle || scope.title || ''));
    if (debugScopeSelection) {
      console.log('[LongTermModalDebug] hydrate scopeDetail from active scope', {
        activeScopeId,
        scopeTitle: scope.title,
        selectedScopeTitle,
        taskCountRaw: Array.isArray(scope.tasks) ? scope.tasks.length : 0,
        taskCountNormalized: normalizeTaskEntries(scope.tasks).length,
        currentTaskCount,
        shouldPreserveCurrentTasks,
        tasks: normalizeTaskEntries(scope.tasks),
        taskNames: normalizeTaskEntries(scope.tasks).map((task) => task.name),
      });
    }

    if (shouldPreserveCurrentTasks) {
      return;
    }

    const normalizedSchedulingMode = scope.schedulingMode === 'specific-days' ? 'specific-days' : 'contiguous';
    const normalizedTasks = normalizeTaskEntries(scope.tasks);
    const hydratedTasks = normalizedTasks.map((task) => {
      const currentYards = toOptionalPositiveNumber(task.yards);
      if (currentYards !== null && currentYards > 0) return task;

      const dateKey = String(task.startDate || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return task;

      const mappedYards = toOptionalPositiveNumber(concreteYardsByDate[dateKey]);
      if (mappedYards === null || mappedYards <= 0) return task;

      return {
        ...task,
        yards: mappedYards,
      };
    });
    const selectedDayEntry =
      normalizedSchedulingMode === 'specific-days' && selectedScheduleDate
        ? (Array.isArray(scope.selectedDays)
            ? scope.selectedDays.find((entry: SelectedDayEntry) => String(entry?.date || '').trim() === selectedScheduleDate)
            : null)
        : null;
    const canUseTaskRollups = hasCompleteTaskInputs(normalizedTasks);
    const fallbackManpower = toOptionalPositiveNumber(scope.manpower);
    const fallbackHours = getEffectiveScopeHours(scope);

    setScopeDetail((prev) => {
      const previousTasks = normalizeTaskEntries(prev.tasks);
      const previousTaskMap = new Map(
        previousTasks.map((task) => [getTaskIdentityKey(task), task])
      );

      const mergedTasks = hydratedTasks.map((task) => {
        const previousTask = previousTaskMap.get(getTaskIdentityKey(task));
        if (!previousTask) return task;

        // Preserve unsaved local task edits when async hydration completes later.
        return {
          ...task,
          yards:
            toOptionalPositiveNumber(previousTask.yards) !== null
              ? previousTask.yards
              : task.yards,
          concreteConfirmed:
            typeof previousTask.concreteConfirmed === 'boolean'
              ? previousTask.concreteConfirmed
              : task.concreteConfirmed,
        };
      });

      const mergedRollups = calculateTaskRollups(mergedTasks);

      return {
        title: scope.title || "",
        predecessorScopeId: scope.predecessorScopeId || null,
        startDate: scope.startDate || "",
        endDate: scope.endDate || "",
        manpower:
          canUseTaskRollups && mergedRollups.manpower > 0
            ? mergedRollups.manpower
            : (fallbackManpower ?? undefined),
        hours:
          normalizedSchedulingMode === 'specific-days' && dayEditMode && selectedDayEntry
            ? Number(selectedDayEntry.hours || 0)
            : (canUseTaskRollups && mergedRollups.hours > 0 ? mergedRollups.hours : fallbackHours),
        description: scope.description || "",
        tasks: mergedTasks,
        color: scope.color,
        taskColors: (scope.taskColors as Record<string, string>) || {},
        schedulingMode: normalizedSchedulingMode,
        selectedDays: Array.isArray(scope.selectedDays) ? scope.selectedDays : [],
      };
    });
  }, [activeScopeId, concreteYardsByDate, dayEditMode, effectiveScopes, getEffectiveScopeHours, isCreatingNewScope, projectBudgetHours, selectedScheduleDate, selectedScheduledHours]);

  useEffect(() => {
    if (isCreatingNewScope || !activeScopeId) return;
    if (selectedTaskIndex === null || selectedTaskIndex < 0) {
      setHighlightedTaskIndex(null);
      return;
    }

    const tasks = normalizeTaskEntries(scopeDetail.tasks);
    if (selectedTaskIndex >= tasks.length) return;

    const timeoutId = window.setTimeout(() => {
      formSectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      const row = taskRowRefs.current[selectedTaskIndex];
      if (!row) return;
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setHighlightedTaskIndex(selectedTaskIndex);
      const focusTarget = row.querySelector('input, button') as HTMLElement | null;
      focusTarget?.focus();
    }, 0);

    const clearHighlightId = window.setTimeout(() => {
      setHighlightedTaskIndex((current) => (current === selectedTaskIndex ? null : current));
    }, 2200);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearTimeout(clearHighlightId);
    };
  }, [activeScopeId, isCreatingNewScope, scopeDetail.tasks, selectedTaskIndex]);

  const handleAddTask = () => {
    const trimmed = newTask.trim();
    if (!trimmed) return;
    const taskEntry = formatTaskEntry({
      name: trimmed,
      startDate: newTaskDate ? newTaskDate : "",
      days: toPositiveWholeDays(newTaskDays),
      manpower: toOptionalPositiveNumber(newTaskManpower),
      yards: toOptionalPositiveNumber(newTaskYards),
      concreteConfirmed: false,
    });

    const existingTasks = normalizeTaskEntries(scopeDetail.tasks);
    const nextTasks = [...existingTasks, taskEntry];
    const rollups = calculateTaskRollups(nextTasks);

    setScopeDetail((prev) => ({
      ...prev,
      tasks: nextTasks,
      manpower: rollups.manpower > 0 ? rollups.manpower : undefined,
      hours: rollups.hours > 0 ? rollups.hours : undefined,
    }));
    setNewTask("");
    setNewTaskDate("");
    setNewTaskDays("");
    setNewTaskManpower("");
    setNewTaskYards("");
  };

  const handleRemoveTask = (index: number) => {
    setScopeDetail((prev) => {
      const normalizedTasks = normalizeTaskEntries(prev.tasks);
      const taskToRemove = normalizedTasks[index];
      const taskName = (taskToRemove?.name || '').trim();
      
      const updatedTaskColors = { ...(prev.taskColors || {}) };
      delete updatedTaskColors[taskName];
      const nextTasks = normalizedTasks.filter((_, i) => i !== index);
      const rollups = calculateTaskRollups(nextTasks);
      const clearedTaskSchedule =
        nextTasks.length === 0 && !hasManualDateOverride
          ? { startDate: "", endDate: "" }
          : {};
      
      return {
        ...prev,
        ...clearedTaskSchedule,
        tasks: nextTasks,
        manpower: rollups.manpower > 0 ? rollups.manpower : undefined,
        hours: rollups.hours > 0 ? rollups.hours : undefined,
        taskColors: updatedTaskColors,
      };
    });
  };

  const extractTaskName = (taskEntry: string | ScheduleTask): string => {
    return parseTaskEntry(taskEntry).name || String(taskEntry || '');
  };

  const updateTaskDateMeta = (index: number, next: Partial<ParsedTaskEntry>) => {
    setScopeDetail((prev) => {
      const currentTasks = normalizeTaskEntries(prev.tasks);
      const existing = currentTasks[index];
      if (!existing) return prev;

      const parsedTasks = currentTasks.map((task) => parseTaskEntry(task));
      const parsed = parsedTasks[index];

      parsedTasks[index] = {
        ...parsed,
        startDate: typeof next.startDate === 'string' ? next.startDate : parsed.startDate,
        days: next.days === undefined ? parsed.days : next.days,
        name: typeof next.name === 'string' ? next.name : parsed.name,
        manpower: next.manpower === undefined ? parsed.manpower : next.manpower,
        yards: next.yards === undefined ? parsed.yards : next.yards,
        concreteConfirmed:
          next.concreteConfirmed === undefined
            ? (next.yards !== undefined ? false : parsed.concreteConfirmed)
            : next.concreteConfirmed,
      };

      const calcEndDate = (task: ParsedTaskEntry): string | null => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(task.startDate)) return null;
        const start = new Date(`${task.startDate}T00:00:00`);
        if (isNaN(start.getTime())) return null;
        const duration = Number.isFinite(task.days || 0) && (task.days || 0) > 0 ? Number(task.days) : 1;
        const end = new Date(start);
        end.setDate(end.getDate() + duration - 1);
        return formatDateKey(end);
      };

      const addDays = (dateKey: string, daysToAdd: number): string | null => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
        const base = new Date(`${dateKey}T00:00:00`);
        if (isNaN(base.getTime())) return null;
        base.setDate(base.getDate() + daysToAdd);
        return formatDateKey(base);
      };

      // Cascade dates down the task chain: each next task starts the day after previous task ends.
      for (let i = index + 1; i < parsedTasks.length; i += 1) {
        const previous = parsedTasks[i - 1];
        const previousEnd = calcEndDate(previous);
        if (!previousEnd) break;

        const nextStart = addDays(previousEnd, 1);
        if (!nextStart) break;

        parsedTasks[i] = {
          ...parsedTasks[i],
          startDate: nextStart,
        };
      }

      for (let i = 0; i < parsedTasks.length; i += 1) {
        currentTasks[i] = formatTaskEntry(parsedTasks[i]);
      }

      const rollups = calculateTaskRollups(currentTasks);

      return {
        ...prev,
        tasks: currentTasks,
        manpower: rollups.manpower > 0 ? rollups.manpower : undefined,
        hours: rollups.hours > 0 ? rollups.hours : undefined,
      };
    });
  };
  const selectedDays = useMemo<SelectedDayEntry[]>(() => (
    Array.isArray(scopeDetail.selectedDays)
      ? scopeDetail.selectedDays
          .map((entry) => ({
            date: String(entry?.date || '').trim(),
            hours: Number(entry?.hours || 0),
            foreman: entry?.foreman ? String(entry.foreman) : null,
          }))
          .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && Number.isFinite(entry.hours) && entry.hours > 0)
          .sort((a, b) => a.date.localeCompare(b.date))
      : []
  ), [scopeDetail.selectedDays]);

  const derivedTaskRange = useMemo(() => {
    const tasks = normalizeTaskEntries(scopeDetail.tasks);
    return calculateTaskDateRange(tasks);
  }, [scopeDetail.tasks]);

  const derivedTaskRollups = useMemo(() => {
    const tasks = normalizeTaskEntries(scopeDetail.tasks);
    return calculateTaskRollups(tasks);
  }, [scopeDetail.tasks]);

  const canUseDerivedTaskRollups = useMemo(() => {
    const tasks = normalizeTaskEntries(scopeDetail.tasks);
    return hasCompleteTaskInputs(tasks);
  }, [scopeDetail.tasks]);

  const selectedDayHoursForDisplay = useMemo(() => {
    if (!dayEditMode) return 0;
    if (scopeDetail.schedulingMode === 'specific-days' && selectedScheduleDate) {
      const selectedEntry = selectedDays.find((entry) => entry.date === selectedScheduleDate);
      if (selectedEntry && Number.isFinite(selectedEntry.hours) && selectedEntry.hours > 0) {
        return Number(selectedEntry.hours);
      }
    }
    if (typeof selectedScheduledHours === 'number' && Number.isFinite(selectedScheduledHours) && selectedScheduledHours > 0) {
      return Number(selectedScheduledHours);
    }
    return 0;
  }, [dayEditMode, scopeDetail.schedulingMode, selectedScheduleDate, selectedDays, selectedScheduledHours]);

  const displayedSummaryHours = useMemo(() => {
    if (selectedDayHoursForDisplay > 0) return selectedDayHoursForDisplay;
    if (canUseDerivedTaskRollups && derivedTaskRollups.hours > 0) return derivedTaskRollups.hours;
    return computeScopeHours(scopeDetail);
  }, [selectedDayHoursForDisplay, canUseDerivedTaskRollups, derivedTaskRollups.hours, scopeDetail]);

  const displayedSummaryManpower = useMemo(() => {
    if (selectedDayHoursForDisplay > 0) return selectedDayHoursForDisplay / 10;
    if (canUseDerivedTaskRollups && derivedTaskRollups.manpower > 0) return derivedTaskRollups.manpower;
    return toOptionalPositiveNumber(scopeDetail.manpower) || 0;
  }, [selectedDayHoursForDisplay, canUseDerivedTaskRollups, derivedTaskRollups.manpower, scopeDetail.manpower]);

  const normalizedScopeTasks = useMemo(() => normalizeTaskEntries(scopeDetail.tasks), [scopeDetail.tasks]);
  const hasScopeTasks = normalizedScopeTasks.length > 0;
  const manualWorkDays = useMemo(
    () => calculateWorkDays(scopeDetail.startDate, scopeDetail.endDate),
    [scopeDetail.startDate, scopeDetail.endDate]
  );

  const getDayOfWeek = (dateKey: string) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Date(year, month - 1, day).getDay();
  };

  const isWeekendDate = (dateKey: string) => {
    const weekday = getDayOfWeek(dateKey);
    return weekday === 0 || weekday === 6;
  };

  const ensurePaidHolidaySetLoaded = useCallback(async () => {
    if (paidHolidayLoadedRef.current) return;

    if (paidHolidayLoadPromiseRef.current) {
      await paidHolidayLoadPromiseRef.current;
      return;
    }

    paidHolidayLoadPromiseRef.current = (async () => {
      try {
        const response = await fetch('/api/holidays?page=1&pageSize=500');
        if (!response.ok) return;
        const json = await response.json().catch(() => ({}));
        const holidays: HolidayApiRow[] = Array.isArray(json?.data) ? json.data : [];
        const paid = holidays
          .filter((h) => Boolean(h?.isPaid) && typeof h?.date === 'string')
          .map((h) => String(h.date));

        const nextPaidHolidaySet = new Set(paid);
        paidHolidaySetRef.current = nextPaidHolidaySet;
        paidHolidayLoadedRef.current = true;
      } catch (error) {
        console.warn('Failed to load paid holidays for scope validation:', error);
      } finally {
        paidHolidayLoadPromiseRef.current = null;
      }
    })();

    await paidHolidayLoadPromiseRef.current;
  }, []);

  const setSchedulingModeWithConfirm = (nextMode: 'contiguous' | 'specific-days') => {
    const currentMode = scopeDetail.schedulingMode === 'specific-days' ? 'specific-days' : 'contiguous';
    if (currentMode === nextMode) return;

    if (currentMode === 'specific-days' && selectedDays.length > 0 && nextMode === 'contiguous') {
      const confirmed = window.confirm('Switching to Continuous Range will ignore the selected-day list for scheduling. Continue?');
      if (!confirmed) return;
    }

    if (currentMode === 'contiguous' && nextMode === 'specific-days') {
      const confirmed = window.confirm('Switching to Specific Days will use only manually selected dates. Continue?');
      if (!confirmed) return;
    }

    setScopeDetail((prev) => ({ ...prev, schedulingMode: nextMode }));
  };

  const clearScopeScheduleDates = () => {
    suppressPopulateEffectRef.current = true;
    if (activeScopeId) {
      clearedScheduleScopeIdsRef.current.add(activeScopeId);
    }
    setHasManualDateOverride(true);
    setScopeDetail((prev) => ({
      ...prev,
      startDate: "",
      endDate: "",
      schedulingMode: "contiguous",
      selectedDays: [],
      tasks: normalizeTaskEntries(prev.tasks).map((task) => ({
        ...task,
        startDate: "",
      })),
    }));
  };

  const isScopeScheduleClearDraft = () => {
    const effectiveSchedulingMode =
      scopeDetail.schedulingMode === 'specific-days' && selectedDays.length > 0
        ? 'specific-days'
        : 'contiguous';

    if (effectiveSchedulingMode === 'specific-days') {
      return selectedDays.length === 0;
    }

    const draftStartDate = hasManualDateOverride
      ? scopeDetail.startDate
      : (derivedTaskRange?.startDate || scopeDetail.startDate || "");
    const draftEndDate = hasManualDateOverride
      ? scopeDetail.endDate
      : (derivedTaskRange?.endDate || scopeDetail.endDate || "");

    return !dateKey(draftStartDate) && !dateKey(draftEndDate) && selectedDays.length === 0;
  };

  const addSelectedDay = async () => {
    const date = newSelectedDayDate.trim();
    const hours = Number(newSelectedDayHours || 0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(hours) || hours <= 0) return;

    await ensurePaidHolidaySetLoaded();

    if (isWeekendDate(date)) {
      alert('Selected day is on a weekend. Please choose a weekday.');
      return;
    }

    if (paidHolidaySetRef.current.has(date)) {
      alert('Selected day is a paid holiday. Please choose another date.');
      return;
    }

    const existingWithoutDate = selectedDays.filter((entry) => entry.date !== date);
    const next = [...existingWithoutDate, { date, hours, foreman: null }].sort((a, b) => a.date.localeCompare(b.date));

    setScopeDetail((prev) => ({
      ...prev,
      selectedDays: next,
      hours: next.reduce((sum, entry) => sum + Number(entry.hours || 0), 0),
    }));
    setNewSelectedDayDate("");
    setNewSelectedDayHours("10");
  };

  const removeSelectedDay = (date: string) => {
    const next = selectedDays.filter((entry) => entry.date !== date);
    setScopeDetail((prev) => ({
      ...prev,
      selectedDays: next,
      hours: next.reduce((sum, entry) => sum + Number(entry.hours || 0), 0),
    }));
  };

  const updateSelectedDayHours = (date: string, hours: number) => {
    if (!Number.isFinite(hours) || hours <= 0) return;
    const next = selectedDays.map((entry) => (entry.date === date ? { ...entry, hours } : entry));
    setScopeDetail((prev) => ({
      ...prev,
      selectedDays: next,
      hours: next.reduce((sum, entry) => sum + Number(entry.hours || 0), 0),
    }));
  };

  const openConcreteOrderModal = (target: {
    mode: "new-task" | "existing-task";
    taskIndex?: number;
    taskLabel?: string;
    date?: string;
    yards?: number | null;
  }) => {
    setConcreteModalTarget(target);
  };

  const handleSaveScope = async (closeAfterSave = false) => {
    setIsSaving(true);
    suppressPopulateEffectRef.current = true;
    try {
      const isClearingSchedule = isScopeScheduleClearDraft();

      if (effectiveLongTermAssignmentContext && !assignmentPmSelection && !isClearingSchedule) {
        throw new Error('Project Manager is required. Select a PM before saving.');
      }

      const isNewScope = isCreatingNewScope || activeScopeId === NEW_SCOPE_ID;
      const scopeUpdateJobKey = resolvedJobKey || project.jobKey || '';

      const publishScopes = (nextScopes: Scope[]) => {
        setCanonicalScopes(nextScopes);
        onScopesUpdated(scopeUpdateJobKey, nextScopes);
      };

      const refreshScopesInBackground = () => {
        ganttProjectsCacheRef.current = { expiresAt: 0, data: null };
        if (resolvedJobKey) {
          persistedScopesByJobKeyRef.current.delete(resolvedJobKey);
        }

        void loadCanonicalScopes()
          .then((refreshedScopes) => {
            if (refreshedScopes && refreshedScopes.length > 0) {
              onScopesUpdated(scopeUpdateJobKey, refreshedScopes);
            }
          })
          .catch((refreshError) => {
            console.error('Failed to refresh scopes after modal save:', refreshError);
          });
      };

      let scopesToMatchAgainst = effectiveScopes;
      let activeScope = activeScopeId
        ? (scopesToMatchAgainst.find((item) => item.id === activeScopeId) || null)
        : null;

      if (activeScopeId && !activeScope && !isNewScope) {
        const latestScopes = await loadCanonicalScopes();
        if (latestScopes && latestScopes.length > 0) {
          scopesToMatchAgainst = latestScopes;
          activeScope = latestScopes.find((item) => item.id === activeScopeId) || null;
        }
      }

      const effectiveSchedulingMode: 'contiguous' | 'specific-days' =
        scopeDetail.schedulingMode === 'specific-days' && selectedDays.length > 0
          ? 'specific-days'
          : 'contiguous';
      const usedSpecificDaysFallback =
        scopeDetail.schedulingMode === 'specific-days' && effectiveSchedulingMode === 'contiguous';

      if (usedSpecificDaysFallback) {
        console.warn('Specific Days mode selected with no days; falling back to Continuous Range for save.');
      }

      if (effectiveSchedulingMode === 'specific-days') {
        await ensurePaidHolidaySetLoaded();
      }

      const invalidSpecificDay = selectedDays.find((entry) => isWeekendDate(entry.date) || paidHolidaySetRef.current.has(entry.date));
      if (effectiveSchedulingMode === 'specific-days' && invalidSpecificDay) {
        throw new Error(`Specific day is invalid: ${invalidSpecificDay.date}. Weekends and paid holidays are blocked.`);
      }

      if (!isClearingSchedule && dayEditMode && !selectedScheduleDate) {
        throw new Error('Day edit context is missing. Close and reopen the card from the schedule grid.');
      }

      if (!isClearingSchedule && dayEditMode && selectedScheduleDate && effectiveSchedulingMode === 'specific-days' && (selectedScopeTitle || scopeDetail.title)) {
        const scopeName = (scopeDetail.title || selectedScopeTitle || '').trim();
        const resolvedStartDate = (derivedTaskRange?.startDate || scopeDetail.startDate || selectedScheduleDate || '').trim();
        const resolvedEndDate = (derivedTaskRange?.endDate || scopeDetail.endDate || resolvedStartDate || '').trim();
        if (!resolvedStartDate) {
          throw new Error('Scope start date is required.');
        }
        const selectedDayEntry = selectedDays.find((entry) => entry.date === selectedScheduleDate);
        const dayHoursRaw =
          scopeDetail.schedulingMode === 'specific-days'
            ? (selectedDayEntry ? selectedDayEntry.hours : 0)
            : (typeof selectedScheduledHours === 'number' && Number.isFinite(selectedScheduledHours)
                ? selectedScheduledHours
                : scopeDetail.hours);
        const dayHours = typeof dayHoursRaw === 'number' ? dayHoursRaw : parseFloat(String(dayHoursRaw || '0'));
        const foremanSelectionForSave =
          assignmentForemanSelection ||
          (selectedForemanId && selectedForemanId !== '__unassigned__' ? selectedForemanId : '__unassigned__');

        const response = await fetch('/api/short-term-schedule/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobKey: project.jobKey,
            scopeOfWork: scopeName,
            sourceDateKey: selectedScheduleDate,
            targetDateKey: selectedScheduleDate,
            targetForemanId: foremanSelectionForSave === '__unassigned__' ? null : foremanSelectionForSave,
            applyForemanAcrossProjectWeek: true,
            hours: Number.isFinite(dayHours) ? dayHours : 0,
            allowScopeOverrun: true,
          }),
        });

        const result = await response.json();
        if (!response.ok || !result?.success) {
          throw new Error(result?.error || 'Failed to update daily assignment');
        }

        if (result?.warning) {
          alert(`Warning: ${result.warning}`);
        }

        // In day-edit mode we still persist full scope metadata from the modal,
        // including total budgeted hours/manpower for contiguous scopes.
        const normalizedTasks = normalizeTaskEntries(scopeDetail.tasks);
        const rollups = calculateTaskRollups(normalizedTasks);

        const canUseRollupsForMetadata = hasCompleteTaskInputs(normalizedTasks);

        const metadataPayload: ScopeMetadataPayload = {
          jobKey: resolvedJobKey,
          title: scopeName || 'Scope',
          startDate: resolvedStartDate,
          endDate: resolvedEndDate,
          description: scopeDetail.description || '',
          tasks: normalizedTasks,

          schedulingMode: effectiveSchedulingMode,
          selectedDays: effectiveSchedulingMode === 'specific-days' ? selectedDays : [],
          manpower: canUseRollupsForMetadata && rollups.manpower > 0 ? rollups.manpower : scopeDetail.manpower,
          hours: canUseRollupsForMetadata && rollups.hours > 0 ? rollups.hours : computeScopeHours(scopeDetail),
        };
        // Keep existing predecessor relationship in day-edit mode
        if (activeScope?.predecessorScopeId) {
          metadataPayload.predecessorScopeId = activeScope.predecessorScopeId;
        }
        await upsertProjectScopeMetadata(metadataPayload, { activeScope });

        const updatedScopes = effectiveScopes.map((scope) => {
          if (activeScopeId && scope.id !== activeScopeId) return scope;
          if (!activeScopeId && normalizeText(scope.title) !== normalizeText(scopeName)) return scope;
          return {
            ...scope,
            startDate: metadataPayload.startDate,
            endDate: metadataPayload.endDate,
            description: metadataPayload.description,
            tasks: metadataPayload.tasks,
            schedulingMode: metadataPayload.schedulingMode,
            selectedDays: metadataPayload.selectedDays,
            manpower: metadataPayload.manpower,
            hours: metadataPayload.hours,
          };
        });

        onScopesUpdated(resolvedJobKey || project.jobKey || '', updatedScopes);
        if (closeAfterSave) {
          onClose();
        }
        return;
      }

      const normalizedTasks = normalizeTaskEntries(scopeDetail.tasks);
      const rollups = calculateTaskRollups(normalizedTasks);
      const explicitDateClearRequested =
        effectiveSchedulingMode === 'contiguous' &&
        hasManualDateOverride &&
        !String(scopeDetail.startDate || '').trim() &&
        !String(scopeDetail.endDate || '').trim();
      const contiguousStartDate = hasManualDateOverride
        ? (scopeDetail.startDate || "")
        : (derivedTaskRange?.startDate || scopeDetail.startDate || "");
      const contiguousEndDate = hasManualDateOverride
        ? (scopeDetail.endDate || "")
        : (derivedTaskRange?.endDate || scopeDetail.endDate || "");

      const payload: ScopeMetadataPayload = {
        jobKey: resolvedJobKey,
        title: (scopeDetail.title || "Scope").trim() || "Scope",
        startDate: effectiveSchedulingMode === 'specific-days'
          ? (selectedDays[0]?.date || scopeDetail.startDate || "")
          : (explicitDateClearRequested ? "" : contiguousStartDate),
        endDate: effectiveSchedulingMode === 'specific-days'
          ? (selectedDays[selectedDays.length - 1]?.date || scopeDetail.endDate || "")
          : (explicitDateClearRequested ? "" : contiguousEndDate),
        description: scopeDetail.description || "",
        tasks: normalizedTasks,

        schedulingMode: effectiveSchedulingMode,
        selectedDays: effectiveSchedulingMode === 'specific-days' ? selectedDays : [],
      };

      // For implicit predecessor based on list position
      if (isNewScope && visibleScopes.length > 0) {
        // New scopes get the last scope as their predecessor
        const nonNewScopes = visibleScopes.filter((s) => isCanonicalScopeId(s.id));
        if (nonNewScopes.length > 0) {
          payload.predecessorScopeId = nonNewScopes[nonNewScopes.length - 1].id;
        } else {
          payload.predecessorScopeId = null;
        }
      } else if (!isNewScope && activeScope) {
        // Existing scopes keep their current predecessor (only change via drag-drop)
        payload.predecessorScopeId = isCanonicalScopeId(activeScope.predecessorScopeId)
          ? activeScope.predecessorScopeId
          : null;
      }

      if (!isCanonicalScopeId(payload.predecessorScopeId) || payload.predecessorScopeId === activeScopeId) {
        payload.predecessorScopeId = null;
      }

      const normalizedStartDate = dateKey(payload.startDate);
      const normalizedEndDate = dateKey(payload.endDate);

      if (normalizedStartDate && normalizedEndDate) {
        payload.startDate = normalizedStartDate;
        payload.endDate = normalizedEndDate;
      } else if (normalizedStartDate || normalizedEndDate) {
        const singleDate = normalizedStartDate || normalizedEndDate;
        // If only one side is provided, treat it as a one-day range.
        payload.startDate = singleDate;
        payload.endDate = singleDate;
      } else {
        // Allow clearing both dates to unschedule the scope.
        payload.startDate = "";
        payload.endDate = "";
      }

      const canUseRollupsForPayload = hasCompleteTaskInputs(normalizedTasks);

      // Only include manpower and hours if they have valid values
      if (canUseRollupsForPayload && rollups.manpower > 0) {
        payload.manpower = rollups.manpower;
      } else if (scopeDetail.manpower !== undefined && scopeDetail.manpower !== null) {
        payload.manpower = scopeDetail.manpower;
      }
      
      const computedHoursFromInputs = canUseRollupsForPayload && rollups.hours > 0
        ? rollups.hours
        : computeScopeHours(scopeDetail);
      const existingScopeHours = toOptionalPositiveNumber(activeScope?.hours) || 0;
      const draftScopeHours = toOptionalPositiveNumber(scopeDetail.hours) || 0;
      const computedHours = computedHoursFromInputs > 0
        ? computedHoursFromInputs
        : (draftScopeHours > 0 ? draftScopeHours : existingScopeHours);
      if (computedHours > 0) {
        payload.hours = computedHours;
      }

      const canonicalScopeCandidates = scopesToMatchAgainst.filter((scope) => isCanonicalScopeId(scope.id));
      const payloadTitleKey = normalizeText(payload.title || '');
      const payloadStartKey = dateKey(payload.startDate);
      const payloadEndKey = dateKey(payload.endDate);

      const exactCanonicalMatch = canonicalScopeCandidates.find((scope) =>
        normalizeText(scope.title || '') === payloadTitleKey &&
        dateKey(scope.startDate) === payloadStartKey &&
        dateKey(scope.endDate) === payloadEndKey
      );

      const titleOnlyCanonicalMatches = canonicalScopeCandidates.filter(
        (scope) => normalizeText(scope.title || '') === payloadTitleKey
      );

      const targetCanonicalScopeId =
        activeScopeId && isCanonicalScopeId(activeScopeId)
          ? activeScopeId
          : (exactCanonicalMatch?.id || (titleOnlyCanonicalMatches.length === 1 ? titleOnlyCanonicalMatches[0].id : null));

      const hasExistingMetadataScope =
        Boolean(activeScopeId && activeScopeId !== NEW_SCOPE_ID && !isCanonicalScopeId(activeScopeId) && activeScope);
      const targetMetadataScopeId = hasExistingMetadataScope ? activeScopeId : targetCanonicalScopeId;
      const shouldCreateNewScope = isCreatingNewScope || (!targetCanonicalScopeId && !hasExistingMetadataScope);

      if (!isCreatingNewScope && !targetCanonicalScopeId && !hasExistingMetadataScope) {
        throw new Error('Select an existing scope to update, or click + Add Scope to create a new one.');
      }

      const targetGanttProjectId = await resolveWritableGanttProjectId();
      let savedScope;
      if (targetGanttProjectId && !hasExistingMetadataScope) {
        const predecessorCandidate = String(payload.predecessorScopeId || '').trim();
        const currentScopeIdForValidation = shouldCreateNewScope ? null : targetCanonicalScopeId;
        const predecessorIsLocalAndValid =
          isCanonicalScopeId(predecessorCandidate) &&
          predecessorCandidate !== currentScopeIdForValidation &&
          canonicalScopeCandidates.some((scope) => scope.id === predecessorCandidate);

        payload.predecessorScopeId = predecessorIsLocalAndValid
          ? predecessorCandidate
          : await sanitizePredecessorScopeId(
              targetGanttProjectId,
              predecessorCandidate,
              currentScopeIdForValidation
            );

        // Persist scheduling metadata first so gantt sync reads latest mode/selectedDays.
        await upsertProjectScopeMetadata(payload, { activeScope });

        const ganttPayload = {
          title: payload.title,
          predecessorScopeId: payload.predecessorScopeId || null,
          startDate: payload.startDate || null,
          endDate: payload.endDate || null,
          totalHours: computedHours,
          crewSize: payload.manpower ?? null,
          notes: payload.description || null,
        };

        if (!shouldCreateNewScope && targetCanonicalScopeId) {
          const response = await fetch(`/api/gantt-v2/scopes/${targetCanonicalScopeId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ganttPayload),
          });
          const result = await readJsonResponse<{ success?: boolean; error?: string; data?: { id?: string } }>(response, {
            label: 'Update Gantt scope',
          });
          if (!response.ok || !result.success) {
            const isScopeMissing =
              response.status === 404 ||
              String(result?.error || '').toLowerCase().includes('scope not found');

            if (isScopeMissing) {
              // Recover from stale/non-canonical scope ids by creating a fresh canonical scope.
              const createResponse = await fetch(`/api/gantt-v2/projects/${targetGanttProjectId}/scopes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(ganttPayload),
              });
              const createResult = await readJsonResponse<{ success?: boolean; error?: string; data?: { id?: string } }>(createResponse, {
                label: 'Recover Gantt scope',
              });
              if (!createResponse.ok || !createResult.success) {
                throw new Error(createResult.error || `Failed to recover missing scope (HTTP ${createResponse.status})`);
              }
              savedScope = createResult.data;
              if (savedScope?.id) {
                setIsCreatingNewScope(false);
                setActiveScopeId(savedScope.id);
              }
            } else {
              throw new Error(result.error || `Failed to update scope (HTTP ${response.status})`);
            }
          }
        } else {
          const response = await fetch(`/api/gantt-v2/projects/${targetGanttProjectId}/scopes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ganttPayload),
          });
          const result = await readJsonResponse<{ success?: boolean; error?: string; data?: { id?: string } }>(response, {
            label: 'Create Gantt scope',
          });
          if (!response.ok || !result.success) {
            throw new Error(result.error || `Failed to create scope (HTTP ${response.status})`);
          }
          savedScope = result.data;
          if (savedScope?.id) {
            setIsCreatingNewScope(false);
            setActiveScopeId(savedScope.id);
          }
        }

        if (!isClearingSchedule) {
          suppressPopulateEffectRef.current = false;
        }
        const savedScopeId = String(savedScope?.id || targetCanonicalScopeId || '').trim();
        const baseScope =
          (savedScopeId
            ? scopesToMatchAgainst.find((scope) => scope.id === savedScopeId) || null
            : null) ||
          (targetCanonicalScopeId
            ? scopesToMatchAgainst.find((scope) => scope.id === targetCanonicalScopeId) || null
            : null) ||
          activeScope ||
          null;

        const nextScope: Scope = {
          ...(baseScope || {}),
          id: savedScopeId || baseScope?.id || activeScopeId || NEW_SCOPE_ID,
          jobKey: resolvedJobKey || project.jobKey,
          title: payload.title,
          predecessorScopeId: payload.predecessorScopeId || null,
          startDate: payload.startDate || '',
          endDate: payload.endDate || '',
          description: payload.description || '',
          tasks: payload.tasks,
          schedulingMode: payload.schedulingMode,
          selectedDays: payload.selectedDays,
          manpower: payload.manpower,
          hours: computedHours > 0 ? computedHours : undefined,
        } as Scope;

        const updatedScopes = shouldCreateNewScope
          ? [
              ...scopesToMatchAgainst.filter((scope) => scope.id !== activeScopeId),
              nextScope,
            ]
          : scopesToMatchAgainst.map((scope) =>
              scope.id === targetCanonicalScopeId ? nextScope : scope
            );

        publishScopes(updatedScopes);
        if (!isClearingSchedule) {
          refreshScopesInBackground();
        }

        if (!shouldCreateNewScope && targetCanonicalScopeId) {
          setActiveScopeId(targetCanonicalScopeId);
        } else if (savedScopeId) {
          setActiveScopeId(savedScopeId);
        }
      } else {
        if (!usesLegacyScopeMetadata && !hasExistingMetadataScope) {
          throw new Error('Unable to resolve a valid Gantt project id for this scope. Refresh and try again.');
        }

        if (!shouldCreateNewScope && targetMetadataScopeId) {
          const response = await fetch('/api/project-scopes', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: targetMetadataScopeId, ...payload }),
          });
          const result = await readJsonResponse<{ success?: boolean; error?: string; data?: Scope }>(response, {
            label: 'Update scope metadata',
          });
          if (!response.ok || !result.success) {
            throw new Error(result.error || `Failed to update scope metadata (HTTP ${response.status})`);
          }
          savedScope = result.data;
          const updatedScopes = scopesToMatchAgainst.map((scope) =>
            scope.id === targetMetadataScopeId ? { ...scope, ...savedScope } : scope
          );
          if (!isClearingSchedule) {
            suppressPopulateEffectRef.current = false;
          }
          publishScopes(updatedScopes);
          setActiveScopeId(targetMetadataScopeId);
        } else {
          const response = await fetch('/api/project-scopes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const result = await readJsonResponse<{ success?: boolean; error?: string; data?: Scope }>(response, {
            label: 'Create scope metadata',
          });
          if (!response.ok || !result.success) {
            throw new Error(result.error || `Failed to create scope metadata (HTTP ${response.status})`);
          }
          savedScope = result.data;
          const newScope: Scope = { ...savedScope } as Scope;

          const filteredScopes = activeScopeId && !isCanonicalScopeId(activeScopeId)
            ? scopesToMatchAgainst.filter((scope) => scope.id !== activeScopeId)
            : scopesToMatchAgainst;

          suppressPopulateEffectRef.current = false;
          publishScopes([...filteredScopes, newScope]);
          setIsCreatingNewScope(false);
          setActiveScopeId(savedScope.id);
        }
      }
      if (usedSpecificDaysFallback) {
        alert('No specific days were selected. Scope was saved as Continuous Range.');
      }
      if (closeAfterSave) {
        onClose();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Failed to save scope:", errorMessage, error);
      alert(`Failed to save scope: ${errorMessage}`);
    } finally {
      if (!isScopeScheduleClearDraft()) {
        suppressPopulateEffectRef.current = false;
      }
      setIsSaving(false);
    }
  };

  const handleDeleteScope = async () => {
    if (!activeScopeId || activeScopeId === NEW_SCOPE_ID) return;
    const deletedScopeId = activeScopeId;
    const scope = effectiveScopes.find((s) => s.id === deletedScopeId);
    const scopeTitle = scope?.title || 'this scope';
    const deletedTitleKey = normalizeText(scope?.title || '');
    const deletedStartKey = dateKey(scope?.startDate);
    const deletedEndKey = dateKey(scope?.endDate);
    if (!window.confirm(`Delete scope "${scopeTitle}"? This cannot be undone.`)) return;

    try {
      const isGeneratedId =
        deletedScopeId.startsWith('fallback-') ||
        deletedScopeId.startsWith('virtual-') ||
        deletedScopeId.startsWith('generated-');

      if (!isGeneratedId) {
        let deletedSomewhere = false;
        let metadataError: string | undefined;
        const cacheJobKey = resolvedJobKey || project.jobKey || '';

        // Try deleting canonical gantt scope first (primary source of truth).
        const ganttRes = await fetch(`/api/gantt-v2/scopes/${deletedScopeId}`, { method: 'DELETE' });
        const ganttJson = await ganttRes.json().catch(() => ({}));
        if (ganttRes.ok && ganttJson?.success) {
          deletedSomewhere = true;
        }

        // Cleanup metadata row by project identity and scope title so it can't be auto-recreated.
        if (resolvedJobKey || project.jobKey) {
          const metadataRes = await fetch(
            `/api/project-scopes?jobKey=${encodeURIComponent(cacheJobKey)}&title=${encodeURIComponent(scopeTitle)}`,
            { method: 'DELETE' }
          );
          const metadataJson = await metadataRes.json().catch(() => ({}));
          metadataError = metadataJson?.error;
          if (metadataRes.ok && metadataJson?.success && Number(metadataJson?.deletedCount || 0) > 0) {
            deletedSomewhere = true;
          }
        }

        if (!deletedSomewhere) {
          throw new Error(ganttJson?.error || metadataError || 'Scope was not deleted');
        }

        persistedScopesByJobKeyRef.current.delete(cacheJobKey);
        ganttProjectsCacheRef.current = { expiresAt: 0, data: null };
      }

      setActiveScopeId(null);
      setIsCreatingNewScope(false);
      const refreshedScopes = await loadCanonicalScopes();
      const remainingBase = refreshedScopes ?? effectiveScopes;
      const remaining = remainingBase.filter((s) => {
        if (s.id === deletedScopeId) return false;

        const sameTitle = deletedTitleKey && normalizeText(s.title || '') === deletedTitleKey;
        if (!sameTitle) return true;

        return !(dateKey(s.startDate) === deletedStartKey && dateKey(s.endDate) === deletedEndKey);
      });
      onScopesUpdated(resolvedJobKey || project.jobKey || '', remaining);
      onClose();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      alert(`Failed to delete scope: ${msg}`);
    }
  };

  const handleStartCreateScope = () => {
    suppressPopulateEffectRef.current = false;
    if (activeScopeId) {
      clearedScheduleScopeIdsRef.current.delete(activeScopeId);
    }
    previousActiveScopeIdRef.current =
      activeScopeId && activeScopeId !== NEW_SCOPE_ID ? activeScopeId : null;
    // Start a fresh scope draft so prior scope values (especially hours) do not leak.
    setScopeDetail(emptyScopeDetail);
    setIsCreatingNewScope(true);
    setActiveScopeId(NEW_SCOPE_ID);
  };

  const handleScopeReorder = async (reorderedScopes: Scope[]) => {
    try {
      // Update predecessors based on new order
      const updatePromises = reorderedScopes.map(async (scope, index) => {
        const newPredecessorId = index > 0 ? reorderedScopes[index - 1].id : null;
        
        // Skip if no change needed
        if (scope.predecessorScopeId === newPredecessorId) {
          return null;
        }
        
        // Call API to update this scope's predecessor
        const res = await fetch(`/api/gantt-v2/scopes/${scope.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            predecessorScopeId: newPredecessorId,
          }),
        });
        
        const result = await readJsonResponse<{ success?: boolean; error?: string; cascadeUpdates?: unknown[] }>(res, {
          label: `Update scope dependency for ${scope.title}`,
        });
        if (!res.ok || !result?.success) {
          throw new Error(result?.error || `Failed to update scope dependency for ${scope.title} (HTTP ${res.status})`);
        }
        
        return result?.cascadeUpdates || [];
      });
      
      await Promise.all(updatePromises);
      
      // Reload scopes to reflect changes
      const updatedScopes = await loadCanonicalScopes();
      if (updatedScopes) {
        setCanonicalScopes(updatedScopes);
        onScopesUpdated(resolvedJobKey || project.jobKey || '', updatedScopes);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      alert(`Failed to reorder scopes: ${msg}`);
    }
  };

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-[70rem] w-full p-6 max-h-[90vh] overflow-y-auto text-gray-900">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="text-lg font-bold">{project.projectName}</div>
            <div className="text-sm text-gray-500">{project.customer}</div>
          </div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl font-bold">x</button>
        </div>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 text-sm bg-gray-50 p-4 rounded">
            <div><span className="font-semibold">Project #:</span><p className="mt-1">{project.projectNumber || "—"}</p></div>
            <div>
              <span className="font-semibold">Total Budgeted Hours:</span>
              <p className="mt-1 text-orange-700 font-bold text-base">
                {displayedTotalBudgetedHours.toFixed(1)}
              </p>
            </div>
            <div className="col-span-2"><span className="font-semibold">Job Key:</span><p className="mt-1">{project.jobKey || "—"}</p></div>
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Scopes</h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleStartCreateScope}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-md border ${
                    isCreatingNewScope
                      ? 'border-orange-500 bg-orange-50 text-orange-700'
                      : 'border-orange-300 text-orange-700 hover:bg-orange-50'
                  }`}
                >
                  + Add Scope
                </button>
              </div>
            </div>
            {scheduledHoursByJobKeyDate && (
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 pb-2 text-[10px] font-bold uppercase text-gray-400">
                <span>Scope</span>
                <span className="text-right">Sched</span>
                <span className="text-right">Unsch</span>
              </div>
            )}
            <div className="grid gap-2 max-h-40 overflow-y-auto">
              {isLoadingScopes ? (
                <div className="text-sm text-gray-400 italic px-1">Loading scopes...</div>
              ) : visibleScopes.length === 0 ? (
                <div className="text-sm text-gray-500">No scopes yet.</div>
              ) : (
                visibleScopes.map((scope, index) => {
                  const scopeTasks = normalizeTaskEntries(scope.tasks);
                  const scopeHours = getDisplayedScopeHours(scope);
                  const scheduledHours = getScheduledHoursForScope(scope);
                  const unscheduledHours = Math.max(scopeHours - scheduledHours, 0);
                  const isNew = scope.id === NEW_SCOPE_ID;
                  const predecessorScope = !isNew && index > 0 ? visibleScopes[index - 1] : null;
                  const isDraggedOver = draggedScopeId && draggedScopeId !== scope.id;
                  const isExpanded = expandedScopeRows.has(scope.id);
                  
                  return (
                  <div
                    key={scope.id}
                    draggable={!isNew}
                    onDragStart={(e) => {
                      if (!isNew) {
                        setDraggedScopeId(scope.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }
                    }}
                    onDragOver={(e) => {
                      if (!isNew && draggedScopeId && draggedScopeId !== scope.id) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                      }
                    }}
                    onDrop={async (e) => {
                      e.preventDefault();
                      if (!isNew && draggedScopeId && draggedScopeId !== scope.id && ganttProjectId) {
                        // Reorder the scopes
                        const draggedIndex = visibleScopes.findIndex(s => s.id === draggedScopeId);
                        const targetIndex = index;
                        
                        if (draggedIndex !== -1 && targetIndex !== -1) {
                          const newOrder = [...visibleScopes];
                          const [draggedItem] = newOrder.splice(draggedIndex, 1);
                          newOrder.splice(targetIndex, 0, draggedItem);
                          
                          // Update predecessors based on new order and persist
                          await handleScopeReorder(newOrder);
                        }
                      }
                      setDraggedScopeId(null);
                    }}
                    onDragEnd={() => setDraggedScopeId(null)}
                    className={`text-left border rounded-md px-3 py-2 transition-colors ${
                      activeScopeId === scope.id ? "border-orange-400 bg-orange-50" : 
                      isDraggedOver ? "border-orange-300 bg-orange-100/30" :
                      "border-gray-200 hover:border-orange-200"
                    } ${!isNew ? 'cursor-move' : ''}`}
                    onClick={() => {
                      suppressPopulateEffectRef.current = false;
                      clearedScheduleScopeIdsRef.current.delete(scope.id);
                      setIsCreatingNewScope(false);
                      setActiveScopeId(scope.id);
                    }}
                  >
                    <div className={scheduledHoursByJobKeyDate ? "grid grid-cols-[1fr_auto_auto] items-center gap-3" : "flex justify-between items-center"}>
                      <div className="flex-1">
                        <div className="text-sm font-semibold flex items-center gap-2">
                          {!isNew && <span className="text-xs text-gray-400">☰</span>}
                          {scopeTasks.length > 0 && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setExpandedScopeRows((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(scope.id)) {
                                    next.delete(scope.id);
                                  } else {
                                    next.add(scope.id);
                                  }
                                  return next;
                                });
                              }}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 hover:text-gray-800 hover:border-gray-400 bg-white"
                              title={isExpanded ? 'Collapse tasks' : 'Expand tasks'}
                            >
                              <svg
                                className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <span>Tasks</span>
                              <span className="text-gray-400">({scopeTasks.length})</span>
                            </button>
                          )}
                          {isNew ? `${scope.title || "New Scope"} (draft)` : (scope.title || "Scope")}
                        </div>
                        <div className="text-xs text-gray-500">
                          {scope.startDate || "No start"} - {scope.endDate || "No end"}
                          {predecessorScope && <span className="ml-2 text-orange-600 font-semibold">→ after {predecessorScope.title}</span>}
                          {shouldExcludePlaceholderScopeHours && isPlaceholderScopeTitle(scope.title) && (
                            <span className="ml-2 text-slate-500 font-medium">planning only</span>
                          )}
                        </div>
                        {isExpanded && scopeTasks.length > 0 && (
                          <div className="mt-2 ml-4 space-y-1">
                            {scopeTasks.map((task, taskIndex) => (
                              <div key={`${scope.id}-preview-task-${taskIndex}`} className="text-xs text-gray-600 leading-tight">
                                • {task.name}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {scheduledHoursByJobKeyDate ? (
                        <>
                          <div className="text-xs font-bold text-orange-700 text-right">
                            {scheduledHours.toFixed(1)}
                          </div>
                          <div className="text-xs font-bold text-gray-600 text-right">
                            {unscheduledHours.toFixed(1)}
                          </div>
                        </>
                      ) : (
                        scopeHours > 0 && (
                          <div className="text-xs font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded">
                            {scopeHours.toFixed(1)} hrs
                          </div>
                        )
                      )}
                    </div>
                  </div>
                );
                })
              )}
            </div>
          </div>

          <div ref={formSectionRef} className="border-t pt-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  {isCreatingNewScope ? "New Scope" : "Edit Scope"}
                </h3>
                <p className="text-xs text-gray-500">
                  {isCreatingNewScope ? "Fill out the details below, then save the new scope." : "Update the selected scope details below."}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {!isCreatingNewScope && activeScopeId && activeScopeId !== NEW_SCOPE_ID && (
                  <>
                    <button
                      type="button"
                      onClick={clearScopeScheduleDates}
                      disabled={isSaving}
                      className="text-xs font-semibold px-3 py-1.5 rounded-md border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:bg-gray-100 disabled:text-gray-400"
                    >
                      Clear Schedule
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveScope(false)}
                      disabled={isSaving || (effectiveLongTermAssignmentContext && !assignmentPmSelection && !isScopeScheduleClearDraft())}
                      className="text-xs font-semibold px-3 py-1.5 rounded-md bg-orange-600 text-white hover:bg-orange-700 disabled:bg-gray-400"
                    >
                      {isSaving ? "Saving..." : "Save Schedule"}
                    </button>
                  </>
                )}
                {isCreatingNewScope && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreatingNewScope(false);
                      setActiveScopeId(previousActiveScopeIdRef.current || selectedScopeId || null);
                    }}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    Cancel New
                  </button>
                )}
              </div>
            </div>
            {effectiveLongTermAssignmentContext && (
              <div className="mb-4 border border-blue-200 bg-blue-50/50 rounded-md p-3">
                <label className="block text-sm font-semibold mb-1">Project Assignment</label>
                <p className="text-[11px] text-gray-600 mb-3">
                  The Project Manager applies to every scope and task in this project.
                  {allowLongTermAssignmentEditing ? ' Foreman remains optional for the currently selected scope.' : ''}
                </p>
                <div className={`grid grid-cols-1 ${allowLongTermAssignmentEditing ? 'md:grid-cols-2' : ''} gap-3`}>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Project Manager</label>
                    <select
                      disabled={savingAssignmentPm}
                      value={assignmentPmSelection}
                      onChange={(e) => handleLongTermPmChange(e.target.value)}
                      className="w-full px-3 py-2 border rounded-md text-sm bg-white"
                    >
                      <option value="">Select Project Manager</option>
                      {effectiveLongTermAssignmentContext.pmOptions.map((pm) => (
                        <option key={pm.id} value={pm.id}>
                          {pm.label}
                        </option>
                      ))}
                    </select>
                    {!assignmentPmSelection && (
                      <p className="mt-1 text-[11px] font-semibold text-red-600">Project Manager is required.</p>
                    )}
                  </div>
                  {allowLongTermAssignmentEditing && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Foreman</label>
                      <select
                        disabled={savingAssignmentForeman || !effectiveLongTermAssignmentContext.scopeOfWork}
                        value={assignmentForemanSelection}
                        onChange={(e) => handleLongTermForemanChange(e.target.value)}
                        className="w-full px-3 py-2 border rounded-md text-sm bg-white disabled:bg-gray-100 disabled:text-gray-500"
                      >
                        <option value="__unassigned__">Unassigned</option>
                        {effectiveLongTermAssignmentContext.foremanOptions.map((foreman) => (
                          <option key={foreman.id} value={foreman.id}>
                            {foreman.label}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-[11px] text-gray-600">
                        {effectiveLongTermAssignmentContext.scopeOfWork
                          ? `Optional for scope: ${effectiveLongTermAssignmentContext.scopeOfWork}`
                          : 'Select a scope to edit its optional foreman assignment.'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-1">Scope Title</label>
              <input ref={titleInputRef} type="text" value={scopeDetail.title || ""} onChange={(e) => setScopeDetail(p => ({ ...p, title: e.target.value }))} className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-orange-500" />
            </div>

            {activeScopeId && activeScopeId !== NEW_SCOPE_ID && (
              <div className="mb-4">
                <label className="block text-sm font-semibold mb-1">Dependency Chain (Reorder in list above)</label>
                {(() => {
                  const activeIndex = visibleScopes.findIndex(s => s.id === activeScopeId);
                  const predecessorScope = activeIndex > 0 ? visibleScopes[activeIndex - 1] : null;
                  const successorScopes = visibleScopes.slice(activeIndex + 1);
                  const hasDirectSuccessor = successorScopes.length > 0;
                  
                  return (
                    <div className="bg-blue-50 border border-blue-200 rounded-md p-3 space-y-2 text-sm">
                      {predecessorScope ? (
                        <div>
                          <span className="font-semibold text-gray-700">Starts after:</span>
                          <div className="text-blue-700 font-semibold mt-1">{predecessorScope.title}</div>
                          <p className="text-[10px] text-gray-500 mt-1">Drag scopes in the list above to change dependencies.</p>
                        </div>
                      ) : (
                        <div>
                          <span className="font-semibold text-gray-700">This is the first scope (no dependencies)</span>
                          <p className="text-[10px] text-gray-500 mt-1">Drag other scopes below this one to make them dependent.</p>
                        </div>
                      )}
                      {hasDirectSuccessor && (
                        <div className="border-t border-blue-200 pt-2">
                          <span className="font-semibold text-gray-700">Next in chain:</span>
                          <div className="text-blue-700 text-xs mt-1">→ {successorScopes[0].title}</div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-semibold mb-2">Scheduling Mode</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSchedulingModeWithConfirm('contiguous')}
                  className={`px-3 py-2 rounded-md border text-sm font-semibold ${scopeDetail.schedulingMode !== 'specific-days' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  Continuous Range
                </button>
                <button
                  type="button"
                  onClick={() => setSchedulingModeWithConfirm('specific-days')}
                  className={`px-3 py-2 rounded-md border text-sm font-semibold ${scopeDetail.schedulingMode === 'specific-days' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  Specific Days
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-semibold mb-1">Start Date</label>
                <input
                  type="date"
                  value={hasManualDateOverride ? (scopeDetail.startDate || "") : (derivedTaskRange?.startDate || scopeDetail.startDate || "")}
                  onChange={(e) => {
                    setHasManualDateOverride(true);
                    setScopeDetail((p) => ({ ...p, startDate: e.target.value }));
                  }}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
                {derivedTaskRange && !hasManualDateOverride && <p className="mt-1 text-[10px] text-gray-500">Driven by task dates.</p>}
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">End Date</label>
                <input
                  type="date"
                  value={hasManualDateOverride ? (scopeDetail.endDate || "") : (derivedTaskRange?.endDate || scopeDetail.endDate || "")}
                  onChange={(e) => {
                    setHasManualDateOverride(true);
                    setScopeDetail((p) => ({ ...p, endDate: e.target.value }));
                  }}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
                {derivedTaskRange && !hasManualDateOverride && <p className="mt-1 text-[10px] text-gray-500">Driven by task dates.</p>}
              </div>
            </div>
            <div className="mb-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={clearScopeScheduleDates}
                disabled={isSaving}
                className="px-3 py-2 border border-red-200 bg-white text-red-700 rounded-md text-xs font-semibold hover:bg-red-50 disabled:bg-gray-100 disabled:text-gray-400"
              >
                Clear Dates
              </button>
              <button
                type="button"
                onClick={() => handleSaveScope(false)}
                disabled={isSaving || (effectiveLongTermAssignmentContext && !assignmentPmSelection && !isScopeScheduleClearDraft())}
                className="px-3 py-2 bg-orange-600 text-white rounded-md text-xs font-semibold hover:bg-orange-700 disabled:bg-gray-400"
              >
                {isSaving ? "Saving..." : "Save Dates"}
              </button>
            </div>

            <div className="bg-orange-50 border border-orange-100 rounded-md p-4 mb-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Manpower</label>
                  <input 
                    type="number" 
                    min="0" 
                    step="0.5" 
                    value={displayedSummaryManpower > 0 ? displayedSummaryManpower : ""} 
                    readOnly={hasScopeTasks}
                    onChange={(e) => {
                      if (hasScopeTasks) return;
                      const nextValue = Number(e.target.value || 0);
                      setScopeDetail((prev) => ({
                        ...prev,
                        manpower: Number.isFinite(nextValue) && nextValue >= 0 ? nextValue : undefined,
                      }));
                    }}
                    className={`w-full px-3 py-2 border rounded-md text-sm font-bold ${hasScopeTasks ? "bg-gray-100" : "bg-white"}`} 
                    placeholder="e.g. 2.0" 
                  />
                  <p className="mt-1 text-[10px] text-gray-400">
                    {hasScopeTasks
                      ? "Auto-derived from task manpower"
                      : "Manual manpower. Scope hours = manpower x 10 x workdays."}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Budgeted Hours</label>
                  <input 
                    type="number" 
                    min="0" 
                    step="0.5" 
                    value={displayedSummaryHours > 0 ? displayedSummaryHours : ""} 
                    readOnly
                    className="w-full px-3 py-2 border rounded-md text-sm bg-gray-100 font-bold text-orange-900" 
                    placeholder="Total hours" 
                  />
                  <p className="mt-1 text-[10px] text-gray-400">
                    {hasScopeTasks
                      ? "Total (sum of task manpower x 10 x days)"
                      : `Total (${manualWorkDays} workday${manualWorkDays === 1 ? '' : 's'} x manpower x 10)`}
                  </p>
                </div>
              </div>
              
              {(derivedTaskRange?.startDate || scopeDetail.startDate) && (derivedTaskRange?.endDate || scopeDetail.endDate) && (
                <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
                  {(() => {
                    const manpowerRequested = displayedSummaryManpower || 0;
                    const dailyUsage = manpowerRequested * 10;
                    const companyLimit = companyCapacity; 
                    const effectiveStartDate = derivedTaskRange?.startDate || scopeDetail.startDate || '';
                    
                    // Sum up all OTHER scopes for the start date to give a real-time snapshot
                    let companyWideManpowerOnDay = 0;
                    if (allScopes && effectiveStartDate) {
                      const targetDateStr = effectiveStartDate;
                      Object.values(allScopes).forEach(projectScopes => {
                        projectScopes.forEach(s => {
                          // Skip the one we are currently editing to avoid double counting
                          if (activeScopeId && s.id === activeScopeId) return;
                          
                          if (s.startDate && s.endDate) {
                            if (targetDateStr >= s.startDate && targetDateStr <= s.endDate) {
                              companyWideManpowerOnDay += (s.manpower || 0);
                            }
                          }
                        });
                      });
                    }

                    const otherUsage = companyWideManpowerOnDay * 10;
                    const remaining = companyLimit - otherUsage - dailyUsage;
                    
                    return (
                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-sm font-bold text-green-800">
                          <span>Total Company Availability ({effectiveStartDate}):</span>
                          <span>{companyLimit} hrs ({companyLimit/10} heads)</span>
                        </div>
                        <div className="flex justify-between items-center text-xs text-gray-600">
                          <span>Other Scheduled Jobs:</span>
                          <span>-{otherUsage.toFixed(1)} hrs</span>
                        </div>
                        <div className="flex justify-between items-center text-xs text-red-700 font-semibold">
                          <span>This Scope&apos;s Requirement:</span>
                          <span>-{dailyUsage.toFixed(1)} hrs</span>
                        </div>
                        <div className="border-t border-green-200 mt-2 pt-1 flex justify-between items-center text-sm font-bold text-green-900">
                          <span>Remaining Company Capacity:</span>
                          <span className={remaining < 0 ? "text-red-600" : "text-green-900"}>
                            {remaining.toFixed(1)} hrs
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {scopeDetail.schedulingMode === 'specific-days' && (
              <div className="mb-4 border border-orange-200 bg-orange-50/40 rounded-md p-3">
                <label className="block text-sm font-semibold mb-2">Selected Work Days (manual hours)</label>
                <div className="grid grid-cols-[1fr_130px_auto] gap-2 mb-3">
                  <input
                    type="date"
                    value={newSelectedDayDate}
                    onChange={(e) => setNewSelectedDayDate(e.target.value)}
                    className="px-3 py-2 border rounded-md text-sm bg-white"
                  />
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={newSelectedDayHours}
                    onChange={(e) => setNewSelectedDayHours(e.target.value)}
                    className="px-3 py-2 border rounded-md text-sm bg-white"
                    placeholder="Hours"
                  />
                  <button type="button" onClick={addSelectedDay} className="px-3 py-2 bg-orange-600 text-white rounded-md text-sm font-semibold hover:bg-orange-700">Add Day</button>
                </div>
                {selectedDays.length === 0 ? (
                  <div className="text-xs text-gray-500">No selected days yet. Add specific dates like Mon/Wed/Fri.</div>
                ) : (
                  <div className="space-y-2">
                    {selectedDays.map((entry) => (
                      <div key={entry.date} className="grid grid-cols-[1fr_130px_auto] gap-2 items-center bg-white border border-gray-200 rounded-md px-3 py-2">
                        <div className="text-sm font-semibold text-gray-800">{entry.date}</div>
                        <input
                          type="number"
                          min="0.5"
                          step="0.5"
                          value={entry.hours}
                          onChange={(e) => updateSelectedDayHours(entry.date, Number(e.target.value || 0))}
                          className="px-2 py-1 border rounded text-sm"
                        />
                        <button type="button" onClick={() => removeSelectedDay(entry.date)} className="text-red-600 hover:text-red-800 text-sm font-bold">Remove</button>
                      </div>
                    ))}
                    <div className="text-xs font-semibold text-orange-700">
                      Total selected-day hours: {selectedDays.reduce((sum, entry) => sum + Number(entry.hours || 0), 0).toFixed(1)}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-semibold mb-1">Description</label>
              <textarea value={scopeDetail.description || ""} onChange={(e) => setScopeDetail(p => ({ ...p, description: e.target.value }))} className="w-full px-3 py-2 border rounded-md text-sm" rows={4} />
            </div>
            <div className="mb-4">
              <button
                type="button"
                onClick={() => handleSaveScope(false)}
                disabled={isSaving || (effectiveLongTermAssignmentContext && !assignmentPmSelection && !isScopeScheduleClearDraft())}
                className="px-4 py-2 bg-orange-600 text-white rounded-md text-sm font-semibold hover:bg-orange-700 disabled:bg-gray-400"
              >
                {isSaving ? "Saving..." : "Save Scope"}
              </button>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-2">Tasks (Drag to Reorder Dependencies)</label>
              <p className="text-xs text-gray-500 mb-3">Tasks follow in order within each scope. First task in next scope starts after last task in previous scope.</p>
              <div className="mb-4">
                <label className="block text-xs font-semibold mb-1.5 text-gray-700">Task Name</label>
                <input type="text" value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyPress={(e) => e.key === "Enter" && handleAddTask()} className="w-full px-3 py-2 border rounded-md text-sm" />
              </div>
              <div className="overflow-x-auto pb-2 mb-4">
              <div className="grid min-w-[860px] grid-cols-[160px_110px_120px_120px_110px_auto] gap-4 items-end">
                <div>
                  <label className="block text-xs font-semibold mb-1.5 text-gray-700">Start Date</label>
                  <input type="date" value={newTaskDate} onChange={(e) => setNewTaskDate(e.target.value)} className="w-full px-3 py-2 border rounded-md text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5 text-gray-700"># of Days</label>
                  <input type="number" min="1" step="1" value={newTaskDays} onChange={(e) => setNewTaskDays(e.target.value)} className="w-full px-3 py-2 border rounded-md text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5 text-gray-700">Manpower</label>
                  <input type="number" min="0" step="0.5" value={newTaskManpower} onChange={(e) => setNewTaskManpower(e.target.value)} className="w-full px-3 py-2 border rounded-md text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5 text-gray-700">Hours</label>
                  <input
                    type="text"
                    value={(() => {
                      const mp = toOptionalPositiveNumber(newTaskManpower) || 0;
                      const d = toPositiveWholeDays(newTaskDays) || 0;
                      const hours = mp * 10 * d;
                      return hours > 0 ? hours.toFixed(1) : '';
                    })()}
                    readOnly
                    className="w-full px-3 py-2 border rounded-md text-sm bg-gray-100 text-gray-600"
                    placeholder="Auto"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5 text-gray-700">Yards</label>
                  <input
                    type="text"
                    readOnly
                    value={newTaskYards}
                    onClick={() => openConcreteOrderModal({
                      mode: "new-task",
                      taskLabel: newTask.trim() || "New Task",
                      date: newTaskDate,
                      yards: toOptionalPositiveNumber(newTaskYards),
                    })}
                    className="w-full px-3 py-2 border rounded-md text-sm cursor-pointer bg-white"
                    placeholder="Click to add order"
                  />
                </div>
                <div className="flex items-end justify-start">
                  <button type="button" onClick={handleAddTask} className="px-5 py-2.5 bg-gray-200 rounded-md text-sm font-semibold hover:bg-gray-300 whitespace-nowrap">Add</button>
                </div>
              </div>
              </div>
              {scopeDetail.tasks && scopeDetail.tasks.length > 0 && (
                <div className="space-y-2 bg-gray-50 p-3 rounded overflow-x-auto">
                  {normalizeTaskEntries(scopeDetail.tasks).map((task, index) => {
                    const isDraggedOver = draggedTaskIndex !== null && draggedTaskIndex !== index;
                    const predecessorTask = index > 0 ? scopeDetail.tasks[index - 1] : null;
                    const predecessorName = predecessorTask ? extractTaskName(predecessorTask) : null;
                    const parsedTask = parseTaskEntry(task);
                    const taskHours = getTaskHours(task);
                    
                    return (
                      <div 
                        key={index} 
                        ref={(element) => {
                          taskRowRefs.current[index] = element;
                        }}
                        draggable={true}
                        onDragStart={(e) => {
                          setDraggedTaskIndex(index);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragOver={(e) => {
                          if (draggedTaskIndex !== null && draggedTaskIndex !== index) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (draggedTaskIndex !== null && draggedTaskIndex !== index) {
                            const newTasks = normalizeTaskEntries(scopeDetail.tasks);
                            const draggedTask = newTasks[draggedTaskIndex];
                            newTasks.splice(draggedTaskIndex, 1);
                            newTasks.splice(index, 0, draggedTask);
                            const rollups = calculateTaskRollups(newTasks);
                            setScopeDetail((prev) => ({
                              ...prev,
                              tasks: newTasks,
                              manpower: rollups.manpower > 0 ? rollups.manpower : undefined,
                              hours: rollups.hours > 0 ? rollups.hours : undefined,
                            }));
                          }
                          setDraggedTaskIndex(null);
                        }}
                        onDragEnd={() => setDraggedTaskIndex(null)}
                        className={`bg-white p-2 rounded border cursor-move transition-colors ${ 
                          highlightedTaskIndex === index
                            ? 'border-orange-400 bg-orange-50 shadow-sm'
                            : isDraggedOver
                              ? 'border-orange-300 bg-orange-100/30'
                              : 'border-gray-200'
                        }`}
                      >
                        <div className="grid min-w-[980px] grid-cols-[18px_1fr_120px_80px_90px_95px_250px] items-end gap-2">
                          <span className="text-xs text-gray-400 pb-2">☰</span>
                          <input
                            type="text"
                            value={parsedTask.name}
                            onChange={(e) => updateTaskDateMeta(index, { name: e.target.value })}
                            className="px-2 py-1 border rounded text-xs"
                            placeholder="Task name"
                          />
                          <input
                            type="date"
                            value={parsedTask.startDate}
                            onChange={(e) => updateTaskDateMeta(index, { startDate: e.target.value })}
                            className="px-2 py-1 border rounded text-xs"
                          />
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={parsedTask.days ?? ''}
                            onChange={(e) => {
                              const nextDays = Number(e.target.value || 0);
                              updateTaskDateMeta(index, {
                                days: Number.isFinite(nextDays) && nextDays > 0 ? nextDays : null,
                              });
                            }}
                            className="px-2 py-1 border rounded text-xs"
                            placeholder="Days"
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={parsedTask.manpower ?? ''}
                            onChange={(e) => {
                              const nextValue = Number(e.target.value || 0);
                              updateTaskDateMeta(index, {
                                manpower: Number.isFinite(nextValue) && nextValue >= 0 ? nextValue : null,
                              });
                            }}
                            className="px-2 py-1 border rounded text-xs"
                            placeholder="Manpower"
                          />
                          <input
                            type="text"
                            value={taskHours > 0 ? taskHours.toFixed(1) : ''}
                            readOnly
                            className="px-2 py-1 border rounded text-xs bg-gray-100 text-gray-600"
                            placeholder="Auto hours"
                          />
                          <div className="flex items-center justify-end gap-1.5 overflow-hidden">
                            <input
                              type="text"
                              readOnly
                              value={parsedTask.yards ?? ''}
                              onClick={() => openConcreteOrderModal({
                                mode: "existing-task",
                                taskIndex: index,
                                taskLabel: parsedTask.name,
                                date: parsedTask.startDate,
                                yards: parsedTask.yards,
                              })}
                              className="w-[72px] px-2 py-1 border rounded text-xs cursor-pointer bg-white shrink-0"
                              placeholder="Click"
                            />
                            {(parsedTask.yards || 0) > 0 ? (
                              <button
                                type="button"
                                onClick={() =>
                                  updateTaskDateMeta(index, {
                                    concreteConfirmed: !parsedTask.concreteConfirmed,
                                  })
                                }
                                className={`w-[96px] px-1.5 py-1 rounded text-[11px] font-semibold border whitespace-nowrap shrink-0 ${
                                  parsedTask.concreteConfirmed
                                    ? 'bg-green-600 border-green-700 text-white hover:bg-green-700'
                                    : 'bg-red-600 border-red-700 text-white hover:bg-red-700'
                                }`}
                              >
                                {parsedTask.concreteConfirmed ? 'Confirmed' : 'Not Confirmed'}
                              </button>
                            ) : (
                              <div className="w-[96px] shrink-0" />
                            )}
                            <button
                              type="button"
                              onClick={() => handleRemoveTask(index)}
                              className="text-red-500 hover:text-red-700 font-bold px-1 py-1 leading-none"
                              aria-label="Delete task"
                            >
                              x
                            </button>
                          </div>
                          {predecessorName && (
                            <div className="text-xs text-orange-600 font-semibold ml-6 col-span-full">
                              → after {predecessorName}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-4 border-t">
            <button type="button" onClick={() => handleSaveScope(true)} disabled={isSaving || (effectiveLongTermAssignmentContext && !assignmentPmSelection && !isScopeScheduleClearDraft())} className="flex-1 px-4 py-2 bg-orange-100 text-orange-800 rounded-md text-sm font-semibold hover:bg-orange-200 disabled:bg-gray-200 disabled:text-gray-500">
              Save & Close
            </button>
            {activeScopeId && activeScopeId !== NEW_SCOPE_ID && !activeScopeId.startsWith('fallback-') && !activeScopeId.startsWith('virtual-') && !activeScopeId.startsWith('generated-') && (
              <button type="button" onClick={handleDeleteScope} className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-semibold hover:bg-red-700">
                Delete Scope
              </button>
            )}
            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 rounded-md text-sm font-semibold hover:bg-gray-300">Close</button>
          </div>
        </div>
      </div>
    </div>
    <ConcreteOrderModal
      isOpen={Boolean(concreteModalTarget)}
      project={concreteModalTarget ? concreteProjectRef : null}
      taskLabel={concreteModalTarget?.taskLabel || null}
      initialDate={concreteModalTarget?.date || ""}
      initialYards={concreteModalTarget?.yards ?? null}
      onClose={() => setConcreteModalTarget(null)}
      onSaved={(saved) => {
        if (!concreteModalTarget) return;

        if (concreteModalTarget.mode === "new-task") {
          setNewTaskYards(String(saved.totalYards));
          if (!newTaskDate) {
            setNewTaskDate(saved.date);
          }
        } else if (typeof concreteModalTarget.taskIndex === "number") {
          updateTaskDateMeta(concreteModalTarget.taskIndex, {
            yards: saved.totalYards,
            startDate: concreteModalTarget.date || saved.date,
            concreteConfirmed: false,
          });
        }

        setConcreteModalTarget(null);
      }}
    />
    </>
  );
}
