"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import { useProcoreAuthAfterRefresh } from "@/hooks/useProcoreAuthAfterRefresh";
import { readJsonResponse } from "@/utils/readJsonResponse";

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

type ProjectVendorsSyncResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  message?: string;
  data?: {
    companyId?: string;
    projectsLimit?: number;
    projectsScanned?: number;
    projectsSynced?: number;
    projectsSkippedAccess?: number;
    fetched?: number;
    upserted?: number;
    feedCustomersUpdated?: number;
    apiVersionsUsed?: string[];
    sampleVendors?: Array<{
      projectId: string;
      vendorId: string;
      name: string | null;
    }>;
    warnings?: string[];
    errors?: string[];
  };
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

type CustomFieldUserOptionsResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  allProjects?: boolean;
  projectId?: string;
  toolName?: string;
  companyId?: string;
  search?: string;
  page?: number;
  perPage?: number;
  count?: number;
  limitProjects?: number;
  projectsScanned?: number;
  projectsSucceeded?: number;
  projectsFailed?: number;
  totalOptionsFetched?: number;
  uniqueOptions?: number;
  projectSummaries?: Array<{ projectId: string; count: number }>;
  errors?: Array<{ projectId: string; error: string }>;
  data?: Array<Record<string, unknown>>;
  raw?: unknown;
};

type ConfigurableFieldSetsResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  companyId?: string;
  projectId?: string;
  page?: number;
  perPage?: number;
  includeLovEntries?: boolean;
  includeDefaultConfigurableFieldSets?: boolean;
  types?: string[];
  count?: number;
  data?: Array<Record<string, unknown>>;
  raw?: unknown;
};

type ConfigurableFieldSetByIdResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  companyId?: string;
  fieldSetId?: string;
  data?: Record<string, unknown>;
  unpacked?: Record<string, unknown>;
  raw?: unknown;
};

type ConfigurableFieldSetsListResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  companyId?: string;
  page?: number;
  perPage?: number;
  searchValue?: string | null;
  count?: number;
  data?: Array<Record<string, unknown>>;
  unpacked?: Array<Record<string, unknown>>;
  searchResults?: Array<{
    index: number;
    id: string | number | null;
    name: string | null;
    matchCount: number;
    matches: Array<{ path: string; value: string }>;
  }>;
  totalMatchCount?: number;
  raw?: unknown;
};

type CompanyUsersResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  companyId?: string;
  page?: number;
  perPage?: number;
  search?: string | null;
  count?: number;
  data?: Array<{
    id: string | number | null;
    login: string | null;
    name: string | null;
    company_name: string | null;
  }>;
  raw?: unknown;
};

type ProjectShowResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  companyId?: string;
  projectId?: string;
  view?: string;
  data?: Record<string, unknown>;
  raw?: unknown;
};

type BidFormPatchTestResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  dryRun?: boolean;
  projectId?: string;
  bidPackageId?: string;
  bidFormId?: string;
  proposalId?: number;
  patchEndpoint?: string;
  patchedEndpoint?: string;
  patchPayload?: Record<string, unknown>;
  data?: unknown;
};

type ProjectBidsLookupResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  hint?: string | null;
  source?: string;
  projectId?: string;
  page?: number;
  perPage?: number;
  pagesFetched?: number;
  count?: number;
  bids?: Array<Record<string, unknown>>;
  url?: string;
  upstreamError?: string;
  rateLimit?: {
    retryAfterSeconds: number | null;
    resetEpochSeconds: number | null;
    remaining: string | null;
    limit: string | null;
  } | null;
};

type ChangeOrderPackagesResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  source?: string;
  companyId?: string;
  projectId?: string;
  contractId?: string;
  contractResolutionSource?: string;
  resolvedContract?: {
    id?: number | string | null;
    number?: string | null;
    title?: string | null;
    status?: string | null;
  } | null;
  page?: number;
  perPage?: number;
  count?: number;
  data?: unknown[];
};

type ChangeOrderSyncResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  companyId?: string;
  projectsScanned?: number;
  projectsWithPackages?: number;
  projectsSkippedNoPrimeContract?: number;
  projectsSkippedAccess?: number;
  totalPackagesFetched?: number;
  totalPackagesUpserted?: number;
  errors?: string[];
  warnings?: string[];
  activeProjects?: Array<{
    projectId: string;
    contractId: string;
    packageCount: number;
    upsertedCount: number;
    status: string;
  }>;
};

export default function ProcoreProductivityFeedPage() {
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [procoreConnected, setProcoreConnected] = useState(false);
  const [companyId, setCompanyId] = useState(process.env.NEXT_PUBLIC_PROCORE_COMPANY_ID || "");
  const [logDate, setLogDate] = useState("");
  const [startDate, setStartDate] = useState("2025-08-01");
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [createdByIds, setCreatedByIds] = useState("");
  const [dailyLogSegmentId, setDailyLogSegmentId] = useState("123456");
  const [perPage, setPerPage] = useState(100);
  const [persist, setPersist] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [combinedBudgetSyncLoading, setCombinedBudgetSyncLoading] = useState(false);
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
  const [projectVendorsLimitProjects, setProjectVendorsLimitProjects] = useState(1000);
  const [projectVendorsLoading, setProjectVendorsLoading] = useState(false);
  const [projectVendorsError, setProjectVendorsError] = useState<string | null>(null);
  const [projectVendorsResponse, setProjectVendorsResponse] = useState<ProjectVendorsSyncResponse | null>(null);
  const [userOptionsProjectId, setUserOptionsProjectId] = useState("");
  const [userOptionsToolName, setUserOptionsToolName] = useState("projects");
  const [userOptionsSearch, setUserOptionsSearch] = useState("");
  const [userOptionsPage, setUserOptionsPage] = useState(1);
  const [userOptionsPerPage, setUserOptionsPerPage] = useState(100);
  const [userOptionsAllProjects, setUserOptionsAllProjects] = useState(false);
  const [userOptionsLimitProjects, setUserOptionsLimitProjects] = useState(250);
  const [userOptionsLoading, setUserOptionsLoading] = useState(false);
  const [userOptionsError, setUserOptionsError] = useState<string | null>(null);
  const [userOptionsResponse, setUserOptionsResponse] = useState<CustomFieldUserOptionsResponse | null>(null);
  const [cfgProjectId, setCfgProjectId] = useState("");
  const [cfgTypes, setCfgTypes] = useState("ConfigurableFieldSet::PurchaseOrderContract, ConfigurableFieldSet::Observations::Item");
  const [cfgIncludeLovEntries, setCfgIncludeLovEntries] = useState(true);
  const [cfgIncludeDefaults, setCfgIncludeDefaults] = useState(true);
  const [cfgPage, setCfgPage] = useState(1);
  const [cfgPerPage, setCfgPerPage] = useState(100);
  const [cfgGenericToolId, setCfgGenericToolId] = useState("");
  const [cfgActionPlanTypeId, setCfgActionPlanTypeId] = useState("");
  const [cfgInspectionTypeId, setCfgInspectionTypeId] = useState("");
  const [cfgObservationsCategoryId, setCfgObservationsCategoryId] = useState("");
  const [cfgCategory, setCfgCategory] = useState("");
  const [cfgLoading, setCfgLoading] = useState(false);
  const [cfgError, setCfgError] = useState<string | null>(null);
  const [cfgResponse, setCfgResponse] = useState<ConfigurableFieldSetsResponse | null>(null);
  const [cfgByIdFieldSetId, setCfgByIdFieldSetId] = useState("");
  const [cfgByIdLoading, setCfgByIdLoading] = useState(false);
  const [cfgByIdError, setCfgByIdError] = useState<string | null>(null);
  const [cfgByIdResponse, setCfgByIdResponse] = useState<ConfigurableFieldSetByIdResponse | null>(null);
  const [cfgListLoading, setCfgListLoading] = useState(false);
  const [cfgListError, setCfgListError] = useState<string | null>(null);
  const [cfgListResponse, setCfgListResponse] = useState<ConfigurableFieldSetsListResponse | null>(null);
  const [cfgListPage, setCfgListPage] = useState(1);
  const [cfgListPerPage, setCfgListPerPage] = useState(100);
  const [cfgListSearchValue, setCfgListSearchValue] = useState("");
  const [companyUsersLoading, setCompanyUsersLoading] = useState(false);
  const [companyUsersError, setCompanyUsersError] = useState<string | null>(null);
  const [companyUsersResponse, setCompanyUsersResponse] = useState<CompanyUsersResponse | null>(null);
  const [companyUsersPage, setCompanyUsersPage] = useState(1);
  const [companyUsersPerPage, setCompanyUsersPerPage] = useState(100);
  const [companyUsersSearch, setCompanyUsersSearch] = useState("");
  const [projectShowId, setProjectShowId] = useState("");
  const [projectShowView, setProjectShowView] = useState<"full" | "minimal">("full");
  const [projectShowLoading, setProjectShowLoading] = useState(false);
  const [projectShowError, setProjectShowError] = useState<string | null>(null);
  const [projectShowResponse, setProjectShowResponse] = useState<ProjectShowResponse | null>(null);
  const [singleBidId, setSingleBidId] = useState("");
  const [singleBidFormId, setSingleBidFormId] = useState("");
  const [projectBidsProjectId, setProjectBidsProjectId] = useState("598134326376806");
  const [projectBidsLoading, setProjectBidsLoading] = useState(false);
  const [projectBidsError, setProjectBidsError] = useState<string | null>(null);
  const [projectBidsResponse, setProjectBidsResponse] = useState<ProjectBidsLookupResponse | null>(null);
  const [changeOrderProjectId, setChangeOrderProjectId] = useState("598134326376806");
  const [changeOrderContractId, setChangeOrderContractId] = useState("");
  const [changeOrderStatusCsv, setChangeOrderStatusCsv] = useState("");
  const [changeOrderLoading, setChangeOrderLoading] = useState(false);
  const [changeOrderError, setChangeOrderError] = useState<string | null>(null);
  const [changeOrderResponse, setChangeOrderResponse] = useState<ChangeOrderPackagesResponse | null>(null);
  const [changeOrderSyncLoading, setChangeOrderSyncLoading] = useState(false);
  const [changeOrderSyncError, setChangeOrderSyncError] = useState<string | null>(null);
  const [changeOrderSyncResponse, setChangeOrderSyncResponse] = useState<ChangeOrderSyncResponse | null>(null);
  const [budgetLineItemId, setBudgetLineItemId] = useState("");
  const [budgetLineItemProjectId, setBudgetLineItemProjectId] = useState("");
  const [budgetLineItemLoading, setBudgetLineItemLoading] = useState(false);
  const [budgetLineItemError, setBudgetLineItemError] = useState<string | null>(null);
  const [budgetLineItemResponse, setBudgetLineItemResponse] = useState<BudgetLineItemLookupResponse | null>(null);
  const [budgetLineItemsSyncLoading, setBudgetLineItemsSyncLoading] = useState(false);
  const [budgetLineItemsSyncError, setBudgetLineItemsSyncError] = useState<string | null>(null);
  const [budgetLineItemsSyncResponse, setBudgetLineItemsSyncResponse] = useState<BudgetLineItemsSyncResponse | null>(null);
  const [qtyPatchProjectId, setQtyPatchProjectId] = useState("598134326377772");
  const [qtyPatchProposalId, setQtyPatchProposalId] = useState("3169188");
  const [qtyPatchBidPackageId, setQtyPatchBidPackageId] = useState("");
  const [qtyPatchBidFormId, setQtyPatchBidFormId] = useState("");
  const [qtyPatchTitle, setQtyPatchTitle] = useState("Concrete API Test");
  const [qtyPatchUpdatesJson, setQtyPatchUpdatesJson] = useState('[\n  { "id": 1235, "locked_quantity": 10.5 }\n]');
  const [qtyPatchLoading, setQtyPatchLoading] = useState(false);
  const [qtyPatchError, setQtyPatchError] = useState<string | null>(null);
  const [qtyPatchResponse, setQtyPatchResponse] = useState<BidFormPatchTestResponse | null>(null);

  // Preserve location, but let the explicit Connect button start OAuth.
  useProcoreAuthAfterRefresh({ autoRedirect: false });

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        const res = await fetch("/api/procore/auth-status", { credentials: "include" });
        const json = await readJsonResponse<{ connected?: boolean; error?: string }>(res, {
          label: "Procore auth status",
          fallback: {},
        });
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
      void (async () => {
        try {
          const res = await fetch("/api/procore/auth-status", { credentials: "include" });
          const json = await readJsonResponse<{ connected?: boolean }>(res, {
            label: "Procore auth status",
            fallback: {},
          });
          setProcoreConnected(Boolean(json.connected));
          if (json.connected) {
            const cleanUrl = `${window.location.pathname}`;
            window.history.replaceState({}, "", cleanUrl);
            setError(null);
          }
        } catch {
          setProcoreConnected(false);
        } finally {
          setCheckingAuth(false);
        }
      })();
    }
  }, []);

  async function syncProjectsWithActivity(): Promise<boolean> {
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
        return false;
      }

      setBulkResponse(json);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setBulkResponse(null);
      return false;
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

  async function fetchProjectBidsLookup() {
    const projectId = projectBidsProjectId.trim();
    if (!projectId) {
      setProjectBidsError("Enter a Project ID.");
      setProjectBidsResponse(null);
      return;
    }

    setProjectBidsLoading(true);
    setProjectBidsError(null);

    try {
      const payload = {
        companyId: companyId.trim() || undefined,
        projectId,
        page: 1,
        perPage: 25,
      };

      const res = await fetch("/api/procore/projects/bids", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as ProjectBidsLookupResponse;
      if (!res.ok || !json.success) {
        setProjectBidsError(json.error || "Failed to fetch project bids");
        if (res.status === 401) setProcoreConnected(false);
        setProjectBidsResponse(json);
        return;
      }

      setProjectBidsResponse(json);
    } catch (err) {
      setProjectBidsError(err instanceof Error ? err.message : "Unknown error");
      setProjectBidsResponse(null);
    } finally {
      setProjectBidsLoading(false);
    }
  }

  async function fetchChangeOrderPackages() {
    const projectId = changeOrderProjectId.trim();
    if (!projectId) {
      setChangeOrderError("Enter a Project ID.");
      setChangeOrderResponse(null);
      return;
    }

    setChangeOrderLoading(true);
    setChangeOrderError(null);

    try {
      const payload = {
        companyId: companyId.trim() || undefined,
        projectId,
        contractId: changeOrderContractId.trim() || undefined,
        status: changeOrderStatusCsv.trim() || undefined,
        page: 1,
        perPage: 100,
      };

      const res = await fetch("/api/procore/change-order-packages", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as ChangeOrderPackagesResponse;
      if (!res.ok || !json.success) {
        setChangeOrderError(json.error || "Failed to fetch change order packages");
        if (res.status === 401) setProcoreConnected(false);
        setChangeOrderResponse(json);
        return;
      }

      setChangeOrderResponse(json);
    } catch (err) {
      setChangeOrderError(err instanceof Error ? err.message : "Unknown error");
      setChangeOrderResponse(null);
    } finally {
      setChangeOrderLoading(false);
    }
  }

  async function syncAllChangeOrderPackages() {
    setChangeOrderSyncLoading(true);
    setChangeOrderSyncError(null);
    try {
      const res = await fetch("/api/procore/sync/change-order-packages", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companyId.trim() || undefined,
          limitProjects: 1000,
          perPage: 100,
        }),
      });
      const json = (await res.json()) as ChangeOrderSyncResponse;
      if (!res.ok || !json.success) {
        setChangeOrderSyncError(json.error || "Failed to sync change order packages");
        if (res.status === 401) setProcoreConnected(false);
        setChangeOrderSyncResponse(null);
        return;
      }
      setChangeOrderSyncResponse(json);
    } catch (err) {
      setChangeOrderSyncError(err instanceof Error ? err.message : "Unknown error");
      setChangeOrderSyncResponse(null);
    } finally {
      setChangeOrderSyncLoading(false);
    }
  }

  async function syncProjectsFeed() {
    setProjectsFeedLoading(true);
    setProjectsFeedError(null);
    try {
      const res = await fetch('/api/procore/sync/projects-feed', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fetchAll: true,
          companyId: companyId.trim() || undefined,
        }),
      });

      const json = await readJsonResponse<ProjectsFeedSyncResponse>(res, {
        label: 'Projects feed sync',
        fallback: {},
      });
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

  async function syncProjectVendors() {
    setProjectVendorsLoading(true);
    setProjectVendorsError(null);
    try {
      const res = await fetch("/api/procore/sync/project-vendors", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companyId.trim() || undefined,
          limitProjects: projectVendorsLimitProjects,
          perPage,
          fetchAll: true,
          isActiveOnly: true,
        }),
      });

      const json = (await res.json()) as ProjectVendorsSyncResponse;
      if (!res.ok || !json.success) {
        setProjectVendorsError(json.error || "Failed to sync project vendors");
        if (res.status === 401) setProcoreConnected(false);
        setProjectVendorsResponse(null);
        return;
      }

      setProjectVendorsResponse(json);
    } catch (err) {
      setProjectVendorsError(err instanceof Error ? err.message : "Unknown error");
      setProjectVendorsResponse(null);
    } finally {
      setProjectVendorsLoading(false);
    }
  }

  async function fetchCustomFieldUserOptions() {
    const projectId = userOptionsProjectId.trim();
    const toolName = userOptionsToolName.trim();

    if ((!projectId && !userOptionsAllProjects) || !toolName) {
      setUserOptionsError("Enter Tool Name and either Project ID or enable All Projects.");
      return;
    }

    setUserOptionsLoading(true);
    setUserOptionsError(null);
    try {
      const res = await fetch("/api/procore/custom-fields/user-options", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companyId.trim() || undefined,
          projectId: projectId || undefined,
          toolName,
          search: userOptionsSearch.trim() || undefined,
          page: userOptionsPage,
          perPage: userOptionsPerPage,
          allProjects: userOptionsAllProjects,
          limitProjects: userOptionsLimitProjects,
        }),
      });

      const json = (await res.json()) as CustomFieldUserOptionsResponse;
      if (!res.ok || !json.success) {
        setUserOptionsError(json.error || "Failed to fetch custom field user options");
        if (res.status === 401) setProcoreConnected(false);
        setUserOptionsResponse(null);
        return;
      }

      setUserOptionsResponse(json);
    } catch (err) {
      setUserOptionsError(err instanceof Error ? err.message : "Unknown error");
      setUserOptionsResponse(null);
    } finally {
      setUserOptionsLoading(false);
    }
  }

  async function fetchConfigurableFieldSets() {
    const projectId = cfgProjectId.trim();
    if (!projectId) {
      setCfgError("Enter Project ID.");
      return;
    }

    setCfgLoading(true);
    setCfgError(null);
    try {
      const res = await fetch("/api/procore/configurable-field-sets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companyId.trim() || undefined,
          projectId,
          page: cfgPage,
          perPage: cfgPerPage,
          includeLovEntries: cfgIncludeLovEntries,
          includeDefaultConfigurableFieldSets: cfgIncludeDefaults,
          types: cfgTypes
            .split(",")
            .map((v) => v.trim())
            .filter((v) => v.length > 0),
          genericToolId: cfgGenericToolId.trim() || undefined,
          actionPlanTypeId: cfgActionPlanTypeId.trim() || undefined,
          inspectionTypeId: cfgInspectionTypeId.trim() || undefined,
          observationsCategoryId: cfgObservationsCategoryId.trim() || undefined,
          category: cfgCategory.trim() || undefined,
        }),
      });

      const json = (await res.json()) as ConfigurableFieldSetsResponse;
      if (!res.ok || !json.success) {
        setCfgError(json.error || "Failed to fetch configurable field sets");
        if (res.status === 401) setProcoreConnected(false);
        setCfgResponse(null);
        return;
      }

      setCfgResponse(json);
    } catch (err) {
      setCfgError(err instanceof Error ? err.message : "Unknown error");
      setCfgResponse(null);
    } finally {
      setCfgLoading(false);
    }
  }

  async function fetchConfigurableFieldSetById() {
    const fieldSetId = cfgByIdFieldSetId.trim();
    if (!fieldSetId) {
      setCfgByIdError("Enter Configurable Field Set ID.");
      return;
    }

    setCfgByIdLoading(true);
    setCfgByIdError(null);
    try {
      const res = await fetch("/api/procore/configurable-field-sets/by-id", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companyId.trim() || undefined,
          fieldSetId,
        }),
      });

      const json = (await res.json()) as ConfigurableFieldSetByIdResponse;
      if (!res.ok || !json.success) {
        setCfgByIdError(json.error || "Failed to fetch configurable field set by id");
        if (res.status === 401) setProcoreConnected(false);
        setCfgByIdResponse(null);
        return;
      }

      setCfgByIdResponse(json);
    } catch (err) {
      setCfgByIdError(err instanceof Error ? err.message : "Unknown error");
      setCfgByIdResponse(null);
    } finally {
      setCfgByIdLoading(false);
    }
  }

  async function fetchAvailableConfigurableFieldSets() {
    setCfgListLoading(true);
    setCfgListError(null);
    try {
      const res = await fetch("/api/procore/configurable-field-sets/list", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companyId.trim() || undefined,
          page: cfgListPage,
          perPage: cfgListPerPage,
          searchValue: cfgListSearchValue.trim() || undefined,
        }),
      });

      const json = (await res.json()) as ConfigurableFieldSetsListResponse;
      if (!res.ok || !json.success) {
        setCfgListError(json.error || "Failed to fetch available configurable field sets");
        if (res.status === 401) setProcoreConnected(false);
        setCfgListResponse(null);
        return;
      }

      setCfgListResponse(json);
    } catch (err) {
      setCfgListError(err instanceof Error ? err.message : "Unknown error");
      setCfgListResponse(null);
    } finally {
      setCfgListLoading(false);
    }
  }

  async function fetchCompanyUsers() {
    setCompanyUsersLoading(true);
    setCompanyUsersError(null);
    try {
      const res = await fetch("/api/procore/company-users", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companyId.trim() || undefined,
          page: companyUsersPage,
          perPage: companyUsersPerPage,
          search: companyUsersSearch.trim() || undefined,
        }),
      });

      const json = (await res.json()) as CompanyUsersResponse;
      if (!res.ok || !json.success) {
        setCompanyUsersError(json.error || "Failed to fetch company users");
        if (res.status === 401) setProcoreConnected(false);
        setCompanyUsersResponse(null);
        return;
      }

      setCompanyUsersResponse(json);
    } catch (err) {
      setCompanyUsersError(err instanceof Error ? err.message : "Unknown error");
      setCompanyUsersResponse(null);
    } finally {
      setCompanyUsersLoading(false);
    }
  }

  async function fetchProjectShowPayload() {
    const projectId = projectShowId.trim();
    if (!projectId) {
      setProjectShowError("Enter Project ID.");
      return;
    }

    setProjectShowLoading(true);
    setProjectShowError(null);
    try {
      const res = await fetch("/api/procore/projects/show", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companyId.trim() || undefined,
          projectId,
          view: projectShowView,
        }),
      });

      const json = (await res.json()) as ProjectShowResponse;
      if (!res.ok || !json.success) {
        setProjectShowError(json.error || "Failed to fetch project payload");
        if (res.status === 401) setProcoreConnected(false);
        setProjectShowResponse(null);
        return;
      }

      setProjectShowResponse(json);
    } catch (err) {
      setProjectShowError(err instanceof Error ? err.message : "Unknown error");
      setProjectShowResponse(null);
    } finally {
      setProjectShowLoading(false);
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

  async function syncCompanyBudgetLineItems(): Promise<boolean> {
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
        return false;
      }

      setBudgetLineItemsSyncResponse(json);
      return true;
    } catch (err) {
      setBudgetLineItemsSyncError(err instanceof Error ? err.message : "Unknown error");
      setBudgetLineItemsSyncResponse(null);
      return false;
    } finally {
      setBudgetLineItemsSyncLoading(false);
    }
  }

  async function syncProjectsAndBudgets() {
    setCombinedBudgetSyncLoading(true);
    const projectsSynced = await syncProjectsWithActivity();
    if (!projectsSynced) {
      setCombinedBudgetSyncLoading(false);
      return;
    }

    await syncCompanyBudgetLineItems();
    setCombinedBudgetSyncLoading(false);
  }

  async function runBidFormQuantityPatch(dryRun: boolean) {
    setQtyPatchLoading(true);
    setQtyPatchError(null);
    try {
      const proposalId = Number.parseInt(qtyPatchProposalId.trim() || "2989879", 10);
      let quantityUpdates: unknown[] = [];
      try {
        quantityUpdates = JSON.parse(qtyPatchUpdatesJson);
        if (!Array.isArray(quantityUpdates)) {
          setQtyPatchError("Quantity updates must be a JSON array.");
          setQtyPatchLoading(false);
          return;
        }
      } catch {
        setQtyPatchError("Invalid JSON in Quantity Updates.");
        setQtyPatchLoading(false);
        return;
      }

      const payload = {
        projectId: qtyPatchProjectId.trim() || "598134326241241",
        proposalId: Number.isFinite(proposalId) ? proposalId : 2989879,
        bidPackageId: qtyPatchBidPackageId.trim() || undefined,
        bidFormId: qtyPatchBidFormId.trim() || undefined,
        title: qtyPatchTitle.trim() || undefined,
        quantityUpdates,
        dryRun,
      };

      const res = await fetch("/api/procore/test/bidform-patch", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as BidFormPatchTestResponse;
      if (!res.ok || !json.success) {
        const errorMsg = json.details 
          ? `${json.error}: ${json.details}`
          : (json.error || "Failed to update bid form quantities");
        setQtyPatchError(errorMsg);
        if (res.status === 401) setProcoreConnected(false);
        setQtyPatchResponse(null);
        return;
      }

      setQtyPatchResponse(json);
    } catch (err) {
      setQtyPatchError(err instanceof Error ? err.message : "Unknown error");
      setQtyPatchResponse(null);
    } finally {
      setQtyPatchLoading(false);
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

        <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.2em] text-amber-900">
                Projects Feed Shortcut
              </h2>
              <p className="mt-1 text-sm font-semibold text-amber-950">
                Use the dedicated projects-feed tools page for live project sync, match verification, and feed backfill actions.
              </p>
            </div>
            <Link
              href="/procore/projects-feed-tools"
              className="inline-flex items-center justify-center rounded-xl bg-amber-700 px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-white transition-colors hover:bg-amber-800"
            >
              Open Projects Feed Tools
            </Link>
          </div>
        </section>

        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 mb-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.2em] text-rose-900">
                Bid Form Quantity Update
              </h2>
              <p className="mt-1 text-sm font-semibold text-rose-950">
                Update bid form quantities for a project from this page. Use dry run first to confirm target IDs.
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <label className="text-xs font-bold uppercase tracking-wider text-rose-800">
              Project ID
              <input
                value={qtyPatchProjectId}
                onChange={(e) => setQtyPatchProjectId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>

            <label className="text-xs font-bold uppercase tracking-wider text-rose-800">
              Proposal ID
              <input
                value={qtyPatchProposalId}
                onChange={(e) => setQtyPatchProposalId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>

            <label className="text-xs font-bold uppercase tracking-wider text-rose-800">
              Bid Package ID (optional)
              <input
                value={qtyPatchBidPackageId}
                onChange={(e) => setQtyPatchBidPackageId(e.target.value)}
                placeholder="Auto-discovers first package"
                className="mt-1 w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>

            <label className="text-xs font-bold uppercase tracking-wider text-rose-800">
              Bid Form ID (optional)
              <input
                value={qtyPatchBidFormId}
                onChange={(e) => setQtyPatchBidFormId(e.target.value)}
                placeholder="Auto-discovers first form"
                className="mt-1 w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>

            <label className="text-xs font-bold uppercase tracking-wider text-rose-800 md:col-span-2 xl:col-span-2">
              Patch Title (optional)
              <input
                value={qtyPatchTitle}
                onChange={(e) => setQtyPatchTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>

            <label className="text-xs font-bold uppercase tracking-wider text-rose-800 md:col-span-2 xl:col-span-3">
              Quantity Updates JSON (target specific line IDs)
              <textarea
                value={qtyPatchUpdatesJson}
                onChange={(e) => setQtyPatchUpdatesJson(e.target.value)}
                rows={7}
                className="mt-1 w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => runBidFormQuantityPatch(true)}
              disabled={qtyPatchLoading}
              className="px-4 py-2 rounded-lg border border-amber-300 bg-amber-100 text-amber-900 font-black text-[10px] uppercase tracking-widest hover:bg-amber-200 disabled:opacity-50"
            >
              {qtyPatchLoading ? "Working..." : "Dry Run Quantity Update"}
            </button>
            <button
              onClick={() => runBidFormQuantityPatch(false)}
              disabled={qtyPatchLoading}
              className="px-4 py-2 rounded-lg bg-rose-700 text-white font-black text-[10px] uppercase tracking-widest hover:bg-rose-800 disabled:opacity-50"
            >
              {qtyPatchLoading ? "Working..." : "Run Live Quantity Update"}
            </button>
          </div>

          {qtyPatchError && (
            <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-800">
              {qtyPatchError}
            </div>
          )}

          {qtyPatchResponse && (
            <pre className="mt-4 max-h-80 overflow-auto rounded-lg border border-rose-200 bg-white p-3 text-[11px] leading-relaxed text-gray-800">
              {JSON.stringify(qtyPatchResponse, null, 2)}
            </pre>
          )}
        </section>

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
              disabled={bulkLoading || combinedBudgetSyncLoading || checkingAuth || !procoreConnected}
              className="px-4 py-2 rounded-xl bg-emerald-700 text-white font-black text-xs uppercase tracking-widest hover:bg-emerald-800 disabled:opacity-50"
            >
              {bulkLoading ? "Syncing..." : "Sync Active Projects"}
            </button>

            <button
              onClick={syncProjectsAndBudgets}
              disabled={bulkLoading || budgetLineItemsSyncLoading || combinedBudgetSyncLoading || checkingAuth || !procoreConnected}
              className="px-4 py-2 rounded-xl bg-cyan-700 text-white font-black text-xs uppercase tracking-widest hover:bg-cyan-800 disabled:opacity-50"
            >
              {combinedBudgetSyncLoading ? "Syncing Projects + Budgets..." : "Sync Projects + Budgets"}
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

        <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5 mb-6">
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-700 mb-4">
            Project Bids Lookup
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Company ID
              <input
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Project ID
              <input
                value={projectBidsProjectId}
                onChange={(e) => setProjectBidsProjectId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <button
              onClick={fetchProjectBidsLookup}
              disabled={projectBidsLoading || checkingAuth || !procoreConnected}
              className="px-4 py-2 rounded-xl bg-sky-700 text-white font-black text-xs uppercase tracking-widest hover:bg-sky-800 disabled:opacity-50"
            >
              {projectBidsLoading ? "Fetching..." : "Fetch Project Bids"}
            </button>
            <a
              href={`/api/procore/projects/bids?projectId=${encodeURIComponent(projectBidsProjectId)}&companyId=${encodeURIComponent(companyId)}&page=1&perPage=25`}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 rounded-xl border border-sky-300 bg-white text-sky-800 font-black text-xs uppercase tracking-widest hover:bg-sky-50"
            >
              Open Raw Endpoint
            </a>
          </div>

          {projectBidsError && (
            <div className="mt-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {projectBidsError}
            </div>
          )}

          {projectBidsResponse && (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                <div>Company: <span className="font-bold">{companyId || "-"}</span></div>
                <div>Project ID: <span className="font-bold">{projectBidsProjectId || "-"}</span></div>
                <div>Fetched: <span className="font-bold">{projectBidsResponse.count ?? 0}</span></div>
                <div>Pages Fetched: <span className="font-bold">{projectBidsResponse.pagesFetched ?? 0}</span></div>
              </div>

              {projectBidsResponse.details ? (
                <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                  {projectBidsResponse.details}
                  {projectBidsResponse.hint ? ` ${projectBidsResponse.hint}` : ""}
                </div>
              ) : null}

              <pre className="max-h-80 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-800">
                {JSON.stringify(projectBidsResponse, null, 2)}
              </pre>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5 mb-6">
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-700 mb-4">
            Change Order Packages
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Company ID
              <input
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Project ID
              <input
                value={changeOrderProjectId}
                onChange={(e) => setChangeOrderProjectId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Contract ID (optional)
              <input
                value={changeOrderContractId}
                onChange={(e) => setChangeOrderContractId(e.target.value)}
                placeholder="Leave blank to auto-resolve from prime contracts"
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Status Filter CSV (optional)
              <input
                value={changeOrderStatusCsv}
                onChange={(e) => setChangeOrderStatusCsv(e.target.value)}
                placeholder="open,pending,approved"
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <button
              onClick={fetchChangeOrderPackages}
              disabled={changeOrderLoading || checkingAuth || !procoreConnected}
              className="px-4 py-2 rounded-xl bg-sky-700 text-white font-black text-xs uppercase tracking-widest hover:bg-sky-800 disabled:opacity-50"
            >
              {changeOrderLoading ? "Fetching..." : "Fetch Change Order Packages"}
            </button>
            <a
              href={`/api/procore/change-order-packages?projectId=${encodeURIComponent(changeOrderProjectId)}&companyId=${encodeURIComponent(companyId)}${changeOrderContractId.trim() ? `&contractId=${encodeURIComponent(changeOrderContractId.trim())}` : ""}${changeOrderStatusCsv.trim() ? `&status=${encodeURIComponent(changeOrderStatusCsv.trim())}` : ""}&page=1&perPage=100`}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 rounded-xl border border-sky-300 bg-white text-sky-800 font-black text-xs uppercase tracking-widest hover:bg-sky-50"
            >
              Open Raw Endpoint
            </a>
          </div>

          {changeOrderError && (
            <div className="mt-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {changeOrderError}
            </div>
          )}

          {changeOrderResponse && (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                <div>Company: <span className="font-bold">{companyId || "-"}</span></div>
                <div>Project ID: <span className="font-bold">{changeOrderProjectId || "-"}</span></div>
                <div>Contract ID: <span className="font-bold">{changeOrderResponse.contractId || "-"}</span></div>
                <div>Fetched: <span className="font-bold">{changeOrderResponse.count ?? 0}</span></div>
              </div>

              {changeOrderResponse.contractResolutionSource ? (
                <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs font-semibold text-blue-900">
                  Contract source: {changeOrderResponse.contractResolutionSource}
                  {changeOrderResponse.resolvedContract?.title
                    ? ` (${changeOrderResponse.resolvedContract.title})`
                    : ""}
                </div>
              ) : null}

              <pre className="max-h-80 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-800">
                {JSON.stringify(changeOrderResponse, null, 2)}
              </pre>
            </div>
          )}
        </section>

        {/* ─── Company-Wide Change Order Packages Sync ─── */}
        <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5 mb-6">
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-700 mb-4">
            Sync All Change Order Packages
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            Loops all projects in the feed, auto-resolves each prime contract, fetches all change order packages, and persists them to <span className="font-bold text-gray-700">procore_change_order_packages</span>.
          </p>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <button
              onClick={syncAllChangeOrderPackages}
              disabled={changeOrderSyncLoading || checkingAuth || !procoreConnected}
              className="px-4 py-2 rounded-xl bg-violet-700 text-white font-black text-xs uppercase tracking-widest hover:bg-violet-800 disabled:opacity-50"
            >
              {changeOrderSyncLoading ? "Syncing..." : "Sync All Change Order Packages"}
            </button>
          </div>

          {changeOrderSyncError && (
            <div className="mt-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {changeOrderSyncError}
            </div>
          )}

          {changeOrderSyncResponse && (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-700 grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div>Projects Scanned: <span className="font-bold">{changeOrderSyncResponse.projectsScanned ?? 0}</span></div>
                <div>With Packages: <span className="font-bold">{changeOrderSyncResponse.projectsWithPackages ?? 0}</span></div>
                <div>Packages Fetched: <span className="font-bold">{changeOrderSyncResponse.totalPackagesFetched ?? 0}</span></div>
                <div>Packages Upserted: <span className="font-bold">{changeOrderSyncResponse.totalPackagesUpserted ?? 0}</span></div>
                <div>No Contract: <span className="font-bold">{changeOrderSyncResponse.projectsSkippedNoPrimeContract ?? 0}</span></div>
                <div>Skipped (Access): <span className="font-bold">{changeOrderSyncResponse.projectsSkippedAccess ?? 0}</span></div>
                <div>Errors: <span className="font-bold">{changeOrderSyncResponse.errors?.length ?? 0}</span></div>
                <div>Warnings: <span className="font-bold">{changeOrderSyncResponse.warnings?.length ?? 0}</span></div>
              </div>

              {changeOrderSyncResponse.warnings?.length ? (
                <div className="mb-3 rounded-xl border border-yellow-300 bg-yellow-50 p-3 text-xs font-semibold text-yellow-900">
                  {changeOrderSyncResponse.warnings.length} warning(s). First: {changeOrderSyncResponse.warnings[0]}
                </div>
              ) : null}

              {changeOrderSyncResponse.errors?.length ? (
                <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                  {changeOrderSyncResponse.errors.length} error(s). First: {changeOrderSyncResponse.errors[0]}
                </div>
              ) : null}

              {changeOrderSyncResponse.activeProjects?.length ? (
                <div className="mt-3">
                  <div className="text-xs font-black uppercase tracking-widest text-gray-500 mb-2">Projects with Packages</div>
                  <div className="max-h-60 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1">
                    {changeOrderSyncResponse.activeProjects.map((p) => (
                      <div key={p.projectId} className="text-xs text-gray-700 flex gap-4">
                        <span className="font-bold">{p.projectId}</span>
                        <span>contract: {p.contractId}</span>
                        <span>{p.packageCount} fetched / {p.upsertedCount} upserted</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
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

          <div className="mt-6 border-t border-gray-200 pt-5">
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 mb-3">
              Custom Field User Options (Project Tool)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-4">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Project ID
                <input
                  value={userOptionsProjectId}
                  onChange={(e) => setUserOptionsProjectId(e.target.value)}
                  placeholder={userOptionsAllProjects ? "Ignored in All Projects mode" : "Required"}
                  disabled={userOptionsAllProjects}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>

              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Tool Name
                <input
                  value={userOptionsToolName}
                  onChange={(e) => setUserOptionsToolName(e.target.value)}
                  placeholder="rfis, submittals, commitments, ..."
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
                <div className="mt-1 text-[10px] font-semibold normal-case tracking-normal text-gray-500">
                  Note: this endpoint does not accept "projects" as tool name. Use the specific Procore tool key.
                </div>
              </label>

              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Search (optional)
                <input
                  value={userOptionsSearch}
                  onChange={(e) => setUserOptionsSearch(e.target.value)}
                  placeholder="Preferred"
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>

              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Page
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={userOptionsPage}
                  onChange={(e) => setUserOptionsPage(Math.min(1000, Math.max(1, Number(e.target.value || "1"))))}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>

              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Per Page
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={userOptionsPerPage}
                  onChange={(e) => setUserOptionsPerPage(Math.min(1000, Math.max(1, Number(e.target.value || "100"))))}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>

              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Max Projects (All Projects mode)
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={userOptionsLimitProjects}
                  onChange={(e) => setUserOptionsLimitProjects(Math.min(250, Math.max(1, Number(e.target.value || "250"))))}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-4 mb-4">
              <label className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-700">
                <input
                  type="checkbox"
                  checked={userOptionsAllProjects}
                  onChange={(e) => setUserOptionsAllProjects(e.target.checked)}
                />
                Pull All Projects
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-4">
              <button
                onClick={fetchCustomFieldUserOptions}
                disabled={userOptionsLoading || checkingAuth || !procoreConnected}
                className="px-4 py-2 rounded-xl bg-pink-700 text-white font-black text-xs uppercase tracking-widest hover:bg-pink-800 disabled:opacity-50"
              >
                {userOptionsLoading ? "Fetching..." : userOptionsAllProjects ? "Fetch User Options (All Projects)" : "Fetch User Options"}
              </button>
            </div>

            {userOptionsError && (
              <div className="mt-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
                {userOptionsError}
              </div>
            )}

            {userOptionsResponse && (
              <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
                <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-3">
                  <div>Company: <span className="font-bold">{userOptionsResponse.companyId || "-"}</span></div>
                  <div>Mode: <span className="font-bold">{userOptionsResponse.allProjects ? "All Projects" : "Single Project"}</span></div>
                  <div>Project ID: <span className="font-bold">{userOptionsResponse.allProjects ? "ALL" : userOptionsResponse.projectId || "-"}</span></div>
                  <div>Tool: <span className="font-bold">{userOptionsResponse.toolName || "-"}</span></div>
                  <div>Search: <span className="font-bold">{userOptionsResponse.search || "-"}</span></div>
                  <div>Page: <span className="font-bold">{userOptionsResponse.page ?? 1}</span></div>
                  <div>Count: <span className="font-bold">{userOptionsResponse.count ?? 0}</span></div>
                </div>

                {userOptionsResponse.allProjects ? (
                  <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-3">
                    <div>Projects Scanned: <span className="font-bold">{userOptionsResponse.projectsScanned ?? 0}</span></div>
                    <div>Projects Succeeded: <span className="font-bold">{userOptionsResponse.projectsSucceeded ?? 0}</span></div>
                    <div>Projects Failed: <span className="font-bold">{userOptionsResponse.projectsFailed ?? 0}</span></div>
                    <div>Total Options Fetched: <span className="font-bold">{userOptionsResponse.totalOptionsFetched ?? 0}</span></div>
                    <div>Unique Options: <span className="font-bold">{userOptionsResponse.uniqueOptions ?? 0}</span></div>
                    <div>Project Limit: <span className="font-bold">{userOptionsResponse.limitProjects ?? 0}</span></div>
                  </div>
                ) : null}

                {userOptionsResponse.errors?.length ? (
                  <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                    {userOptionsResponse.errors.length} project errors. First: {userOptionsResponse.errors[0].projectId} - {userOptionsResponse.errors[0].error}
                  </div>
                ) : null}

                {userOptionsResponse.data?.length ? (
                  <div className="overflow-x-auto rounded-xl border border-gray-200 mb-3">
                    <table className="min-w-[840px] w-full border-collapse">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          {['id', 'name', 'active', 'value'].map((label) => (
                            <th key={label} className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-wider text-gray-600">
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {userOptionsResponse.data.slice(0, 25).map((row, index) => (
                          <tr key={`${String(row.id ?? index)}-${index}`} className="border-b border-gray-100">
                            <td className="px-3 py-2 text-sm text-gray-800 font-semibold">{String(row.id ?? "-")}</td>
                            <td className="px-3 py-2 text-sm text-gray-800">{String(row.name ?? "-")}</td>
                            <td className="px-3 py-2 text-sm text-gray-800">{typeof row.active === "boolean" ? (row.active ? "Yes" : "No") : "-"}</td>
                            <td className="px-3 py-2 text-sm text-gray-800">{String(row.value ?? "-")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <pre className="max-h-72 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 whitespace-pre-wrap break-all">
                  {JSON.stringify(userOptionsResponse.raw ?? userOptionsResponse.data ?? {}, null, 2)}
                </pre>
              </div>
            )}
          </div>

          <div className="mt-6 border-t border-gray-200 pt-5">
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 mb-3">
              Configurable Field Sets (Project)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-4">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Project ID
                <input
                  value={cfgProjectId}
                  onChange={(e) => setCfgProjectId(e.target.value)}
                  placeholder="Required"
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>

              <label className="text-xs font-bold uppercase tracking-wider text-gray-600 md:col-span-2 xl:col-span-2">
                Types (comma-separated)
                <input
                  value={cfgTypes}
                  onChange={(e) => setCfgTypes(e.target.value)}
                  placeholder="ConfigurableFieldSet::PurchaseOrderContract"
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>

              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Page
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={cfgPage}
                  onChange={(e) => setCfgPage(Math.min(1000, Math.max(1, Number(e.target.value || "1"))))}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>

              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Per Page
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={cfgPerPage}
                  onChange={(e) => setCfgPerPage(Math.min(1000, Math.max(1, Number(e.target.value || "100"))))}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-4">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                generic_tool_id (optional)
                <input
                  value={cfgGenericToolId}
                  onChange={(e) => setCfgGenericToolId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>

              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                action_plan_type_id (optional)
                <input
                  value={cfgActionPlanTypeId}
                  onChange={(e) => setCfgActionPlanTypeId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>

              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                inspection_type_id (optional)
                <input
                  value={cfgInspectionTypeId}
                  onChange={(e) => setCfgInspectionTypeId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>

              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                observations_category_id (optional)
                <input
                  value={cfgObservationsCategoryId}
                  onChange={(e) => setCfgObservationsCategoryId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>

              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                category (optional)
                <input
                  value={cfgCategory}
                  onChange={(e) => setCfgCategory(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-4 mb-4">
              <label className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-700">
                <input
                  type="checkbox"
                  checked={cfgIncludeLovEntries}
                  onChange={(e) => setCfgIncludeLovEntries(e.target.checked)}
                />
                include_lov_entries
              </label>
              <label className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-700">
                <input
                  type="checkbox"
                  checked={cfgIncludeDefaults}
                  onChange={(e) => setCfgIncludeDefaults(e.target.checked)}
                />
                include_default_configurable_field_sets
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-4">
              <button
                onClick={fetchConfigurableFieldSets}
                disabled={cfgLoading || checkingAuth || !procoreConnected}
                className="px-4 py-2 rounded-xl bg-indigo-700 text-white font-black text-xs uppercase tracking-widest hover:bg-indigo-800 disabled:opacity-50"
              >
                {cfgLoading ? "Fetching..." : "Fetch Configurable Field Sets"}
              </button>
            </div>

            {cfgError && (
              <div className="mt-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
                {cfgError}
              </div>
            )}

            {cfgResponse && (
              <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
                <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-3">
                  <div>Company: <span className="font-bold">{cfgResponse.companyId || "-"}</span></div>
                  <div>Project ID: <span className="font-bold">{cfgResponse.projectId || "-"}</span></div>
                  <div>Count: <span className="font-bold">{cfgResponse.count ?? 0}</span></div>
                  <div>Page: <span className="font-bold">{cfgResponse.page ?? 1}</span></div>
                  <div>Per Page: <span className="font-bold">{cfgResponse.perPage ?? 100}</span></div>
                  <div>Include LOV: <span className="font-bold">{cfgResponse.includeLovEntries ? "Yes" : "No"}</span></div>
                </div>

                {cfgResponse.data?.length ? (
                  <div className="overflow-x-auto rounded-xl border border-gray-200 mb-3">
                    <table className="min-w-[840px] w-full border-collapse">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          {['id', 'name', 'category', 'type', 'source'].map((label) => (
                            <th key={label} className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-wider text-gray-600">
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cfgResponse.data.slice(0, 25).map((row, index) => (
                          <tr key={`${String(row.id ?? index)}-${index}`} className="border-b border-gray-100">
                            <td className="px-3 py-2 text-sm text-gray-800 font-semibold">{String(row.id ?? "-")}</td>
                            <td className="px-3 py-2 text-sm text-gray-800">{String(row.name ?? "-")}</td>
                            <td className="px-3 py-2 text-sm text-gray-800">{String(row.category ?? "-")}</td>
                            <td className="px-3 py-2 text-sm text-gray-800">{String(row.type ?? "-")}</td>
                            <td className="px-3 py-2 text-sm text-gray-800">{String(row.source ?? "-")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <pre className="max-h-72 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 whitespace-pre-wrap break-all">
                  {JSON.stringify(cfgResponse.raw ?? cfgResponse.data ?? {}, null, 2)}
                </pre>
              </div>
            )}
          </div>

          <div className="mt-6 border-t border-gray-200 pt-5">
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 mb-3">
              Available Configurable Field Sets (Company)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Page
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={cfgListPage}
                  onChange={(e) => setCfgListPage(Math.min(1000, Math.max(1, Number(e.target.value || "1"))))}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Per Page
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={cfgListPerPage}
                  onChange={(e) => setCfgListPerPage(Math.min(1000, Math.max(1, Number(e.target.value || "100"))))}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
              <label className="text-xs font-bold uppercase tracking-wider text-gray-600 md:col-span-2">
                Search Value In Payload (optional)
                <input
                  value={cfgListSearchValue}
                  onChange={(e) => setCfgListSearchValue(e.target.value)}
                  placeholder="Hoover Building Specialists, Inc"
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-4">
              <button
                onClick={fetchAvailableConfigurableFieldSets}
                disabled={cfgListLoading || checkingAuth || !procoreConnected}
                className="px-4 py-2 rounded-xl bg-green-700 text-white font-black text-xs uppercase tracking-widest hover:bg-green-800 disabled:opacity-50"
              >
                {cfgListLoading ? "Fetching..." : "Fetch Available Configurable Field Sets"}
              </button>
            </div>

            {cfgListError && (
              <div className="mt-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
                {cfgListError}
              </div>
            )}

            {cfgListResponse && (
              <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
                <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-3">
                  <div>Company: <span className="font-bold">{cfgListResponse.companyId || "-"}</span></div>
                  <div>Count: <span className="font-bold">{cfgListResponse.count ?? 0}</span></div>
                  <div>Page: <span className="font-bold">{cfgListResponse.page ?? 1}</span></div>
                  <div>Per Page: <span className="font-bold">{cfgListResponse.perPage ?? 100}</span></div>
                  <div>Search Value: <span className="font-bold">{cfgListResponse.searchValue || "-"}</span></div>
                  <div>Matches: <span className="font-bold">{cfgListResponse.totalMatchCount ?? 0}</span></div>
                </div>

                {cfgListResponse.searchResults?.length ? (
                  <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                    <div className="font-black uppercase tracking-wider mb-2">Search Matches</div>
                    <div className="space-y-2 max-h-56 overflow-auto">
                      {(cfgListResponse.searchResults ?? []).map((row, idx) => (
                        <div key={`${String(row.id ?? idx)}-${idx}`} className="rounded-lg border border-blue-200 bg-white p-2">
                          <div className="font-bold">{String(row.name ?? "-")} (id: {String(row.id ?? "-")})</div>
                          <div className="text-[11px]">Match Count: {row.matchCount}</div>
                          {row.matches.map((m, i) => (
                            <div key={`${m.path}-${i}`} className="text-[11px] font-mono break-all">
                              {m.path}: {m.value}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {cfgListResponse.data?.length ? (
                  <div className="overflow-x-auto rounded-xl border border-gray-200 mb-3">
                    <table className="min-w-[840px] w-full border-collapse">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          {['id', 'name', 'category', 'type', 'fields'].map((label) => (
                            <th key={label} className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-wider text-gray-600">
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(cfgListResponse.unpacked ?? cfgListResponse.data ?? []).map((row, index) => (
                          <tr key={`${String(row.id ?? index)}-${index}`} className="border-b border-gray-100">
                            <td className="px-3 py-2 text-sm text-gray-800 font-semibold">{String(row.id ?? "-")}</td>
                            <td className="px-3 py-2 text-sm text-gray-800">{String(row.name ?? "-")}</td>
                            <td className="px-3 py-2 text-sm text-gray-800">{String(row.category ?? "-")}</td>
                            <td className="px-3 py-2 text-sm text-gray-800">{String(row.type ?? "-")}</td>
                            <td className="px-3 py-2 text-sm text-gray-800">{String(row.configurableFieldCount ?? "-")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-gray-600">
                  Unpacked Payloads
                </div>

                <pre className="max-h-72 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 whitespace-pre-wrap break-all">
                  {JSON.stringify(cfgListResponse.unpacked ?? cfgListResponse.raw ?? cfgListResponse.data ?? {}, null, 2)}
                </pre>
              </div>
            )}
          </div>

          <div className="mt-6 border-t border-gray-200 pt-5">
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 mb-3">
              Configurable Field Set By ID (Company)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Configurable Field Set ID
                <input
                  value={cfgByIdFieldSetId}
                  onChange={(e) => setCfgByIdFieldSetId(e.target.value)}
                  placeholder="Required"
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-4">
              <button
                onClick={fetchConfigurableFieldSetById}
                disabled={cfgByIdLoading || checkingAuth || !procoreConnected}
                className="px-4 py-2 rounded-xl bg-violet-700 text-white font-black text-xs uppercase tracking-widest hover:bg-violet-800 disabled:opacity-50"
              >
                {cfgByIdLoading ? "Fetching..." : "Fetch Configurable Field Set By ID"}
              </button>
            </div>

            {cfgByIdError && (
              <div className="mt-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
                {cfgByIdError}
              </div>
            )}

            {cfgByIdResponse && (
              <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
                <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
                  <div>Company: <span className="font-bold">{cfgByIdResponse.companyId || "-"}</span></div>
                  <div>Field Set ID: <span className="font-bold">{cfgByIdResponse.fieldSetId || "-"}</span></div>
                  <div>Name: <span className="font-bold">{String(cfgByIdResponse.unpacked?.name ?? cfgByIdResponse.data?.name ?? "-")}</span></div>
                  <div>Type: <span className="font-bold">{String(cfgByIdResponse.unpacked?.type ?? cfgByIdResponse.data?.type ?? "-")}</span></div>
                  <div>Fields: <span className="font-bold">{String(cfgByIdResponse.unpacked?.configurableFieldCount ?? "-")}</span></div>
                  <div>Projects: <span className="font-bold">{String(cfgByIdResponse.unpacked?.projectsCount ?? "-")}</span></div>
                  <div>Deletable: <span className="font-bold">{String(cfgByIdResponse.unpacked?.deletable ?? "-")}</span></div>
                  <div>Updated At: <span className="font-bold">{String(cfgByIdResponse.unpacked?.updatedAt ?? "-")}</span></div>
                  <div>Updated By Login: <span className="font-bold">{String((cfgByIdResponse.unpacked?.updatedBy as { login?: unknown } | undefined)?.login ?? "-")}</span></div>
                  <div>Inspection Type ID: <span className="font-bold">{String(cfgByIdResponse.unpacked?.inspectionTypeId ?? "-")}</span></div>
                  <div>Generic Tool ID: <span className="font-bold">{String(cfgByIdResponse.unpacked?.genericToolId ?? "-")}</span></div>
                  <div>Action Plan Type ID: <span className="font-bold">{String(cfgByIdResponse.unpacked?.actionPlanTypeId ?? "-")}</span></div>
                  <div>Observations Category ID: <span className="font-bold">{String(cfgByIdResponse.unpacked?.observationsCategoryId ?? "-")}</span></div>
                </div>

                <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-gray-600">
                  Unpacked Payload
                </div>

                <pre className="max-h-72 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 whitespace-pre-wrap break-all">
                  {JSON.stringify(cfgByIdResponse.unpacked ?? cfgByIdResponse.raw ?? cfgByIdResponse.data ?? {}, null, 2)}
                </pre>
              </div>
            )}
          </div>

          <div className="mt-6 border-t border-gray-200 pt-5">
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 mb-3">
              Company Users (Contractor Lookup)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Search (optional)
                <input
                  value={companyUsersSearch}
                  onChange={(e) => setCompanyUsersSearch(e.target.value)}
                  placeholder="carl.contractor@example.com"
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Page
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={companyUsersPage}
                  onChange={(e) => setCompanyUsersPage(Math.min(1000, Math.max(1, Number(e.target.value || "1"))))}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Per Page
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={companyUsersPerPage}
                  onChange={(e) => setCompanyUsersPerPage(Math.min(1000, Math.max(1, Number(e.target.value || "100"))))}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-4">
              <button
                onClick={fetchCompanyUsers}
                disabled={companyUsersLoading || checkingAuth || !procoreConnected}
                className="px-4 py-2 rounded-xl bg-teal-700 text-white font-black text-xs uppercase tracking-widest hover:bg-teal-800 disabled:opacity-50"
              >
                {companyUsersLoading ? "Fetching..." : "Fetch Company Users"}
              </button>
            </div>

            {companyUsersError && (
              <div className="mt-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
                {companyUsersError}
              </div>
            )}

            {companyUsersResponse && (
              <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
                <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-3">
                  <div>Company: <span className="font-bold">{companyUsersResponse.companyId || "-"}</span></div>
                  <div>Count: <span className="font-bold">{companyUsersResponse.count ?? 0}</span></div>
                  <div>Page: <span className="font-bold">{companyUsersResponse.page ?? 1}</span></div>
                  <div>Per Page: <span className="font-bold">{companyUsersResponse.perPage ?? 100}</span></div>
                  <div>Search: <span className="font-bold">{companyUsersResponse.search || "-"}</span></div>
                </div>

                {companyUsersResponse.data?.length ? (
                  <div className="overflow-x-auto rounded-xl border border-gray-200 mb-3">
                    <table className="min-w-[840px] w-full border-collapse">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          {['id', 'login', 'name', 'company_name'].map((label) => (
                            <th key={label} className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-wider text-gray-600">
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {companyUsersResponse.data.map((row, index) => (
                          <tr key={`${String(row.id ?? index)}-${index}`} className="border-b border-gray-100">
                            <td className="px-3 py-2 text-sm text-gray-800 font-semibold">{String(row.id ?? "-")}</td>
                            <td className="px-3 py-2 text-sm text-gray-800">{String(row.login ?? "-")}</td>
                            <td className="px-3 py-2 text-sm text-gray-800">{String(row.name ?? "-")}</td>
                            <td className="px-3 py-2 text-sm text-gray-800">{String(row.company_name ?? "-")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <pre className="max-h-72 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 whitespace-pre-wrap break-all">
                  {JSON.stringify(companyUsersResponse.data ?? companyUsersResponse.raw ?? {}, null, 2)}
                </pre>
              </div>
            )}
          </div>

          <div className="mt-6 border-t border-gray-200 pt-5">
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 mb-3">
              Project Payload By ID (v1.0)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Project ID
                <input
                  value={projectShowId}
                  onChange={(e) => setProjectShowId(e.target.value)}
                  placeholder="Required"
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                View
                <select
                  value={projectShowView}
                  onChange={(e) => setProjectShowView(e.target.value === "minimal" ? "minimal" : "full")}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                >
                  <option value="full">full</option>
                  <option value="minimal">minimal</option>
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-4">
              <button
                onClick={fetchProjectShowPayload}
                disabled={projectShowLoading || checkingAuth || !procoreConnected}
                className="px-4 py-2 rounded-xl bg-cyan-700 text-white font-black text-xs uppercase tracking-widest hover:bg-cyan-800 disabled:opacity-50"
              >
                {projectShowLoading ? "Fetching..." : "Fetch Project Payload"}
              </button>
            </div>

            {projectShowError && (
              <div className="mt-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
                {projectShowError}
              </div>
            )}

            {projectShowResponse && (
              <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
                <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3 mb-3">
                  <div>Company: <span className="font-bold">{projectShowResponse.companyId || "-"}</span></div>
                  <div>Project ID: <span className="font-bold">{projectShowResponse.projectId || "-"}</span></div>
                  <div>View: <span className="font-bold">{projectShowResponse.view || "-"}</span></div>
                  <div>Name: <span className="font-bold">{String(projectShowResponse.data?.name ?? "-")}</span></div>
                  <div>Display Name: <span className="font-bold">{String(projectShowResponse.data?.display_name ?? "-")}</span></div>
                  <div>Project Number: <span className="font-bold">{String(projectShowResponse.data?.project_number ?? "-")}</span></div>
                </div>

                <pre className="max-h-72 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 whitespace-pre-wrap break-all">
                  {JSON.stringify(projectShowResponse.data ?? projectShowResponse.raw ?? {}, null, 2)}
                </pre>
              </div>
            )}
          </div>

          <div className="mt-6 border-t border-gray-200 pt-5">
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 mb-3">
              Project Vendors (All Projects)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Max Projects
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={projectVendorsLimitProjects}
                  onChange={(e) =>
                    setProjectVendorsLimitProjects(Math.min(10000, Math.max(1, Number(e.target.value || "1000"))))
                  }
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-4">
              <button
                onClick={syncProjectVendors}
                disabled={projectVendorsLoading || checkingAuth || !procoreConnected}
                className="px-4 py-2 rounded-xl bg-orange-700 text-white font-black text-xs uppercase tracking-widest hover:bg-orange-800 disabled:opacity-50"
              >
                {projectVendorsLoading ? "Syncing..." : "Sync All Project Vendors"}
              </button>
            </div>

            {projectVendorsError && (
              <div className="mt-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
                {projectVendorsError}
              </div>
            )}

            {projectVendorsResponse && (
              <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
                <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 mb-3">
                  <div>Company: <span className="font-bold">{projectVendorsResponse.data?.companyId || '-'}</span></div>
                  <div>Projects Scanned: <span className="font-bold">{projectVendorsResponse.data?.projectsScanned ?? 0}</span></div>
                  <div>Projects Synced: <span className="font-bold">{projectVendorsResponse.data?.projectsSynced ?? 0}</span></div>
                  <div>Fetched: <span className="font-bold">{projectVendorsResponse.data?.fetched ?? 0}</span></div>
                  <div>Upserted: <span className="font-bold">{projectVendorsResponse.data?.upserted ?? 0}</span></div>
                </div>

                <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <div>Skipped (Access): <span className="font-bold">{projectVendorsResponse.data?.projectsSkippedAccess ?? 0}</span></div>
                  <div>Project Limit: <span className="font-bold">{projectVendorsResponse.data?.projectsLimit ?? 0}</span></div>
                  <div>Feed Customers Updated: <span className="font-bold">{projectVendorsResponse.data?.feedCustomersUpdated ?? 0}</span></div>
                  <div>API Versions: <span className="font-bold">{projectVendorsResponse.data?.apiVersionsUsed?.join(', ') || '-'}</span></div>
                </div>

                {projectVendorsResponse.data?.warnings?.length ? (
                  <div className="mb-3 rounded-xl border border-yellow-300 bg-yellow-50 p-3 text-xs font-semibold text-yellow-900">
                    {projectVendorsResponse.data.warnings.length} warnings. First: {projectVendorsResponse.data.warnings[0]}
                  </div>
                ) : null}

                {projectVendorsResponse.data?.errors?.length ? (
                  <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                    {projectVendorsResponse.data.errors.length} errors. First: {projectVendorsResponse.data.errors[0]}
                  </div>
                ) : null}

                {projectVendorsResponse.data?.sampleVendors?.length ? (
                  <div className="overflow-x-auto rounded-xl border border-gray-200">
                    <table className="min-w-[840px] w-full border-collapse">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          {['Project ID', 'Vendor ID', 'Vendor Name'].map((label) => (
                            <th key={label} className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-wider text-gray-600">
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {projectVendorsResponse.data.sampleVendors.map((vendor, index) => (
                          <tr key={`${vendor.projectId}-${vendor.vendorId}-${index}`} className="border-b border-gray-100">
                            <td className="px-3 py-2 text-sm text-gray-800">{vendor.projectId}</td>
                            <td className="px-3 py-2 text-sm text-gray-800 font-semibold">{vendor.vendorId}</td>
                            <td className="px-3 py-2 text-sm text-gray-800">{vendor.name || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            )}
          </div>

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
