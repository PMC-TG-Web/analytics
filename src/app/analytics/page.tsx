"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";

type PersistedLineItem = {
  id: string;
  actualsKey?: string | null;
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
  actualTimecardFirstDate?: string | null;
  actualTimecardLastDate?: string | null;
  actualProductivityQty?: number;
  actualProductivityFirstDate?: string | null;
  actualProductivityLastDate?: string | null;
  actualProductivityBreakdown?: ProductivityBreakdownItem[];
  syncedAt: string;
};

type ProductivityBreakdownItem = {
  costCode: string | null;
  contractNumber: string | null;
  contractTitle: string | null;
  lineItemPosition: number | null;
  lineItemDescription: string | null;
  lineItemQuantity: number | null;
  lineItemUom: string | null;
  quantityUsed: number;
  quantityDelivered: number;
  logCount: number;
  firstDate: string | null;
  lastDate: string | null;
};

type ProjectSummary = {
  id: string;
  companyId: string;
  procoreProjectId: string | null;
  bidBoardId: string | null;
  projectNumber: string | null;
  projectName: string;
  customerName: string | null;
  status: string | null;
  bidBoardStatus: string | null;
  sourceTable: string;
  budgetLineItems: number;
  budgetAmount: number;
  originalBudgetAmount: number;
  estimateLineItems: number;
  estimateProposals: number;
  timecardEntries: number;
  timecardHours: number;
  productivityLogs: number;
  productivityQuantityUsed: number;
  productivityQuantityDelivered: number;
};

type ApiResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  count?: number;
  source?: string;
  note?: string;
  diagnostics?: {
    companyIdUsed?: string;
    tableCountsByCompany?: {
      pmcProjects?: number;
      pmcBidBoardProjects?: number;
      budgetlineitems?: number;
      timecardEntries?: number;
      productivityLogs?: number;
      purchaseOrderLineItemContractDetails?: number;
    };
    budgetlineitemsCompaniesWithData?: Array<{
      companyId: string;
      count: number;
    }>;
  };
  projects?: ProjectSummary[];
  data?: PersistedLineItem[];
};

type RankedMetric = {
  key: string;
  label: string;
  lineItems: number;
  sales: number;
  actualUnits: number;
  timecardHours: number;
  productivityQty: number;
};

type DateGranularity = "day" | "week" | "month";
type FieldActualSource = "timecards" | "productivity";

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
  timecardHours: number;
  productivityQty: number;
  runningCost: number;
};

type ComparisonRow = {
  key: string;
  projectName: string;
  customerName: string;
  actualSource: FieldActualSource;
  lineItems: number;
  budgetQty: number;
  plannedHours: number;
  budgetAmount: number;
  originalBudgetAmount: number;
  completedBudgetAmount: number;
  actualUnits: number;
  runningCost: number;
  isMargin: boolean;
  syncedAt: string;
};

type PreviewRow = {
  id: string;
  budgetRow: PersistedLineItem;
  productivityLine?: ProductivityBreakdownItem;
};

const DEFAULT_COMPANY_ID = process.env.NEXT_PUBLIC_PROCORE_COMPANY_ID || "";
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

function getFieldActualSource(row: PersistedLineItem): FieldActualSource {
  const costCodeType = getCostCodeTypeSuffix(row.costCode);
  if (costCodeType === "L") return "timecards";
  return isHourBasedUom(row.uom) ? "timecards" : "productivity";
}

function formatFieldActualSource(source: FieldActualSource): string {
  return source === "timecards" ? "Timecards" : "Productivity";
}

function formatFieldActivity(productivityQty: number, timecardHours: number): string {
  return `${formatNumber(productivityQty)} qty / ${formatNumber(timecardHours)} hrs`;
}

function formatQuantityWithUom(quantity: number | null | undefined, uom: string | null | undefined): string {
  if (quantity == null || !Number.isFinite(quantity)) return "-";
  const normalizedUom = String(uom || "").trim();
  return normalizedUom ? `${formatNumber(quantity)} ${normalizedUom}` : formatNumber(quantity);
}

function formatProductivityBreakdownLabel(item: ProductivityBreakdownItem): string {
  const position = item.lineItemPosition != null ? `#${formatNumber(item.lineItemPosition)} - ` : "";
  return `${position}${item.lineItemDescription || "Unassigned PO line"}`;
}

function getProductivityBreakdown(row: PersistedLineItem): ProductivityBreakdownItem[] {
  if (getFieldActualSource(row) !== "productivity") return [];
  return row.actualProductivityBreakdown || [];
}

function getProductivityBreakdownUoms(row: PersistedLineItem): string[] {
  return Array.from(
    new Set(
      getProductivityBreakdown(row)
        .map((item) => String(item.lineItemUom || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function hasMixedProductivityUnits(row: PersistedLineItem): boolean {
  return getProductivityBreakdownUoms(row).length > 1;
}

function getProductivityBreakdownVariance(item: ProductivityBreakdownItem): number | null {
  const contractQty = item.lineItemQuantity;
  if (contractQty == null || !Number.isFinite(contractQty)) return null;
  return contractQty - Number(item.quantityUsed || 0);
}

function formatBudgetRowActual(row: PersistedLineItem): string {
  if (hasMixedProductivityUnits(row)) {
    return `${getProductivityBreakdown(row).length.toLocaleString()} PO lines`;
  }
  return formatNumber(getActualUnits(row));
}

function formatBudgetRowVariance(row: PersistedLineItem, variance: number): string {
  return hasMixedProductivityUnits(row) ? "see PO lines" : formatNumber(variance);
}

function getBudgetCostType(row: PersistedLineItem): string {
  const name = String(row.costCodeName || "").trim();
  if (name.includes(".")) {
    const suffix = name.slice(name.lastIndexOf(".") + 1).trim();
    if (suffix) return suffix;
  }

  const lineItemType = String(row.lineItemType || "").trim();
  if (lineItemType) return lineItemType;

  const costCodeType = getCostCodeTypeSuffix(row.costCode);
  if (costCodeType === "L") return "Labor";
  if (costCodeType === "M") return "Materials";
  if (costCodeType === "S") return "Subcontractors";
  if (costCodeType === "O") return "Other";
  return "";
}

function getBudgetCategoryPrefix(row: PersistedLineItem): string {
  const name = String(row.costCodeName || "").trim();
  if (!name) return String(row.costCode || "").trim();
  return name.includes(".") ? name.slice(0, name.lastIndexOf(".")).trim() : name;
}

function getGroupedCategoryName(row: PersistedLineItem): string {
  const costType = getBudgetCostType(row);
  if (costType.toLowerCase() === "labor") return "Labor";

  const prefix = getBudgetCategoryPrefix(row) || "(no name)";
  const words = prefix.split(/\s+/).filter(Boolean);
  return words.length >= 2 ? words.slice(-2).join(" ") : prefix;
}

function getBudgetSubcategoryName(row: PersistedLineItem): string {
  const prefix = getBudgetCategoryPrefix(row) || row.costCodeName || row.costCode || "-";
  if (getBudgetCostType(row).toLowerCase() === "labor") {
    return prefix.replace(/^labor\s+/i, "").trim() || "Labor";
  }
  return prefix;
}

function buildPreviewRows(rows: PersistedLineItem[]): PreviewRow[] {
  return rows.flatMap((row) => {
    const breakdown = getProductivityBreakdown(row);
    if (breakdown.length === 0) {
      return [{ id: row.id, budgetRow: row }];
    }

    return breakdown.map((item, index) => ({
      id: `${row.id}:productivity:${item.contractNumber || "contract"}:${item.lineItemPosition ?? index}`,
      budgetRow: row,
      productivityLine: item,
    }));
  });
}

function getPreviewLineLabel(row: PreviewRow): string {
  return row.productivityLine ? formatProductivityBreakdownLabel(row.productivityLine) : getBudgetSubcategoryName(row.budgetRow);
}

function getPreviewLineUom(row: PreviewRow): string {
  return row.productivityLine?.lineItemUom || row.budgetRow.uom || "-";
}

function getPreviewLineSource(row: PreviewRow): string {
  return row.productivityLine ? "Productivity" : formatFieldActualSource(getFieldActualSource(row.budgetRow));
}

function getPreviewLineLastDate(row: PreviewRow): string | null {
  return row.productivityLine?.lastDate || getFieldLastDate(row.budgetRow);
}

function getPreviewLineBudgetQty(row: PreviewRow): string {
  const item = row.productivityLine;
  if (item) return formatQuantityWithUom(item.lineItemQuantity, item.lineItemUom);
  return row.budgetRow.quantity != null ? formatNumber(Number(row.budgetRow.quantity)) : "-";
}

function getPreviewLineActual(row: PreviewRow): string {
  const item = row.productivityLine;
  if (item) return formatQuantityWithUom(item.quantityUsed, item.lineItemUom);
  return formatBudgetRowActual(row.budgetRow);
}

function getPreviewLineVariance(row: PreviewRow): { text: string; isOver: boolean } {
  const item = row.productivityLine;
  if (item) {
    const variance = getProductivityBreakdownVariance(item);
    return {
      text: variance == null ? "-" : formatQuantityWithUom(variance, item.lineItemUom),
      isOver: variance != null && variance < 0,
    };
  }

  const variance = Number(row.budgetRow.quantity || 0) - getActualUnits(row.budgetRow);
  return {
    text: formatBudgetRowVariance(row.budgetRow, variance),
    isOver: !hasMixedProductivityUnits(row.budgetRow) && variance < 0,
  };
}

function getPreviewLineRunningCost(row: PreviewRow): string {
  return row.productivityLine ? "-" : formatCurrency(getRunningCost(row.budgetRow));
}

function getPreviewLineBudgetAmount(row: PreviewRow): string {
  return row.productivityLine ? "-" : formatCurrency(Number(row.budgetRow.amount || 0));
}

function getActualUnits(row: PersistedLineItem): number {
  if (getFieldActualSource(row) === "timecards") return Number(row.actualTimecardHours || 0);
  return Number(row.actualProductivityQty || 0);
}

function isHourBasedUom(value: string | null | undefined): boolean {
  const normalizedUom = String(value || "").trim().toLowerCase();
  return /\b(hours?|hrs?|h)\b/.test(normalizedUom);
}

function getCostCodeTypeSuffix(value: string | null | undefined): string {
  const match = String(value || "").trim().match(/\.([A-Za-z])$/);
  return match ? match[1].toUpperCase() : "";
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

function getFieldFirstDate(row: PersistedLineItem): string | null {
  if (getFieldActualSource(row) === "timecards") return row.actualTimecardFirstDate || null;
  return row.actualProductivityFirstDate || null;
}

function getFieldLastDate(row: PersistedLineItem): string | null {
  if (getFieldActualSource(row) === "timecards") return row.actualTimecardLastDate || null;
  return row.actualProductivityLastDate || null;
}

function getComparisonKey(row: PersistedLineItem): string {
  const source = getFieldActualSource(row);
  const actualsKey = String(row.actualsKey || "").trim();
  if (actualsKey) return `${actualsKey}::${source}`;

  const fallbackCostCode = String(row.costCode || row.id || "").trim().toUpperCase();
  return `${row.projectId}::${fallbackCostCode}::${source}`;
}

function getLaterDateString(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;

  const aTime = new Date(a).getTime();
  const bTime = new Date(b).getTime();
  if (Number.isNaN(aTime)) return b;
  if (Number.isNaN(bTime)) return a;
  return bTime > aTime ? b : a;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function getComparisonCompletionRatio(budgetQty: number, actualUnits: number): number {
  if (!Number.isFinite(budgetQty) || budgetQty <= 0) return 0;
  return clamp01(actualUnits / budgetQty);
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


export default function AnalyticsPage() {
  const [projectSummaries, setProjectSummaries] = useState<ProjectSummary[]>([]);
  const [rows, setRows] = useState<PersistedLineItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [diagnostics, setDiagnostics] = useState<ApiResponse["diagnostics"] | null>(null);
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
  const [sortCol, setSortCol] = useState<string>("projectName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = useCallback((col: string) => {
    setSortCol((prev) => {
      if (prev === col) return col;
      return col;
    });
    setSortDir((prev) => (sortCol === col ? (prev === "asc" ? "desc" : "asc") : "asc"));
  }, [sortCol]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    setNote("");
    setDiagnostics(null);

    try {
      const url = new URL("/api/analytics/advanced", window.location.origin);
      url.searchParams.set("companyId", DEFAULT_COMPANY_ID);
      url.searchParams.set("actualsMode", "cost-code");
      url.searchParams.set("_ts", String(Date.now()));

      const response = await fetch(url.toString(), { cache: "no-store" });
      const body: ApiResponse = await response.json();

      if (!response.ok || body.success === false) {
        throw new Error(
          body.error
            ? `${body.error}${body.details ? `: ${body.details}` : ""}`
            : `Failed to load analytics data (${response.status})`
        );
      }

      const allRows: PersistedLineItem[] = Array.isArray(body.data) ? body.data : [];
      const allProjects: ProjectSummary[] = Array.isArray(body.projects) ? body.projects : [];
      const bodyDiagnostics = body.diagnostics || null;

      setProjectSummaries(allProjects);
      setRows(allRows);
      setDiagnostics(bodyDiagnostics);
      setNote(
        `Analytics loaded from clean project tables: ${allProjects.length.toLocaleString()} projects and ${allRows.length.toLocaleString()} budget line rows${bodyDiagnostics?.companyIdUsed ? ` (company ${bodyDiagnostics.companyIdUsed})` : ""}.`
      );
      setLastRefreshedAt(new Date().toLocaleString());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load analytics data");
      setRows([]);
      setProjectSummaries([]);
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
    for (const project of projectSummaries) {
      const value = String(project.projectName || "").trim();
      if (value) unique.add(value);
    }
    for (const row of rows) {
      const value = String(row.projectName || "").trim();
      if (value) unique.add(value);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [projectSummaries, rows]);

  const customerOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const project of projectSummaries) {
      const value = String(project.customerName || "").trim();
      if (value) unique.add(value);
    }
    for (const row of rows) {
      const value = String(row.customerName || "").trim();
      if (value) unique.add(value);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [projectSummaries, rows]);

  const filteredProjectSummaries = useMemo(() => {
    const query = search.trim().toLowerCase();

    return projectSummaries.filter((project) => {
      const projectName = String(project.projectName || "").trim();
      const customerName = String(project.customerName || "").trim();

      if (projectFilter && projectName !== projectFilter) return false;
      if (customerFilter && customerName !== customerFilter) return false;
      if (!query) return true;

      const haystack = [
        project.projectName,
        project.customerName,
        project.projectNumber,
        project.procoreProjectId,
        project.bidBoardId,
        project.status,
        project.bidBoardStatus,
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");

      return haystack.includes(query);
    });
  }, [projectSummaries, projectFilter, customerFilter, search]);

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

  const comparisonRows = useMemo(() => {
    const grouped = new Map<string, ComparisonRow & { unitCostFallbackTotal: number }>();

    for (const row of filteredRows) {
      const key = getComparisonKey(row);
      const budgetQty = Number(row.quantity || 0);
      const budgetAmount = Number(row.totalSales || 0);
      const originalBudgetAmount = Number(row.totalCost || 0);
      const actualUnits = getActualUnits(row);
      const existing =
        grouped.get(key) ||
        {
          key,
          projectName: String(row.projectName || "Unassigned Project").trim(),
          customerName: String(row.customerName || "Unassigned Customer").trim(),
          actualSource: getFieldActualSource(row),
          lineItems: 0,
          budgetQty: 0,
          plannedHours: 0,
          budgetAmount: 0,
          originalBudgetAmount: 0,
          completedBudgetAmount: 0,
          actualUnits: 0,
          runningCost: 0,
          isMargin: false,
          syncedAt: "",
          unitCostFallbackTotal: 0,
        };

      existing.lineItems += 1;
      existing.budgetQty += budgetQty;
      existing.plannedHours += getPlannedHours(row);
      existing.budgetAmount += budgetAmount;
      existing.originalBudgetAmount += originalBudgetAmount;
      existing.actualUnits = Math.max(existing.actualUnits, actualUnits);
      existing.isMargin = existing.isMargin || isMarginRevenueLine(row);
      existing.syncedAt = getLaterDateString(existing.syncedAt, row.syncedAt || "");
      existing.unitCostFallbackTotal += getEffectiveUnitCost(row);
      grouped.set(key, existing);
    }

    return Array.from(grouped.values()).map(({ unitCostFallbackTotal, ...row }) => {
      const effectiveUnitCost =
        row.budgetQty > 0
          ? row.budgetAmount / row.budgetQty
          : row.lineItems > 0
            ? unitCostFallbackTotal / row.lineItems
            : 0;

      return {
        ...row,
        completedBudgetAmount: row.budgetAmount * getComparisonCompletionRatio(row.budgetQty, row.actualUnits),
        runningCost: row.actualUnits * effectiveUnitCost,
      };
    });
  }, [filteredRows]);

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

    for (const row of comparisonRows) {
      const budgetAmount = row.budgetAmount;
      const originalBudget = row.originalBudgetAmount;
      const actualUnits = row.actualUnits;
      const runningCost = row.runningCost;
      const isMargin = row.isMargin;
      const projectName = row.projectName;
      const customerName = row.customerName;

      budgetAmountTotal += budgetAmount;
      originalBudgetTotal += originalBudget;
      actualUnitsTotal += actualUnits;
      totalPlannedHours += row.plannedHours;
      if (isMargin) {
        plannedOpRevenueTotal += budgetAmount;
      } else {
        operationalRunningCostTotal += runningCost;
        operationalBudgetAmountTotal += budgetAmount;
        operationalOriginalBudgetTotal += originalBudget;
        operationalCompletedBudgetAmountTotal += row.completedBudgetAmount;
      }
      if (row.actualSource === "timecards") {
        totalTimecardHours += actualUnits;
      } else {
        totalProductivityQty += actualUnits;
      }
      projectSet.add(projectName);
      customerSet.add(customerName);

      const projectMetric = byProject.get(projectName) || {
        key: projectName,
        label: projectName,
        lineItems: 0,
        sales: 0,
        actualUnits: 0,
        timecardHours: 0,
        productivityQty: 0,
      };
      projectMetric.lineItems += row.lineItems;
      projectMetric.sales += budgetAmount;
      projectMetric.actualUnits += actualUnits;
      if (row.actualSource === "timecards") {
        projectMetric.timecardHours += actualUnits;
      } else {
        projectMetric.productivityQty += actualUnits;
      }
      byProject.set(projectName, projectMetric);

      const customerMetric = byCustomer.get(customerName) || {
        key: customerName,
        label: customerName,
        lineItems: 0,
        sales: 0,
        actualUnits: 0,
        timecardHours: 0,
        productivityQty: 0,
      };
      customerMetric.lineItems += row.lineItems;
      customerMetric.sales += budgetAmount;
      customerMetric.actualUnits += actualUnits;
      if (row.actualSource === "timecards") {
        customerMetric.timecardHours += actualUnits;
      } else {
        customerMetric.productivityQty += actualUnits;
      }
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
      projects: filteredProjectSummaries.length || projectSet.size,
      customers: filteredProjectSummaries.length > 0
        ? new Set(filteredProjectSummaries.map((project) => String(project.customerName || "").trim()).filter(Boolean)).size
        : customerSet.size,
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
  }, [filteredRows.length, filteredProjectSummaries, comparisonRows]);

  const projectTotals = useMemo(() => {
    return filteredProjectSummaries.reduce(
      (acc, project) => {
        acc.budgetAmount += Number(project.budgetAmount || 0);
        acc.originalBudgetAmount += Number(project.originalBudgetAmount || 0);
        acc.estimateLineItems += Number(project.estimateLineItems || 0);
        acc.estimateProposals += Number(project.estimateProposals || 0);
        acc.timecardEntries += Number(project.timecardEntries || 0);
        acc.timecardHours += Number(project.timecardHours || 0);
        acc.productivityLogs += Number(project.productivityLogs || 0);
        acc.productivityQuantityUsed += Number(project.productivityQuantityUsed || 0);
        return acc;
      },
      {
        budgetAmount: 0,
        originalBudgetAmount: 0,
        estimateLineItems: 0,
        estimateProposals: 0,
        timecardEntries: 0,
        timecardHours: 0,
        productivityLogs: 0,
        productivityQuantityUsed: 0,
      }
    );
  }, [filteredProjectSummaries]);

  const projectPreviewRows = useMemo(() => {
    return filteredProjectSummaries
      .slice()
      .sort((a, b) => {
        const aActivity =
          Number(a.budgetLineItems || 0) +
          Number(a.estimateLineItems || 0) +
          Number(a.timecardEntries || 0) +
          Number(a.productivityLogs || 0);
        const bActivity =
          Number(b.budgetLineItems || 0) +
          Number(b.estimateLineItems || 0) +
          Number(b.timecardEntries || 0) +
          Number(b.productivityLogs || 0);
        if (aActivity !== bActivity) return bActivity - aActivity;
        return String(a.projectName || "").localeCompare(String(b.projectName || ""));
      })
      .slice(0, 200);
  }, [filteredProjectSummaries]);

  const trendData = useMemo(() => {
    const grouped = new Map<string, TrendPoint>();

    for (const row of comparisonRows) {
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
        timecardHours: 0,
        productivityQty: 0,
        runningCost: 0,
      };

      current.lineItems += row.lineItems;
      current.sales += row.budgetAmount;
      current.cost += row.originalBudgetAmount;
      current.actualUnits += row.actualUnits;
      if (row.actualSource === "timecards") {
        current.timecardHours += row.actualUnits;
      } else {
        current.productivityQty += row.actualUnits;
      }
      current.runningCost += row.runningCost;
      grouped.set(bucketKey, current);
    }

    return Array.from(grouped.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [comparisonRows, dateGranularity]);

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
      "fieldSource",
      "fieldFirstDate",
      "fieldLastDate",
      "effectiveUnitCost",
      "budgetQty",
      "fieldUsedUnits",
      "qtyVariance",
      "runningCost",
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
          formatFieldActualSource(getFieldActualSource(row)),
          toDateKey(getFieldFirstDate(row)),
          toDateKey(getFieldLastDate(row)),
          getEffectiveUnitCost(row).toFixed(2),
          Number(row.quantity || 0).toFixed(2),
          getActualUnits(row).toFixed(1),
          (Number(row.quantity || 0) - getActualUnits(row)).toFixed(2),
          getRunningCost(row).toFixed(2),
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

  const groupedRows = useMemo(() => {
    const map = new Map<string, { budgetQty: number; actualUnits: number; timecardHours: number; productivityQty: number; runningCost: number; budgetAmount: number; rowCount: number; lines: PersistedLineItem[] }>();
    for (const row of filteredRows) {
      const group = getGroupedCategoryName(row);
      const existing = map.get(group) ?? { budgetQty: 0, actualUnits: 0, timecardHours: 0, productivityQty: 0, runningCost: 0, budgetAmount: 0, rowCount: 0, lines: [] };
      const actualUnits = getActualUnits(row);
      existing.budgetQty += Number(row.quantity || 0);
      existing.actualUnits += actualUnits;
      if (getFieldActualSource(row) === "timecards") {
        existing.timecardHours += actualUnits;
      } else {
        existing.productivityQty += actualUnits;
      }
      existing.runningCost += getRunningCost(row);
      existing.budgetAmount += Number(row.amount || 0);
      existing.rowCount += 1;
      existing.lines.push(row);
      map.set(group, existing);
    }
    return Array.from(map.entries())
      .map(([group, totals]) => ({
        group,
        ...totals,
        lines: [...totals.lines].sort((a, b) => {
          const labelCompare = getBudgetSubcategoryName(a).localeCompare(getBudgetSubcategoryName(b));
          if (labelCompare !== 0) return labelCompare;
          return String(a.costCode || "").localeCompare(String(b.costCode || ""));
        }),
        qtyVariance: totals.budgetQty - totals.actualUnits,
      }))
      .sort((a, b) => a.group.localeCompare(b.group));
  }, [filteredRows]);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = useCallback((group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  }, []);

  const exportGroupedCsv = useCallback(() => {
    const headers = [
      "rowType",
      "category",
      "project",
      "customer",
      "costCode",
      "subcategory",
      "uom",
      "effectiveUnitCost",
      "lines",
      "budgetQty",
      "fieldUsedUnits",
      "qtyVariance",
      "runningCost",
      "budgetAmount",
    ];
    const lines = [headers.map(csvCell).join(",")];
    for (const g of groupedRows) {
      lines.push(
        [
          "group",
          g.group,
          "",
          "",
          "",
          "",
          "",
          "",
          g.rowCount,
          g.budgetQty.toFixed(2),
          g.actualUnits.toFixed(2),
          g.qtyVariance.toFixed(2),
          g.runningCost.toFixed(2),
          g.budgetAmount.toFixed(2),
        ]
          .map(csvCell)
          .join(",")
      );

      for (const row of g.lines) {
        lines.push(
          [
            "line-item",
            g.group,
            row.projectName || "",
            row.customerName || "",
            row.costCode || "",
            getBudgetSubcategoryName(row),
            row.uom || "",
            getEffectiveUnitCost(row).toFixed(2),
            "",
            Number(row.quantity || 0).toFixed(2),
            getActualUnits(row).toFixed(2),
            (Number(row.quantity || 0) - getActualUnits(row)).toFixed(2),
            getRunningCost(row).toFixed(2),
            Number(row.amount || 0).toFixed(2),
          ]
            .map(csvCell)
            .join(",")
        );
      }
    }
    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = url;
    link.download = `analytics-grouped-${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [groupedRows]);

  const tableTotals = useMemo(() => {
    let unitCostTotal = 0;
    let budgetQtyTotal = 0;
    let actualUnitsTotal = 0;
    let timecardHoursTotal = 0;
    let productivityQtyTotal = 0;
    let runningCostTotal = 0;
    let budgetAmountTotal = 0;

    for (const row of filteredRows) {
      const actualUnits = getActualUnits(row);
      unitCostTotal += getEffectiveUnitCost(row);
      budgetQtyTotal += Number(row.quantity || 0);
      actualUnitsTotal += actualUnits;
      if (getFieldActualSource(row) === "timecards") {
        timecardHoursTotal += actualUnits;
      } else {
        productivityQtyTotal += actualUnits;
      }
      runningCostTotal += getRunningCost(row);
      budgetAmountTotal += Number(row.amount || 0);
    }

    return {
      unitCostTotal,
      budgetQtyTotal,
      actualUnitsTotal,
      timecardHoursTotal,
      productivityQtyTotal,
      qtyVarianceTotal: budgetQtyTotal - actualUnitsTotal,
      runningCostTotal,
      budgetAmountTotal,
    };
  }, [filteredRows]);

  const previewRows = useMemo(() => {
    const sorted = buildPreviewRows(filteredRows).sort((a, b) => {
      const aBudgetRow = a.budgetRow;
      const bBudgetRow = b.budgetRow;
      let av: string | number = 0;
      let bv: string | number = 0;
      switch (sortCol) {
        case "syncedAt":      av = aBudgetRow.syncedAt || ""; bv = bBudgetRow.syncedAt || ""; break;
        case "projectName":   av = (aBudgetRow.projectName || "").toLowerCase(); bv = (bBudgetRow.projectName || "").toLowerCase(); break;
        case "customerName":  av = (aBudgetRow.customerName || "").toLowerCase(); bv = (bBudgetRow.customerName || "").toLowerCase(); break;
        case "costCode":      av = (a.productivityLine?.costCode || aBudgetRow.costCode || "").toLowerCase(); bv = (b.productivityLine?.costCode || bBudgetRow.costCode || "").toLowerCase(); break;
        case "costCodeName":  av = getPreviewLineLabel(a).toLowerCase(); bv = getPreviewLineLabel(b).toLowerCase(); break;
        case "uom":           av = getPreviewLineUom(a).toLowerCase(); bv = getPreviewLineUom(b).toLowerCase(); break;
        case "fieldSource":   av = getPreviewLineSource(a); bv = getPreviewLineSource(b); break;
        case "fieldLastDate": av = getPreviewLineLastDate(a) || ""; bv = getPreviewLineLastDate(b) || ""; break;
        case "quantity":      av = Number(a.productivityLine?.lineItemQuantity ?? aBudgetRow.quantity ?? 0); bv = Number(b.productivityLine?.lineItemQuantity ?? bBudgetRow.quantity ?? 0); break;
        case "unitCost":      av = a.productivityLine ? 0 : getEffectiveUnitCost(aBudgetRow); bv = b.productivityLine ? 0 : getEffectiveUnitCost(bBudgetRow); break;
        case "actualUnits":   av = Number(a.productivityLine?.quantityUsed ?? getActualUnits(aBudgetRow)); bv = Number(b.productivityLine?.quantityUsed ?? getActualUnits(bBudgetRow)); break;
        case "runningCost":   av = a.productivityLine ? 0 : getRunningCost(aBudgetRow); bv = b.productivityLine ? 0 : getRunningCost(bBudgetRow); break;
        case "qtyVariance":   av = a.productivityLine ? Number(getProductivityBreakdownVariance(a.productivityLine) ?? 0) : Number(aBudgetRow.quantity || 0) - getActualUnits(aBudgetRow); bv = b.productivityLine ? Number(getProductivityBreakdownVariance(b.productivityLine) ?? 0) : Number(bBudgetRow.quantity || 0) - getActualUnits(bBudgetRow); break;
        case "amount":        av = a.productivityLine ? 0 : Number(aBudgetRow.amount || 0); bv = b.productivityLine ? 0 : Number(bBudgetRow.amount || 0); break;
        default: av = ""; bv = "";
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted.slice(0, 250);
  }, [filteredRows, sortCol, sortDir]);

  return (
    <div className="min-h-screen bg-slate-100">
      <Navigation currentPage="analytics" />

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
          {diagnostics && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <p className="font-semibold text-slate-800">
                Diagnostics: company {diagnostics.companyIdUsed || "unknown"}
              </p>
              <p className="mt-1">
                pmc projects: {(diagnostics.tableCountsByCompany?.pmcProjects || 0).toLocaleString()} | bid board: {(diagnostics.tableCountsByCompany?.pmcBidBoardProjects || 0).toLocaleString()} | budgetlineitems: {(diagnostics.tableCountsByCompany?.budgetlineitems || 0).toLocaleString()} | timecards: {(diagnostics.tableCountsByCompany?.timecardEntries || 0).toLocaleString()} | productivity logs: {(diagnostics.tableCountsByCompany?.productivityLogs || 0).toLocaleString()} | PO line details: {(diagnostics.tableCountsByCompany?.purchaseOrderLineItemContractDetails || 0).toLocaleString()}
              </p>
              {Array.isArray(diagnostics.budgetlineitemsCompaniesWithData) && diagnostics.budgetlineitemsCompaniesWithData.length > 0 && (
                <p className="mt-1">
                  budgetlineitems companies with data: {diagnostics.budgetlineitemsCompaniesWithData
                    .map((row) => `${row.companyId} (${Number(row.count || 0).toLocaleString()})`)
                    .join(", ")}
                </p>
              )}
            </div>
          )}
          {error && <p className="mt-3 text-xs font-semibold text-red-700">{error}</p>}
        </section>

        <section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Line Items" value={formatNumber(analytics.lineItems)} tone="slate" />
          <MetricCard label="Projects" value={formatNumber(analytics.projects)} tone="teal" />
          <MetricCard label="Customers" value={formatNumber(analytics.customers)} tone="amber" />
          <MetricCard label="Estimate Lines" value={formatNumber(projectTotals.estimateLineItems)} tone="blue" />
          <MetricCard label="Estimate Proposals" value={formatNumber(projectTotals.estimateProposals)} tone="indigo" />
          <MetricCard label="Field Used" value={formatFieldActivity(analytics.totalProductivityQty, analytics.totalTimecardHours)} tone="emerald" />
          <MetricCard label="Total Planned Hours" value={formatNumber(analytics.totalPlannedHours)} tone="teal" />
          <MetricCard label="Operational Running Cost" value={formatCurrency(analytics.runningCostTotal)} tone="slate" />
          <MetricCard label="Operational Budget Amount" value={formatCurrency(analytics.operationalBudgetAmountTotal)} tone="rose" />
          <MetricCard label="Planned O&P Revenue" value={formatCurrency(analytics.plannedOpRevenueTotal)} tone="violet" />
          <MetricCard label="Earned O&P Revenue" value={formatCurrency(analytics.actualOpRevenueTotal)} tone="indigo" />
          <MetricCard label="Spent %" value={`${analytics.spentPct.toFixed(1)}%`} tone="indigo" />
          <MetricCard label="Remaining %" value={`${analytics.remainingPct.toFixed(1)}%`} tone="teal" />
          <MetricCard label="Variance %" value={`${analytics.variancePct.toFixed(1)}%`} tone="amber" />
          <MetricCard label="Budget Remaining" value={formatCurrency(analytics.budgetRemaining)} tone="blue" />
          <MetricCard label="Timecard Hours" value={formatNumber(analytics.totalTimecardHours)} tone="indigo" />
          <MetricCard label="Productivity Qty" value={formatNumber(analytics.totalProductivityQty)} tone="violet" />
          <MetricCard label="Original Budget" value={formatCurrency(analytics.costTotal)} tone="blue" />
          <MetricCard label="All Budget Amount" value={formatCurrency(analytics.budgetAmountTotal)} tone="slate" />
        </section>

        <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-700">
                Clean Project Overview ({formatNumber(filteredProjectSummaries.length)} projects)
              </h2>
              <p className="mt-1 text-[11px] font-semibold text-slate-500">
                Rooted in pmc_projects and pmc_bid_board_projects only.
              </p>
            </div>
            <div className="text-right text-[11px] font-bold text-slate-600">
              {formatCurrency(projectTotals.budgetAmount)} budget | {formatNumber(projectTotals.timecardHours)} hours | {formatNumber(projectTotals.productivityQuantityUsed)} used qty
            </div>
          </div>

          <div className="overflow-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 pl-4">Project</th>
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">Project ID</th>
                  <th className="py-2 pr-3">Bid Board ID</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Budget Lines</th>
                  <th className="py-2 pr-3 text-right">Budget</th>
                  <th className="py-2 pr-3 text-right">Estimate Lines</th>
                  <th className="py-2 pr-3 text-right">Timecards</th>
                  <th className="py-2 pr-3 text-right">Hours</th>
                  <th className="py-2 pr-4 text-right">Prod Logs</th>
                </tr>
              </thead>
              <tbody>
                {!loading && projectPreviewRows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-6 text-center text-sm font-semibold text-slate-500">
                      No clean project rows match these filters.
                    </td>
                  </tr>
                )}
                {projectPreviewRows.map((project) => (
                  <tr key={project.id} className="border-b border-slate-100 text-slate-800 hover:bg-slate-50">
                    <td className="py-2 pr-3 pl-4">
                      <div className="font-semibold">{project.projectName || "-"}</div>
                      <div className="text-[11px] text-slate-500">{project.projectNumber || project.sourceTable}</div>
                    </td>
                    <td className="py-2 pr-3">{project.customerName || "-"}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{project.procoreProjectId || "-"}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{project.bidBoardId || "-"}</td>
                    <td className="py-2 pr-3">{project.status || project.bidBoardStatus || "-"}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">{formatNumber(project.budgetLineItems)}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">{formatCurrency(project.budgetAmount)}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">{formatNumber(project.estimateLineItems)}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">{formatNumber(project.timecardEntries)}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">{formatNumber(project.timecardHours)}</td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right">{formatNumber(project.productivityLogs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <TrendChartCard trendData={trendData} granularity={dateGranularity} />
          <RankedListCard
            title="Top Projects by Budget Amount"
            rows={analytics.topProjects}
            valueFormatter={(row) => `${formatCurrency(row.sales)} budget | ${formatFieldActivity(row.productivityQty, row.timecardHours)}`}
          />
          <RankedListCard
            title="Top Customers by Budget Amount"
            rows={analytics.topCustomers}
            valueFormatter={(row) => `${formatCurrency(row.sales)} budget | ${formatFieldActivity(row.productivityQty, row.timecardHours)}`}
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
                  {(
                    [
                      ["syncedAt", "Synced Date"],
                      ["projectName", "Project"],
                      ["customerName", "Customer"],
                      ["costCode", "Cost Code"],
                      ["costCodeName", "Line"],
                      ["uom", "UOM"],
                      ["fieldSource", "Field Source"],
                      ["fieldLastDate", "Last Used"],
                      ["unitCost", "Unit Cost (Eff)"],
                      ["quantity", "Budget Qty"],
                      ["actualUnits", "Field Used"],
                      ["qtyVariance", "Qty Variance"],
                      ["runningCost", "Running Cost"],
                      ["amount", "Budget Amount"],
                    ] as [string, string][]
                  ).map(([col, label]) => {
                    const isActive = sortCol === col;
                    const numeric = ["quantity","unitCost","actualUnits","qtyVariance","runningCost","amount"].includes(col);
                    return (
                      <th
                        key={col}
                        onClick={() => handleSort(col)}
                        className={`cursor-pointer select-none py-2 pr-3 ${col === "syncedAt" ? "pl-4" : ""} ${numeric ? "text-right" : ""} hover:text-slate-800 ${isActive ? "text-teal-700" : ""}`}
                      >
                        {label}{isActive ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                      </th>
                    );
                  })}
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
                {previewRows.map((row) => {
                  const budgetRow = row.budgetRow;
                  const variance = getPreviewLineVariance(row);
                  return (
                    <tr key={row.id} className={`border-b border-slate-100 text-slate-800 ${variance.isOver ? "bg-red-50" : ""}`}>
                      <td className="whitespace-nowrap py-2 pr-3 pl-4">{toDateKey(budgetRow.syncedAt) || "-"}</td>
                      <td className="py-2 pr-3">{budgetRow.projectName || "-"}</td>
                      <td className="py-2 pr-3">{budgetRow.customerName || "-"}</td>
                      <td className="whitespace-nowrap py-2 pr-3">{row.productivityLine?.costCode || budgetRow.costCode || "-"}</td>
                      <td className="py-2 pr-3">{getPreviewLineLabel(row)}</td>
                      <td className="whitespace-nowrap py-2 pr-3">{getPreviewLineUom(row)}</td>
                      <td className="whitespace-nowrap py-2 pr-3">{getPreviewLineSource(row)}</td>
                      <td className="whitespace-nowrap py-2 pr-3">{toDateKey(getPreviewLineLastDate(row)) || "-"}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right">{row.productivityLine ? "-" : formatCurrency(getEffectiveUnitCost(budgetRow))}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right">{getPreviewLineBudgetQty(row)}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right">{getPreviewLineActual(row)}</td>
                      <td className={`whitespace-nowrap py-2 pr-3 text-right font-semibold ${variance.isOver ? "text-red-600" : ""}`}>{variance.text}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right">{getPreviewLineRunningCost(row)}</td>
                      <td className="whitespace-nowrap py-2 pr-4 text-right">{getPreviewLineBudgetAmount(row)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {!loading && filteredRows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50 text-slate-900">
                    <td colSpan={8} className="py-2 pr-3 pl-4 text-[11px] font-black uppercase tracking-wider">
                      Totals (Filtered)
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right font-black">
                      {formatCurrency(tableTotals.unitCostTotal)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right font-black">
                      {formatNumber(tableTotals.budgetQtyTotal)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right font-black">
                      <div>{formatNumber(tableTotals.productivityQtyTotal)} qty</div>
                      <div className="text-[10px] font-bold text-slate-500">{formatNumber(tableTotals.timecardHoursTotal)} hrs</div>
                    </td>
                    <td className={`whitespace-nowrap py-2 pr-3 text-right font-black ${tableTotals.qtyVarianceTotal < 0 ? "text-red-600" : ""}`}>
                      {formatNumber(tableTotals.qtyVarianceTotal)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right font-black">
                      {formatCurrency(tableTotals.runningCostTotal)}
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

        <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-700">
              Grouped by Category ({groupedRows.length} groups)
            </h2>
            <button
              type="button"
              onClick={exportGroupedCsv}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50"
            >
              Export CSV
            </button>
          </div>
          <div className="overflow-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 pl-4">Category</th>
                  <th className="py-2 pr-3 text-right">Lines</th>
                  <th className="py-2 pr-3 text-right">Budget Qty</th>
                  <th className="py-2 pr-3 text-right">Field Used</th>
                  <th className="py-2 pr-3 text-right">Qty Variance</th>
                  <th className="py-2 pr-3 text-right">Running Cost</th>
                  <th className="py-2 pr-4 text-right">Budget Amount</th>
                </tr>
              </thead>
              <tbody>
                {groupedRows.map((g) => {
                  const isExpanded = expandedGroups.has(g.group);
                  return (
                    <React.Fragment key={g.group}>
                      <tr
                        onClick={() => toggleGroup(g.group)}
                        className={`cursor-pointer border-b border-slate-100 text-slate-800 hover:bg-slate-50 ${g.qtyVariance < 0 ? "bg-red-50 hover:bg-red-100" : ""}`}
                      >
                        <td className="py-2 pr-3 pl-4 font-semibold">
                          <span className="mr-2 text-slate-400">{isExpanded ? "▾" : "▸"}</span>
                          {g.group}
                        </td>
                        <td className="whitespace-nowrap py-2 pr-3 text-right text-slate-500">{g.rowCount}</td>
                        <td className="whitespace-nowrap py-2 pr-3 text-right">{formatNumber(g.budgetQty)}</td>
                        <td className="whitespace-nowrap py-2 pr-3 text-right">
                          <div>{formatNumber(g.productivityQty)} qty</div>
                          <div className="text-[10px] font-bold text-slate-500">{formatNumber(g.timecardHours)} hrs</div>
                        </td>
                        <td className={`whitespace-nowrap py-2 pr-3 text-right font-semibold ${g.qtyVariance < 0 ? "text-red-600" : ""}`}>{formatNumber(g.qtyVariance)}</td>
                        <td className="whitespace-nowrap py-2 pr-3 text-right">{formatCurrency(g.runningCost)}</td>
                        <td className="whitespace-nowrap py-2 pr-4 text-right">{formatCurrency(g.budgetAmount)}</td>
                      </tr>
                      {isExpanded && g.lines.map((row) => {
                        const qv = Number(row.quantity || 0) - getActualUnits(row);
                        const productivityBreakdown = getProductivityBreakdown(row);
                        const mixedProductivityUnits = hasMixedProductivityUnits(row);
                        return (
                          <React.Fragment key={row.id}>
                            <tr className={`border-b border-slate-100 text-slate-600 ${!mixedProductivityUnits && qv < 0 ? "bg-red-50" : "bg-slate-50"}`}>
                              <td className="py-1.5 pr-3 pl-10 text-[11px]">{getBudgetSubcategoryName(row)} <span className="ml-1 text-slate-400">{row.projectName}</span></td>
                              <td className="whitespace-nowrap py-1.5 pr-3 text-right text-[11px] text-slate-400">{row.costCode || "-"}</td>
                              <td className="whitespace-nowrap py-1.5 pr-3 text-right text-[11px]">{formatNumber(Number(row.quantity || 0))}</td>
                              <td className="whitespace-nowrap py-1.5 pr-3 text-right text-[11px]">{formatBudgetRowActual(row)}</td>
                              <td className={`whitespace-nowrap py-1.5 pr-3 text-right text-[11px] font-semibold ${!mixedProductivityUnits && qv < 0 ? "text-red-600" : ""}`}>{formatBudgetRowVariance(row, qv)}</td>
                              <td className="whitespace-nowrap py-1.5 pr-3 text-right text-[11px]">{formatCurrency(getRunningCost(row))}</td>
                              <td className="whitespace-nowrap py-1.5 pr-4 text-right text-[11px]">{formatCurrency(Number(row.amount || 0))}</td>
                            </tr>
                            {productivityBreakdown.length > 0 && (
                              <tr className="border-b border-slate-100 bg-white text-slate-600">
                                <td colSpan={7} className="py-2 pr-4 pl-14">
                                  <table className="min-w-full text-[11px]">
                                    <thead>
                                      <tr className="border-b border-slate-100 text-left uppercase tracking-wider text-slate-400">
                                        <th className="py-1 pr-3 font-black">PO Line</th>
                                        <th className="py-1 pr-3 font-black">Contract</th>
                                        <th className="py-1 pr-3 text-right font-black">Logs</th>
                                        <th className="py-1 pr-3 text-right font-black">Contract Qty</th>
                                        <th className="py-1 pr-3 text-right font-black">Used</th>
                                        <th className="py-1 pr-3 text-right font-black">Variance</th>
                                        <th className="py-1 pr-3 text-right font-black">Delivered</th>
                                        <th className="py-1 text-right font-black">Last</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {productivityBreakdown.map((item, index) => {
                                        const lineVariance = getProductivityBreakdownVariance(item);
                                        const isLineOver = lineVariance != null && lineVariance < 0;
                                        return (
                                          <tr key={`${row.id}:productivity:${item.contractNumber || "contract"}:${item.lineItemPosition ?? index}`} className="border-b border-slate-50 last:border-0">
                                            <td className="py-1 pr-3 text-slate-700">{formatProductivityBreakdownLabel(item)}</td>
                                            <td className="py-1 pr-3 text-slate-500">
                                              <span className="font-bold text-slate-600">{item.contractNumber || "-"}</span>
                                              {item.contractTitle ? <span className="ml-1">{item.contractTitle}</span> : null}
                                            </td>
                                            <td className="whitespace-nowrap py-1 pr-3 text-right">{formatNumber(item.logCount)}</td>
                                            <td className="whitespace-nowrap py-1 pr-3 text-right">{formatQuantityWithUom(item.lineItemQuantity, item.lineItemUom)}</td>
                                            <td className="whitespace-nowrap py-1 pr-3 text-right font-semibold text-slate-800">{formatQuantityWithUom(item.quantityUsed, item.lineItemUom)}</td>
                                            <td className={`whitespace-nowrap py-1 pr-3 text-right font-semibold ${isLineOver ? "text-red-600" : "text-slate-700"}`}>
                                              {lineVariance == null ? "-" : formatQuantityWithUom(lineVariance, item.lineItemUom)}
                                            </td>
                                            <td className="whitespace-nowrap py-1 pr-3 text-right">{formatQuantityWithUom(item.quantityDelivered, item.lineItemUom)}</td>
                                            <td className="whitespace-nowrap py-1 text-right">{toDateKey(item.lastDate) || "-"}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
              {groupedRows.length > 0 && (() => {
                const gt = groupedRows.reduce((acc, g) => ({
                  budgetQty: acc.budgetQty + g.budgetQty,
                  actualUnits: acc.actualUnits + g.actualUnits,
                  timecardHours: acc.timecardHours + g.timecardHours,
                  productivityQty: acc.productivityQty + g.productivityQty,
                  qtyVariance: acc.qtyVariance + g.qtyVariance,
                  runningCost: acc.runningCost + g.runningCost,
                  budgetAmount: acc.budgetAmount + g.budgetAmount,
                  rowCount: acc.rowCount + g.rowCount,
                }), { budgetQty: 0, actualUnits: 0, timecardHours: 0, productivityQty: 0, qtyVariance: 0, runningCost: 0, budgetAmount: 0, rowCount: 0 });
                return (
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 bg-slate-50 text-slate-900">
                      <td className="py-2 pr-3 pl-4 text-[11px] font-black uppercase tracking-wider">Totals</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right font-black text-slate-500">{gt.rowCount}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right font-black">{formatNumber(gt.budgetQty)}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right font-black">
                        <div>{formatNumber(gt.productivityQty)} qty</div>
                        <div className="text-[10px] font-bold text-slate-500">{formatNumber(gt.timecardHours)} hrs</div>
                      </td>
                      <td className={`whitespace-nowrap py-2 pr-3 text-right font-black ${gt.qtyVariance < 0 ? "text-red-600" : ""}`}>{formatNumber(gt.qtyVariance)}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right font-black">{formatCurrency(gt.runningCost)}</td>
                      <td className="whitespace-nowrap py-2 pr-4 text-right font-black">{formatCurrency(gt.budgetAmount)}</td>
                    </tr>
                  </tfoot>
                );
              })()}
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
                  {row.lineItems.toLocaleString()} items | {formatFieldActivity(row.productivityQty, row.timecardHours)}
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
