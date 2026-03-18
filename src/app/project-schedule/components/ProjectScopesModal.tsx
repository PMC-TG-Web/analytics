import React, { useState, useEffect, useMemo } from "react";

import { ProjectInfo, Scope } from "@/types";

type GanttProjectResponse = {
  id: string;
  projectName: string;
  customer: string | null;
  projectNumber: string | null;
  scopes?: Array<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    totalHours: number;
    crewSize: number | null;
    notes: string | null;
  }>;
};

interface ProjectScopesModalProps {
  project: ProjectInfo;
  scopes: Scope[];
  allScopes?: Record<string, Scope[]>; // Map of jobKey -> Scope[] for company-wide capacity
  companyCapacity?: number; // Total available hours per day
  scheduledHoursByJobKeyDate?: Record<string, Record<string, number>>; // jobKey -> dateKey -> hours
  selectedScopeId: string | null;
  selectedScopeTitle?: string | null;
  selectedScheduleDate?: string | null;
  selectedScheduledHours?: number | null;
  selectedForemanId?: string | null;
  dayEditMode?: boolean;
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
  // Priority 1: Use manually entered hours (total budgeted)
  const hoursRaw = scope.hours;
  const hoursValue = typeof hoursRaw === "number" ? hoursRaw : parseFloat(String(hoursRaw));
  if (Number.isFinite(hoursValue) && hoursValue > 0) return hoursValue;

  // Priority 2: Fall back to manpower calculation if hours not set
  const manpowerRaw = scope.manpower;
  const manpowerValue = typeof manpowerRaw === "number" ? manpowerRaw : parseFloat(String(manpowerRaw));
  const days = calculateWorkDays(scope.startDate, scope.endDate);

  if (Number.isFinite(manpowerValue) && manpowerValue > 0 && days > 0) {
    return manpowerValue * 10 * days;
  }

  return 0;
};

export function ProjectScopesModal({
  project,
  scopes,
  allScopes,
  companyCapacity = 210, // Default to 210 if not provided
  scheduledHoursByJobKeyDate,
  selectedScopeId,
  selectedScopeTitle,
  selectedScheduleDate,
  selectedScheduledHours,
  selectedForemanId,
  dayEditMode = false,
  onClose,
  onScopesUpdated,
}: ProjectScopesModalProps) {
  const [activeScopeId, setActiveScopeId] = useState<string | null>(selectedScopeId);
  const [ganttProjectId, setGanttProjectId] = useState<string | null>(null);
  const [canonicalScopes, setCanonicalScopes] = useState<Scope[] | null>(null);
  const [projectBudgetHours, setProjectBudgetHours] = useState<number | null>(null);
  const [scopeDetail, setScopeDetail] = useState<Partial<Scope>>({
    title: "",
    startDate: "",
    endDate: "",
    description: "",
    tasks: [],
    schedulingMode: "contiguous",
    selectedDays: [],
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [newSelectedDayDate, setNewSelectedDayDate] = useState("");
  const [newSelectedDayHours, setNewSelectedDayHours] = useState("10");
  const [paidHolidaySet, setPaidHolidaySet] = useState<Set<string>>(new Set());

  const normalize = (value: string | null | undefined) =>
    (value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const matchesProjectIdentity = (
    item: { customer?: string | null; projectName?: string | null }
  ) => {
    const normalizedItemCustomer = normalize(item.customer);
    const normalizedProjectCustomer = normalize(project.customer);
    const normalizedItemName = normalize(item.projectName);
    const normalizedProjectName = normalize(project.projectName);

    const customerMatch =
      normalizedItemCustomer === normalizedProjectCustomer ||
      normalizedItemCustomer.includes(normalizedProjectCustomer) ||
      normalizedProjectCustomer.includes(normalizedItemCustomer);

    const nameMatch =
      normalizedItemName === normalizedProjectName ||
      normalizedItemName.includes(normalizedProjectName) ||
      normalizedProjectName.includes(normalizedItemName);

    return customerMatch && nameMatch;
  };

  const identityFallbackScopes = useMemo(() => {
    if (scopes.length > 0) return scopes;
    if (!allScopes) return scopes;

    const matched = Object.entries(allScopes).find(([jobKey]) => {
      const [customer = "", , projectName = ""] = String(jobKey).split("~");
      return matchesProjectIdentity({ customer, projectName });
    });

    return matched ? matched[1] : scopes;
  }, [allScopes, scopes, project.customer, project.projectName]);

  const resolvedJobKey = useMemo(() => {
    const explicit = (project.jobKey || '').trim();
    if (explicit) return explicit;

    const customer = (project.customer || '').trim();
    const projectNumber = (project.projectNumber || '').trim();
    const projectName = (project.projectName || '').trim();
    if (!projectName) return '';

    return `${customer}~${projectNumber}~${projectName}`;
  }, [project.customer, project.jobKey, project.projectName, project.projectNumber]);

  // Never let a failed canonical lookup hide already-known scopes from the grid.
  const effectiveScopes =
    canonicalScopes && canonicalScopes.length > 0 ? canonicalScopes : identityFallbackScopes;

  const getEffectiveScopeHours = (scope: Partial<Scope>) => {
    const scopeHours = computeScopeHours(scope);
    if (scopeHours > 0) return scopeHours;

    // If this project is effectively single-scope and scope hours are missing,
    // fall back to schedule-level budgeted hours from the scheduling/WIP chain.
    if ((effectiveScopes?.length || 0) <= 1 && projectBudgetHours && projectBudgetHours > 0) {
      return projectBudgetHours;
    }

    return 0;
  };

  const displayedTotalBudgetedHours =
    projectBudgetHours && projectBudgetHours > 0
      ? projectBudgetHours
      : effectiveScopes.reduce((sum, s) => sum + getEffectiveScopeHours(s), 0);

  const mapGanttScopes = (rows: NonNullable<GanttProjectResponse["scopes"]>): Scope[] =>
    rows.map((scope) => ({
      id: scope.id,
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
    }));

  const loadCanonicalScopes = async (): Promise<Scope[] | null> => {
    const response = await fetch('/api/gantt-v2/projects');
    const result = await response.json();
    if (!response.ok || !result?.success || !Array.isArray(result?.data)) {
      setGanttProjectId(null);
      setCanonicalScopes(null);
      return null;
    }

    const match = (result.data as GanttProjectResponse[]).find((item) =>
      matchesProjectIdentity({ customer: item.customer, projectName: item.projectName })
    );

    if (!match) {
      setGanttProjectId(null);
      setCanonicalScopes(null);
      return null;
    }

    let mappedScopes = mapGanttScopes(match.scopes || []);

    // Merge persisted metadata from project-scopes so description/tasks survive refresh
    // even when the canonical source comes from gantt-v2.
    try {
      if (resolvedJobKey) {
        const projectScopesRes = await fetch(`/api/project-scopes?jobKey=${encodeURIComponent(resolvedJobKey)}`);
        if (projectScopesRes.ok) {
          const projectScopesJson = await projectScopesRes.json();
          let persistedScopes: Scope[] = Array.isArray(projectScopesJson?.data)
            ? projectScopesJson.data
            : (Array.isArray(projectScopesJson?.scopes) ? projectScopesJson.scopes : []);

          // Fallback for jobKey format drift: match by project identity from scope.jobKey parts.
          if (persistedScopes.length === 0) {
            const allScopesRes = await fetch('/api/project-scopes');
            if (allScopesRes.ok) {
              const allScopesJson = await allScopesRes.json();
              const allScopes: Scope[] = Array.isArray(allScopesJson?.data)
                ? allScopesJson.data
                : (Array.isArray(allScopesJson?.scopes) ? allScopesJson.scopes : []);

              const normalizedCustomer = normalize(project.customer);
              const normalizedProjectNumber = normalize(project.projectNumber);
              const normalizedProjectName = normalize(project.projectName);

              persistedScopes = allScopes.filter((scope) => {
                const [scopeCustomer = '', scopeProjectNumber = '', scopeProjectName = ''] = String(scope.jobKey || '').split('~');
                const customerMatch = normalize(scopeCustomer) === normalizedCustomer;
                const projectNumberMatch = normalize(scopeProjectNumber) === normalizedProjectNumber;
                const projectNameMatch = normalize(scopeProjectName) === normalizedProjectName;
                return customerMatch && projectNumberMatch && projectNameMatch;
              });
            }
          }

          const persistedByTitle = new Map<string, Scope>();
          persistedScopes.forEach((scope) => {
            const key = normalize(scope?.title || '');
            if (key) persistedByTitle.set(key, scope);
          });

          mappedScopes = mappedScopes.map((scope) => {
            const persisted = persistedByTitle.get(normalize(scope.title || ''));
            if (!persisted) return scope;
            return {
              ...scope,
              description: persisted.description || scope.description || '',
              tasks: Array.isArray(persisted.tasks) ? persisted.tasks : (scope.tasks || []),
              schedulingMode: persisted.schedulingMode === 'specific-days' ? 'specific-days' : (scope.schedulingMode || 'contiguous'),
              selectedDays: Array.isArray(persisted.selectedDays) ? persisted.selectedDays : (scope.selectedDays || []),
            };
          });
        }
      }
    } catch (error) {
      console.warn('Failed to merge project-scope metadata into canonical scopes:', error);
    }

    setGanttProjectId(match.id);
    setCanonicalScopes(mappedScopes);
    return mappedScopes;
  };

  const upsertProjectScopeMetadata = async (payload: Record<string, any>) => {
    const titleKey = normalize(payload?.title || '');
    if (!titleKey) return;

    if (!resolvedJobKey) return;

    const response = await fetch(`/api/project-scopes?jobKey=${encodeURIComponent(resolvedJobKey)}`);
    const result = await response.json().catch(() => ({}));
    const projectScopes: Scope[] = Array.isArray(result?.data)
      ? result.data
      : (Array.isArray(result?.scopes) ? result.scopes : []);

    const existing = projectScopes.find((scope) => normalize(scope?.title || '') === titleKey);

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
  };

  const loadProjectBudgetHours = async () => {
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

    setProjectBudgetHours(foundHours);
  };

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

  useEffect(() => {
    if (selectedScopeId) {
      setActiveScopeId(selectedScopeId);
      return;
    }

    if (selectedScopeTitle) {
      const match = effectiveScopes.find(
        (scope) => normalize(scope.title) === normalize(selectedScopeTitle)
      );
      if (match) {
        setActiveScopeId(match.id);
        return;
      }
    }

    setActiveScopeId(null);
  }, [selectedScopeId, selectedScopeTitle, effectiveScopes]);

  useEffect(() => {
    loadCanonicalScopes().catch((error) => {
      console.error('Failed to load canonical gantt scopes:', error);
      setGanttProjectId(null);
      setCanonicalScopes(null);
    });

    loadProjectBudgetHours().catch((error) => {
      console.error('Failed to load project budget hours:', error);
      setProjectBudgetHours(null);
    });
  }, [project.customer, project.projectName, project.jobKey]);

  useEffect(() => {
    const loadPaidHolidays = async () => {
      try {
        const response = await fetch('/api/holidays?page=1&pageSize=500');
        if (!response.ok) return;
        const json = await response.json().catch(() => ({}));
        const holidays = Array.isArray(json?.data) ? json.data : [];
        const paid = holidays
          .filter((h: any) => Boolean(h?.isPaid) && typeof h?.date === 'string')
          .map((h: any) => String(h.date));
        setPaidHolidaySet(new Set(paid));
      } catch (error) {
        console.warn('Failed to load paid holidays for scope validation:', error);
      }
    };

    loadPaidHolidays();
  }, []);

  useEffect(() => {
    const scope = effectiveScopes.find((item) => item.id === activeScopeId);
    if (!scope) {
      setScopeDetail({
        title: "",
        startDate: "",
        endDate: "",
        manpower: undefined,
        hours: undefined,
        description: "",
        tasks: [],
        schedulingMode: "contiguous",
        selectedDays: [],
      });
      return;
    }

    setScopeDetail({
      title: scope.title || "",
      startDate: selectedScheduleDate || scope.startDate || "",
      endDate: selectedScheduleDate || scope.endDate || "",
      manpower:
        typeof selectedScheduledHours === 'number' && Number.isFinite(selectedScheduledHours)
          ? selectedScheduledHours / 10
          : scope.manpower,
      hours:
        typeof selectedScheduledHours === 'number' && Number.isFinite(selectedScheduledHours)
          ? selectedScheduledHours
          : getEffectiveScopeHours(scope),
      description: scope.description || "",
      tasks: Array.isArray(scope.tasks) ? scope.tasks : [],
      schedulingMode: scope.schedulingMode === 'specific-days' ? 'specific-days' : 'contiguous',
      selectedDays: Array.isArray(scope.selectedDays) ? scope.selectedDays : [],
    });
  }, [activeScopeId, effectiveScopes, selectedScheduleDate, selectedScheduledHours, projectBudgetHours]);

  const handleAddTask = () => {
    const trimmed = newTask.trim();
    if (!trimmed) return;
    setScopeDetail((prev) => ({
      ...prev,
      tasks: [...(prev.tasks || []), trimmed],
    }));
    setNewTask("");
  };

  const handleRemoveTask = (index: number) => {
    setScopeDetail((prev) => ({
      ...prev,
      tasks: prev.tasks?.filter((_, i) => i !== index) || [],
    }));
  };

  const selectedDays = Array.isArray(scopeDetail.selectedDays)
    ? scopeDetail.selectedDays
        .map((entry: any) => ({
          date: String(entry?.date || '').trim(),
          hours: Number(entry?.hours || 0),
          foreman: entry?.foreman ? String(entry.foreman) : null,
        }))
        .filter((entry: any) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && Number.isFinite(entry.hours) && entry.hours > 0)
        .sort((a: any, b: any) => a.date.localeCompare(b.date))
    : [];

  const getDayOfWeek = (dateKey: string) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Date(year, month - 1, day).getDay();
  };

  const isWeekendDate = (dateKey: string) => {
    const weekday = getDayOfWeek(dateKey);
    return weekday === 0 || weekday === 6;
  };

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

  const addSelectedDay = () => {
    const date = newSelectedDayDate.trim();
    const hours = Number(newSelectedDayHours || 0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(hours) || hours <= 0) return;

    if (isWeekendDate(date)) {
      alert('Selected day is on a weekend. Please choose a weekday.');
      return;
    }

    if (paidHolidaySet.has(date)) {
      alert('Selected day is a paid holiday. Please choose another date.');
      return;
    }

    const existingWithoutDate = selectedDays.filter((entry: any) => entry.date !== date);
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

  const handleSaveScope = async () => {
    setIsSaving(true);
    try {
      if (scopeDetail.schedulingMode === 'specific-days' && selectedDays.length === 0) {
        throw new Error('Specific Days mode requires at least one selected work day.');
      }

      const invalidSpecificDay = selectedDays.find((entry) => isWeekendDate(entry.date) || paidHolidaySet.has(entry.date));
      if (scopeDetail.schedulingMode === 'specific-days' && invalidSpecificDay) {
        throw new Error(`Specific day is invalid: ${invalidSpecificDay.date}. Weekends and paid holidays are blocked.`);
      }

      if (dayEditMode && !selectedScheduleDate) {
        throw new Error('Day edit context is missing. Close and reopen the card from the schedule grid.');
      }

      if (selectedScheduleDate && (selectedScopeTitle || scopeDetail.title)) {
        const scopeName = (scopeDetail.title || selectedScopeTitle || '').trim();
        const dayHoursRaw = scopeDetail.hours;
        const dayHours = typeof dayHoursRaw === 'number' ? dayHoursRaw : parseFloat(String(dayHoursRaw || '0'));

        const response = await fetch('/api/short-term-schedule/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobKey: project.jobKey,
            scopeOfWork: scopeName,
            sourceDateKey: selectedScheduleDate,
            targetDateKey: selectedScheduleDate,
            targetForemanId: selectedForemanId === '__unassigned__' ? null : selectedForemanId,
            hours: Number.isFinite(dayHours) ? dayHours : 0,
          }),
        });

        const result = await response.json();
        if (!response.ok || !result?.success) {
          throw new Error(result?.error || 'Failed to update daily assignment');
        }

        // In day-edit mode we still need to persist scope metadata from the modal
        // (description/tasks), but we must avoid rewriting scope total hours.
        const metadataPayload: Record<string, any> = {
          jobKey: resolvedJobKey,
          title: scopeName || 'Scope',
          startDate: scopeDetail.startDate || selectedScheduleDate,
          endDate: scopeDetail.endDate || selectedScheduleDate,
          description: scopeDetail.description || '',
          tasks: (scopeDetail.tasks || []).filter((task) => task.trim()),
          schedulingMode: scopeDetail.schedulingMode === 'specific-days' ? 'specific-days' : 'contiguous',
          selectedDays: Array.isArray(scopeDetail.selectedDays) ? scopeDetail.selectedDays : [],
        };
        await upsertProjectScopeMetadata(metadataPayload);

        const updatedScopes = effectiveScopes.map((scope) => {
          if (normalize(scope.title) !== normalize(scopeName)) return scope;
          return {
            ...scope,
            description: metadataPayload.description,
            tasks: metadataPayload.tasks,
            schedulingMode: metadataPayload.schedulingMode,
            selectedDays: metadataPayload.selectedDays,
          };
        });

        onScopesUpdated(resolvedJobKey || project.jobKey || '', updatedScopes);
        onClose();
        return;
      }

      const payload: Record<string, any> = {
        jobKey: resolvedJobKey,
        title: (scopeDetail.title || "Scope").trim() || "Scope",
        startDate: scopeDetail.schedulingMode === 'specific-days'
          ? (selectedDays[0]?.date || scopeDetail.startDate || "")
          : (scopeDetail.startDate || ""),
        endDate: scopeDetail.schedulingMode === 'specific-days'
          ? (selectedDays[selectedDays.length - 1]?.date || scopeDetail.endDate || "")
          : (scopeDetail.endDate || ""),
        description: scopeDetail.description || "",
        tasks: (scopeDetail.tasks || []).filter((task) => task.trim()),
        schedulingMode: scopeDetail.schedulingMode === 'specific-days' ? 'specific-days' : 'contiguous',
        selectedDays: selectedDays,
      };

      // Only include manpower and hours if they have valid values
      if (scopeDetail.manpower !== undefined && scopeDetail.manpower !== null) {
        payload.manpower = scopeDetail.manpower;
      }
      
      const computedHours = computeScopeHours(scopeDetail);
      if (computedHours > 0) {
        payload.hours = computedHours;
      }

      const isGeneratedScopeId = !!activeScopeId && (
        activeScopeId.startsWith('fallback-') ||
        activeScopeId.startsWith('virtual-') ||
        activeScopeId.startsWith('generated-')
      );

      let savedScope;
      if (ganttProjectId) {
        const ganttPayload = {
          title: payload.title,
          startDate: payload.startDate || null,
          endDate: payload.endDate || null,
          totalHours: computedHours,
          crewSize: payload.manpower ?? null,
          notes: payload.description || null,
        };

        if (activeScopeId && !isGeneratedScopeId) {
          const response = await fetch(`/api/gantt-v2/scopes/${activeScopeId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ganttPayload),
          });
          const result = await response.json();
          if (!result.success) throw new Error(result.error || 'Failed to update scope');
        } else {
          const response = await fetch(`/api/gantt-v2/projects/${ganttProjectId}/scopes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ganttPayload),
          });
          const result = await response.json();
          if (!result.success) throw new Error(result.error || 'Failed to create scope');
          savedScope = result.data;
          if (savedScope?.id) {
            setActiveScopeId(savedScope.id);
          }
        }

        // Persist description/tasks and any local metadata to project-scopes so
        // they are not lost on refresh when canonical data comes from gantt-v2.
        await upsertProjectScopeMetadata(payload);

        const refreshedScopes = await loadCanonicalScopes();
        onScopesUpdated(
          resolvedJobKey || project.jobKey || '',
          refreshedScopes && refreshedScopes.length > 0 ? refreshedScopes : effectiveScopes
        );
      } else {
        if (activeScopeId && !isGeneratedScopeId) {
          const response = await fetch('/api/project-scopes', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: activeScopeId, ...payload }),
          });
          const result = await response.json();
          if (!result.success) throw new Error(result.error || 'Failed to update scope');
          savedScope = result.data;
          const updatedScopes = effectiveScopes.map((scope) =>
            scope.id === activeScopeId ? { ...scope, ...savedScope } : scope
          );
          onScopesUpdated(resolvedJobKey || project.jobKey || '', updatedScopes);
        } else {
          const response = await fetch('/api/project-scopes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const result = await response.json();
          if (!result.success) throw new Error(result.error || 'Failed to create scope');
          savedScope = result.data;
          const newScope: Scope = { ...savedScope } as Scope;

          const filteredScopes = isGeneratedScopeId
            ? effectiveScopes.filter((scope) => scope.id !== activeScopeId)
            : effectiveScopes;

          onScopesUpdated(resolvedJobKey || project.jobKey || '', [...filteredScopes, newScope]);
          setActiveScopeId(savedScope.id);
        }
      }
      onClose();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Failed to save scope:", errorMessage, error);
      alert(`Failed to save scope: ${errorMessage}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetSchedule = async () => {
    if (!project.jobKey) {
      alert("Cannot reset schedule: No job key found.");
      return;
    }

    alert("Reset Schedule functionality is currently being migrated to the new API. This feature will be available soon.");
    
    // TODO: Implement reset schedule via API
    // This will require endpoints for:
    // - DELETE /api/active-schedule?jobKey={jobKey}
    // - POST /api/active-schedule/rebuild
    // - POST /api/scope-tracking/recalculate
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto text-gray-900">
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
                  onClick={handleResetSchedule} 
                  disabled={isResetting}
                  className="text-xs font-semibold px-3 py-1.5 rounded-md border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isResetting ? "Resetting..." : "Reset Schedule"}
                </button>
                <button type="button" onClick={() => setActiveScopeId(null)} className="text-xs font-semibold px-3 py-1.5 rounded-md border border-orange-300 text-orange-700 hover:bg-orange-50">+ Add Scope</button>
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
              {effectiveScopes.filter(s => !s.id?.startsWith('fallback-') && !s.id?.startsWith('virtual-') && !s.id?.startsWith('generated-')).length === 0 ? (
                <div className="text-sm text-gray-500">No scopes yet.</div>
              ) : (
                effectiveScopes
                  .filter(s => !s.id?.startsWith('fallback-') && !s.id?.startsWith('virtual-') && !s.id?.startsWith('generated-'))
                  .map((scope) => {
                  const scopeHours = getEffectiveScopeHours(scope);
                  const scheduledHours = getScheduledHoursForScope(scope);
                  const unscheduledHours = Math.max(scopeHours - scheduledHours, 0);
                  return (
                  <button
                    key={scope.id}
                    type="button"
                    onClick={() => setActiveScopeId(scope.id)}
                    className={`text-left border rounded-md px-3 py-2 transition-colors ${
                      activeScopeId === scope.id ? "border-orange-400 bg-orange-50" : "border-gray-200 hover:border-orange-200"
                    }`}
                  >
                    <div className={scheduledHoursByJobKeyDate ? "grid grid-cols-[1fr_auto_auto] items-center gap-3" : "flex justify-between items-center"}>
                      <div>
                        <div className="text-sm font-semibold">{scope.title || "Scope"}</div>
                        <div className="text-xs text-gray-500">
                          {scope.startDate || "No start"} - {scope.endDate || "No end"}
                        </div>
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
                  </button>
                );
                })
              )}
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-1">Scope Title</label>
              <input type="text" value={scopeDetail.title || ""} onChange={(e) => setScopeDetail(p => ({ ...p, title: e.target.value }))} className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-orange-500" />
            </div>

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
                <input type="date" value={scopeDetail.startDate || ""} onChange={(e) => setScopeDetail(p => ({ ...p, startDate: e.target.value }))} className="w-full px-3 py-2 border rounded-md text-sm" />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">End Date</label>
                <input type="date" value={scopeDetail.endDate || ""} onChange={(e) => setScopeDetail(p => ({ ...p, endDate: e.target.value }))} className="w-full px-3 py-2 border rounded-md text-sm" />
              </div>
            </div>

            <div className="bg-orange-50 border border-orange-100 rounded-md p-4 mb-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Manpower</label>
                  <input 
                    type="number" 
                    min="0" 
                    step="0.5" 
                    value={scopeDetail.manpower ?? ""} 
                    onChange={(e) => {
                      const mp = e.target.value ? parseFloat(e.target.value) : 0;
                      const days = calculateWorkDays(scopeDetail.startDate, scopeDetail.endDate);
                      // Auto-calculate Budgeted Hours: Manpower * 10 hrs * Days
                      setScopeDetail(p => ({
                        ...p,
                        manpower: mp,
                        hours: p.schedulingMode === 'specific-days'
                          ? (p.hours ?? selectedDays.reduce((sum, entry) => sum + Number(entry.hours || 0), 0))
                          : mp * 10 * days,
                      }));
                    }} 
                    className="w-full px-3 py-2 border rounded-md text-sm bg-white font-bold" 
                    placeholder="e.g. 2.0" 
                  />
                  <p className="mt-1 text-[10px] text-gray-400">Heads assigned</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Budgeted Hours</label>
                  <input 
                    type="number" 
                    min="0" 
                    step="0.5" 
                    value={scopeDetail.hours ?? ""} 
                    onChange={(e) => setScopeDetail(p => ({ ...p, hours: e.target.value ? parseFloat(e.target.value) : undefined }))} 
                    className="w-full px-3 py-2 border rounded-md text-sm bg-white font-bold text-orange-900" 
                    placeholder="Total hours" 
                  />
                  <p className="mt-1 text-[10px] text-gray-400">Total (Manpower x 10 x Days)</p>
                </div>
              </div>
              
              {scopeDetail.startDate && scopeDetail.endDate && (
                <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
                  {(() => {
                    const manpowerRequested = scopeDetail.manpower || 0;
                    const dailyUsage = manpowerRequested * 10;
                    const companyLimit = companyCapacity; 
                    
                    // Sum up all OTHER scopes for the start date to give a real-time snapshot
                    let companyWideManpowerOnDay = 0;
                    if (allScopes && scopeDetail.startDate) {
                      const targetDateStr = scopeDetail.startDate;
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
                          <span>Total Company Availability ({scopeDetail.startDate}):</span>
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
              <label className="block text-sm font-semibold mb-2">Tasks</label>
              <div className="flex gap-2 mb-3">
                <input type="text" value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyPress={(e) => e.key === "Enter" && handleAddTask()} className="flex-1 px-3 py-2 border rounded-md text-sm" />
                <button type="button" onClick={handleAddTask} className="px-4 py-2 bg-gray-200 rounded-md text-sm font-semibold hover:bg-gray-300">Add</button>
              </div>
              {scopeDetail.tasks && scopeDetail.tasks.length > 0 && (
                <div className="space-y-2 bg-gray-50 p-3 rounded">
                  {scopeDetail.tasks.map((task, index) => (
                    <div key={index} className="flex items-start justify-between gap-2 bg-white p-2 rounded border border-gray-200">
                      <div className="text-sm flex-1">{task}</div>
                      <button type="button" onClick={() => handleRemoveTask(index)} className="text-red-500 hover:text-red-700 font-bold">x</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-4 border-t">
            <button type="button" onClick={handleSaveScope} disabled={isSaving} className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-md text-sm font-semibold hover:bg-orange-700 disabled:bg-gray-400">
              {isSaving ? "Saving..." : "Save Scope of Work"}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 rounded-md text-sm font-semibold hover:bg-gray-300">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
