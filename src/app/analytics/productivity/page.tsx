"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import FormsCloseoutPanel from "./FormsCloseoutPanel";
import {
  calculateWeightedCompletion,
  type WeightedCompletion,
} from "@/lib/productivityWeightedCompletion";

const PROJECT_REVIEW_EMAILS = [
  "ProjectEnd@pmcdecor.com",
];

type ProductivityLine = {
  companyId: string;
  projectId: string;
  projectNumber: string | null;
  projectName: string;
  customer: string | null;
  projectStatus: string | null;
  contractId: string | null;
  poNumber: string | null;
  poTitle: string | null;
  poStatus: string | null;
  vendorName: string | null;
  lineItemId: string;
  position: number | null;
  description: string | null;
  costCode: string | null;
  costType: string | null;
  wbsCode: string | null;
  uom: string | null;
  expectedQuantity: number;
  usedQuantity: number;
  remainingQuantity: number;
  quantityCompleteRatio: number | null;
  productivityLogCount: number;
  firstActivityDate: string | null;
  lastActivityDate: string | null;
  aliasCount: number;
  reviewedAliasCount: number;
};

type ApiSummary = {
  projectCount: number;
  poCount: number;
  lineCount: number;
  activeLineCount: number;
  productivityCount: number;
  matchedProductivityCount: number;
  unmatchedProductivityCount: number;
  productivityMatchRate: number;
  sourceLineCount: number;
  aliasCount: number;
  reviewedAliasCount: number;
  timecardEntryCount: number;
  timecardHours: number;
  expectedLaborHours: number;
  laborProjectCount: number;
};

type LaborGroup = {
  companyId: string;
  projectId: string;
  key: string;
  scopeCode: string;
  description: string;
  costCodeId: string | null;
  costCode: string | null;
  originalExpectedHours: number;
  approvedChangeHours: number;
  expectedHours: number;
  totalHours: number;
  remainingHours: number;
  laborBurnRatio: number | null;
  entryCount: number;
  firstEntryDate: string | null;
  lastEntryDate: string | null;
};

type ApiResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  generatedAt?: string;
  summary?: ApiSummary;
  lines?: ProductivityLine[];
  laborGroups?: LaborGroup[];
};

type ProjectReview = {
  projectId: string;
  projectNumber: string | null;
  projectName: string;
  status: string;
  reviewedAt: string | null;
  reviewedByEmail: string | null;
  notificationEmail: string | null;
  notificationStatus: "not_sent" | "pending" | "sent" | "failed";
  notificationError: string | null;
  weightedCompletion: number | null;
  updatedAt: string;
};

type ReviewApiResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  alreadyCompleted?: boolean;
  reviews?: ProjectReview[];
  review?: ProjectReview;
};

type ReviewDialogState = {
  project: ProjectGroup;
  completion: WeightedCompletion;
};

async function readJsonResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  if (!raw.trim()) {
    throw new Error(
      `The server returned an empty response (${response.status} ${response.statusText || "Unknown error"}).`,
    );
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `The server returned an invalid response (${response.status} ${response.statusText || "Unknown error"}).`,
    );
  }
}

type ProductivityLogDetail = {
  logId: string | null;
  projectId: string;
  sourceLineItemId: string | null;
  lineItemId: string;
  aliasApplied: boolean;
  date: string | null;
  status: string | null;
  position: number | null;
  poNumber: string | null;
  poTitle: string | null;
  lineDescription: string | null;
  quantityUsed: number;
  createdByName: string | null;
  foreman: string | null;
  crew: string | null;
  hours: number | null;
  notes: string | null;
};

type ProductivityLogResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  logs?: ProductivityLogDetail[];
};

type TimecardEntryDetail = {
  id: string;
  procoreId: string | null;
  date: string | null;
  hours: number;
  employeeName: string | null;
  laborDescription: string;
  costCode: string | null;
  notes: string | null;
  timeType: string | null;
  status: string | null;
  timeIn: string | null;
  timeOut: string | null;
  lunchTime: number | null;
  createdByName: string | null;
  subJobName: string | null;
  billable: boolean | null;
  source: "timecard" | "productivity_closeout";
};

type TimecardEntryResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  entries?: TimecardEntryDetail[];
};

type QuantityTotals = {
  uom: string;
  expected: number;
  used: number;
  lineCount: number;
};

type PoGroup = {
  key: string;
  contractId: string | null;
  poNumber: string | null;
  poTitle: string | null;
  poStatus: string | null;
  vendorName: string | null;
  lines: ProductivityLine[];
};

type ProjectGroup = {
  projectId: string;
  projectNumber: string | null;
  projectName: string;
  customer: string | null;
  projectStatus: string | null;
  pos: PoGroup[];
};

type DescriptionGroup = {
  key: string;
  companyId: string;
  projectId: string;
  description: string;
  uom: string;
  expectedQuantity: number;
  usedQuantity: number;
  remainingQuantity: number;
  quantityCompleteRatio: number | null;
  productivityLogCount: number;
  lastActivityDate: string | null;
  lineCount: number;
  lineItemIds: string[];
  poLabels: string[];
  costCodes: string[];
};

const DEFAULT_COMPANY_ID = process.env.NEXT_PUBLIC_PROCORE_COMPANY_ID || "";

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number): string {
  return `${(value * 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })}%`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function summarizeQuantities(lines: ProductivityLine[]): QuantityTotals[] {
  const totals = new Map<string, QuantityTotals>();
  for (const line of lines) {
    const uom = (line.uom || "units").trim().toUpperCase();
    const current = totals.get(uom) || { uom, expected: 0, used: 0, lineCount: 0 };
    current.expected += line.expectedQuantity;
    current.used += line.usedQuantity;
    current.lineCount += 1;
    totals.set(uom, current);
  }
  return [...totals.values()].sort((a, b) => b.used - a.used || a.uom.localeCompare(b.uom));
}

function groupLinesByDescription(lines: ProductivityLine[]): DescriptionGroup[] {
  type MutableDescriptionGroup = Omit<DescriptionGroup, "lineItemIds" | "poLabels" | "costCodes" | "quantityCompleteRatio"> & {
    lineItemIds: Set<string>;
    poLabels: Set<string>;
    costCodes: Set<string>;
  };

  const groups = new Map<string, MutableDescriptionGroup>();
  for (const line of lines) {
    const description = (line.description || "No description").trim().replace(/\s+/g, " ");
    const normalizedDescription = description.toLocaleLowerCase();
    const uom = (line.uom || "units").trim().toUpperCase();
    const key = `${normalizedDescription}:${uom}`;
    const current = groups.get(key) || {
      key,
      companyId: line.companyId,
      projectId: line.projectId,
      description,
      uom,
      expectedQuantity: 0,
      usedQuantity: 0,
      remainingQuantity: 0,
      productivityLogCount: 0,
      lastActivityDate: null,
      lineCount: 0,
      lineItemIds: new Set<string>(),
      poLabels: new Set<string>(),
      costCodes: new Set<string>(),
    };

    current.expectedQuantity += line.expectedQuantity;
    current.usedQuantity += line.usedQuantity;
    current.remainingQuantity += line.remainingQuantity;
    current.productivityLogCount += line.productivityLogCount;
    current.lineCount += 1;
    current.lineItemIds.add(line.lineItemId);
    const poLabel = line.poNumber || line.poTitle || "Unassigned PO";
    current.poLabels.add(poLabel);
    const costCode = line.costCode || line.wbsCode;
    if (costCode) current.costCodes.add(costCode);
    if (line.lastActivityDate && (!current.lastActivityDate || line.lastActivityDate > current.lastActivityDate)) {
      current.lastActivityDate = line.lastActivityDate;
    }
    groups.set(key, current);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      quantityCompleteRatio:
        group.expectedQuantity === 0 ? null : group.usedQuantity / group.expectedQuantity,
      lineItemIds: [...group.lineItemIds].sort((a, b) => a.localeCompare(b)),
      poLabels: [...group.poLabels].sort((a, b) => a.localeCompare(b)),
      costCodes: [...group.costCodes].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.description.localeCompare(b.description) || a.uom.localeCompare(b.uom));
}

function QuantityChips({ totals, limit = 4 }: { totals: QuantityTotals[]; limit?: number }) {
  const visible = totals.slice(0, limit);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((total) => {
        const ratio = total.expected > 0 ? total.used / total.expected : null;
        return (
          <span
            key={total.uom}
            className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700"
            title={`${formatNumber(total.used)} used across ${total.lineCount} lines`}
          >
            {formatNumber(total.used)} / {formatNumber(total.expected)} {total.uom}
            {ratio !== null ? ` · ${formatPercent(ratio)}` : ""}
          </span>
        );
      })}
      {totals.length > limit && (
        <span className="text-[11px] font-bold text-slate-500">+{totals.length - limit} UOM</span>
      )}
    </div>
  );
}

function ProgressBar({ ratio, missingLabel = "No budget qty" }: { ratio: number | null; missingLabel?: string }) {
  if (ratio === null) return <span className="text-[11px] font-bold text-amber-700">{missingLabel}</span>;
  const width = Math.min(100, Math.max(0, ratio * 100));
  const color = ratio > 1 ? "bg-rose-500" : ratio >= 0.85 ? "bg-emerald-500" : "bg-teal-600";
  return (
    <div className="min-w-28">
      <div className="mb-1 flex justify-between text-[11px] font-black text-slate-700">
        <span>{formatPercent(ratio)}</span>
        {ratio > 1 && <span className="text-rose-700">Over</span>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

const COMPLETION_LABELS = {
  concrete: "Concrete",
  rebar: "Rebar",
  labor: "Labor",
  other: "Other",
} as const;

function WeightedCompletionBadge({
  completion,
  dark = false,
}: {
  completion: WeightedCompletion;
  dark?: boolean;
}) {
  const title = completion.breakdown.length
    ? completion.breakdown
        .map((item) => `${COMPLETION_LABELS[item.category]} ${formatPercent(item.ratio)} × ${formatPercent(item.weight)}`)
        .join(" + ")
    : "No expected quantities or labor hours";

  return (
    <span
      title={title}
      className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-black ${
        dark
          ? "border-white/20 bg-white/10 text-white"
          : "border-teal-200 bg-teal-50 text-teal-800"
      }`}
    >
      Weighted {completion.ratio === null ? "—" : formatPercent(completion.ratio)}
    </span>
  );
}

function LaborCompletionChip({ groups }: { groups: LaborGroup[] }) {
  if (!groups.length) return null;
  const expected = groups.reduce((sum, group) => sum + group.expectedHours, 0);
  const used = groups.reduce((sum, group) => sum + group.totalHours, 0);
  const ratio = expected > 0 ? used / expected : null;

  return (
    <span
      className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-bold text-violet-800"
      title={`${formatNumber(used)} labor hours used across ${groups.length} labor description${groups.length === 1 ? "" : "s"}`}
    >
      Labor {formatNumber(used)} / {formatNumber(expected)} HRS
      {ratio !== null ? ` · ${formatPercent(ratio)}` : ""}
    </span>
  );
}

function ProductivityLogDrilldown({
  companyId,
  projectId,
  lineItemIdsCsv,
}: {
  companyId: string;
  projectId: string;
  lineItemIdsCsv: string;
}) {
  const [logs, setLogs] = useState<ProductivityLogDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const loadLogs = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = new URL("/api/analytics/commitment-productivity/logs", window.location.origin);
        url.searchParams.set("companyId", companyId);
        url.searchParams.set("projectId", projectId);
        url.searchParams.set("lineItemIds", lineItemIdsCsv);
        const response = await fetch(url.toString(), {
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        const data = (await response.json()) as ProductivityLogResponse;
        if (!response.ok || !data.success) {
          throw new Error(data.details || data.error || `Request failed (${response.status})`);
        }
        setLogs(Array.isArray(data.logs) ? data.logs : []);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadLogs();
    return () => controller.abort();
  }, [companyId, lineItemIdsCsv, projectId]);

  if (loading) {
    return <div className="px-4 py-5 text-xs font-bold text-slate-500">Loading productivity logs…</div>;
  }
  if (error) {
    return <div className="px-4 py-4 text-xs font-bold text-rose-700">{error}</div>;
  }
  if (logs.length === 0) {
    return <div className="px-4 py-4 text-xs font-bold text-slate-500">No productivity logs are stored for this row.</div>;
  }

  return (
    <div className="overflow-x-auto border-y border-teal-100 bg-teal-50/50 px-3 py-3">
      <table className="w-full min-w-[980px] border-collapse text-left">
        <thead className="text-[9px] font-black uppercase tracking-widest text-teal-800">
          <tr>
            <th className="px-2 py-2">Date</th>
            <th className="px-2 py-2">PO</th>
            <th className="px-2 py-2">Log Line</th>
            <th className="px-2 py-2 text-right">Used</th>
            <th className="px-2 py-2">Created By</th>
            <th className="px-2 py-2">Status</th>
            <th className="px-2 py-2">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-teal-100 bg-white/80">
          {logs.map((log, index) => (
            <tr key={log.logId || `${log.lineItemId}:${log.date}:${index}`} className="align-top">
              <td className="whitespace-nowrap px-2 py-2.5 text-xs font-bold text-slate-700">{formatDate(log.date)}</td>
              <td className="max-w-44 px-2 py-2.5 text-xs font-bold text-slate-600">
                <p>{log.poNumber || "—"}</p>
                {log.poTitle && <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-400">{log.poTitle}</p>}
              </td>
              <td className="max-w-sm px-2 py-2.5">
                <p className="text-xs font-bold text-slate-700">{log.lineDescription || "No description"}</p>
                <div className="mt-0.5 flex flex-wrap gap-1.5 text-[9px] font-semibold text-slate-400">
                  {log.logId && <span className="font-mono">{log.logId}</span>}
                  {log.aliasApplied && <span className="rounded bg-sky-100 px-1 text-sky-700">Alias mapped</span>}
                </div>
              </td>
              <td className="whitespace-nowrap px-2 py-2.5 text-right text-xs font-black text-teal-700">{formatNumber(log.quantityUsed)}</td>
              <td className="whitespace-nowrap px-2 py-2.5 text-xs font-semibold text-slate-600">{log.createdByName || log.foreman || "—"}</td>
              <td className="px-2 py-2.5">
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase ${String(log.status || "").toLowerCase() === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                  {log.status || "Unknown"}
                </span>
              </td>
              <td className="max-w-xs px-2 py-2.5 text-xs font-semibold text-slate-500">{log.notes || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TimecardEntryDrilldown({
  companyId,
  projectId,
  scopeCode,
}: {
  companyId: string;
  projectId: string;
  scopeCode: string;
}) {
  const [entries, setEntries] = useState<TimecardEntryDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const loadEntries = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = new URL("/api/analytics/commitment-productivity/timecards", window.location.origin);
        url.searchParams.set("companyId", companyId);
        url.searchParams.set("projectId", projectId);
        url.searchParams.set("scopeCode", scopeCode);
        const response = await fetch(url.toString(), {
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        const data = (await response.json()) as TimecardEntryResponse;
        if (!response.ok || !data.success) {
          throw new Error(data.details || data.error || `Request failed (${response.status})`);
        }
        setEntries(Array.isArray(data.entries) ? data.entries : []);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadEntries();
    return () => controller.abort();
  }, [companyId, projectId, scopeCode]);

  if (loading) {
    return <div className="px-4 py-5 text-xs font-bold text-slate-500">Loading timecard entries…</div>;
  }
  if (error) {
    return <div className="px-4 py-4 text-xs font-bold text-rose-700">{error}</div>;
  }
  if (entries.length === 0) {
    return <div className="px-4 py-4 text-xs font-bold text-slate-500">No timecard entries are stored for this labor description.</div>;
  }

  return (
    <div className="overflow-x-auto border-y border-indigo-100 bg-indigo-50/50 px-3 py-3">
      <table className="w-full min-w-[980px] border-collapse text-left">
        <thead className="text-[9px] font-black uppercase tracking-widest text-indigo-800">
          <tr>
            <th className="px-2 py-2">Date</th>
            <th className="px-2 py-2">Employee</th>
            <th className="px-2 py-2 text-right">Hours</th>
            <th className="px-2 py-2">Time</th>
            <th className="px-2 py-2">Type</th>
            <th className="px-2 py-2">Status</th>
            <th className="px-2 py-2">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-indigo-100 bg-white/80">
          {entries.map((entry) => (
            <tr key={entry.id} className="align-top">
              <td className="whitespace-nowrap px-2 py-2.5 text-xs font-bold text-slate-700">{formatDate(entry.date)}</td>
              <td className="max-w-52 px-2 py-2.5">
                <p className="text-xs font-bold text-slate-700">{entry.employeeName || "—"}</p>
                {entry.source === "productivity_closeout" && <span className="mt-1 inline-block rounded bg-teal-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-teal-800">Productivity</span>}
                {entry.subJobName && <p className="mt-0.5 text-[10px] font-semibold text-slate-400">{entry.subJobName}</p>}
              </td>
              <td className="whitespace-nowrap px-2 py-2.5 text-right text-xs font-black text-indigo-700">{formatNumber(entry.hours)}</td>
              <td className="whitespace-nowrap px-2 py-2.5 text-xs font-semibold text-slate-600">
                {entry.timeIn || entry.timeOut ? `${entry.timeIn || "—"} – ${entry.timeOut || "—"}` : "—"}
              </td>
              <td className="px-2 py-2.5 text-xs font-semibold text-slate-600">{entry.timeType || "—"}</td>
              <td className="px-2 py-2.5 text-xs font-semibold text-slate-600">{entry.status || "—"}</td>
              <td className="max-w-sm px-2 py-2.5 text-xs font-semibold text-slate-500">{entry.notes || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LaborDrilldown({ projectId, groups }: { projectId: string; groups: LaborGroup[] }) {
  const [open, setOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const totalHours = groups.reduce((sum, group) => sum + group.totalHours, 0);
  const expectedHours = groups.reduce((sum, group) => sum + group.expectedHours, 0);
  const entryCount = groups.reduce((sum, group) => sum + group.entryCount, 0);
  const laborRatio = expectedHours > 0 ? totalHours / expectedHours : null;

  const toggleGroup = (key: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="overflow-hidden rounded-lg border border-indigo-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-indigo-50/60 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <span className="text-base font-black text-indigo-700">{open ? "▾" : "▸"}</span>
          <div>
            <p className="text-sm font-black text-slate-900">Labor</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              {groups.length} description{groups.length === 1 ? "" : "s"} · {formatNumber(entryCount)} labor {entryCount === 1 ? "log" : "logs"}
            </p>
          </div>
        </div>
        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-800">
          {formatNumber(totalHours)} / {formatNumber(expectedHours)} hrs{laborRatio !== null ? ` · ${formatPercent(laborRatio)}` : ""}
        </span>
      </button>

      {open && (
        groups.length === 0 ? (
          <div className="border-t border-indigo-100 px-4 py-5 text-xs font-bold text-slate-500">
            No labor budget lines or labor logs are stored for this project.
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-indigo-100">
            <table className="w-full min-w-[1080px] border-collapse text-left">
              <thead className="bg-indigo-50 text-[10px] font-black uppercase tracking-widest text-indigo-800">
                <tr>
                  <th className="px-3 py-2.5">Labor Description</th>
                  <th className="px-3 py-2.5">Budget Code</th>
                  <th className="px-3 py-2.5 text-right">Expected</th>
                  <th className="px-3 py-2.5 text-right">Used</th>
                  <th className="px-3 py-2.5 text-right">Remaining</th>
                  <th className="px-3 py-2.5">Progress</th>
                  <th className="px-3 py-2.5">Last Entry</th>
                  <th className="px-3 py-2.5">Logs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groups.map((group) => {
                  const rowKey = `${projectId}:${group.key}`;
                  const entriesOpen = expandedGroups.has(rowKey);
                  const isOver = group.remainingHours < 0;
                  return (
                    <Fragment key={group.key}>
                      <tr className="align-top hover:bg-indigo-50/30">
                        <td className="max-w-md px-3 py-3 text-sm font-bold text-slate-800">{group.description}</td>
                        <td className="px-3 py-3 text-xs font-bold text-slate-600">{group.costCode || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right">
                          <p className="text-sm font-black text-slate-800">{formatNumber(group.expectedHours)}</p>
                          <p className="mt-0.5 text-[9px] font-semibold text-slate-400">
                            {formatNumber(group.originalExpectedHours)} budget{group.approvedChangeHours !== 0 ? ` + ${formatNumber(group.approvedChangeHours)} CO` : ""}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-black text-indigo-700">{formatNumber(group.totalHours)}</td>
                        <td className={`whitespace-nowrap px-3 py-3 text-right text-sm font-black ${isOver ? "text-rose-700" : "text-slate-700"}`}>
                          {formatNumber(group.remainingHours)}
                        </td>
                        <td className="px-3 py-3"><ProgressBar ratio={group.laborBurnRatio} missingLabel="No expected hrs" /></td>
                        <td className="whitespace-nowrap px-3 py-3 text-xs font-semibold text-slate-500">{formatDate(group.lastEntryDate)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-xs font-semibold">
                          <button
                            type="button"
                            onClick={() => toggleGroup(rowKey)}
                            disabled={group.entryCount === 0}
                            className="font-black text-indigo-700 hover:text-indigo-900 disabled:cursor-default disabled:text-slate-400"
                          >
                            {group.entryCount > 0 ? `${entriesOpen ? "▾" : "▸"} ${group.entryCount} logs` : "0 logs"}
                          </button>
                        </td>
                      </tr>
                      {entriesOpen && (
                        <tr>
                          <td colSpan={8} className="p-0">
                            <TimecardEntryDrilldown
                              companyId={group.companyId}
                              projectId={group.projectId}
                              scopeCode={group.scopeCode}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

export default function ProductivityAnalyticsPage() {
  const [lines, setLines] = useState<ProductivityLine[]>([]);
  const [laborGroups, setLaborGroups] = useState<LaborGroup[]>([]);
  const [summary, setSummary] = useState<ApiSummary | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("Approved");
  const [activityFilter, setActivityFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"po" | "description">("po");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedPos, setExpandedPos] = useState<Set<string>>(new Set());
  const [expandedLogRows, setExpandedLogRows] = useState<Set<string>>(new Set());
  const [formsCloseoutOpen, setFormsCloseoutOpen] = useState(false);
  const [reviewsByProject, setReviewsByProject] = useState<Record<string, ProjectReview>>({});
  const [reviewDialog, setReviewDialog] = useState<ReviewDialogState | null>(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/analytics/commitment-productivity", window.location.origin);
      if (DEFAULT_COMPANY_ID) url.searchParams.set("companyId", DEFAULT_COMPANY_ID);
      const reviewsUrl = new URL("/api/analytics/commitment-productivity/reviews", window.location.origin);
      if (DEFAULT_COMPANY_ID) reviewsUrl.searchParams.set("companyId", DEFAULT_COMPANY_ID);
      const [response, reviewsResponse] = await Promise.all([
        fetch(url.toString(), { cache: "no-store", credentials: "include" }),
        fetch(reviewsUrl.toString(), { cache: "no-store", credentials: "include" }),
      ]);
      const data = await readJsonResponse<ApiResponse>(response);
      if (!response.ok || !data.success) {
        throw new Error(data.details || data.error || `Request failed (${response.status})`);
      }
      const reviewsData = await readJsonResponse<ReviewApiResponse>(reviewsResponse);
      if (!reviewsResponse.ok || !reviewsData.success) {
        throw new Error(
          reviewsData.details
          || reviewsData.error
          || `Review status request failed (${reviewsResponse.status})`,
        );
      }
      setLines(Array.isArray(data.lines) ? data.lines : []);
      setLaborGroups(Array.isArray(data.laborGroups) ? data.laborGroups : []);
      setSummary(data.summary || null);
      setGeneratedAt(data.generatedAt || null);
      setReviewsByProject(
        Object.fromEntries((reviewsData.reviews || []).map((review) => [review.projectId, review])),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const requestedProjectId = new URLSearchParams(window.location.search).get("projectId");
    if (requestedProjectId) setProjectFilter(requestedProjectId);
  }, []);

  const projectOptions = useMemo(() => {
    const byId = new Map<string, { id: string; label: string }>();
    for (const line of lines) {
      byId.set(line.projectId, {
        id: line.projectId,
        label: [line.projectNumber, line.projectName].filter(Boolean).join(" · "),
      });
    }
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [lines]);

  const statusOptions = useMemo(
    () => [...new Set(lines.map((line) => line.poStatus).filter((value): value is string => Boolean(value)))].sort(),
    [lines]
  );

  const filteredLines = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return lines.filter((line) => {
      if (projectFilter && line.projectId !== projectFilter) return false;
      if (statusFilter && line.poStatus !== statusFilter) return false;
      if (activityFilter === "active" && line.productivityLogCount === 0) return false;
      if (activityFilter === "remaining" && line.remainingQuantity <= 0) return false;
      if (activityFilter === "over" && line.remainingQuantity >= 0) return false;
      if (!needle) return true;
      return [
        line.projectNumber,
        line.projectName,
        line.customer,
        line.poNumber,
        line.poTitle,
        line.vendorName,
        line.description,
        line.costCode,
        line.wbsCode,
      ].some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [activityFilter, lines, projectFilter, search, statusFilter]);

  const projects = useMemo<ProjectGroup[]>(() => {
    const projectMap = new Map<string, ProjectGroup>();
    for (const line of filteredLines) {
      let project = projectMap.get(line.projectId);
      if (!project) {
        project = {
          projectId: line.projectId,
          projectNumber: line.projectNumber,
          projectName: line.projectName,
          customer: line.customer,
          projectStatus: line.projectStatus,
          pos: [],
        };
        projectMap.set(line.projectId, project);
      }
      const poKey = `${line.projectId}:${line.contractId || line.poNumber || "unassigned"}`;
      let po = project.pos.find((entry) => entry.key === poKey);
      if (!po) {
        po = {
          key: poKey,
          contractId: line.contractId,
          poNumber: line.poNumber,
          poTitle: line.poTitle,
          poStatus: line.poStatus,
          vendorName: line.vendorName,
          lines: [],
        };
        project.pos.push(po);
      }
      po.lines.push(line);
    }

    return [...projectMap.values()]
      .map((project) => ({
        ...project,
        pos: project.pos
          .map((po) => ({
            ...po,
            lines: [...po.lines].sort(
              (a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER)
            ),
          }))
          .sort((a, b) => String(a.poNumber || a.poTitle || "").localeCompare(String(b.poNumber || b.poTitle || ""))),
      }))
      .sort((a, b) => a.projectName.localeCompare(b.projectName));
  }, [filteredLines]);

  const laborGroupsByProject = useMemo(() => {
    const byProject = new Map<string, LaborGroup[]>();
    for (const group of laborGroups) {
      const current = byProject.get(group.projectId) || [];
      current.push(group);
      byProject.set(group.projectId, current);
    }
    for (const groups of byProject.values()) {
      groups.sort((a, b) => a.description.localeCompare(b.description) || String(a.costCode || "").localeCompare(String(b.costCode || "")));
    }
    return byProject;
  }, [laborGroups]);

  useEffect(() => {
    if (!projectFilter) return;
    setExpandedProjects((current) => new Set(current).add(projectFilter));
  }, [projectFilter]);

  const toggleProject = (projectId: string) => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const togglePo = (poKey: string) => {
    setExpandedPos((current) => {
      const next = new Set(current);
      if (next.has(poKey)) next.delete(poKey);
      else next.add(poKey);
      return next;
    });
  };

  const toggleLogRow = (rowKey: string) => {
    setExpandedLogRows((current) => {
      const next = new Set(current);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedProjects(new Set(projects.map((project) => project.projectId)));
    setExpandedPos(new Set(projects.flatMap((project) => project.pos.map((po) => po.key))));
  };

  const collapseAll = () => {
    setExpandedProjects(new Set());
    setExpandedPos(new Set());
    setExpandedLogRows(new Set());
  };

  const openReview = (project: ProjectGroup, completion: WeightedCompletion) => {
    setReviewError(null);
    setReviewDialog({ project, completion });
  };

  const submitReview = async () => {
    if (!reviewDialog || reviewSubmitting) return;

    setReviewSubmitting(true);
    setReviewError(null);
    const currentReview = reviewsByProject[reviewDialog.project.projectId];
    try {
      const response = await fetch("/api/analytics/commitment-productivity/reviews", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId: lines[0]?.companyId || DEFAULT_COMPANY_ID,
          projectId: reviewDialog.project.projectId,
          weightedCompletion: reviewDialog.completion.ratio,
          completionSnapshot: {
            weightedCompletion: reviewDialog.completion.ratio,
            breakdown: reviewDialog.completion.breakdown,
          },
          retryNotification:
            currentReview?.status === "completed"
            && currentReview.notificationStatus !== "sent",
        }),
      });
      const data = await readJsonResponse<ReviewApiResponse>(response);
      if (data.review) {
        setReviewsByProject((current) => ({
          ...current,
          [data.review!.projectId]: data.review!,
        }));
      }
      if (!response.ok || !data.success) {
        throw new Error(data.details || data.error || `Request failed (${response.status})`);
      }

      setReviewDialog(null);
    } catch (submitError) {
      setReviewError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setReviewSubmitting(false);
    }
  };

  const unreviewProject = async (project: ProjectGroup) => {
    const review = reviewsByProject[project.projectId];
    if (review?.status !== "completed") return;
    const confirmed = window.confirm(
      `Un-review ${[project.projectNumber, project.projectName].filter(Boolean).join(" · ")}?\n\n`
      + "The email already delivered to the office cannot be recalled. The project can be reviewed again later.",
    );
    if (!confirmed) return;

    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const response = await fetch("/api/analytics/commitment-productivity/reviews", {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId: lines[0]?.companyId || DEFAULT_COMPANY_ID,
          projectId: project.projectId,
        }),
      });
      const data = await readJsonResponse<ReviewApiResponse>(response);
      if (!response.ok || !data.success || !data.review) {
        throw new Error(data.details || data.error || `Request failed (${response.status})`);
      }
      setReviewsByProject((current) => ({
        ...current,
        [data.review!.projectId]: data.review!,
      }));
    } catch (unreviewError) {
      window.alert(
        unreviewError instanceof Error
          ? unreviewError.message
          : "The project could not be un-reviewed.",
      );
    } finally {
      setReviewSubmitting(false);
    }
  };

  const filteredPoCount = useMemo(
    () => projects.reduce((sum, project) => sum + project.pos.length, 0),
    [projects]
  );

  const filteredDescriptionCount = useMemo(
    () =>
      projects.reduce(
        (sum, project) => sum + groupLinesByDescription(project.pos.flatMap((po) => po.lines)).length,
        0
      ),
    [projects]
  );

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto w-full max-w-[1800px] px-3 py-6 xl:px-6">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-teal-900 px-5 py-5 text-white">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-teal-200">
                  <span>Analytics</span>
                  <span className="text-slate-500">/</span>
                  <span>Productivity</span>
                </div>
                <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Field Productivity</h1>
                <p className="mt-1 max-w-3xl text-sm font-medium text-slate-300">
                  Drill from projects into PO quantities, productivity logs, labor descriptions, and individual timecard entries.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setFormsCloseoutOpen(true)}
                  className="hidden rounded-lg border border-teal-300/50 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-wider text-teal-100 hover:bg-white/20 lg:inline-flex"
                >
                  Admin Closeout
                </button>
                <button
                  type="button"
                  onClick={() => void loadData()}
                  disabled={loading}
                  className="rounded-lg bg-teal-400 px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-950 hover:bg-teal-300 disabled:opacity-60"
                >
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </div>
            {generatedAt && (
              <p className="mt-3 text-[11px] font-semibold text-slate-400">
                Data calculated {new Date(generatedAt).toLocaleString()}
              </p>
            )}
          </div>

          {error && (
            <div className="m-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
              {error}
            </div>
          )}

          <div className="hidden grid-cols-2 gap-3 p-5 lg:grid lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Projects</p>
              <p className="mt-1 text-2xl font-black text-slate-800">{summary ? formatNumber(summary.projectCount) : "—"}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">with PO lines</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Purchase Orders</p>
              <p className="mt-1 text-2xl font-black text-slate-800">{summary ? formatNumber(summary.poCount) : "—"}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">canonical headers</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">PO Lines</p>
              <p className="mt-1 text-2xl font-black text-slate-800">{summary ? formatNumber(summary.lineCount) : "—"}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                {summary ? `${formatNumber(summary.activeLineCount)} with activity` : "Loading"}
              </p>
            </div>
            <div className={`rounded-xl border p-4 ${summary?.unmatchedProductivityCount ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Exceptions</p>
              <p className={`mt-1 text-2xl font-black ${summary?.unmatchedProductivityCount ? "text-amber-700" : "text-emerald-700"}`}>
                {summary ? formatNumber(summary.unmatchedProductivityCount) : "—"}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                {summary ? `${summary.aliasCount} aliases · ${summary.reviewedAliasCount} reviewed` : "Loading"}
              </p>
            </div>
          </div>

          <div className="border-y border-slate-200 bg-slate-50 px-5 py-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Project</label>
                <select
                  value={projectFilter}
                  onChange={(event) => setProjectFilter(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  <option value="">All projects</option>
                  {projectOptions.map((project) => (
                    <option key={project.id} value={project.id}>{project.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">PO Status</label>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  <option value="">All statuses</option>
                  {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Line Activity</label>
                <select
                  value={activityFilter}
                  onChange={(event) => setActivityFilter(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  <option value="all">All lines</option>
                  <option value="active">With productivity</option>
                  <option value="remaining">Quantity remaining</option>
                  <option value="over">Over expected quantity</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Search</label>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Project, PO, vendor, line, or cost code"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 placeholder:text-slate-400"
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold text-slate-500">
                {viewMode === "po"
                  ? `Showing ${formatNumber(filteredLines.length)} lines in ${formatNumber(filteredPoCount)} POs across ${formatNumber(projects.length)} projects`
                  : `Showing ${formatNumber(filteredDescriptionCount)} descriptions from ${formatNumber(filteredLines.length)} lines across ${formatNumber(projects.length)} projects`}
              </p>
              <div className="flex flex-wrap gap-2">
                <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewMode("po")}
                    aria-pressed={viewMode === "po"}
                    className={`rounded-md px-3 py-1 text-[11px] font-black uppercase tracking-wider ${viewMode === "po" ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                  >
                    By PO
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("description")}
                    aria-pressed={viewMode === "description"}
                    className={`rounded-md px-3 py-1 text-[11px] font-black uppercase tracking-wider ${viewMode === "description" ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                  >
                    By Description
                  </button>
                </div>
                <button type="button" onClick={expandAll} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-slate-700 hover:bg-slate-100">
                  Expand all
                </button>
                <button type="button" onClick={collapseAll} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-slate-700 hover:bg-slate-100">
                  Collapse all
                </button>
              </div>
            </div>
          </div>

          <div className="p-3 sm:p-5">
            {loading && lines.length === 0 ? (
              <div className="py-16 text-center text-sm font-bold text-slate-500">Loading productivity quantities…</div>
            ) : projects.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 py-16 text-center text-sm font-bold text-slate-500">
                No PO lines match the current filters.
              </div>
            ) : (
              <div className="space-y-3">
                {projects.map((project) => {
                  const projectOpen = expandedProjects.has(project.projectId);
                  const projectLines = project.pos.flatMap((po) => po.lines);
                  const projectTotals = summarizeQuantities(projectLines);
                  const activeLines = projectLines.filter((line) => line.productivityLogCount > 0).length;
                  const descriptionGroups = groupLinesByDescription(projectLines);
                  const activeDescriptions = descriptionGroups.filter((group) => group.productivityLogCount > 0).length;
                  const projectLaborGroups = laborGroupsByProject.get(project.projectId) || [];
                  const projectCompletion = calculateWeightedCompletion({
                    lines: projectLines,
                    labor: projectLaborGroups,
                  });
                  const projectReview = reviewsByProject[project.projectId];
                  const reviewSent =
                    projectReview?.status === "completed"
                    && projectReview.notificationStatus === "sent";
                  const reviewFailed =
                    projectReview?.status === "completed"
                    && projectReview.notificationStatus === "failed";
                  const reviewPending =
                    projectReview?.status === "completed"
                    && projectReview.notificationStatus === "pending";
                  return (
                    <section key={project.projectId} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                      <div
                        className="flex w-full flex-col gap-3 bg-slate-800 px-4 py-4 text-left text-white hover:bg-slate-750 lg:flex-row lg:items-center lg:justify-between"
                      >
                        <button
                          type="button"
                          onClick={() => toggleProject(project.projectId)}
                          className="flex min-w-0 flex-1 items-start gap-3 text-left"
                        >
                          <span className="mt-0.5 text-lg font-black text-teal-300">{projectOpen ? "▾" : "▸"}</span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              {project.projectNumber && <span className="text-xs font-black text-teal-300">{project.projectNumber}</span>}
                              <h2 className="truncate text-base font-black">{project.projectName}</h2>
                              {project.projectStatus && <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-300">{project.projectStatus}</span>}
                            </div>
                            <p className="mt-1 text-xs font-semibold text-slate-300">
                              {viewMode === "po"
                                ? `${project.customer || "No customer"} · ${project.pos.length} POs · ${projectLines.length} lines · ${activeLines} active`
                                : `${project.customer || "No customer"} · ${descriptionGroups.length} descriptions · ${projectLines.length} lines · ${activeDescriptions} active`}
                            </p>
                          </div>
                        </button>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <WeightedCompletionBadge completion={projectCompletion} dark />
                          <LaborCompletionChip groups={projectLaborGroups} />
                          <QuantityChips totals={projectTotals} />
                          <button
                            type="button"
                            onClick={() => {
                              if (reviewSent) void unreviewProject(project);
                              else openReview(project, projectCompletion);
                            }}
                            disabled={reviewSubmitting}
                            title={
                              reviewSent
                                ? `Reviewed by ${projectReview.reviewedByEmail || "unknown"}${projectReview.reviewedAt ? ` on ${new Date(projectReview.reviewedAt).toLocaleString()}` : ""}. Click to un-review.`
                                : reviewFailed
                                  ? "The review is saved, but the notification email needs to be retried."
                                  : reviewPending
                                    ? "The office notification is being sent."
                                  : "Mark this project reviewed and notify the office."
                            }
                            className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wider transition ${
                              reviewSent
                                ? "border-emerald-300/50 bg-emerald-400/20 text-emerald-100 hover:bg-emerald-400/30"
                                : reviewFailed
                                  ? "border-rose-300/60 bg-rose-400/20 text-rose-100 hover:bg-rose-400/30"
                                  : reviewPending
                                    ? "border-amber-300/60 bg-amber-400/20 text-amber-100 hover:bg-amber-400/30"
                                  : "border-white/30 bg-white/10 text-white hover:bg-white/20"
                            }`}
                          >
                            {reviewSent
                              ? `✓ Reviewed${projectReview.reviewedAt ? ` ${formatDate(projectReview.reviewedAt)}` : ""}`
                              : reviewFailed
                                ? "! Email failed"
                                : reviewPending
                                  ? "◷ Email sending"
                                  : "□ Mark reviewed"}
                          </button>
                        </div>
                      </div>

                      {projectOpen && (
                        <div className="space-y-2 bg-slate-100 p-2 sm:p-3">
                          {viewMode === "description" ? (
                            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                              <table className="w-full min-w-[1060px] border-collapse text-left">
                                <thead className="bg-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                  <tr>
                                    <th className="px-3 py-2.5">Description</th>
                                    <th className="px-3 py-2.5">Purchase Orders</th>
                                    <th className="px-3 py-2.5">Cost Code</th>
                                    <th className="px-3 py-2.5 text-right">Expected</th>
                                    <th className="px-3 py-2.5 text-right">Used</th>
                                    <th className="px-3 py-2.5 text-right">Remaining</th>
                                    <th className="px-3 py-2.5">Progress</th>
                                    <th className="px-3 py-2.5">Activity</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {descriptionGroups.map((group) => {
                                    const isOver = group.remainingQuantity < 0;
                                    const visiblePos = group.poLabels.slice(0, 3);
                                    const logRowKey = `description:${group.projectId}:${group.key}`;
                                    const logsOpen = expandedLogRows.has(logRowKey);
                                    return (
                                      <Fragment key={group.key}>
                                        <tr className="align-top hover:bg-teal-50/40">
                                          <td className="max-w-md px-3 py-3">
                                            <p className="text-sm font-bold text-slate-800">{group.description}</p>
                                            <p className="mt-1 text-[10px] font-semibold text-slate-400">
                                              {group.lineCount} PO line{group.lineCount === 1 ? "" : "s"} across {group.poLabels.length} PO{group.poLabels.length === 1 ? "" : "s"}
                                            </p>
                                          </td>
                                          <td className="max-w-xs px-3 py-3">
                                            <div className="flex flex-wrap gap-1">
                                              {visiblePos.map((poLabel) => (
                                                <span key={poLabel} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                                                  {poLabel}
                                                </span>
                                              ))}
                                              {group.poLabels.length > visiblePos.length && (
                                                <span className="px-1 py-0.5 text-[10px] font-bold text-slate-400">
                                                  +{group.poLabels.length - visiblePos.length}
                                                </span>
                                              )}
                                            </div>
                                          </td>
                                          <td className="px-3 py-3 text-xs font-bold text-slate-600">
                                            {group.costCodes.length ? group.costCodes.join(", ") : "—"}
                                          </td>
                                          <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-black text-slate-800">
                                            {formatNumber(group.expectedQuantity)} <span className="text-[10px] text-slate-400">{group.uom}</span>
                                          </td>
                                          <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-black text-teal-700">
                                            {formatNumber(group.usedQuantity)}
                                          </td>
                                          <td className={`whitespace-nowrap px-3 py-3 text-right text-sm font-black ${isOver ? "text-rose-700" : "text-slate-700"}`}>
                                            {formatNumber(group.remainingQuantity)}
                                          </td>
                                          <td className="px-3 py-3"><ProgressBar ratio={group.quantityCompleteRatio} /></td>
                                          <td className="whitespace-nowrap px-3 py-3 text-xs font-semibold text-slate-500">
                                            <button
                                              type="button"
                                              onClick={() => toggleLogRow(logRowKey)}
                                              disabled={group.productivityLogCount === 0}
                                              className="font-black text-teal-700 hover:text-teal-900 disabled:cursor-default disabled:text-slate-400"
                                            >
                                              {group.productivityLogCount > 0 ? `${logsOpen ? "▾" : "▸"} ${group.productivityLogCount} logs` : "0 logs"}
                                            </button>
                                            <p className="mt-1">{formatDate(group.lastActivityDate)}</p>
                                          </td>
                                        </tr>
                                        {logsOpen && (
                                          <tr>
                                            <td colSpan={8} className="p-0">
                                              <ProductivityLogDrilldown
                                                companyId={group.companyId}
                                                projectId={group.projectId}
                                                lineItemIdsCsv={group.lineItemIds.join(",")}
                                              />
                                            </td>
                                          </tr>
                                        )}
                                      </Fragment>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          ) : project.pos.map((po) => {
                            const poOpen = expandedPos.has(po.key);
                            const poTotals = summarizeQuantities(po.lines);
                            const poLogCount = po.lines.reduce((sum, line) => sum + line.productivityLogCount, 0);
                            const poCompletion = calculateWeightedCompletion({ lines: po.lines });
                            return (
                              <div key={po.key} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                                <button
                                  type="button"
                                  onClick={() => togglePo(po.key)}
                                  className="flex w-full flex-col gap-3 px-4 py-3 text-left hover:bg-slate-50 lg:flex-row lg:items-center lg:justify-between"
                                >
                                  <div className="flex min-w-0 items-start gap-3">
                                    <span className="text-base font-black text-teal-700">{poOpen ? "▾" : "▸"}</span>
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-black text-slate-900">{po.poNumber || "Unnumbered PO"}</span>
                                        <span className="truncate text-sm font-bold text-slate-600">{po.poTitle || "Untitled"}</span>
                                        {po.poStatus && (
                                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${po.poStatus.toLowerCase() === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                                            {po.poStatus}
                                          </span>
                                        )}
                                      </div>
                                      <p className="mt-1 text-xs font-semibold text-slate-500">
                                        {po.vendorName || "No vendor"} · {po.lines.length} lines · {poLogCount} productivity logs
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                    <WeightedCompletionBadge completion={poCompletion} />
                                    <QuantityChips totals={poTotals} limit={3} />
                                  </div>
                                </button>

                                {poOpen && (
                                  <div className="overflow-x-auto border-t border-slate-200">
                                    <table className="w-full min-w-[1060px] border-collapse text-left">
                                      <thead className="bg-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                        <tr>
                                          <th className="px-3 py-2.5">Line</th>
                                          <th className="px-3 py-2.5">Description</th>
                                          <th className="px-3 py-2.5">Cost Code</th>
                                          <th className="px-3 py-2.5 text-right">Expected</th>
                                          <th className="px-3 py-2.5 text-right">Used</th>
                                          <th className="px-3 py-2.5 text-right">Remaining</th>
                                          <th className="px-3 py-2.5">Progress</th>
                                          <th className="px-3 py-2.5">Activity</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100">
                                        {po.lines.map((line) => {
                                          const isOver = line.remainingQuantity < 0;
                                          const logRowKey = `line:${line.projectId}:${line.lineItemId}`;
                                          const logsOpen = expandedLogRows.has(logRowKey);
                                          return (
                                            <Fragment key={line.lineItemId}>
                                            <tr className="align-top hover:bg-teal-50/40">
                                              <td className="whitespace-nowrap px-3 py-3 text-xs font-black text-slate-500">
                                                {line.position ?? "—"}
                                              </td>
                                              <td className="max-w-md px-3 py-3">
                                                <p className="text-sm font-bold text-slate-800">{line.description || "No description"}</p>
                                                <div className="mt-1 flex flex-wrap gap-1.5">
                                                  <span className="font-mono text-[10px] text-slate-400">{line.lineItemId}</span>
                                                  {line.aliasCount > 0 && (
                                                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${line.reviewedAliasCount > 0 ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`}>
                                                      {line.reviewedAliasCount > 0 ? "Reviewed alias" : `${line.aliasCount} alias${line.aliasCount === 1 ? "" : "es"}`}
                                                    </span>
                                                  )}
                                                </div>
                                              </td>
                                              <td className="px-3 py-3 text-xs font-bold text-slate-600">
                                                {line.costCode || line.wbsCode || "—"}
                                              </td>
                                              <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-black text-slate-800">
                                                {formatNumber(line.expectedQuantity)} <span className="text-[10px] text-slate-400">{(line.uom || "units").toUpperCase()}</span>
                                              </td>
                                              <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-black text-teal-700">{formatNumber(line.usedQuantity)}</td>
                                              <td className={`whitespace-nowrap px-3 py-3 text-right text-sm font-black ${isOver ? "text-rose-700" : "text-slate-700"}`}>
                                                {formatNumber(line.remainingQuantity)}
                                              </td>
                                              <td className="px-3 py-3"><ProgressBar ratio={line.quantityCompleteRatio} /></td>
                                              <td className="whitespace-nowrap px-3 py-3 text-xs font-semibold text-slate-500">
                                                <button
                                                  type="button"
                                                  onClick={() => toggleLogRow(logRowKey)}
                                                  disabled={line.productivityLogCount === 0}
                                                  className="font-black text-teal-700 hover:text-teal-900 disabled:cursor-default disabled:text-slate-400"
                                                >
                                                  {line.productivityLogCount > 0 ? `${logsOpen ? "▾" : "▸"} ${line.productivityLogCount} logs` : "0 logs"}
                                                </button>
                                                <p className="mt-1">{formatDate(line.lastActivityDate)}</p>
                                              </td>
                                            </tr>
                                            {logsOpen && (
                                              <tr>
                                                <td colSpan={8} className="p-0">
                                                  <ProductivityLogDrilldown
                                                    companyId={line.companyId}
                                                    projectId={line.projectId}
                                                    lineItemIdsCsv={line.lineItemId}
                                                  />
                                                </td>
                                              </tr>
                                            )}
                                            </Fragment>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          <LaborDrilldown projectId={project.projectId} groups={projectLaborGroups} />
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
      <FormsCloseoutPanel
        open={formsCloseoutOpen}
        companyId={lines[0]?.companyId || DEFAULT_COMPANY_ID}
        initialProjectId={projectFilter}
        onClose={() => setFormsCloseoutOpen(false)}
        onCompleted={loadData}
      />
      {reviewDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !reviewSubmitting) setReviewDialog(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-review-title"
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="bg-slate-800 px-5 py-4 text-white">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-teal-300">Office handoff</p>
              <h2 id="project-review-title" className="mt-1 text-xl font-black">Mark project reviewed</h2>
              <p className="mt-1 text-sm font-semibold text-slate-300">
                {[reviewDialog.project.projectNumber, reviewDialog.project.projectName].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="space-y-4 p-5">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="font-bold text-emerald-950">
                  ✓ I reviewed this project&apos;s field productivity information and it is ready for the office team.
                </p>
                <p className="mt-1 text-xs font-semibold text-emerald-800">
                  Your signed-in email and the completion time will be saved with this review.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Office notifications</p>
                <div className="mt-1 space-y-0.5">
                  {PROJECT_REVIEW_EMAILS.map((email) => (
                    <p key={email} className="text-sm font-black text-slate-900">{email}</p>
                  ))}
                </div>
              </div>
              {reviewError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
                  {reviewError}
                </div>
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setReviewDialog(null)}
                  disabled={reviewSubmitting}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void submitReview()}
                  disabled={reviewSubmitting}
                  className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-black text-white hover:bg-teal-800 disabled:cursor-wait disabled:opacity-60"
                >
                  {reviewSubmitting
                    ? "Saving and sending…"
                    : reviewsByProject[reviewDialog.project.projectId]?.status === "completed"
                      && reviewsByProject[reviewDialog.project.projectId]?.notificationStatus !== "sent"
                      ? "Retry office email"
                      : "Complete review and email"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
