"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";

type PersistedLineItem = {
  id: string;
  projectName: string | null;
  customerName: string | null;
  projectId: string;
  costCode: string | null;
  costCodeName?: string | null;
  lineItemType?: string | null;
  uom?: string | null;
  quantity?: number | null;
  unitCost?: number | null;
  originalBudgetAmount?: number | null;
  amount?: number | null;
  totalCost?: number | null;
  totalSales?: number | null;
  actualTimecardHours?: number;
  actualProductivityQty?: number;
  syncedAt: string;
};

type ApiResponse = {
  success?: boolean;
  error?: string;
  note?: string;
  data?: PersistedLineItem[];
  hasNextPage?: boolean;
};

type ProjectMasterRow = {
  canonicalProjectId: string;
  procoreProjectId: string | null;
  projectName: string | null;
  customer: string;
  budgetLineItemCount: number;
};

type ProjectMasterApiResponse = {
  success?: boolean;
  error?: string;
  data?: ProjectMasterRow[];
  hasNextPage?: boolean;
};

type BudgetLineApiRow = {
  id: string;
  projectId: string;
  costCode: string | null;
  costCodeDescription?: string | null;
  lineItemType?: string | null;
  uom: string | null;
  quantity: number | null;
  unitCost: number | null;
  originalBudgetAmount: number | null;
  amount: number | null;
  actualTimecardHours?: number;
  actualProductivityQty?: number;
  syncedAt: string;
};

type BudgetLineApiResponse = {
  success?: boolean;
  error?: string;
  data?: BudgetLineApiRow[];
};

type RankedMetric = {
  key: string;
  label: string;
  lineItems: number;
  sales: number;
  actualUnits: number;
};

type DateGranularity = "day" | "week" | "month";

type FilterPreset = {
  id: string;
  name: string;
  projectFilter: string;
  customerFilter: string;
  dateFrom: string;
  dateTo: string;
  search: string;
  createdAt: string;
};

type TrendPoint = {
  key: string;
  label: string;
  lineItems: number;
  sales: number;
  cost: number;
  actualUnits: number;
  runningCost: number;
};

const DEFAULT_COMPANY_ID = "598134325658789";
const PAGE_SIZE = 1000;
const MAX_PAGES = 100;
const PRESET_STORAGE_KEY = "analytics:advanced-presets";

function toDateKey(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

function getActualUnits(row: PersistedLineItem): number {
  const normalizedUom = String(row.uom || "").trim().toLowerCase();
  const isHourUom = /\b(hours?|hrs?|h)\b/.test(normalizedUom);
  if (isHourUom) return Number(row.actualTimecardHours || 0);
  return Number(row.actualProductivityQty || 0);
}

function isHourBasedUom(value: string | null | undefined): boolean {
  const normalizedUom = String(value || "").trim().toLowerCase();
  return /\b(hours?|hrs?|h)\b/.test(normalizedUom);
}

function getPlannedHours(row: PersistedLineItem): number {
  if (!isHourBasedUom(row.uom)) return 0;
  const quantity = Number(row.quantity || 0);
  return Number.isFinite(quantity) ? quantity : 0;
}

function getRunningCost(row: PersistedLineItem): number {
  const actualUnits = getActualUnits(row);
  const unitCost = getEffectiveUnitCost(row);
  return actualUnits * unitCost;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function getProductionCompletionRatio(row: PersistedLineItem): number {
  const quantity = Number(row.quantity || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;

  const actualUnits = getActualUnits(row);
  return clamp01(actualUnits / quantity);
}

function getEffectiveUnitCost(row: PersistedLineItem): number {
  const qty = Number(row.quantity || 0);
  const amount = Number(row.amount || 0);
  if (Number.isFinite(qty) && qty > 0 && Number.isFinite(amount)) {
    return amount / qty;
  }

  const rawUnitCost = Number(row.unitCost || 0);
  return Number.isFinite(rawUnitCost) ? rawUnitCost : 0;
}

function isMarginRevenueLine(row: PersistedLineItem): boolean {
  const marker = [row.costCodeName, row.costCode, row.lineItemType]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");

  return (
    marker.includes("overhead & profit") ||
    marker.includes("overhead and profit") ||
    marker.includes("profit.other") ||
    marker.includes("o&p")
  );
}

function getWeekStartDateKey(dateKey: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return "";
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  date.setDate(date.getDate() + mondayOffset);

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getMonthDateKey(dateKey: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return "";
  return dateKey.slice(0, 7);
}

function formatTrendLabel(key: string, granularity: DateGranularity): string {
  if (!key) return "Unknown";
  if (granularity === "day") return key;
  if (granularity === "month") return key;
  return `Week of ${key}`;
}

function csvCell(value: unknown): string {
  const raw = String(value ?? "");
  return `"${raw.replace(/"/g, '""')}"`;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export default function AnalyticsPage() {
  const [rows, setRows] = useState<PersistedLineItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>("");

  const [projectFilter, setProjectFilter] = useState<string>("");
  const [customerFilter, setCustomerFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [dateGranularity, setDateGranularity] = useState<DateGranularity>("week");
  const [presetName, setPresetName] = useState<string>("");
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    setNote("");

    try {
      const projects: ProjectMasterRow[] = [];
      let projectPage = 1;

      while (projectPage <= MAX_PAGES) {
        const url = new URL("/api/procore/projects-master", window.location.origin);
        url.searchParams.set("companyId", DEFAULT_COMPANY_ID);
        url.searchParams.set("page", String(projectPage));
        url.searchParams.set("pageSize", "500");
        url.searchParams.set("_ts", String(Date.now()));

        const response = await fetch(url.toString(), { cache: "no-store" });
        const body: ProjectMasterApiResponse = await response.json();

        if (!response.ok || body.success === false) {
          throw new Error(body.error || `Failed to load project list (${response.status})`);
        }

        const batch = Array.isArray(body.data) ? body.data : [];
        projects.push(...batch);

        if (!body.hasNextPage || batch.length === 0) break;
        projectPage += 1;
      }

      const budgetProjects = projects.filter(
        (project) => project.procoreProjectId && Number(project.budgetLineItemCount || 0) > 0
      );

      const projectMeta = new Map<string, { projectName: string | null; customerName: string | null }>();
      for (const project of budgetProjects) {
        const projectId = String(project.procoreProjectId || "").trim();
        if (!projectId) continue;
        projectMeta.set(projectId, {
          projectName: project.projectName,
          customerName: project.customer || "",
        });
      }

      const allRows: PersistedLineItem[] = [];
      const chunks = chunkArray(budgetProjects, 12);

      for (const projectChunk of chunks) {
        const chunkRows = await Promise.all(
          projectChunk.map(async (project) => {
            const projectId = String(project.procoreProjectId || "").trim();
            if (!projectId) return [] as PersistedLineItem[];

            const url = new URL("/api/procore/budget-line-items-live", window.location.origin);
            url.searchParams.set("companyId", DEFAULT_COMPANY_ID);
            url.searchParams.set("projectId", projectId);
            url.searchParams.set("pageSize", String(PAGE_SIZE));
            url.searchParams.set("actualsMode", "cost-code");
            url.searchParams.set("_ts", String(Date.now()));

            const response = await fetch(url.toString(), { cache: "no-store" });
            const body: BudgetLineApiResponse = await response.json();
            if (!response.ok || body.success === false) {
              return [] as PersistedLineItem[];
            }

            const rows = Array.isArray(body.data) ? body.data : [];
            const meta = projectMeta.get(projectId);

            return rows.map((row) => ({
              id: `${projectId}:${row.id}`,
              projectName: meta?.projectName || null,
              customerName: meta?.customerName || null,
              projectId,
              costCode: row.costCode,
              costCodeName: row.costCodeDescription || null,
              lineItemType: row.lineItemType || null,
              uom: row.uom,
              quantity: row.quantity,
              unitCost: row.unitCost,
              originalBudgetAmount: row.originalBudgetAmount,
              amount: row.amount,
              totalCost: Number(row.originalBudgetAmount || 0),
              totalSales: Number(row.amount || 0),
              actualTimecardHours: Number(row.actualTimecardHours || 0),
              actualProductivityQty: Number(row.actualProductivityQty || 0),
              syncedAt: row.syncedAt,
            }));
          })
        );

        for (const rowsForProject of chunkRows) {
          allRows.push(...rowsForProject);
        }
      }

      setRows(allRows);
      setNote(
        `Budget-only analytics loaded from ${budgetProjects.length.toLocaleString()} projects with budget lines.`
      );
      setLastRefreshedAt(new Date().toLocaleString());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load analytics data");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      setPresets(parsed as FilterPreset[]);
    } catch {
      setPresets([]);
    }
  }, []);

  const projectOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const row of rows) {
      const value = String(row.projectName || "").trim();
      if (value) unique.add(value);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const customerOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const row of rows) {
      const value = String(row.customerName || "").trim();
      if (value) unique.add(value);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    return rows.filter((row) => {
      const projectName = String(row.projectName || "").trim();
      const customerName = String(row.customerName || "").trim();
      const dateKey = toDateKey(row.syncedAt);

      if (projectFilter && projectName !== projectFilter) return false;
      if (customerFilter && customerName !== customerFilter) return false;
      if (dateFrom && (!dateKey || dateKey < dateFrom)) return false;
      if (dateTo && (!dateKey || dateKey > dateTo)) return false;

      if (!query) return true;

      const haystack = [
        row.projectName,
        row.customerName,
        row.projectId,
        row.costCode,
        row.costCodeName,
        row.lineItemType,
        row.uom,
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");

      return haystack.includes(query);
    });
  }, [rows, projectFilter, customerFilter, dateFrom, dateTo, search]);

  const analytics = useMemo(() => {
    let budgetAmountTotal = 0;
    let originalBudgetTotal = 0;
    let actualUnitsTotal = 0;
    let totalPlannedHours = 0;
    let operationalRunningCostTotal = 0;
    let operationalBudgetAmountTotal = 0;
    let operationalOriginalBudgetTotal = 0;
    let operationalCompletedBudgetAmountTotal = 0;
    let plannedOpRevenueTotal = 0;
    let totalTimecardHours = 0;
    let totalProductivityQty = 0;
    const projectSet = new Set<string>();
    const customerSet = new Set<string>();
    const byProject = new Map<string, RankedMetric>();
    const byCustomer = new Map<string, RankedMetric>();

    for (const row of filteredRows) {
      const budgetAmount = Number(row.totalSales || 0);
      const originalBudget = Number(row.totalCost || 0);
      const actualUnits = getActualUnits(row);
      const runningCost = getRunningCost(row);
      const isMargin = isMarginRevenueLine(row);
      const projectName = String(row.projectName || "Unassigned Project").trim();
      const customerName = String(row.customerName || "Unassigned Customer").trim();

      budgetAmountTotal += budgetAmount;
      originalBudgetTotal += originalBudget;
      actualUnitsTotal += actualUnits;
      totalPlannedHours += getPlannedHours(row);
      if (isMargin) {
        plannedOpRevenueTotal += budgetAmount;
      } else {
        operationalRunningCostTotal += runningCost;
        operationalBudgetAmountTotal += budgetAmount;
        operationalOriginalBudgetTotal += originalBudget;
        operationalCompletedBudgetAmountTotal += budgetAmount * getProductionCompletionRatio(row);
      }
      totalTimecardHours += Number(row.actualTimecardHours || 0);
      totalProductivityQty += Number(row.actualProductivityQty || 0);
      projectSet.add(projectName);
      customerSet.add(customerName);

      const projectMetric = byProject.get(projectName) || {
        key: projectName,
        label: projectName,
        lineItems: 0,
        sales: 0,
        actualUnits: 0,
      };
      projectMetric.lineItems += 1;
      projectMetric.sales += budgetAmount;
      projectMetric.actualUnits += actualUnits;
      byProject.set(projectName, projectMetric);

      const customerMetric = byCustomer.get(customerName) || {
        key: customerName,
        label: customerName,
        lineItems: 0,
        sales: 0,
        actualUnits: 0,
      };
      customerMetric.lineItems += 1;
      customerMetric.sales += budgetAmount;
      customerMetric.actualUnits += actualUnits;
      byCustomer.set(customerName, customerMetric);
    }

    const spentPct =
      operationalBudgetAmountTotal > 0
        ? (operationalRunningCostTotal / operationalBudgetAmountTotal) * 100
        : 0;
    const earnedOperationalPct =
      operationalBudgetAmountTotal > 0
        ? clamp01(operationalCompletedBudgetAmountTotal / operationalBudgetAmountTotal)
        : 0;
    const actualOpRevenueTotal = plannedOpRevenueTotal * earnedOperationalPct;
    const budgetRemaining = operationalBudgetAmountTotal - operationalRunningCostTotal;
    const remainingPct =
      operationalBudgetAmountTotal > 0
        ? (budgetRemaining / operationalBudgetAmountTotal) * 100
        : 0;
    const variancePct =
      operationalBudgetAmountTotal > 0
        ? ((operationalRunningCostTotal - operationalBudgetAmountTotal) / operationalBudgetAmountTotal) * 100
        : 0;

    const topProjects = Array.from(byProject.values())
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 8);

    const topCustomers = Array.from(byCustomer.values())
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 8);

    return {
      lineItems: filteredRows.length,
      projects: projectSet.size,
      customers: customerSet.size,
      budgetAmountTotal,
      costTotal: originalBudgetTotal,
      actualUnitsTotal,
      totalPlannedHours,
      runningCostTotal: operationalRunningCostTotal,
      operationalBudgetAmountTotal,
      operationalOriginalBudgetTotal,
      plannedOpRevenueTotal,
      actualOpRevenueTotal,
      budgetRemaining,
      spentPct,
      remainingPct,
      variancePct,
      totalTimecardHours,
      totalProductivityQty,
      avgSalesPerLine: filteredRows.length > 0 ? budgetAmountTotal / filteredRows.length : 0,
      topProjects,
      topCustomers,
    };
  }, [filteredRows]);

  const trendData = useMemo(() => {
    const grouped = new Map<string, TrendPoint>();

    for (const row of filteredRows) {
      const rawDate = toDateKey(row.syncedAt);
      if (!rawDate) continue;

      const bucketKey =
        dateGranularity === "day"
          ? rawDate
          : dateGranularity === "week"
            ? getWeekStartDateKey(rawDate)
            : getMonthDateKey(rawDate);

      if (!bucketKey) continue;

      const current = grouped.get(bucketKey) || {
        key: bucketKey,
        label: formatTrendLabel(bucketKey, dateGranularity),
        lineItems: 0,
        sales: 0,
        cost: 0,
        actualUnits: 0,
        runningCost: 0,
      };

      current.lineItems += 1;
      current.sales += Number(row.totalSales || 0);
      current.cost += Number(row.totalCost || 0);
      current.actualUnits += getActualUnits(row);
      current.runningCost += getRunningCost(row);
      grouped.set(bucketKey, current);
    }

    return Array.from(grouped.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [filteredRows, dateGranularity]);

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = presets.find((item) => item.id === presetId);
      if (!preset) return;

      setProjectFilter(preset.projectFilter);
      setCustomerFilter(preset.customerFilter);
      setDateFrom(preset.dateFrom);
      setDateTo(preset.dateTo);
      setSearch(preset.search);
      setSelectedPresetId(preset.id);
    },
    [presets]
  );

  const savePreset = useCallback(() => {
    const trimmedName = presetName.trim();
    if (!trimmedName) return;

    const newPreset: FilterPreset = {
      id: `${Date.now()}`,
      name: trimmedName,
      projectFilter,
      customerFilter,
      dateFrom,
      dateTo,
      search,
      createdAt: new Date().toISOString(),
    };

    const next = [newPreset, ...presets].slice(0, 20);
    setPresets(next);
    setSelectedPresetId(newPreset.id);
    setPresetName("");

    try {
      window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage write errors and keep in-memory presets.
    }
  }, [presetName, projectFilter, customerFilter, dateFrom, dateTo, search, presets]);

  const deleteSelectedPreset = useCallback(() => {
    if (!selectedPresetId) return;
    const next = presets.filter((item) => item.id !== selectedPresetId);
    setPresets(next);
    setSelectedPresetId("");
    try {
      window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage write errors and keep in-memory presets.
    }
  }, [selectedPresetId, presets]);

  const exportFilteredCsv = useCallback(() => {
    const headers = [
      "syncedDate",
      "project",
      "customer",
      "projectId",
      "costCode",
      "costCodeName",
      "uom",
      "budgetQty",
      "effectiveUnitCost",
      "timecardHours",
      "productivityQty",
      "actualUnits",
      "runningCost",
      "originalBudgetAmount",
      "budgetAmount",
    ];

    const lines = [headers.map(csvCell).join(",")];
    for (const row of filteredRows) {
      lines.push(
        [
          toDateKey(row.syncedAt),
          row.projectName || "",
          row.customerName || "",
          row.projectId || "",
          row.costCode || "",
          row.costCodeName || "",
          row.uom || "",
          Number(row.quantity || 0).toFixed(2),
          getEffectiveUnitCost(row).toFixed(2),
          Number(row.actualTimecardHours || 0).toFixed(1),
          Number(row.actualProductivityQty || 0).toFixed(1),
          getActualUnits(row).toFixed(1),
          getRunningCost(row).toFixed(2),
          Number(row.originalBudgetAmount || 0).toFixed(2),
          Number(row.amount || 0).toFixed(2),
        ]
          .map(csvCell)
          .join(",")
      );
    }

    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = url;
    link.download = `advanced-analytics-${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [filteredRows]);

  const tableTotals = useMemo(() => {
    let unitCostTotal = 0;
    let tcHoursTotal = 0;
    let prodQtyTotal = 0;
    let budgetQtyTotal = 0;
    let actualUnitsTotal = 0;
    let runningCostTotal = 0;
    let originalBudgetTotal = 0;
    let budgetAmountTotal = 0;

    for (const row of filteredRows) {
      unitCostTotal += getEffectiveUnitCost(row);
      tcHoursTotal += Number(row.actualTimecardHours || 0);
      prodQtyTotal += Number(row.actualProductivityQty || 0);
      budgetQtyTotal += Number(row.quantity || 0);
      actualUnitsTotal += getActualUnits(row);
      runningCostTotal += getRunningCost(row);
      originalBudgetTotal += Number(row.originalBudgetAmount || 0);
      budgetAmountTotal += Number(row.amount || 0);
    }

    return {
      unitCostTotal,
      tcHoursTotal,
      prodQtyTotal,
      budgetQtyTotal,
      actualUnitsTotal,
      runningCostTotal,
      originalBudgetTotal,
      budgetAmountTotal,
    };
  }, [filteredRows]);

  const previewRows = useMemo(() => filteredRows.slice(0, 250), [filteredRows]);

  return (
    <div className="min-h-screen bg-slate-100">
      <Navigation currentPage="reporting" />

      <div className="mx-auto w-full max-w-[1700px] px-3 py-8 xl:px-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black uppercase tracking-widest text-slate-800">Advanced Analytics</h1>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                Filter and analyze budget line performance by project, customer, and date.
              </p>
              {lastRefreshedAt && (
                <p className="mt-1 text-[11px] font-semibold text-slate-500">Last refreshed: {lastRefreshedAt}</p>
              )}
            </div>

            <button
              onClick={() => void loadRows()}
              className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-black uppercase tracking-wider text-white hover:bg-slate-900"
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh Data"}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div>
              <label className="mb-1 block text-[11px] font-black uppercase tracking-wider text-slate-500">Project</label>
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">All Projects</option>
                {projectOptions.map((project) => (
                  <option key={project} value={project}>{project}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-black uppercase tracking-wider text-slate-500">Customer</label>
              <select
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">All Customers</option>
                {customerOptions.map((customer) => (
                  <option key={customer} value={customer}>{customer}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-black uppercase tracking-wider text-slate-500">From Date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-black uppercase tracking-wider text-slate-500">To Date</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-black uppercase tracking-wider text-slate-500">Search</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Project, proposal, cost code..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Preset name"
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold"
            />
            <button
              type="button"
              onClick={savePreset}
              disabled={!presetName.trim()}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save Preset
            </button>
            <select
              value={selectedPresetId}
              onChange={(e) => {
                const nextId = e.target.value;
                setSelectedPresetId(nextId);
                if (nextId) applyPreset(nextId);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold"
            >
              <option value="">Load Preset</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={deleteSelectedPreset}
              disabled={!selectedPresetId}
              className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-black uppercase tracking-wider text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Delete Preset
            </button>
            <select
              value={dateGranularity}
              onChange={(e) => setDateGranularity(e.target.value as DateGranularity)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold"
            >
              <option value="day">Daily Trend</option>
              <option value="week">Weekly Trend</option>
              <option value="month">Monthly Trend</option>
            </select>
            <button
              type="button"
              onClick={exportFilteredCsv}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => {
                setProjectFilter("");
                setCustomerFilter("");
                setDateFrom("");
                setDateTo("");
                setSearch("");
                setSelectedPresetId("");
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50"
            >
              Clear Filters
            </button>
          </div>

          {note && <p className="mt-3 text-xs font-semibold text-amber-700">{note}</p>}
          {error && <p className="mt-3 text-xs font-semibold text-red-700">{error}</p>}
        </section>

        <section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Line Items" value={formatNumber(analytics.lineItems)} tone="slate" />
          <MetricCard label="Projects" value={formatNumber(analytics.projects)} tone="teal" />
          <MetricCard label="Customers" value={formatNumber(analytics.customers)} tone="amber" />
          <MetricCard label="Actual Units" value={formatNumber(analytics.actualUnitsTotal)} tone="emerald" />
          <MetricCard label="Total Planned Hours" value={formatNumber(analytics.totalPlannedHours)} tone="teal" />
          <MetricCard label="Operational Running Cost" value={formatCurrency(analytics.runningCostTotal)} tone="slate" />
          <MetricCard label="Operational Budget Amount" value={formatCurrency(analytics.operationalBudgetAmountTotal)} tone="rose" />
          <MetricCard label="Planned O&P Revenue" value={formatCurrency(analytics.plannedOpRevenueTotal)} tone="violet" />
          <MetricCard label="Actual O&P Revenue" value={formatCurrency(analytics.actualOpRevenueTotal)} tone="indigo" />
          <MetricCard label="Spent %" value={`${analytics.spentPct.toFixed(1)}%`} tone="indigo" />
          <MetricCard label="Remaining %" value={`${analytics.remainingPct.toFixed(1)}%`} tone="teal" />
          <MetricCard label="Variance %" value={`${analytics.variancePct.toFixed(1)}%`} tone="amber" />
          <MetricCard label="Budget Remaining" value={formatCurrency(analytics.budgetRemaining)} tone="blue" />
          <MetricCard label="Total TC Hours" value={formatNumber(analytics.totalTimecardHours)} tone="indigo" />
          <MetricCard label="Total Prod Qty" value={formatNumber(analytics.totalProductivityQty)} tone="violet" />
          <MetricCard label="Original Budget" value={formatCurrency(analytics.costTotal)} tone="blue" />
          <MetricCard label="All Budget Amount" value={formatCurrency(analytics.budgetAmountTotal)} tone="slate" />
        </section>

        <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <TrendChartCard trendData={trendData} granularity={dateGranularity} />
          <RankedListCard
            title="Top Projects by Budget Amount"
            rows={analytics.topProjects}
            valueFormatter={(row) => `${formatCurrency(row.sales)} budget | ${formatNumber(row.actualUnits)} units`}
          />
          <RankedListCard
            title="Top Customers by Budget Amount"
            rows={analytics.topCustomers}
            valueFormatter={(row) => `${formatCurrency(row.sales)} budget | ${formatNumber(row.actualUnits)} units`}
          />
        </section>

        <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-700">
              Detail Preview ({formatNumber(filteredRows.length)} rows, showing {formatNumber(previewRows.length)})
            </h2>
          </div>

          <div className="overflow-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 pl-4">Synced Date</th>
                  <th className="py-2 pr-3">Project</th>
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">Cost Code</th>
                  <th className="py-2 pr-3">Cost Code Name</th>
                  <th className="py-2 pr-3">UOM</th>
                  <th className="py-2 pr-3 text-right">Budget Qty</th>
                  <th className="py-2 pr-3 text-right">Unit Cost (Eff)</th>
                  <th className="py-2 pr-3 text-right">TC Hours</th>
                  <th className="py-2 pr-3 text-right">Prod Qty</th>
                  <th className="py-2 pr-3 text-right">Actual Units</th>
                  <th className="py-2 pr-3 text-right">Running Cost</th>
                  <th className="py-2 pr-3 text-right">Original Budget</th>
                  <th className="py-2 pr-4 text-right">Budget Amount</th>
                </tr>
              </thead>
              <tbody>
                {!loading && previewRows.length === 0 && (
                  <tr>
                    <td colSpan={14} className="px-4 py-6 text-center text-sm font-semibold text-slate-500">
                      No rows match these filters.
                    </td>
                  </tr>
                )}
                {previewRows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 text-slate-800">
                    <td className="whitespace-nowrap py-2 pr-3 pl-4">{toDateKey(row.syncedAt) || "-"}</td>
                    <td className="py-2 pr-3">{row.projectName || "-"}</td>
                    <td className="py-2 pr-3">{row.customerName || "-"}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{row.costCode || "-"}</td>
                    <td className="py-2 pr-3">{row.costCodeName || "-"}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{row.uom || "-"}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">{row.quantity != null ? formatNumber(Number(row.quantity)) : "-"}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">{formatCurrency(getEffectiveUnitCost(row))}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">{formatNumber(Number(row.actualTimecardHours || 0))}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">{formatNumber(Number(row.actualProductivityQty || 0))}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">{formatNumber(getActualUnits(row))}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">{formatCurrency(getRunningCost(row))}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">{formatCurrency(Number(row.originalBudgetAmount || 0))}</td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right">{formatCurrency(Number(row.amount || 0))}</td>
                  </tr>
                ))}
              </tbody>
              {!loading && filteredRows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50 text-slate-900">
                    <td colSpan={6} className="py-2 pr-3 pl-4 text-[11px] font-black uppercase tracking-wider">
                      Totals (Filtered)
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right font-black">
                      {formatNumber(tableTotals.budgetQtyTotal)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right font-black">
                      {formatCurrency(tableTotals.unitCostTotal)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right font-black">
                      {formatNumber(tableTotals.tcHoursTotal)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right font-black">
                      {formatNumber(tableTotals.prodQtyTotal)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right font-black">
                      {formatNumber(tableTotals.actualUnitsTotal)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right font-black">
                      {formatCurrency(tableTotals.runningCostTotal)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right font-black">
                      {formatCurrency(tableTotals.originalBudgetTotal)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right font-black">
                      {formatCurrency(tableTotals.budgetAmountTotal)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: "slate" | "teal" | "amber" | "emerald" | "blue" | "indigo" | "rose" | "violet" }) {
  const toneMap: Record<typeof tone, string> = {
    slate: "border-slate-200 bg-slate-50 text-slate-800",
    teal: "border-teal-200 bg-teal-50 text-teal-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    violet: "border-violet-200 bg-violet-50 text-violet-800",
  };

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${toneMap[tone]}`}>
      <p className="text-[11px] font-black uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-1 text-xl font-black">{value}</p>
    </div>
  );
}

function TrendChartCard({ trendData, granularity }: { trendData: TrendPoint[]; granularity: DateGranularity }) {
  const maxSales = trendData.reduce((acc, row) => Math.max(acc, row.sales), 0);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-black uppercase tracking-wider text-slate-700">
        Sales Trend ({granularity})
      </h3>
      <p className="mt-1 text-[11px] font-semibold text-slate-500">
        Bars represent total sales per {granularity} bucket for the active filters.
      </p>

      <div className="mt-3 space-y-2">
        {trendData.length === 0 && <p className="text-xs font-semibold text-slate-500">No trend data for current filters.</p>}
        {trendData.map((row) => {
          const widthPct = maxSales > 0 ? Math.max(6, (row.sales / maxSales) * 100) : 6;

          return (
            <div key={row.key} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-black text-slate-700">{row.label}</p>
                <p className="text-[11px] font-semibold text-slate-600">
                  {row.lineItems.toLocaleString()} items | {formatNumber(row.actualUnits)} units
                </p>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-emerald-600" style={{ width: `${widthPct}%` }} />
              </div>
              <p className="mt-1 text-[11px] font-semibold text-slate-600">
                {formatCurrency(row.sales)} budget | {formatCurrency(row.runningCost)} running cost
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RankedListCard({
  title,
  rows,
  valueFormatter,
}: {
  title: string;
  rows: RankedMetric[];
  valueFormatter: (row: RankedMetric) => string;
}) {
  const maxSales = rows.reduce((acc, row) => Math.max(acc, row.sales), 0);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-black uppercase tracking-wider text-slate-700">{title}</h3>
      <div className="mt-3 space-y-2">
        {rows.length === 0 && <p className="text-xs font-semibold text-slate-500">No data for current filters.</p>}
        {rows.map((row) => {
          const widthPct = maxSales > 0 ? Math.max(8, (row.sales / maxSales) * 100) : 8;

          return (
            <div key={row.key} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-xs font-black text-slate-700">{row.label}</p>
                <p className="whitespace-nowrap text-[11px] font-semibold text-slate-600">{row.lineItems.toLocaleString()} items</p>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-slate-700" style={{ width: `${widthPct}%` }} />
              </div>
              <p className="mt-1 text-[11px] font-semibold text-slate-600">{valueFormatter(row)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
