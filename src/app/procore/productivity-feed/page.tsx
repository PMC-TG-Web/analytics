"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";

type CCOLineItemSyncResponse = {
  success?: boolean;
  error?: string;
  companyId?: string;
  totalProjectsChecked?: number;
  projectsWithChangeOrders?: number;
  projectsNotEnabled?: number;
  projectsWithoutChangeOrders?: number;
  totalChangeOrdersFetched?: number;
  totalLineItemsFetched?: number;
  totalLineItemsSaved?: number;
  totalProjectsCreated?: number;
  errors?: string[];
  activeProjects?: Array<{
    projectId: string;
    projectNumber: string | null;
    projectName: string;
    changeOrderCount: number;
    lineItemCount: number;
    savedCount: number;
    projectCreated: boolean;
    status: string;
  }>;
};

type POLineItemDetailsSyncResponse = {
  success?: boolean;
  error?: string;
  companyId?: string;
  totalProjectsChecked?: number;
  projectsWithPurchaseOrderContracts?: number;
  projectsNotEnabled?: number;
  projectsWithoutPurchaseOrderContracts?: number;
  totalPurchaseOrderContractsFetched?: number;
  totalLineItemContractDetailsFetched?: number;
  totalLineItemContractDetailsSaved?: number;
  totalProjectsCreated?: number;
  errors?: string[];
  activeProjects?: Array<{
    projectId: string;
    projectNumber: string | null;
    projectName: string;
    purchaseOrderContractCount: number;
    lineItemContractDetailCount: number;
    savedCount: number;
    projectCreated: boolean;
    status: string;
  }>;
};

type ContractSyncResponse = {
  success?: boolean;
  error?: string;
  companyId?: string;
  totalProjectsChecked?: number;
  projectsWithContracts?: number;
  totalContractsFetched?: number;
  totalContractsSaved?: number;
  totalProjectsCreated?: number;
  errors?: string[];
  activeProjects?: Array<{
    projectId: string;
    projectNumber: string | null;
    projectName: string;
    contractCount: number;
    savedCount: number;
    skippedCount: number;
    projectCreated: boolean;
    linkedProjectId: string | null;
  }>;
};

type BulkSyncResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  companyId?: string;
  totalProjectsChecked?: number;
  projectsWithActivity?: number;
  totalLogsFetched?: number;
  totalLogsSaved?: number;
  totalProjectsCreated?: number;
  errors?: string[];
  activeProjects?: Array<{
    projectId: string;
    projectNumber: string | null;
    projectName: string;
    logCount: number;
    savedCount: number;
    skippedCount: number;
    projectCreated: boolean;
    linkedProjectId: string | null;
  }>;
};

type BidFormsSyncResponse = {
  success?: boolean;
  error?: string;
  companyWide?: boolean;
  companyId?: string;
  projectId?: string | null;
  bidPackageId?: string | null;
  bidId?: string | null;
  bidFormId?: string | null;
  fetched?: number;
  upserted?: number;
  projectsScanned?: number | null;
  bidPackagesDiscovered?: number | null;
  skippedProjectsNoBiddingAccess?: number;
  skippedPackagesNoFormAccess?: number;
  projectLevelFormsFallbackUsed?: number;
  warnings?: string[];
  errors?: string[];
};

type ProjectsFeedSyncResponse = {
  success?: boolean;
  error?: string;
  message?: string;
  count?: number;
  data?: unknown;
};

type BudgetLineItemLookupResponse = {
  success?: boolean;
  error?: string;
  message?: string;
  data?: {
    companyId?: string;
    projectId?: string;
    budgetLineItemId?: string;
    endpoint?: string;
    budgetLineItem?: unknown;
  };
};

type BudgetLineItemsSyncResponse = {
  success?: boolean;
  error?: string;
  data?: {
    companyId?: string;
    projectsLimit?: number;
    projectsScanned?: number;
    projectsSkippedAccess?: number;
    fetched?: number;
    upserted?: number;
    warnings?: string[];
    errors?: string[];
  };
};

export default function ProcoreProductivityFeedPage() {
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [procoreConnected, setProcoreConnected] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [logDate, setLogDate] = useState("");
  const [startDate, setStartDate] = useState("2025-08-01");
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [createdByIds, setCreatedByIds] = useState("");
  const [dailyLogSegmentId, setDailyLogSegmentId] = useState("123456");
  const [perPage, setPerPage] = useState(100);
  const [persist, setPersist] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkResponse, setBulkResponse] = useState<BulkSyncResponse | null>(null);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [contractsError, setContractsError] = useState<string | null>(null);
  const [contractsResponse, setContractsResponse] = useState<ContractSyncResponse | null>(null);
  const [ccoLoading, setCcoLoading] = useState(false);
  const [ccoError, setCcoError] = useState<string | null>(null);
  const [ccoResponse, setCcoResponse] = useState<CCOLineItemSyncResponse | null>(null);
  const [poLineItemsLoading, setPoLineItemsLoading] = useState(false);
  const [poLineItemsError, setPoLineItemsError] = useState<string | null>(null);
  const [poLineItemsResponse, setPoLineItemsResponse] = useState<POLineItemDetailsSyncResponse | null>(null);
  const [bidFormsLoading, setBidFormsLoading] = useState(false);
  const [bidFormsError, setBidFormsError] = useState<string | null>(null);
  const [bidFormsResponse, setBidFormsResponse] = useState<BidFormsSyncResponse | null>(null);
  const [projectsFeedLoading, setProjectsFeedLoading] = useState(false);
  const [projectsFeedError, setProjectsFeedError] = useState<string | null>(null);
  const [projectsFeedResponse, setProjectsFeedResponse] = useState<ProjectsFeedSyncResponse | null>(null);
  const [singleBidId, setSingleBidId] = useState("");
  const [singleBidFormId, setSingleBidFormId] = useState("");
  const [budgetLineItemId, setBudgetLineItemId] = useState("");
  const [budgetLineItemProjectId, setBudgetLineItemProjectId] = useState("");
  const [budgetLineItemLoading, setBudgetLineItemLoading] = useState(false);
  const [budgetLineItemError, setBudgetLineItemError] = useState<string | null>(null);
  const [budgetLineItemResponse, setBudgetLineItemResponse] = useState<BudgetLineItemLookupResponse | null>(null);
  const [budgetLineItemsSyncLoading, setBudgetLineItemsSyncLoading] = useState(false);
  const [budgetLineItemsSyncError, setBudgetLineItemsSyncError] = useState<string | null>(null);
  const [budgetLineItemsSyncResponse, setBudgetLineItemsSyncResponse] = useState<BudgetLineItemsSyncResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        const res = await fetch("/api/procore/auth-status", { credentials: "include" });
        const json = (await res.json()) as { connected?: boolean; error?: string };
        if (!cancelled) {
          setProcoreConnected(Boolean(json.connected));
        }
      } catch {
        if (!cancelled) {
          setProcoreConnected(false);
        }
      } finally {
        if (!cancelled) {
          setCheckingAuth(false);
        }
      }
    }

    checkAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("error");
    const status = params.get("status");

    if (oauthError) {
      setError(oauthError);
    }

    if (status === "authenticated") {
      setCheckingAuth(true);
      fetch("/api/procore/auth-status", { credentials: "include" })
        .then((res) => res.json())
        .then((json: { connected?: boolean }) => {
          setProcoreConnected(Boolean(json.connected));
          if (json.connected) {
            const cleanUrl = `${window.location.pathname}`;
            window.history.replaceState({}, "", cleanUrl);
            setError(null);
          }
        })
        .catch(() => {
          setProcoreConnected(false);
        })
        .finally(() => {
          setCheckingAuth(false);
        });
    }
  }, []);

  async function syncProjectsWithActivity() {
    setBulkLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/procore/sync/productivity-projects", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId: companyId.trim() || undefined,
          logDate: logDate || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          createdByIds: createdByIds.trim() || undefined,
          dailyLogSegmentId: dailyLogSegmentId.trim() || undefined,
          perPage,
          persist,
        }),
      });

      const json = (await res.json()) as BulkSyncResponse;
      if (!res.ok || !json.success) {
        setError(json.error || "Failed to sync projects with productivity activity");
        if (res.status === 401) {
          setProcoreConnected(false);
        }
        setBulkResponse(null);
        return;
      }

      setBulkResponse(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setBulkResponse(null);
    } finally {
      setBulkLoading(false);
    }
  }

  async function syncCCOLineItems() {
        setCcoLoading(true);
        setCcoError(null);
        try {
          const res = await fetch("/api/procore/sync/commitment-change-order-line-items", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId: companyId.trim() || undefined,
              perPage,
              persist,
            }),
          });
          const json = (await res.json()) as CCOLineItemSyncResponse;
          if (!res.ok || !json.success) {
            setCcoError(json.error || "Failed to sync change order line items");
            if (res.status === 401) setProcoreConnected(false);
            setCcoResponse(null);
            return;
          }
          setCcoResponse(json);
        } catch (err) {
          setCcoError(err instanceof Error ? err.message : "Unknown error");
          setCcoResponse(null);
        } finally {
          setCcoLoading(false);
        }
      }

  async function syncCommitmentContracts() {
    setContractsLoading(true);
    setContractsError(null);
    try {
      const res = await fetch("/api/procore/sync/commitment-contracts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companyId.trim() || undefined,
          perPage,
          persist,
        }),
      });
      const json = (await res.json()) as ContractSyncResponse;
      if (!res.ok || !json.success) {
        setContractsError(json.error || "Failed to sync commitment contracts");
        if (res.status === 401) setProcoreConnected(false);
        setContractsResponse(null);
        return;
      }
      setContractsResponse(json);
    } catch (err) {
      setContractsError(err instanceof Error ? err.message : "Unknown error");
      setContractsResponse(null);
    } finally {
      setContractsLoading(false);
    }
  }

  async function syncPOLineItemDetails() {
    setPoLineItemsLoading(true);
    setPoLineItemsError(null);
    try {
      const res = await fetch("/api/procore/sync/purchase-order-line-item-details", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companyId.trim() || undefined,
          perPage,
          persist,
        }),
      });
      const json = (await res.json()) as POLineItemDetailsSyncResponse;
      if (!res.ok || !json.success) {
        setPoLineItemsError(json.error || "Failed to sync purchase order line item details");
        if (res.status === 401) setProcoreConnected(false);
        setPoLineItemsResponse(null);
        return;
      }
      setPoLineItemsResponse(json);
    } catch (err) {
      setPoLineItemsError(err instanceof Error ? err.message : "Unknown error");
      setPoLineItemsResponse(null);
    } finally {
      setPoLineItemsLoading(false);
    }
  }

  async function syncCompanyWideBidForms() {
    setBidFormsLoading(true);
    setBidFormsError(null);
    try {
      const res = await fetch("/api/procore/sync/bidforms", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyWide: true,
          companyId: companyId.trim() || undefined,
          fetchAll: true,
          perPage,
        }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string; data?: BidFormsSyncResponse };
      if (!res.ok || !json.success) {
        setBidFormsError(json.error || "Failed to sync company-wide bid forms");
        if (res.status === 401) setProcoreConnected(false);
        setBidFormsResponse(null);
        return;
      }
      setBidFormsResponse(json.data || { success: true });
    } catch (err) {
      setBidFormsError(err instanceof Error ? err.message : "Unknown error");
      setBidFormsResponse(null);
    } finally {
      setBidFormsLoading(false);
    }
  }

  async function syncCompanyBidFormById() {
    const bidId = singleBidId.trim();
    const bidFormId = singleBidFormId.trim();

    if (!bidId || !bidFormId) {
      setBidFormsError("Enter both Bid ID and Bid Form ID.");
      return;
    }

    setBidFormsLoading(true);
    setBidFormsError(null);
    try {
      const res = await fetch("/api/procore/sync/bidforms", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companyId.trim() || undefined,
          bidId,
          bidFormId,
        }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string; data?: BidFormsSyncResponse };
      if (!res.ok || !json.success) {
        setBidFormsError(json.error || "Failed to sync bid form by id");
        if (res.status === 401) setProcoreConnected(false);
        setBidFormsResponse(null);
        return;
      }
      setBidFormsResponse(json.data || { success: true });
    } catch (err) {
      setBidFormsError(err instanceof Error ? err.message : "Unknown error");
      setBidFormsResponse(null);
    } finally {
      setBidFormsLoading(false);
    }
  }

  async function syncProjectsFeed() {
    setProjectsFeedLoading(true);
    setProjectsFeedError(null);
    try {
      const query = new URLSearchParams({ fetchAll: 'true' });
      if (companyId.trim()) query.set('companyId', companyId.trim());

      const res = await fetch(`/api/procore/sync/projects-feed?${query.toString()}`, {
        method: 'GET',
        credentials: 'include',
      });

      const json = (await res.json()) as ProjectsFeedSyncResponse;
      if (!res.ok || !json.success) {
        setProjectsFeedError(json.error || 'Failed to sync projects feed');
        if (res.status === 401) setProcoreConnected(false);
        setProjectsFeedResponse(null);
        return;
      }

      setProjectsFeedResponse(json);
    } catch (err) {
      setProjectsFeedError(err instanceof Error ? err.message : 'Unknown error');
      setProjectsFeedResponse(null);
    } finally {
      setProjectsFeedLoading(false);
    }
  }

  async function fetchBudgetLineItemById() {
    const id = budgetLineItemId.trim();
    const projectId = budgetLineItemProjectId.trim();

    if (!id || !projectId) {
      setBudgetLineItemError("Enter both Budget Line Item ID and Project ID.");
      return;
    }

    setBudgetLineItemLoading(true);
    setBudgetLineItemError(null);
    try {
      const res = await fetch("/api/procore/sync/budget-line-item", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companyId.trim() || undefined,
          budgetLineItemId: id,
          projectId,
        }),
      });

      const json = (await res.json()) as BudgetLineItemLookupResponse;
      if (!res.ok || !json.success) {
        setBudgetLineItemError(json.error || "Failed to fetch budget line item");
        if (res.status === 401) setProcoreConnected(false);
        setBudgetLineItemResponse(null);
        return;
      }

      setBudgetLineItemResponse(json);
    } catch (err) {
      setBudgetLineItemError(err instanceof Error ? err.message : "Unknown error");
      setBudgetLineItemResponse(null);
    } finally {
      setBudgetLineItemLoading(false);
    }
  }

  async function syncCompanyBudgetLineItems() {
    setBudgetLineItemsSyncLoading(true);
    setBudgetLineItemsSyncError(null);
    try {
      const res = await fetch("/api/procore/sync/budget-line-items", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companyId.trim() || undefined,
          limitProjects: 1000,
          perPage,
          fetchAll: true,
        }),
      });

      const json = (await res.json()) as BudgetLineItemsSyncResponse;
      if (!res.ok || !json.success) {
        setBudgetLineItemsSyncError(json.error || "Failed to sync company budget line items");
        if (res.status === 401) setProcoreConnected(false);
        setBudgetLineItemsSyncResponse(null);
        return;
      }

      setBudgetLineItemsSyncResponse(json);
    } catch (err) {
      setBudgetLineItemsSyncError(err instanceof Error ? err.message : "Unknown error");
      setBudgetLineItemsSyncResponse(null);
    } finally {
      setBudgetLineItemsSyncLoading(false);
    }
  }

  function connectProcore() {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/api/auth/procore/login?returnTo=${encodeURIComponent(returnTo)}`;
  }

  return (
    <main className="min-h-screen bg-neutral-100 p-2 md:p-4 font-sans text-slate-900">
      <div className="w-full bg-white rounded-3xl border border-gray-200 shadow-2xl p-4 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-100 pb-6 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900 uppercase italic leading-none">
              Procore <span className="text-red-700">Productivity Feed</span>
            </h1>
            <p className="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-[0.2em] mt-2">
              Fetches API + Writes to Prisma
            </p>
          </div>
          <Navigation currentPage="procore" />
        </div>

        <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5 mb-6">
          <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs font-bold uppercase tracking-wider flex items-center justify-between gap-3">
            <span>
              Procore Auth: {checkingAuth ? "Checking..." : procoreConnected ? "Connected" : "Not Connected"}
            </span>
            {!procoreConnected && !checkingAuth && (
              <button
                onClick={connectProcore}
                className="px-3 py-1.5 rounded-lg bg-red-700 text-white font-black text-[10px] uppercase tracking-widest hover:bg-red-800"
              >
                Connect Procore
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Company ID
              <input
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                placeholder="Uses default if blank"
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>

            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Log Date
              <input
                type="date"
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>

            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Start Date
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>

            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              End Date
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>

            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              filters[created_by_id]
              <input
                value={createdByIds}
                onChange={(e) => setCreatedByIds(e.target.value)}
                placeholder="123,456"
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>

            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              filters[daily_log_segment_id]
              <input
                value={dailyLogSegmentId}
                onChange={(e) => setDailyLogSegmentId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>

            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Per Page
              <input
                type="number"
                min={1}
                max={200}
                value={perPage}
                onChange={(e) => setPerPage(Math.min(200, Math.max(1, Number(e.target.value || "100"))))}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-700">
              <input
                type="checkbox"
                checked={persist}
                onChange={(e) => setPersist(e.target.checked)}
              />
              Write to Prisma
            </label>

            <button
              onClick={syncProjectsWithActivity}
              disabled={bulkLoading || checkingAuth || !procoreConnected}
              className="px-4 py-2 rounded-xl bg-emerald-700 text-white font-black text-xs uppercase tracking-widest hover:bg-emerald-800 disabled:opacity-50"
            >
              {bulkLoading ? "Syncing..." : "Sync Active Projects"}
            </button>
          </div>
        </section>

        {/* ─── Budget Line Item Lookup Section ─── */}
        <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5 mb-6">
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-700 mb-4">
            Budget Line Item Lookup
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Budget Line Item ID
              <input
                value={budgetLineItemId}
                onChange={(e) => setBudgetLineItemId(e.target.value)}
                placeholder="Required"
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>

            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Project ID
              <input
                value={budgetLineItemProjectId}
                onChange={(e) => setBudgetLineItemProjectId(e.target.value)}
                placeholder="Required (project_id query param)"
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <button
              onClick={fetchBudgetLineItemById}
              disabled={budgetLineItemLoading || checkingAuth || !procoreConnected}
              className="px-4 py-2 rounded-xl bg-teal-700 text-white font-black text-xs uppercase tracking-widest hover:bg-teal-800 disabled:opacity-50"
            >
              {budgetLineItemLoading ? "Fetching..." : "Fetch Budget Line Item By ID"}
            </button>
          </div>

          {budgetLineItemError && (
            <div className="mt-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {budgetLineItemError}
            </div>
          )}

          {budgetLineItemResponse?.data && (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
                <div>Company: <span className="font-bold">{budgetLineItemResponse.data.companyId || "-"}</span></div>
                <div>Project ID: <span className="font-bold">{budgetLineItemResponse.data.projectId || "-"}</span></div>
                <div>Line Item ID: <span className="font-bold">{budgetLineItemResponse.data.budgetLineItemId || "-"}</span></div>
                <div>Endpoint: <span className="font-bold">{budgetLineItemResponse.data.endpoint || "-"}</span></div>
              </div>

              <pre className="max-h-80 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 whitespace-pre-wrap break-all">
                {JSON.stringify(budgetLineItemResponse.data.budgetLineItem ?? {}, null, 2)}
              </pre>
            </div>
          )}

          <div className="mt-6 border-t border-gray-200 pt-5">
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 mb-3">
              Company-Wide Budget Line Items
            </h3>

            <div className="flex flex-wrap items-center gap-3 mb-4">
              <button
                onClick={syncCompanyBudgetLineItems}
                disabled={budgetLineItemsSyncLoading || checkingAuth || !procoreConnected}
                className="px-4 py-2 rounded-xl bg-cyan-700 text-white font-black text-xs uppercase tracking-widest hover:bg-cyan-800 disabled:opacity-50"
              >
                {budgetLineItemsSyncLoading ? "Syncing..." : "Sync All Company Budget Line Items"}
              </button>
            </div>

            {budgetLineItemsSyncError && (
              <div className="mt-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
                {budgetLineItemsSyncError}
              </div>
            )}

            {budgetLineItemsSyncResponse?.data && (
              <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
                <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-7 gap-3 mb-3">
                  <div>Company: <span className="font-bold">{budgetLineItemsSyncResponse.data.companyId || "-"}</span></div>
                  <div>Project Limit: <span className="font-bold">{budgetLineItemsSyncResponse.data.projectsLimit ?? 0}</span></div>
                  <div>Projects Scanned: <span className="font-bold">{budgetLineItemsSyncResponse.data.projectsScanned ?? 0}</span></div>
                  <div>Skipped (Access): <span className="font-bold">{budgetLineItemsSyncResponse.data.projectsSkippedAccess ?? 0}</span></div>
                  <div>Fetched: <span className="font-bold">{budgetLineItemsSyncResponse.data.fetched ?? 0}</span></div>
                  <div>Upserted: <span className="font-bold">{budgetLineItemsSyncResponse.data.upserted ?? 0}</span></div>
                  <div>Errors: <span className="font-bold">{budgetLineItemsSyncResponse.data.errors?.length ?? 0}</span></div>
                </div>

                {budgetLineItemsSyncResponse.data.warnings?.length ? (
                  <div className="mb-3 rounded-xl border border-yellow-300 bg-yellow-50 p-3 text-xs font-semibold text-yellow-900">
                    {budgetLineItemsSyncResponse.data.warnings.length} access warnings. First: {budgetLineItemsSyncResponse.data.warnings[0]}
                  </div>
                ) : null}

                {budgetLineItemsSyncResponse.data.errors?.length ? (
                  <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                    {budgetLineItemsSyncResponse.data.errors.length} errors. First: {budgetLineItemsSyncResponse.data.errors[0]}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </section>

        {/* ─── Company-Wide Bid Forms Section ─── */}
        <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5 mb-6">
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-700 mb-4">
            Company-Wide Bid Forms
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Bid ID
              <input
                value={singleBidId}
                onChange={(e) => setSingleBidId(e.target.value)}
                placeholder="Required for single lookup"
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Bid Form ID
              <input
                value={singleBidFormId}
                onChange={(e) => setSingleBidFormId(e.target.value)}
                placeholder="Required for single lookup"
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <button
              onClick={syncCompanyBidFormById}
              disabled={bidFormsLoading || checkingAuth || !procoreConnected}
              className="px-4 py-2 rounded-xl bg-indigo-700 text-white font-black text-xs uppercase tracking-widest hover:bg-indigo-800 disabled:opacity-50"
            >
              {bidFormsLoading ? "Syncing..." : "Sync Single Bid Form (Bid ID + Form ID)"}
            </button>
            <button
              onClick={syncCompanyWideBidForms}
              disabled={bidFormsLoading || checkingAuth || !procoreConnected}
              className="px-4 py-2 rounded-xl bg-purple-700 text-white font-black text-xs uppercase tracking-widest hover:bg-purple-800 disabled:opacity-50"
            >
              {bidFormsLoading ? "Syncing..." : "Sync Company-Wide Bid Forms"}
            </button>
          </div>

          {bidFormsError && (
            <div className="mt-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {bidFormsError}
            </div>
          )}

          {bidFormsResponse && (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-3">
                <div>Company-Wide: <span className="font-bold">{bidFormsResponse.companyWide ? "Yes" : "No"}</span></div>
                <div>Company: <span className="font-bold">{bidFormsResponse.companyId || "-"}</span></div>
                <div>Bid ID: <span className="font-bold">{bidFormsResponse.bidId || "-"}</span></div>
                <div>Projects Scanned: <span className="font-bold">{bidFormsResponse.projectsScanned ?? 0}</span></div>
                <div>Packages Found: <span className="font-bold">{bidFormsResponse.bidPackagesDiscovered ?? 0}</span></div>
                <div>Fetched: <span className="font-bold">{bidFormsResponse.fetched ?? 0}</span></div>
                <div>Upserted: <span className="font-bold">{bidFormsResponse.upserted ?? 0}</span></div>
                <div>Skipped Projects (Access): <span className="font-bold">{bidFormsResponse.skippedProjectsNoBiddingAccess ?? 0}</span></div>
                <div>Skipped Packages (Access): <span className="font-bold">{bidFormsResponse.skippedPackagesNoFormAccess ?? 0}</span></div>
                <div>Project-Level Fallback Used: <span className="font-bold">{bidFormsResponse.projectLevelFormsFallbackUsed ?? 0}</span></div>
                <div>Errors: <span className="font-bold">{bidFormsResponse.errors?.length ?? 0}</span></div>
              </div>

              {(bidFormsResponse.fetched ?? 0) === 0 && (bidFormsResponse.errors?.length ?? 0) === 0 ? (
                <div className="mb-3 rounded-xl border border-blue-300 bg-blue-50 p-3 text-xs font-semibold text-blue-800">
                  No bid forms were fetched. Check Projects Scanned / Packages Found / Skipped Access counters to see whether this was due to permissions.
                </div>
              ) : null}

              {bidFormsResponse.warnings?.length ? (
                <div className="mb-3 rounded-xl border border-yellow-300 bg-yellow-50 p-3 text-xs font-semibold text-yellow-900">
                  {bidFormsResponse.warnings.length} access warnings. First: {bidFormsResponse.warnings[0]}
                </div>
              ) : null}

              {bidFormsResponse.errors?.length ? (
                <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                  {bidFormsResponse.errors.length} errors. First: {bidFormsResponse.errors[0]}
                </div>
              ) : null}
            </div>
          )}
        </section>

        {/* ─── Supporting Tables / Projects Feed Section ─── */}
        <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5 mb-6">
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-700 mb-4">
            Supporting Tables
          </h2>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <button
              onClick={syncProjectsFeed}
              disabled={projectsFeedLoading || checkingAuth || !procoreConnected}
              className="px-4 py-2 rounded-xl bg-slate-700 text-white font-black text-xs uppercase tracking-widest hover:bg-slate-800 disabled:opacity-50"
            >
              {projectsFeedLoading ? 'Syncing...' : 'Sync Projects Feed (Required First)'}
            </button>
          </div>

          {projectsFeedError && (
            <div className="mt-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {projectsFeedError}
            </div>
          )}

          {projectsFeedResponse && (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-700">
                <div>Message: <span className="font-bold">{projectsFeedResponse.message || '-'}</span></div>
              </div>
            </div>
          )}
        </section>

        {error && (
          <section className="mb-6 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {error}
          </section>
        )}

        {bulkResponse && (
          <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-black uppercase tracking-widest text-gray-700 mb-2">Bulk Activity Sync</h2>
            <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-5 gap-3">
              <div>Company: <span className="font-bold">{bulkResponse.companyId || "-"}</span></div>
              <div>Projects Checked: <span className="font-bold">{bulkResponse.totalProjectsChecked ?? 0}</span></div>
              <div>Projects With Activity: <span className="font-bold">{bulkResponse.projectsWithActivity ?? 0}</span></div>
              <div>Logs Saved: <span className="font-bold">{bulkResponse.totalLogsSaved ?? 0}</span></div>
              <div>Projects Created: <span className="font-bold">{bulkResponse.totalProjectsCreated ?? 0}</span></div>
            </div>

            {bulkResponse.errors?.length ? (
              <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                {bulkResponse.errors.length} project sync errors captured. First: {bulkResponse.errors[0]}
              </div>
            ) : null}
          </section>
        )}

        {bulkResponse?.activeProjects?.length ? (
          <section className="mb-6 rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 text-sm font-black uppercase tracking-widest text-gray-700">
              Projects With Productivity Activity
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full border-collapse">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {["Project #", "Project Name", "Procore ID", "Logs", "Saved", "Created"].map((label) => (
                      <th key={label} className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-wider text-gray-600">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bulkResponse.activeProjects.map((project) => (
                    <tr key={project.projectId} className="border-b border-gray-100">
                      <td className="px-3 py-2 text-sm text-gray-800">{project.projectNumber || "-"}</td>
                      <td className="px-3 py-2 text-sm text-gray-800">{project.projectName}</td>
                      <td className="px-3 py-2 text-sm text-gray-800">{project.projectId}</td>
                      <td className="px-3 py-2 text-sm text-gray-800">{project.logCount}</td>
                      <td className="px-3 py-2 text-sm text-gray-800">{project.savedCount}</td>
                      <td className="px-3 py-2 text-sm text-gray-800">{project.projectCreated ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {/* ── Commitment Contracts Section ── */}
        <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5 mb-6">
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-700 mb-4">
            Commitment Contracts
          </h2>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={syncCommitmentContracts}
              disabled={contractsLoading || checkingAuth || !procoreConnected}
              className="px-4 py-2 rounded-xl bg-blue-700 text-white font-black text-xs uppercase tracking-widest hover:bg-blue-800 disabled:opacity-50"
            >
              {contractsLoading ? "Syncing..." : "Sync Contracts"}
            </button>
          </div>

          {contractsError && (
            <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {contractsError}
            </div>
          )}

          {contractsResponse && (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-5 gap-3 mb-3">
                <div>Company: <span className="font-bold">{contractsResponse.companyId || "-"}</span></div>
                <div>Projects Checked: <span className="font-bold">{contractsResponse.totalProjectsChecked ?? 0}</span></div>
                <div>Projects With Contracts: <span className="font-bold">{contractsResponse.projectsWithContracts ?? 0}</span></div>
                <div>Contracts Saved: <span className="font-bold">{contractsResponse.totalContractsSaved ?? 0}</span></div>
                <div>Projects Created: <span className="font-bold">{contractsResponse.totalProjectsCreated ?? 0}</span></div>
              </div>

              {contractsResponse.errors?.length ? (
                <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                  {contractsResponse.errors.length} errors. First: {contractsResponse.errors[0]}
                </div>
              ) : null}

              {contractsResponse.activeProjects?.length ? (
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="min-w-[900px] w-full border-collapse">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        {["Project #", "Project Name", "Procore ID", "Contracts", "Saved", "Created"].map((label) => (
                          <th key={label} className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-wider text-gray-600">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {contractsResponse.activeProjects.map((project) => (
                        <tr key={project.projectId} className="border-b border-gray-100">
                          <td className="px-3 py-2 text-sm text-gray-800">{project.projectNumber || "-"}</td>
                          <td className="px-3 py-2 text-sm text-gray-800">{project.projectName}</td>
                          <td className="px-3 py-2 text-sm text-gray-800">{project.projectId}</td>
                          <td className="px-3 py-2 text-sm text-gray-800">{project.contractCount}</td>
                          <td className="px-3 py-2 text-sm text-gray-800">{project.savedCount}</td>
                          <td className="px-3 py-2 text-sm text-gray-800">{project.projectCreated ? "Yes" : "No"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          )}
        </section>

        {/* ─── Commitment Change Order Line Items Section ─── */}
        <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5 mb-6">
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-700 mb-4">
            Commitment Change Order Line Items
          </h2>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <button
              onClick={syncCCOLineItems}
              disabled={ccoLoading || checkingAuth || !procoreConnected}
              className="px-4 py-2 rounded-xl bg-violet-700 text-white font-black text-xs uppercase tracking-widest hover:bg-violet-800 disabled:opacity-50"
            >
              {ccoLoading ? "Syncing..." : "Sync Change Order Line Items"}
            </button>
          </div>

          {ccoError && (
            <div className="mt-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {ccoError}
            </div>
          )}

          {ccoResponse && (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-9 gap-3 mb-3">
                <div>Company: <span className="font-bold">{ccoResponse.companyId || "-"}</span></div>
                <div>Projects Checked: <span className="font-bold">{ccoResponse.totalProjectsChecked ?? 0}</span></div>
                <div>With Change Orders: <span className="font-bold">{ccoResponse.projectsWithChangeOrders ?? 0}</span></div>
                <div>Not Enabled: <span className="font-bold">{ccoResponse.projectsNotEnabled ?? 0}</span></div>
                <div>No Change Orders: <span className="font-bold">{ccoResponse.projectsWithoutChangeOrders ?? 0}</span></div>
                <div>Change Orders: <span className="font-bold">{ccoResponse.totalChangeOrdersFetched ?? 0}</span></div>
                <div>Line Items Saved: <span className="font-bold">{ccoResponse.totalLineItemsSaved ?? 0}</span></div>
                <div>Projects Created: <span className="font-bold">{ccoResponse.totalProjectsCreated ?? 0}</span></div>
              </div>

              {ccoResponse.errors?.length ? (
                <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                  {ccoResponse.errors.length} errors. First: {ccoResponse.errors[0]}
                </div>
              ) : null}

              {ccoResponse.activeProjects?.length ? (
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="min-w-[1040px] w-full border-collapse">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        {["Project #", "Project Name", "Procore ID", "Status", "Change Orders", "Line Items", "Saved", "Created"].map((label) => (
                          <th key={label} className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-wider text-gray-600">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ccoResponse.activeProjects.map((project) => (
                        <tr key={project.projectId} className="border-b border-gray-100">
                          <td className="px-3 py-2 text-sm text-gray-800">{project.projectNumber || "-"}</td>
                          <td className="px-3 py-2 text-sm text-gray-800">{project.projectName}</td>
                          <td className="px-3 py-2 text-sm text-gray-800">{project.projectId}</td>
                          <td className="px-3 py-2 text-sm text-gray-800">{project.status}</td>
                          <td className="px-3 py-2 text-sm text-gray-800">{project.changeOrderCount}</td>
                          <td className="px-3 py-2 text-sm text-gray-800">{project.lineItemCount}</td>
                          <td className="px-3 py-2 text-sm text-gray-800">{project.savedCount}</td>
                          <td className="px-3 py-2 text-sm text-gray-800">{project.projectCreated ? "Yes" : "No"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                  No projects returned from Procore for this run.
                </div>
              )}
            </div>
          )}
        </section>

        {/* ─── Purchase Order Contract Line Item Details Section ─── */}
        <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5 mb-6">
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-700 mb-4">
            Purchase Order Contract Line Item Details
          </h2>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <button
              onClick={syncPOLineItemDetails}
              disabled={poLineItemsLoading || checkingAuth || !procoreConnected}
              className="px-4 py-2 rounded-xl bg-indigo-700 text-white font-black text-xs uppercase tracking-widest hover:bg-indigo-800 disabled:opacity-50"
            >
              {poLineItemsLoading ? "Syncing..." : "Sync PO Line Item Details"}
            </button>
          </div>

          {poLineItemsError && (
            <div className="mt-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {poLineItemsError}
            </div>
          )}

          {poLineItemsResponse && (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-8 gap-3 mb-3">
                <div>Company: <span className="font-bold">{poLineItemsResponse.companyId || "-"}</span></div>
                <div>Projects Checked: <span className="font-bold">{poLineItemsResponse.totalProjectsChecked ?? 0}</span></div>
                <div>With PO Contracts: <span className="font-bold">{poLineItemsResponse.projectsWithPurchaseOrderContracts ?? 0}</span></div>
                <div>Not Enabled: <span className="font-bold">{poLineItemsResponse.projectsNotEnabled ?? 0}</span></div>
                <div>No PO Contracts: <span className="font-bold">{poLineItemsResponse.projectsWithoutPurchaseOrderContracts ?? 0}</span></div>
                <div>PO Contracts: <span className="font-bold">{poLineItemsResponse.totalPurchaseOrderContractsFetched ?? 0}</span></div>
                <div>Details Fetched: <span className="font-bold">{poLineItemsResponse.totalLineItemContractDetailsFetched ?? 0}</span></div>
                <div>Details Saved: <span className="font-bold">{poLineItemsResponse.totalLineItemContractDetailsSaved ?? 0}</span></div>
                <div>Projects Created: <span className="font-bold">{poLineItemsResponse.totalProjectsCreated ?? 0}</span></div>
              </div>

              {poLineItemsResponse.errors?.length ? (
                <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                  {poLineItemsResponse.errors.length} errors. First: {poLineItemsResponse.errors[0]}
                </div>
              ) : null}

              {poLineItemsResponse.activeProjects?.length ? (
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="min-w-[1240px] w-full border-collapse">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        {["Project #", "Project Name", "Procore ID", "Status", "PO Contracts", "Details", "Saved", "Created"].map((label) => (
                          <th key={label} className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-wider text-gray-600">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {poLineItemsResponse.activeProjects.map((project) => (
                        <tr key={project.projectId} className="border-b border-gray-100">
                          <td className="px-3 py-2 text-sm text-gray-800">{project.projectNumber || "-"}</td>
                          <td className="px-3 py-2 text-sm text-gray-800">{project.projectName}</td>
                          <td className="px-3 py-2 text-sm text-gray-800">{project.projectId}</td>
                          <td className="px-3 py-2 text-sm text-gray-800">{project.status}</td>
                          <td className="px-3 py-2 text-sm text-gray-800">{project.purchaseOrderContractCount}</td>
                          <td className="px-3 py-2 text-sm text-gray-800">{project.lineItemContractDetailCount}</td>
                          <td className="px-3 py-2 text-sm text-gray-800">{project.savedCount}</td>
                          <td className="px-3 py-2 text-sm text-gray-800">{project.projectCreated ? "Yes" : "No"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                  No projects returned from Procore for this run.
                </div>
              )}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
          Use the filters above, then click <span className="font-semibold text-gray-900">Sync Active Projects</span>,{" "}
          <span className="font-semibold text-gray-900">Sync Contracts</span>, or{" "}
          <span className="font-semibold text-gray-900">Sync Change Order Line Items</span>, or{" "}
          <span className="font-semibold text-gray-900">Sync PO Line Item Details</span>, or{" "}
          <span className="font-semibold text-gray-900">Sync Projects Feed (Required First)</span>, then{" "}
          <span className="font-semibold text-gray-900">Sync Company-Wide Bid Forms</span>.
          This page no longer auto-runs single-project feed calls.
        </section>
      </div>
    </main>
  );
}
