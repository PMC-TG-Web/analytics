"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ProjectRow = {
  id: string;
  projectName?: string | null;
  projectNumber?: string | null;
  customer?: string | null;
  status?: string | null;
  statusRaw?: string | null;
  projectStageName?: string | null;
  projectStageCategory?: string | null;
  bidBoardStatus?: string | null;
  bidBoardId?: string | null;
  procoreId?: string | null;
  syncedAt?: string | null;
  budgetUoms?: string;
  budgetAmount?: number;
  budgetLineItemCount?: number;
  budgetSyncedAt?: string | null;
  changeOrderCount?: number;
  changeOrderValue?: number;
  approvedChangeOrderValue?: number;
  changeOrderStatuses?: string;
  changeOrderSyncedAt?: string | null;
  bidCount?: number;
  bidFormCount?: number;
  bidPackageCount?: number;
  bidStatuses?: string;
  estimateProposalCount?: number;
  estimateLineItemCount?: number;
  estimateProposalIds?: string;
  estimateProposalNames?: string;
};

type BidBoardRow = {
  id: string;
  bidBoardId?: string | null;
  projectName?: string | null;
  customer?: string | null;
  status?: string | null;
  statusRaw?: string | null;
  procoreId?: string | null;
  syncedAt?: string | null;
};

type ProjectBudgetRow = {
  projectId: string;
  projectName?: string | null;
  customer?: string | null;
  bidBoardStatus?: string | null;
  totalAmount?: number | null;
  lineItemCount?: number | null;
  uoms?: string | null;
  syncedAt?: string | null;
};

type ProjectChangeOrderRow = {
  projectId: string;
  projectName?: string | null;
  customer?: string | null;
  bidBoardStatus?: string | null;
  changeOrderCount?: number | null;
  totalChangeOrderValue?: number | null;
  approvedChangeOrderValue?: number | null;
  changeOrderStatuses?: string | null;
  latestChangeOrderAt?: string | null;
};

type SortKey =
  | "projectName"
  | "projectNumber"
  | "customer"
  | "status"
  | "projectStageName"
  | "bidBoardStatus"
  | "budgetUoms"
  | "budgetAmount"
  | "budgetLineItemCount"
  | "changeOrderCount"
  | "changeOrderValue"
  | "approvedChangeOrderValue"
  | "changeOrderStatuses"
  | "bidCount"
  | "bidFormCount"
  | "estimateProposalCount"
  | "estimateLineItemCount"
  | "estimateProposalIds";

type ApiResponse = {
  success?: boolean;
  data?: ProjectRow[];
};

type BudgetApiResponse = {
  success?: boolean;
  data?: ProjectBudgetRow[];
};

type ChangeOrderApiResponse = {
  success?: boolean;
  data?: ProjectChangeOrderRow[];
  source?: string;
};

type ProjectEstimateBidRow = {
  projectId: string;
  procoreProjectId?: string | null;
  bidBoardId?: string | null;
  bidCount?: number | null;
  bidStatuses?: string | null;
  bidFormCount?: number | null;
  bidPackageCount?: number | null;
  estimateProposalCount?: number | null;
  estimateLineItemCount?: number | null;
  estimateProposalNames?: string | null;
};

type EstimateBidApiResponse = {
  success?: boolean;
  data?: ProjectEstimateBidRow[];
};

type ProposalBulkProjectRecord = {
  id?: string | number | null;
  bid_board_project_id?: string | number | null;
  project_id?: string | number | null;
  procore_project_id?: string | number | null;
};

type ProposalBulkEntry = {
  bidBoardProjectId?: string | null;
  procoreProjectId?: string | null;
  projectName?: string | null;
  customerName?: string | null;
  proposal?: {
    id?: string | number | null;
    proposal_id?: string | number | null;
    name?: string | null;
    title?: string | null;
    proposal_number?: string | number | null;
    status?: string | null;
  } | null;
};

type ProposalsBulkApiResponse = {
  success?: boolean;
  bidBoardProjects?: ProposalBulkProjectRecord[];
  proposals?: ProposalBulkEntry[];
};

type BidBoardApiResponse = {
  success?: boolean;
  data?: BidBoardRow[];
  projects?: Array<{
    id?: string | number | null;
    project_id?: string | number | null;
    name?: string | null;
    customer_name?: string | null;
    status?: string | null;
    updated_at?: string | null;
  }>;
};

const DEFAULT_PROCORE_COMPANY_ID = process.env.NEXT_PUBLIC_PROCORE_COMPANY_ID || "";

export default function ProjectsPage() {
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingCommercial, setSyncingCommercial] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("projectName");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [changeOrderSource, setChangeOrderSource] = useState<string>("");
  const syncInFlightRef = useRef(false);
  const lastAutoFullSyncAtRef = useRef(0);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const projectsUrl = new URL("/api/projects-v1-live", window.location.origin);
      const budgetUrl = new URL("/api/scheduling/projects-with-budget", window.location.origin);
      const changeOrdersUrl = new URL("/api/scheduling/projects-with-change-orders", window.location.origin);
      const estimatesBidsUrl = new URL("/api/scheduling/projects-with-estimates-bids", window.location.origin);
      projectsUrl.searchParams.set("page", "1");
      projectsUrl.searchParams.set("pageSize", "500");
      projectsUrl.searchParams.set("_ts", String(Date.now()));
      budgetUrl.searchParams.set("bidBoardStatus", "All");
      budgetUrl.searchParams.set("companyId", DEFAULT_PROCORE_COMPANY_ID);
      budgetUrl.searchParams.set("_ts", String(Date.now()));
      changeOrdersUrl.searchParams.set("bidBoardStatus", "All");
      changeOrdersUrl.searchParams.set("companyId", DEFAULT_PROCORE_COMPANY_ID);
      changeOrdersUrl.searchParams.set("_ts", String(Date.now()));
      estimatesBidsUrl.searchParams.set("bidBoardStatus", "All");
      estimatesBidsUrl.searchParams.set("companyId", DEFAULT_PROCORE_COMPANY_ID);
      estimatesBidsUrl.searchParams.set("_ts", String(Date.now()));

      const bidBoardUrl = new URL("/api/bid-board-live", window.location.origin);
      bidBoardUrl.searchParams.set("page", "1");
      bidBoardUrl.searchParams.set("pageSize", "2000");
      bidBoardUrl.searchParams.set("_ts", String(Date.now()));

      const [projectsResponse, bidBoardResponse, budgetResponse, changeOrdersResponse, estimatesBidsResponse] = await Promise.all([
        fetch(projectsUrl.toString(), { cache: "no-store" }),
        fetch(bidBoardUrl.toString(), { cache: "no-store" }),
        fetch(budgetUrl.toString(), { cache: "no-store" }),
        fetch(changeOrdersUrl.toString(), { cache: "no-store" }),
        fetch(estimatesBidsUrl.toString(), { cache: "no-store" }),
      ]);

      if (!projectsResponse.ok) {
        throw new Error(`Projects request failed with ${projectsResponse.status}`);
      }
      const payload = (await projectsResponse.json()) as ApiResponse;
      let bidPayload = (await bidBoardResponse.json()) as BidBoardApiResponse;
      const budgetPayload = budgetResponse.ok
        ? ((await budgetResponse.json()) as BudgetApiResponse)
        : { data: [] };
      const changeOrdersPayload = changeOrdersResponse.ok
        ? ((await changeOrdersResponse.json()) as ChangeOrderApiResponse)
        : { data: [] };
      const estimatesBidsPayload = estimatesBidsResponse.ok
        ? ((await estimatesBidsResponse.json()) as EstimateBidApiResponse)
        : { data: [] };
      const proposalsBulkPayload: ProposalsBulkApiResponse = { bidBoardProjects: [], proposals: [] };

      if (!bidBoardResponse.ok) {
        bidPayload = { data: [] };
      }

      const budgetByProjectId = new Map<string, ProjectBudgetRow>();
      for (const item of Array.isArray(budgetPayload.data) ? budgetPayload.data : []) {
        const projectId = (item.projectId || "").toString().trim();
        if (projectId) {
          budgetByProjectId.set(projectId, item);
        }
      }

      const changeOrdersByProjectId = new Map<string, ProjectChangeOrderRow>();
      for (const item of Array.isArray(changeOrdersPayload.data) ? changeOrdersPayload.data : []) {
        const projectId = (item.projectId || "").toString().trim();
        if (projectId) {
          changeOrdersByProjectId.set(projectId, item);
        }
      }

      const estimatesBidsByProjectId = new Map<string, ProjectEstimateBidRow>();
      for (const item of Array.isArray(estimatesBidsPayload.data) ? estimatesBidsPayload.data : []) {
        const projectId = (item.procoreProjectId || item.projectId || "").toString().trim();
        if (projectId) {
          estimatesBidsByProjectId.set(projectId, item);
        }
      }

      const bidBoardProjectIdToProcoreProjectId = new Map<string, string>();
      if (Array.isArray(bidPayload.projects)) {
        for (const project of bidPayload.projects) {
          const bidBoardProjectId = String(project.id || project.project_id || "").trim();
          const procoreProjectId = String(project.project_id || "").trim();
          if (bidBoardProjectId && procoreProjectId) {
            bidBoardProjectIdToProcoreProjectId.set(bidBoardProjectId, procoreProjectId);
          }
        }
      }
      for (const project of Array.isArray(proposalsBulkPayload.bidBoardProjects) ? proposalsBulkPayload.bidBoardProjects : []) {
        const bidBoardProjectId = String(project.id || project.bid_board_project_id || "").trim();
        const procoreProjectId = String(project.project_id || project.procore_project_id || "").trim();
        if (bidBoardProjectId && procoreProjectId) {
          bidBoardProjectIdToProcoreProjectId.set(bidBoardProjectId, procoreProjectId);
        }
      }

      const liveProposalsByProjectId = new Map<
        string,
        { count: number; proposalIds: string; proposalNames: string }
      >();
      const liveProposalsByNameCustomer = new Map<
        string,
        { count: number; proposalIds: string; proposalNames: string }
      >();
      for (const item of Array.isArray(proposalsBulkPayload.proposals) ? proposalsBulkPayload.proposals : []) {
        const bidBoardProjectId = String(item.bidBoardProjectId || "").trim();
        const procoreProjectId = String(item.procoreProjectId || "").trim();
        const projectName = String(item.projectName || "").trim();
        const customerName = String(item.customerName || "").trim();
        const proposalRecord = item.proposal || {};
        const proposalId = String(proposalRecord.id || proposalRecord.proposal_id || "").trim();
        const proposalName = String(
          proposalRecord.name || proposalRecord.title || proposalRecord.proposal_number || ""
        ).trim();
        const projectId = procoreProjectId || bidBoardProjectIdToProcoreProjectId.get(bidBoardProjectId) || bidBoardProjectId;
        if (!projectId) continue;

        const existing = liveProposalsByProjectId.get(projectId) || {
          count: 0,
          proposalIds: "",
          proposalNames: "",
        };

        const idSet = new Set(existing.proposalIds ? existing.proposalIds.split(", ").filter(Boolean) : []);
        const nameSet = new Set(existing.proposalNames ? existing.proposalNames.split(", ").filter(Boolean) : []);
        if (proposalId) idSet.add(proposalId);
        if (proposalName) nameSet.add(proposalName);

        liveProposalsByProjectId.set(projectId, {
          count: Math.max(existing.count, idSet.size),
          proposalIds: Array.from(idSet).sort((a, b) => a.localeCompare(b)).join(", "),
          proposalNames: Array.from(nameSet).sort((a, b) => a.localeCompare(b)).join(", "),
        });

        const nameCustomerKey = normalizeJoinKey(projectName, customerName);
        if (nameCustomerKey) {
          const existingByName = liveProposalsByNameCustomer.get(nameCustomerKey) || {
            count: 0,
            proposalIds: "",
            proposalNames: "",
          };
          const nameIdSet = new Set(existingByName.proposalIds ? existingByName.proposalIds.split(", ").filter(Boolean) : []);
          const nameNameSet = new Set(
            existingByName.proposalNames ? existingByName.proposalNames.split(", ").filter(Boolean) : []
          );
          if (proposalId) nameIdSet.add(proposalId);
          if (proposalName) nameNameSet.add(proposalName);

          liveProposalsByNameCustomer.set(nameCustomerKey, {
            count: Math.max(existingByName.count, nameIdSet.size),
            proposalIds: Array.from(nameIdSet).sort((a, b) => a.localeCompare(b)).join(", "),
            proposalNames: Array.from(nameNameSet).sort((a, b) => a.localeCompare(b)).join(", "),
          });
        }
      }

      const projectItems: ProjectRow[] = (Array.isArray(payload.data) ? payload.data : []).map((project) => {
        const lookupId = (project.procoreId || project.id || "").toString().trim();
        const budget = lookupId ? budgetByProjectId.get(lookupId) : undefined;
        const changeOrders = lookupId ? changeOrdersByProjectId.get(lookupId) : undefined;
        const estimatesBids = lookupId ? estimatesBidsByProjectId.get(lookupId) : undefined;
        const liveProposals =
          (lookupId ? liveProposalsByProjectId.get(lookupId) : undefined) ||
          liveProposalsByNameCustomer.get(normalizeJoinKey(project.projectName, project.customer));
        const estimateProposalCount = Math.max(
          Number(estimatesBids?.estimateProposalCount || 0),
          Number(liveProposals?.count || 0)
        );
        const estimateProposalIds = mergeCommaSeparated(
          "",
          liveProposals?.proposalIds || ""
        );
        const estimateProposalNames = mergeCommaSeparated(
          (estimatesBids?.estimateProposalNames || "").toString(),
          liveProposals?.proposalNames || ""
        );

        return {
          ...project,
          budgetUoms: (budget?.uoms || "").toString(),
          budgetAmount: Number(budget?.totalAmount || 0),
          budgetLineItemCount: Number(budget?.lineItemCount || 0),
          budgetSyncedAt: budget?.syncedAt || null,
          changeOrderCount: Number(changeOrders?.changeOrderCount || 0),
          changeOrderValue: Number(changeOrders?.totalChangeOrderValue || 0),
          approvedChangeOrderValue: Number(changeOrders?.approvedChangeOrderValue || 0),
          changeOrderStatuses: (changeOrders?.changeOrderStatuses || "").toString(),
          changeOrderSyncedAt: changeOrders?.latestChangeOrderAt || null,
          bidCount: Number(estimatesBids?.bidCount || 0),
          bidFormCount: Number(estimatesBids?.bidFormCount || 0),
          bidPackageCount: Number(estimatesBids?.bidPackageCount || 0),
          bidStatuses: (estimatesBids?.bidStatuses || "").toString(),
          estimateProposalCount,
          estimateLineItemCount: Number(estimatesBids?.estimateLineItemCount || 0),
          estimateProposalIds,
          estimateProposalNames,
        };
      });
      const bidItems: BidBoardRow[] = Array.isArray(bidPayload.projects)
        ? bidPayload.projects.map((project) => ({
            id: String(project.id || project.project_id || ""),
            bidBoardId: String(project.id || ""),
            procoreId: project.project_id ? String(project.project_id) : null,
            projectName: project.name || null,
            customer: project.customer_name || null,
            status: project.status || null,
            statusRaw: project.status || null,
            syncedAt: project.updated_at || null,
          }))
        : (Array.isArray(bidPayload.data) ? bidPayload.data : []);

      const mergedProjectItems: ProjectRow[] = [...projectItems];
      const existingProcoreIds = new Set(
        projectItems
          .map((item) => String(item.procoreId || "").trim())
          .filter(Boolean)
      );
      const existingBidBoardIds = new Set(
        projectItems
          .map((item) => String(item.bidBoardId || "").trim())
          .filter(Boolean)
      );

      for (const bidItem of bidItems) {
        const procoreId = String(bidItem.procoreId || "").trim();
        const bidBoardId = String(bidItem.bidBoardId || bidItem.id || "").trim();
        const hasMatch =
          (procoreId && existingProcoreIds.has(procoreId)) ||
          (bidBoardId && existingBidBoardIds.has(bidBoardId));

        if (hasMatch) continue;

        mergedProjectItems.push({
          id: bidBoardId || procoreId || String(bidItem.id || ""),
          projectName: bidItem.projectName || null,
          customer: bidItem.customer || null,
          status: bidItem.status || null,
          statusRaw: bidItem.statusRaw || null,
          bidBoardStatus: bidItem.status || null,
          bidBoardId: bidBoardId || null,
          procoreId: procoreId || null,
          syncedAt: bidItem.syncedAt || null,
        });
      }

      setRows(mergedProjectItems);
      setChangeOrderSource((changeOrdersPayload.source || "").toString());
      setLastRefreshedAt(new Date().toLocaleString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
      setRows([]);
      setChangeOrderSource("");
    } finally {
      setLoading(false);
    }
  }, []);

  const syncAndReload = useCallback(async (options?: { auto?: boolean }) => {
    const isAuto = options?.auto === true;

    if (syncInFlightRef.current) {
      return;
    }

    syncInFlightRef.current = true;
    if (!isAuto) {
      setSyncing(true);
      setError("");
    }

    try {
      const response = await fetch("/api/procore/sync/all-projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId: DEFAULT_PROCORE_COMPANY_ID || "598134325805519",
          fetchAll: !isAuto,
          includeInactiveV1: !isAuto,
          includeTestProjects: !isAuto,
          maxPages: isAuto ? 1 : 1000,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || `Sync failed with ${response.status}`);
      }

      await loadProjects();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to sync from Procore";
      if (/429|too many requests/i.test(message)) {
        // Procore can rate-limit bursty syncs; keep stale-safe UI by reloading local API data only.
        await loadProjects();
        return;
      }

      if (!isAuto) {
        setError(message);
      }
    } finally {
      if (!isAuto) {
        setSyncing(false);
      }
      syncInFlightRef.current = false;
    }
  }, [loadProjects]);

  const syncCommercialData = useCallback(async () => {
    setSyncingCommercial(true);
    setError("");

    try {
      async function runStep(path: string, payload: Record<string, unknown>, label: string) {
        const response = await fetch(path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            (body as { error?: string; details?: string })?.error ||
              (body as { details?: string })?.details ||
              `${label} failed with ${response.status}`
          );
        }

        return body;
      }

      await runStep(
        "/api/procore/sync/bids",
        {
          companyWide: true,
            companyId: DEFAULT_PROCORE_COMPANY_ID || "598134325805519",
          fetchAll: true,
          limitProjects: 1000,
          perPage: 100,
        },
        "Bids sync"
      );

      await runStep(
        "/api/procore/sync/bidforms",
        {
          companyWide: true,
            companyId: DEFAULT_PROCORE_COMPANY_ID || "598134325805519",
          fetchAll: true,
          limitProjects: 1000,
          perPage: 100,
        },
        "Bid forms sync"
      );

      await runStep(
        "/api/procore/estimating/proposal-line-items-bulk",
        {
            companyId: DEFAULT_PROCORE_COMPANY_ID || "598134325805519",
          fetchAll: true,
          persist: true,
          includeProjectSummaries: false,
          includeLineItems: false,
          perPage: 100,
          "filters[by_status]": "All",
          maxBidBoardProjects: 1000,
          maxProposalsPerProject: 200,
          maxLineItemsPages: 50,
        },
        "Estimate line items sync"
      );

      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync commercial project data");
    } finally {
      setSyncingCommercial(false);
    }
  }, [loadProjects]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    const refreshIntervalMs = 60_000;
    const minAutoFullSyncIntervalMs = 3 * 60_000;

    const triggerRefresh = (allowFullSync: boolean) => {
      if (document.visibilityState !== "visible") {
        return;
      }

      const now = Date.now();
      const canRunFullSync =
        allowFullSync &&
        now - lastAutoFullSyncAtRef.current >= minAutoFullSyncIntervalMs;

      if (canRunFullSync) {
        lastAutoFullSyncAtRef.current = now;
        void syncAndReload({ auto: true });
        return;
      }

      void loadProjects();
    };

    const onInterval = () => triggerRefresh(true);
    const onFocus = () => triggerRefresh(true);
    const onVisibilityChange = () => triggerRefresh(true);

    const intervalId = window.setInterval(onInterval, refreshIntervalMs);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadProjects, syncAndReload]);

  const statusOptions = useMemo(() => {
    const all = new Set<string>();

    for (const row of rows) {
      const status = (row.status || "").trim();
      if (status) all.add(status);
    }

    return ["All", ...Array.from(all).sort((a, b) => a.localeCompare(b))];
  }, [rows]);

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase();

    const base = rows.filter((row) => {
      if (statusFilter !== "All" && (row.status || "") !== statusFilter) return false;

      if (!q) return true;

      const fields = [
        row.projectName,
        row.projectNumber,
        row.customer,
        row.status,
        row.projectStageName,
        row.projectStageCategory,
        row.bidBoardStatus,
        row.procoreId,
        row.budgetUoms,
        row.budgetAmount?.toString(),
        row.budgetLineItemCount?.toString(),
        row.changeOrderCount?.toString(),
        row.changeOrderValue?.toString(),
        row.approvedChangeOrderValue?.toString(),
        row.changeOrderStatuses,
        row.bidCount?.toString(),
        row.bidFormCount?.toString(),
        row.estimateProposalCount?.toString(),
        row.estimateLineItemCount?.toString(),
        row.estimateProposalIds,
        row.bidStatuses,
        row.estimateProposalNames,
      ]
        .map((v) => (v || "").toString().toLowerCase())
        .join(" ");

      return fields.includes(q);
    });

    const sorted = [...base].sort((a, b) => {
      const numericSortKeys: SortKey[] = [
        "budgetAmount",
        "budgetLineItemCount",
        "changeOrderCount",
        "changeOrderValue",
        "approvedChangeOrderValue",
        "bidCount",
        "bidFormCount",
        "estimateProposalCount",
        "estimateLineItemCount",
        "estimateProposalIds",
      ];
      const cmp = numericSortKeys.includes(sortKey)
        ? (Number(a[sortKey] || 0) - Number(b[sortKey] || 0))
        : (a[sortKey] || "").toString().toLowerCase().localeCompare((b[sortKey] || "").toString().toLowerCase());
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [rows, query, statusFilter, sortKey, sortDirection]);

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection("asc");
  }

  const projectsWithBudgetCount = useMemo(
    () => filteredProjects.filter((row) => (row.budgetLineItemCount || 0) > 0).length,
    [filteredProjects]
  );

  const totalVisibleBudgetAmount = useMemo(
    () => filteredProjects.reduce((sum, row) => sum + (row.budgetAmount || 0), 0),
    [filteredProjects]
  );

  const totalVisibleBudgetLines = useMemo(
    () => filteredProjects.reduce((sum, row) => sum + (row.budgetLineItemCount || 0), 0),
    [filteredProjects]
  );

  const projectsWithChangeOrdersCount = useMemo(
    () => filteredProjects.filter((row) => (row.changeOrderCount || 0) > 0).length,
    [filteredProjects]
  );

  const totalVisibleChangeOrders = useMemo(
    () => filteredProjects.reduce((sum, row) => sum + (row.changeOrderCount || 0), 0),
    [filteredProjects]
  );

  const totalVisibleChangeOrderValue = useMemo(
    () => filteredProjects.reduce((sum, row) => sum + (row.changeOrderValue || 0), 0),
    [filteredProjects]
  );

  const totalVisibleApprovedChangeOrderValue = useMemo(
    () => filteredProjects.reduce((sum, row) => sum + (row.approvedChangeOrderValue || 0), 0),
    [filteredProjects]
  );

  const projectsWithBidsCount = useMemo(
    () => filteredProjects.filter((row) => (row.bidCount || 0) > 0 || (row.bidFormCount || 0) > 0).length,
    [filteredProjects]
  );

  const projectsWithEstimatesCount = useMemo(
    () => filteredProjects.filter((row) => (row.estimateProposalCount || 0) > 0).length,
    [filteredProjects]
  );

  return (
    <div className="p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="text-sm text-gray-500">
            Live Procore endpoint snapshots (V1 + Bid Board).
            {lastRefreshedAt ? ` Last refreshed: ${lastRefreshedAt}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void syncAndReload()}
            disabled={syncing || loading}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {syncing ? "Syncing Procore..." : "Sync Procore Now"}
          </button>

          <button
            onClick={() => void syncCommercialData()}
            disabled={syncingCommercial || syncing || loading}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {syncingCommercial ? "Syncing Bids/Estimates..." : "Sync Bids/Estimates"}
          </button>

          <button
            onClick={() => void loadProjects()}
            disabled={loading || syncing || syncingCommercial}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh Live Data"}
          </button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <input
          type="text"
          placeholder="Search name, number, customer, status, IDs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <h2 className="mb-2 text-lg font-semibold text-gray-900">Projects V1 (Live)</h2>
      <div className="mb-3 flex flex-wrap gap-3 text-sm text-gray-600">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          Projects with budget: <span className="font-semibold text-gray-900">{projectsWithBudgetCount.toLocaleString()}</span>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          Visible budget lines: <span className="font-semibold text-gray-900">{totalVisibleBudgetLines.toLocaleString()}</span>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          Visible budget amount: <span className="font-semibold text-gray-900">{formatCurrency(totalVisibleBudgetAmount)}</span>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          Projects with change orders: <span className="font-semibold text-gray-900">{projectsWithChangeOrdersCount.toLocaleString()}</span>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          Visible change orders: <span className="font-semibold text-gray-900">{totalVisibleChangeOrders.toLocaleString()}</span>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          Visible change order value: <span className="font-semibold text-gray-900">{formatCurrency(totalVisibleChangeOrderValue)}</span>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          Visible approved CO value: <span className="font-semibold text-gray-900">{formatCurrency(totalVisibleApprovedChangeOrderValue)}</span>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          Projects with bids: <span className="font-semibold text-gray-900">{projectsWithBidsCount.toLocaleString()}</span>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          Projects with estimates: <span className="font-semibold text-gray-900">{projectsWithEstimatesCount.toLocaleString()}</span>
        </div>
      </div>
      {changeOrderSource && changeOrderSource !== "packages" && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Change orders are currently using the `{changeOrderSource}` fallback source. The project-level packages table is not available in this database yet, so approved change-order amounts may stay blank until that sync is loaded.
        </div>
      )}
      <div className="mb-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <HeaderCell label="Project Name" onClick={() => toggleSort("projectName")} />
              <HeaderCell label="Project #" onClick={() => toggleSort("projectNumber")} />
              <HeaderCell label="Customer" onClick={() => toggleSort("customer")} />
              <HeaderCell label="Status" onClick={() => toggleSort("status")} />
              <HeaderCell label="Project Stage" onClick={() => toggleSort("projectStageName")} />
              <HeaderCell label="Bid Board Status" onClick={() => toggleSort("bidBoardStatus")} />
              <HeaderCell label="UOM" onClick={() => toggleSort("budgetUoms")} />
              <HeaderCell label="Budget Amount" onClick={() => toggleSort("budgetAmount")} />
              <HeaderCell label="Budget Lines" onClick={() => toggleSort("budgetLineItemCount")} />
              <HeaderCell label="CO Count" onClick={() => toggleSort("changeOrderCount")} />
              <HeaderCell label="Approved CO Value" onClick={() => toggleSort("approvedChangeOrderValue")} />
              <HeaderCell label="CO Statuses" onClick={() => toggleSort("changeOrderStatuses")} />
              <HeaderCell label="Bids" onClick={() => toggleSort("bidCount")} />
              <HeaderCell label="Bid Forms" onClick={() => toggleSort("bidFormCount")} />
              <HeaderCell label="Est Proposals" onClick={() => toggleSort("estimateProposalCount")} />
              <HeaderCell label="Est Items" onClick={() => toggleSort("estimateLineItemCount")} />
              <HeaderCell label="Proposal IDs" onClick={() => toggleSort("estimateProposalIds")} />
              <th className="px-3 py-2 text-left">Procore ID</th>
            </tr>
          </thead>
          <tbody>
            {!loading && filteredProjects.length === 0 && (
              <tr>
                <td colSpan={18} className="px-3 py-10 text-center text-gray-400">
                  No V1 projects found.
                </td>
              </tr>
            )}

            {filteredProjects.map((row) => (
              <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 font-medium text-gray-900">{row.projectName || "Unknown"}</td>
                <td className="px-3 py-2 text-gray-700">{row.projectNumber || ""}</td>
                <td className="px-3 py-2 text-gray-700">{row.customer || "Unknown"}</td>
                <td className="px-3 py-2 text-gray-700">{row.status || "Unknown"}</td>
                <td className="px-3 py-2 text-gray-700">{row.projectStageName || row.projectStageCategory || ""}</td>
                <td className="px-3 py-2 text-gray-700">{row.bidBoardStatus || ""}</td>
                <td className="px-3 py-2 text-gray-700">{row.budgetLineItemCount ? (row.budgetUoms || "") : ""}</td>
                <td className="px-3 py-2 text-right text-gray-700">{row.budgetLineItemCount ? formatCurrency(row.budgetAmount || 0) : ""}</td>
                <td className="px-3 py-2 text-right text-gray-700">{row.budgetLineItemCount ? (row.budgetLineItemCount || 0).toLocaleString() : ""}</td>
                <td className="px-3 py-2 text-right text-gray-700">{row.changeOrderCount ? row.changeOrderCount.toLocaleString() : ""}</td>
                <td className="px-3 py-2 text-right text-gray-700">{row.changeOrderCount ? formatCurrency(row.approvedChangeOrderValue || 0) : ""}</td>
                <td className="px-3 py-2 text-gray-700">{row.changeOrderStatuses || ""}</td>
                <td className="px-3 py-2 text-right text-gray-700">{row.bidCount ? row.bidCount.toLocaleString() : ""}</td>
                <td className="px-3 py-2 text-right text-gray-700">{row.bidFormCount ? row.bidFormCount.toLocaleString() : ""}</td>
                <td className="px-3 py-2 text-right text-gray-700">{row.estimateProposalCount ? row.estimateProposalCount.toLocaleString() : ""}</td>
                <td className="px-3 py-2 text-right text-gray-700">{row.estimateLineItemCount ? row.estimateLineItemCount.toLocaleString() : ""}</td>
                <td className="px-3 py-2 text-gray-700">{row.estimateProposalIds || ""}</td>
                <td className="px-3 py-2 text-gray-700">{row.procoreId || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mb-6 mt-2 text-xs text-gray-500">Showing {filteredProjects.length.toLocaleString()} V1 project(s).</p>

    </div>
  );
}

function HeaderCell({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <th className="px-3 py-2 text-left">
      <button onClick={onClick} className="font-semibold text-gray-500 hover:text-gray-700">
        {label}
      </button>
    </th>
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

function mergeCommaSeparated(...values: string[]) {
  const items = new Set<string>();

  for (const value of values) {
    for (const part of value.split(",")) {
      const trimmed = part.trim();
      if (trimmed) items.add(trimmed);
    }
  }

  return Array.from(items).sort((a, b) => a.localeCompare(b)).join(", ");
}

function normalizeJoinKey(...parts: Array<string | null | undefined>) {
  const normalized = parts
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);

  return normalized.length > 0 ? normalized.join("||") : "";
}
