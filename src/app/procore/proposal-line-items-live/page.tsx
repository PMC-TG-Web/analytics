"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";
import { getRolledUpCostCode } from "@/lib/costCodeRollup";

type PersistedLineItem = {
  id: string;
  companyId: string;
  bidBoardProjectId: string;
  procoreProjectId?: string | null;
  proposalId: string;
  lineItemId: string;
  projectName: string | null;
  customerName: string | null;
  projectStatus?: string | null;
  bidBoardStatus?: string | null;
  proposalName: string | null;
  name: string | null;
  status: string | null;
  costCode: string | null;
  rollupCostCode?: string | null;
  uom?: string | null;
  lineItemType?: string | null;
  totalCost?: number | null;
  totalSales?: number | null;
  actualTimecardHours?: number;
  actualProductivityQty?: number;
  payload: unknown;
  syncedAt: string;
};

type ApiResponse = {
  success?: boolean;
  error?: string;
  note?: string;
  data?: PersistedLineItem[];
  total?: number;
  count?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
};

type ProjectMasterRow = {
  canonicalProjectId: string;
  procoreProjectId: string | null;
  externalProjectId: string | null;
  bidBoardProjectId: string | null;
  companyId: string;
  projectName: string | null;
  customer: string;
  projectStatus: string | null;
  bidBoardStatus: string | null;
  v1SyncedAt: string | null;
  bidBoardSyncedAt: string | null;
  commitmentContractCount: number;
  purchaseOrderContractCount: number;
  commitmentTotalCount: number;
  commitmentTotalValue: number;
  commitmentVendors: string;
  commitmentStatuses: string;
  budgetTotalAmount: number;
  budgetLineItemCount: number;
  budgetUoms: string;
  changeOrderCount: number;
  totalChangeOrderValue: number;
  approvedChangeOrderValue: number;
  changeOrderStatuses: string;
  bidCount: number;
  bidStatuses: string;
  bidFormCount: number;
  bidPackageCount: number;
  bidFormStatuses: string;
  estimateProposalCount: number;
  estimateLineItemCount: number;
  estimateProposalIds: string;
  estimateProposalNames: string;
  estimateBidBoardProjectIds: string;
  latestEstimateAt: string | null;
};

type ProjectMasterApiResponse = {
  success?: boolean;
  error?: string;
  note?: string;
  data?: ProjectMasterRow[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
};

type BudgetLineRow = {
  id: string;
  companyId: string;
  projectId: string;
  budgetLineItemId: string;
  name: string | null;
  costCode: string | null;
  rollupCostCode?: string | null;
  costCodeDescription: string | null;
  lineItemType: string | null;
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
  data?: BudgetLineRow[];
  count?: number;
};

type ProposalGroup = {
  key: string;
  proposalId: string;
  proposalName: string | null;
  projectName: string | null;
  customerName: string | null;
  projectStatus: string | null | undefined;
  bidBoardStatus: string | null | undefined;
  uoms: string[];
  totalSales: number;
  rows: PersistedLineItem[];
};

function buildProposalGroups(inputRows: PersistedLineItem[]): ProposalGroup[] {
  const groups = new Map<string, ProposalGroup>();

  for (const row of inputRows) {
    const key = [row.proposalId, row.projectName || "", row.customerName || ""].join("::");
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
      if (row.uom && !existing.uoms.includes(row.uom)) {
        existing.uoms.push(row.uom);
        existing.uoms.sort((a, b) => a.localeCompare(b));
      }
      existing.totalSales += typeof row.totalSales === "number" ? row.totalSales : 0;
      continue;
    }

    groups.set(key, {
      key,
      proposalId: row.proposalId,
      proposalName: row.proposalName,
      projectName: row.projectName,
      customerName: row.customerName,
      projectStatus: row.projectStatus,
      bidBoardStatus: row.bidBoardStatus,
      uoms: row.uom ? [row.uom] : [],
      totalSales: typeof row.totalSales === "number" ? row.totalSales : 0,
      rows: [row],
    });
  }

  return Array.from(groups.values());
}

export default function ProposalLineItemsLivePage() {
  const [viewMode, setViewMode] = useState<"projects" | "lineItems">("projects");
  const [rows, setRows] = useState<PersistedLineItem[]>([]);
  const [projectRows, setProjectRows] = useState<ProjectMasterRow[]>([]);
  const [collapsedProposalKeys, setCollapsedProposalKeys] = useState<Record<string, boolean>>({});
  const [expandedProjectKeys, setExpandedProjectKeys] = useState<Record<string, boolean>>({});
  const [projectLineItemsByProject, setProjectLineItemsByProject] = useState<Record<string, PersistedLineItem[]>>({});
  const [projectBudgetLinesByProject, setProjectBudgetLinesByProject] = useState<Record<string, BudgetLineRow[]>>({});
  const [loadingProjectLineItems, setLoadingProjectLineItems] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [companyId, setCompanyId] = useState<string>(process.env.NEXT_PUBLIC_PROCORE_COMPANY_ID || "");
  const [bidBoardProjectId, setBidBoardProjectId] = useState<string>("");
  const [proposalId, setProposalId] = useState<string>("");
  const [projectStatus, setProjectStatus] = useState<string>("");
  const [bidBoardStatus, setBidBoardStatus] = useState<string>("");
  const [proposalName, setProposalName] = useState<string>("");
  const [uom, setUom] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const pageSize = 500;
  const maxPagesToFetch = 100;
  const [total, setTotal] = useState<number>(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>("");

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    setNote("");

    try {
      const combinedRows: PersistedLineItem[] = [];
      let currentPage = 1;
      let totalFromApi = 0;
      let latestNote = "";

      while (currentPage <= maxPagesToFetch) {
        const url = new URL("/api/procore/estimating/proposal-line-items-live", window.location.origin);
        url.searchParams.set("page", String(currentPage));
        url.searchParams.set("pageSize", String(pageSize));
        if (companyId.trim()) url.searchParams.set("companyId", companyId.trim());
        if (bidBoardProjectId.trim()) url.searchParams.set("bidBoardProjectId", bidBoardProjectId.trim());
        if (proposalId.trim()) url.searchParams.set("proposalId", proposalId.trim());
        if (projectStatus.trim()) url.searchParams.set("projectStatus", projectStatus.trim());
        if (bidBoardStatus.trim()) url.searchParams.set("bidBoardStatus", bidBoardStatus.trim());
        if (proposalName.trim()) url.searchParams.set("proposalName", proposalName.trim());
        if (uom.trim()) url.searchParams.set("uom", uom.trim());
        if (search.trim()) url.searchParams.set("search", search.trim());
        url.searchParams.set("_ts", String(Date.now()));

        const res = await fetch(url.toString(), { cache: "no-store" });
        const payload = (await res.json().catch(() => ({}))) as ApiResponse;

        if (!res.ok || payload.success === false) {
          throw new Error(payload.error || `Request failed with ${res.status}`);
        }

        const pageRows = Array.isArray(payload.data) ? payload.data : [];
        combinedRows.push(...pageRows);
        totalFromApi = Number(payload.total || 0);
        latestNote = payload.note || latestNote;

        if (!payload.hasNextPage || pageRows.length === 0) break;
        if (totalFromApi > 0 && combinedRows.length >= totalFromApi) break;
        currentPage += 1;
      }

      setRows(combinedRows);
      setProjectRows([]);
      setTotal(totalFromApi || combinedRows.length);
      setNote(latestNote);
      setLastRefreshedAt(new Date().toLocaleString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRows([]);
      setProjectRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [companyId, bidBoardProjectId, proposalId, projectStatus, bidBoardStatus, proposalName, uom, search]);

  const loadProjectRows = useCallback(async () => {
    setLoading(true);
    setError("");
    setNote("");

    try {
      const url = new URL("/api/procore/projects-master", window.location.origin);
      url.searchParams.set("page", "1");
      url.searchParams.set("pageSize", String(pageSize));
      if (companyId.trim()) url.searchParams.set("companyId", companyId.trim());
      if (projectStatus.trim()) url.searchParams.set("projectStatus", projectStatus.trim());
      if (bidBoardStatus.trim()) url.searchParams.set("bidBoardStatus", bidBoardStatus.trim());
      if (search.trim()) url.searchParams.set("search", search.trim());
      url.searchParams.set("withMetricsOnly", "true");
      url.searchParams.set("_ts", String(Date.now()));

      const res = await fetch(url.toString(), { cache: "no-store" });
      const payload = (await res.json().catch(() => ({}))) as ProjectMasterApiResponse;

      if (!res.ok || payload.success === false) {
        throw new Error(payload.error || `Request failed with ${res.status}`);
      }

      setProjectRows(Array.isArray(payload.data) ? payload.data : []);
      setRows([]);
      setTotal(Number(payload.total || 0));
      setNote(payload.note || "");
      setLastRefreshedAt(new Date().toLocaleString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProjectRows([]);
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [companyId, projectStatus, bidBoardStatus, search]);

  useEffect(() => {
    if (viewMode === "projects") {
      void loadProjectRows();
      return;
    }

    void loadRows();
  }, [viewMode, loadProjectRows, loadRows]);

  const titleStats = useMemo(() => {
    const currentCount = viewMode === "projects" ? projectRows.length : rows.length;
    return `${currentCount} rows on page, ${total} total`;
  }, [viewMode, projectRows.length, rows.length, total]);

  const proposalGroups = useMemo(() => {
    return buildProposalGroups(rows);
  }, [rows]);

  const primaryOrActiveFields = useMemo(() => {
    const found = new Set<string>();

    function walk(value: unknown) {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
        return;
      }

      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        const lower = key.toLowerCase();
        if (lower.includes("active") || lower.includes("primary")) {
          found.add(key);
        }
        walk(nested);
      }
    }

    for (const row of rows.slice(0, 50)) {
      walk(row.payload);
    }

    return Array.from(found).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  function toggleProposalGroup(key: string) {
    setCollapsedProposalKeys((prev) => ({
      ...prev,
      [key]: !(prev[key] ?? true),
    }));
  }

  async function toggleProjectExpansion(project: ProjectMasterRow) {
    const projectKey = project.canonicalProjectId;
    const nextExpanded = !expandedProjectKeys[projectKey];

    setExpandedProjectKeys((prev) => ({
      ...prev,
      [projectKey]: nextExpanded,
    }));

    if (!nextExpanded || projectLineItemsByProject[projectKey] || loadingProjectLineItems[projectKey]) {
      return;
    }

    setLoadingProjectLineItems((prev) => ({
      ...prev,
      [projectKey]: true,
    }));

    try {
      const [lineItemPayload, budgetPayload] = await Promise.all([
        (async () => {
          if (!project.bidBoardProjectId) {
            return [] as PersistedLineItem[];
          }

          const combinedRows: PersistedLineItem[] = [];
          let currentPage = 1;

          while (currentPage <= maxPagesToFetch) {
            const url = new URL("/api/procore/estimating/proposal-line-items-live", window.location.origin);
            url.searchParams.set("page", String(currentPage));
            url.searchParams.set("pageSize", String(pageSize));
            url.searchParams.set("companyId", companyId.trim());
            url.searchParams.set("bidBoardProjectId", project.bidBoardProjectId);
            url.searchParams.set("_ts", String(Date.now()));

            const res = await fetch(url.toString(), { cache: "no-store" });
            const payload = (await res.json().catch(() => ({}))) as ApiResponse;

            if (!res.ok || payload.success === false) {
              throw new Error(payload.error || `Request failed with ${res.status}`);
            }

            const pageRows = Array.isArray(payload.data) ? payload.data : [];
            combinedRows.push(...pageRows);

            if (!payload.hasNextPage || pageRows.length === 0) break;
            if (payload.total && combinedRows.length >= payload.total) break;
            currentPage += 1;
          }

          return combinedRows;
        })(),
        (async () => {
          if (!project.procoreProjectId) {
            return [] as BudgetLineRow[];
          }

          const url = new URL("/api/procore/budget-line-items-live", window.location.origin);
          url.searchParams.set("companyId", companyId.trim());
          url.searchParams.set("projectId", project.procoreProjectId);
          url.searchParams.set("pageSize", String(pageSize));
          url.searchParams.set("_ts", String(Date.now()));

          const res = await fetch(url.toString(), { cache: "no-store" });
          const payload = (await res.json().catch(() => ({}))) as BudgetLineApiResponse;

          if (!res.ok || payload.success === false) {
            throw new Error(payload.error || `Request failed with ${res.status}`);
          }

          return Array.isArray(payload.data) ? payload.data : [];
        })(),
      ]);

      setProjectLineItemsByProject((prev) => ({
        ...prev,
        [projectKey]: lineItemPayload,
      }));
      setProjectBudgetLinesByProject((prev) => ({
        ...prev,
        [projectKey]: budgetPayload,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProjectLineItemsByProject((prev) => ({
        ...prev,
        [projectKey]: [],
      }));
      setProjectBudgetLinesByProject((prev) => ({
        ...prev,
        [projectKey]: [],
      }));
    } finally {
      setLoadingProjectLineItems((prev) => ({
        ...prev,
        [projectKey]: false,
      }));
    }
  }

  function renderBudgetFallback(project: ProjectMasterRow) {
    const budgetRows = projectBudgetLinesByProject[project.canonicalProjectId] || [];

    if (budgetRows.length === 0) {
      return (
        <p className="text-xs font-semibold text-gray-500">
          No synced line items found for this bid board project.
        </p>
      );
    }

    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-600">
          Showing budget rows because this project has budget data but no synced estimating line items.
        </p>
        <div className="overflow-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left uppercase tracking-wider text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-3 pl-3">Budget Item</th>
                <th className="py-2 pr-3">Cost Code</th>
                <th className="py-2 pr-3">Rollup Cost Code</th>
                <th className="py-2 pr-3">Description</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">UOM</th>
                <th className="py-2 pr-3 text-right">Qty</th>
                <th className="py-2 pr-3 text-right">Actual Units</th>
                <th className="py-2 pr-3 text-right">Unit Cost</th>
                <th className="py-2 pr-3 text-right">Original Budget</th>
                <th className="py-2 pr-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {budgetRows.map((budgetRow) => (
                <tr key={budgetRow.id} className="border-b border-gray-100 text-gray-800 align-top">
                  <td className="py-2 pr-3 pl-3 whitespace-nowrap">{budgetRow.budgetLineItemId}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{budgetRow.costCode || "-"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{budgetRow.rollupCostCode || getRolledUpCostCode(budgetRow.costCode) || "-"}</td>
                  <td className="py-2 pr-3">{budgetRow.name || budgetRow.costCodeDescription || "-"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{budgetRow.lineItemType || "-"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{budgetRow.uom || "-"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-right">{formatNumber(budgetRow.quantity)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-right">{formatActualUnits(budgetRow.uom, budgetRow.actualTimecardHours, budgetRow.actualProductivityQty)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-right">{formatCurrencyMaybe(budgetRow.unitCost)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-right">{formatCurrencyMaybe(budgetRow.originalBudgetAmount)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-right">{formatCurrencyMaybe(budgetRow.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Navigation />

      <div className="w-full px-3 py-8 space-y-5 xl:px-4 2xl:px-6">
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-black uppercase tracking-widest text-gray-800">
                {viewMode === "projects" ? "Procore Projects Master" : "Persisted Proposal Line Items"}
              </h1>
              <p className="text-xs font-semibold text-gray-500 mt-1">{titleStats}</p>
              {viewMode === "lineItems" && primaryOrActiveFields.length > 0 && (
                <p className="text-[11px] font-semibold text-gray-500 mt-1">
                  Detected `active`/`primary`-style fields in payload: {primaryOrActiveFields.join(", ")}
                </p>
              )}
              {viewMode === "lineItems" && primaryOrActiveFields.length === 0 && (
                <p className="text-[11px] font-semibold text-gray-500 mt-1">
                  No `active` or `primary` fields found in the current persisted line-item payload sample.
                </p>
              )}
              {viewMode === "projects" && (
                <p className="text-[11px] font-semibold text-gray-500 mt-1">
                  `59...` is the canonical Procore project ID. `56...` is the estimating bid board project ID.
                </p>
              )}
              {!!lastRefreshedAt && (
                <p className="text-[11px] font-semibold text-gray-500 mt-1">Last refreshed: {lastRefreshedAt}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => {
                  setViewMode("projects");
                }}
                className={`px-4 py-2 rounded-lg font-black text-xs uppercase tracking-wider ${
                  viewMode === "projects"
                    ? "bg-slate-800 text-white"
                    : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                Projects
              </button>
              <button
                onClick={() => {
                  setViewMode("lineItems");
                }}
                className={`px-4 py-2 rounded-lg font-black text-xs uppercase tracking-wider ${
                  viewMode === "lineItems"
                    ? "bg-slate-800 text-white"
                    : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                Line Items
              </button>
              <button
                onClick={() => void (viewMode === "projects" ? loadProjectRows() : loadRows())}
                className="px-4 py-2 rounded-lg bg-indigo-700 text-white font-black text-xs uppercase tracking-wider hover:bg-indigo-800"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-8 gap-3 mt-4">
            <input
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              placeholder="Company ID"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            />
            <input
              value={bidBoardProjectId}
              onChange={(e) => setBidBoardProjectId(e.target.value)}
              placeholder="Bid Board Project ID"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            />
            <input
              value={proposalId}
              onChange={(e) => setProposalId(e.target.value)}
              placeholder="Proposal ID"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            />
            <input
              value={projectStatus}
              onChange={(e) => setProjectStatus(e.target.value)}
              placeholder="Project status"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            />
            <input
              value={bidBoardStatus}
              onChange={(e) => setBidBoardStatus(e.target.value)}
              placeholder="Bid board status"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            />
            <input
              value={proposalName}
              onChange={(e) => setProposalName(e.target.value)}
              placeholder="Proposal name"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
              disabled={viewMode === "projects"}
            />
            <input
              value={uom}
              onChange={(e) => setUom(e.target.value)}
              placeholder="UOM"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
              disabled={viewMode === "projects"}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search line item"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            />
            <button
              onClick={() => {
                setBidBoardProjectId("");
                setProposalId("");
                setProjectStatus("");
                setBidBoardStatus("");
                setProposalName("");
                setUom("");
                setSearch("");
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-black uppercase tracking-wider hover:bg-gray-50"
            >
              Clear Filters
            </button>
          </div>

          {!!note && <p className="text-xs font-semibold text-amber-700 mt-3">{note}</p>}
          {!!error && <p className="text-xs font-semibold text-red-700 mt-3">{error}</p>}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4 overflow-auto">
          {viewMode === "projects" ? (
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left uppercase tracking-wider text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-3">Action</th>
                  <th className="py-2 pr-3">Project Status</th>
                  <th className="py-2 pr-3">Bid Board Status</th>
                  <th className="py-2 pr-3">Project Name</th>
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">Procore Project</th>
                  <th className="py-2 pr-3">Bid Board Project</th>
                  <th className="py-2 pr-3 text-right">Commitments</th>
                  <th className="py-2 pr-3 text-right">Commitment Value</th>
                  <th className="py-2 pr-3 text-right">Budget</th>
                  <th className="py-2 pr-3">Budget UOMs</th>
                  <th className="py-2 pr-3 text-right">Approved CO</th>
                  <th className="py-2 pr-3 text-right">Bids</th>
                  <th className="py-2 pr-3 text-right">Bid Forms</th>
                  <th className="py-2 pr-3 text-right">Est Proposals</th>
                  <th className="py-2 pr-3 text-right">Est Items</th>
                  <th className="py-2 pr-3">Proposal IDs</th>
                </tr>
              </thead>
              <tbody>
                {!loading && projectRows.length === 0 && (
                  <tr>
                    <td className="py-4 text-gray-500" colSpan={15}>
                      No rows found.
                    </td>
                  </tr>
                )}
                {projectRows.map((row) => (
                  <Fragment key={row.canonicalProjectId}>
                    <tr className="border-b border-gray-100 text-gray-800 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void toggleProjectExpansion(row)}
                          className="rounded border border-slate-300 bg-white px-2 py-1 font-black uppercase tracking-wider hover:bg-slate-50"
                        >
                          {expandedProjectKeys[row.canonicalProjectId] ? "Collapse" : "Expand"}
                        </button>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{row.projectStatus || "-"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{row.bidBoardStatus || "-"}</td>
                      <td className="py-2 pr-3 font-semibold">{row.projectName || "-"}</td>
                      <td className="py-2 pr-3">{row.customer || "-"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{row.procoreProjectId || "-"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{row.bidBoardProjectId || "-"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-right">{row.commitmentTotalCount.toLocaleString()}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-right">{formatCurrency(row.commitmentTotalValue || 0)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-right">{formatCurrency(row.budgetTotalAmount || 0)}</td>
                      <td className="py-2 pr-3">{row.budgetUoms || "-"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-right">{formatCurrency(row.approvedChangeOrderValue || 0)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-right">{row.bidCount.toLocaleString()}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-right">{row.bidFormCount.toLocaleString()}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-right">{row.estimateProposalCount.toLocaleString()}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-right">{row.estimateLineItemCount.toLocaleString()}</td>
                      <td className="py-2 pr-3">{row.estimateProposalIds || "-"}</td>
                    </tr>
                    {expandedProjectKeys[row.canonicalProjectId] && (
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <td colSpan={17} className="p-3">
                          <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Commitments</p>
                              <p className="text-sm font-semibold text-slate-800">{row.commitmentTotalCount.toLocaleString()}</p>
                              <p className="text-[11px] text-slate-500">
                                Contracts {row.commitmentContractCount.toLocaleString()} | POs {row.purchaseOrderContractCount.toLocaleString()}
                              </p>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Commitment Value</p>
                              <p className="text-sm font-semibold text-slate-800">{formatCurrency(row.commitmentTotalValue || 0)}</p>
                              <p className="text-[11px] text-slate-500">{row.commitmentStatuses || "No statuses"}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Vendors</p>
                              <p className="text-sm font-semibold text-slate-800">{row.commitmentVendors || "No vendors"}</p>
                            </div>
                          </div>
                          {loadingProjectLineItems[row.canonicalProjectId] && (
                            <p className="text-xs font-semibold text-gray-500">Loading line items...</p>
                          )}
                          {!loadingProjectLineItems[row.canonicalProjectId] &&
                            (projectLineItemsByProject[row.canonicalProjectId] || []).length === 0 && (
                              renderBudgetFallback(row)
                            )}
                          {!loadingProjectLineItems[row.canonicalProjectId] &&
                            buildProposalGroups(projectLineItemsByProject[row.canonicalProjectId] || []).length > 0 && (
                              <div className="space-y-3">
                                {buildProposalGroups(projectLineItemsByProject[row.canonicalProjectId] || []).map((group) => {
                                  const nestedKey = `${row.canonicalProjectId}::${group.key}`;
                                  const collapsed = collapsedProposalKeys[nestedKey] ?? true;

                                  return (
                                    <div key={nestedKey} className="overflow-auto rounded-lg border border-slate-200 bg-white">
                                      <table className="min-w-full text-xs">
                                        <tbody>
                                          <tr className="bg-slate-100 text-slate-900 align-top">
                                            <td className="py-2 pr-3 pl-3 whitespace-nowrap">
                                              <button
                                                type="button"
                                                onClick={() => toggleProposalGroup(nestedKey)}
                                                className="rounded border border-slate-300 bg-white px-2 py-1 font-black uppercase tracking-wider hover:bg-slate-50"
                                              >
                                                {collapsed ? "Expand" : "Collapse"}
                                              </button>
                                            </td>
                                            <td className="py-2 pr-3 whitespace-nowrap font-semibold">{group.projectStatus || row.projectStatus || "-"}</td>
                                            <td className="py-2 pr-3 whitespace-nowrap font-semibold">{group.bidBoardStatus || row.bidBoardStatus || "-"}</td>
                                            <td className="py-2 pr-3 whitespace-nowrap">{group.rows[0] ? new Date(group.rows[0].syncedAt).toLocaleString() : "-"}</td>
                                            <td className="py-2 pr-3 whitespace-nowrap">{group.rows[0]?.bidBoardProjectId || row.bidBoardProjectId || "-"}</td>
                                            <td className="py-2 pr-3 whitespace-nowrap">{group.rows[0]?.procoreProjectId || row.procoreProjectId || "-"}</td>
                                            <td className="py-2 pr-3 font-semibold">{group.projectName || row.projectName || "-"}</td>
                                            <td className="py-2 pr-3">{group.customerName || row.customer || "-"}</td>
                                            <td className="py-2 pr-3 whitespace-nowrap font-semibold">{group.proposalId}</td>
                                            <td className="py-2 pr-3">{group.proposalName || "-"}</td>
                                            <td className="py-2 pr-3 whitespace-nowrap">{group.uoms.join(", ") || "-"}</td>
                                            <td className="py-2 pr-3 whitespace-nowrap font-semibold">{group.rows.length.toLocaleString()} items</td>
                                            <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                                            <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                                            <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                                            <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                                            <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                                            <td className="py-2 pr-3 whitespace-nowrap text-right font-semibold">{formatCurrency(group.totalSales)}</td>
                                          </tr>
                                          {!collapsed &&
                                            group.rows.map((itemRow) => (
                                              <tr
                                                key={`${nestedKey}:${itemRow.id}`}
                                                className="border-t border-gray-100 text-gray-800 align-top"
                                              >
                                                <td className="py-2 pr-3 pl-10 whitespace-nowrap text-gray-400">.</td>
                                                <td className="py-2 pr-3 whitespace-nowrap">{itemRow.projectStatus || row.projectStatus || "-"}</td>
                                                <td className="py-2 pr-3 whitespace-nowrap">{itemRow.bidBoardStatus || row.bidBoardStatus || "-"}</td>
                                                <td className="py-2 pr-3 whitespace-nowrap">{new Date(itemRow.syncedAt).toLocaleString()}</td>
                                                <td className="py-2 pr-3 whitespace-nowrap">{itemRow.bidBoardProjectId}</td>
                                                <td className="py-2 pr-3 whitespace-nowrap">{itemRow.procoreProjectId || row.procoreProjectId || "-"}</td>
                                                <td className="py-2 pr-3">{itemRow.projectName || row.projectName || "-"}</td>
                                                <td className="py-2 pr-3">{itemRow.customerName || row.customer || "-"}</td>
                                                <td className="py-2 pr-3 whitespace-nowrap">{itemRow.proposalId}</td>
                                                <td className="py-2 pr-3">{itemRow.proposalName || "-"}</td>
                                                <td className="py-2 pr-3 whitespace-nowrap">{itemRow.uom || "-"}</td>
                                                <td className="py-2 pr-3 whitespace-nowrap">{itemRow.lineItemType || "-"}</td>
                                                <td className="py-2 pr-3 whitespace-nowrap">{itemRow.lineItemId}</td>
                                                <td className="py-2 pr-3">{itemRow.name || "-"}</td>
                                                <td className="py-2 pr-3 whitespace-nowrap">{itemRow.status || "-"}</td>
                                                <td className="py-2 pr-3 whitespace-nowrap">{itemRow.costCode || "-"}</td>
                                                <td className="py-2 pr-3 whitespace-nowrap">{itemRow.rollupCostCode || getRolledUpCostCode(itemRow.costCode) || "-"}</td>
                                                <td className="py-2 pr-3 whitespace-nowrap text-right">{formatActualUnits(itemRow.uom, itemRow.actualTimecardHours, itemRow.actualProductivityQty)}</td>
                                                <td className="py-2 pr-3 whitespace-nowrap text-right">
                                                  {typeof itemRow.totalSales === "number" ? formatCurrency(itemRow.totalSales) : "-"}
                                                </td>
                                              </tr>
                                            ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left uppercase tracking-wider text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-3">Toggle</th>
                  <th className="py-2 pr-3">Project Status</th>
                  <th className="py-2 pr-3">Bid Board Status</th>
                  <th className="py-2 pr-3">Synced</th>
                  <th className="py-2 pr-3">Bid Board Project</th>
                  <th className="py-2 pr-3">Procore Project</th>
                  <th className="py-2 pr-3">Project Name</th>
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">Proposal</th>
                  <th className="py-2 pr-3">Proposal Name</th>
                  <th className="py-2 pr-3">UOM</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Line Item ID</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Cost Code</th>
                  <th className="py-2 pr-3">Rollup Cost Code</th>
                  <th className="py-2 pr-3 text-right">Actual Units</th>
                  <th className="py-2 pr-3 text-right">Sales</th>
                </tr>
              </thead>
              <tbody>
                {!loading && proposalGroups.length === 0 && (
                  <tr>
                    <td className="py-4 text-gray-500" colSpan={19}>
                      No rows found.
                    </td>
                  </tr>
                )}

                {proposalGroups.map((group) => {
                  const collapsed = collapsedProposalKeys[group.key] ?? true;

                  return (
                    <Fragment key={group.key}>
                      <tr className="border-b border-slate-300 bg-slate-100 text-slate-900 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => toggleProposalGroup(group.key)}
                            className="rounded border border-slate-300 bg-white px-2 py-1 font-black uppercase tracking-wider hover:bg-slate-50"
                          >
                            {collapsed ? "Expand" : "Collapse"}
                          </button>
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap font-semibold">{group.projectStatus || "-"}</td>
                        <td className="py-2 pr-3 whitespace-nowrap font-semibold">{group.bidBoardStatus || "-"}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{group.rows[0] ? new Date(group.rows[0].syncedAt).toLocaleString() : "-"}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{group.rows[0]?.bidBoardProjectId || "-"}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{group.rows[0]?.procoreProjectId || "-"}</td>
                        <td className="py-2 pr-3 font-semibold">{group.projectName || "-"}</td>
                        <td className="py-2 pr-3">{group.customerName || "-"}</td>
                        <td className="py-2 pr-3 whitespace-nowrap font-semibold">{group.proposalId}</td>
                        <td className="py-2 pr-3">{group.proposalName || "-"}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{group.uoms.join(", ") || "-"}</td>
                        <td className="py-2 pr-3 whitespace-nowrap font-semibold">{group.rows.length.toLocaleString()} items</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-right font-semibold">{formatCurrency(group.totalSales)}</td>
                      </tr>
                      {!collapsed && (
                        <tr className="border-b border-gray-200 bg-white">
                          <td colSpan={19} className="p-0">
                            <div className="overflow-auto">
                              <table className="min-w-full text-xs">
                                <tbody>
                                  {group.rows.map((row) => (
                                    <tr key={`${group.key}:${row.id}`} className="border-b border-gray-100 text-gray-800 align-top">
                                      <td className="py-2 pr-3 pl-10 whitespace-nowrap text-gray-400">.</td>
                                      <td className="py-2 pr-3 whitespace-nowrap">{row.projectStatus || "-"}</td>
                                      <td className="py-2 pr-3 whitespace-nowrap">{row.bidBoardStatus || "-"}</td>
                                      <td className="py-2 pr-3 whitespace-nowrap">{new Date(row.syncedAt).toLocaleString()}</td>
                                      <td className="py-2 pr-3 whitespace-nowrap">{row.bidBoardProjectId}</td>
                                      <td className="py-2 pr-3 whitespace-nowrap">{row.procoreProjectId || "-"}</td>
                                      <td className="py-2 pr-3">{row.projectName || "-"}</td>
                                      <td className="py-2 pr-3">{row.customerName || "-"}</td>
                                      <td className="py-2 pr-3 whitespace-nowrap">{row.proposalId}</td>
                                      <td className="py-2 pr-3">{row.proposalName || "-"}</td>
                                      <td className="py-2 pr-3 whitespace-nowrap">{row.uom || "-"}</td>
                                      <td className="py-2 pr-3 whitespace-nowrap">{row.lineItemType || "-"}</td>
                                      <td className="py-2 pr-3 whitespace-nowrap">{row.lineItemId}</td>
                                      <td className="py-2 pr-3">{row.name || "-"}</td>
                                      <td className="py-2 pr-3 whitespace-nowrap">{row.status || "-"}</td>
                                      <td className="py-2 pr-3 whitespace-nowrap">{row.costCode || "-"}</td>
                                      <td className="py-2 pr-3 whitespace-nowrap">{row.rollupCostCode || getRolledUpCostCode(row.costCode) || "-"}</td>
                                      <td className="py-2 pr-3 whitespace-nowrap text-right">{formatActualUnits(row.uom, row.actualTimecardHours, row.actualProductivityQty)}</td>
                                      <td className="py-2 pr-3 whitespace-nowrap text-right">
                                        {typeof row.totalSales === "number" ? formatCurrency(row.totalSales) : "-"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

      </div>
    </div>
  );
}

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatCurrencyMaybe(value: number | null | undefined) {
  return typeof value === "number" ? formatCurrency(value) : "-";
}

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" ? value.toLocaleString() : "-";
}

function formatActualUnits(
  uom: string | null | undefined,
  timecardHours: number | null | undefined,
  productivityQty: number | null | undefined
) {
  const normalizedUom = String(uom || "").trim().toLowerCase();
  const isHourUom = /\b(hours?|hrs?|h)\b/.test(normalizedUom);

  if (isHourUom) {
    const tc = typeof timecardHours === "number" ? timecardHours.toFixed(1) : "0.0";
    return tc;
  }

  return typeof productivityQty === "number" ? productivityQty.toFixed(1) : "0.0";
}
