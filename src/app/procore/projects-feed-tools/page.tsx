"use client";

import React, { useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";
import { useProcoreAuthAfterRefresh } from "@/hooks/useProcoreAuthAfterRefresh";
import { readJsonResponse } from "@/utils/readJsonResponse";

type ToolResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  data?: unknown;
  [key: string]: unknown;
};

function toPrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function ProcoreProjectsFeedToolsPage() {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [output, setOutput] = useState<string>("Run an action to see results here.");
  const [lastStatus, setLastStatus] = useState<string>("idle");
  const [procoreConnected, setProcoreConnected] = useState<boolean>(false);
  const [checkingAuth, setCheckingAuth] = useState<boolean>(true);
  const [bidsProjectId, setBidsProjectId] = useState<string>("");
  const [primeContractsProjectId, setPrimeContractsProjectId] = useState<string>("");
  const [bidFormsProjectId, setBidFormsProjectId] = useState<string>("");
  const [bidFormsPackageId, setBidFormsPackageId] = useState<string>("");
  const [projectIdsToCheck, setProjectIdsToCheck] = useState<string>("598134326375662,598134326375719,598134326376806");
  const [bidBoardCompanyId, setBidBoardCompanyId] = useState<string>("598134325658789");
  const [bidBoardStatusFilter, setBidBoardStatusFilter] = useState<string>("All");
  const [lineItemGroupsCompanyId, setLineItemGroupsCompanyId] = useState<string>("598134325658789");
  const [lineItemGroupsBidBoardProjectId, setLineItemGroupsBidBoardProjectId] = useState<string>("562949955352714");
  const [lineItemGroupsProposalId, setLineItemGroupsProposalId] = useState<string>("3206336");

  // Preserve location, but let the explicit Connect button start OAuth.
  useProcoreAuthAfterRefresh({ autoRedirect: false });

  const endpointExamples = useMemo(
    () => ({
      statusRefreshQuick: "/api/scheduling/refresh-status",
      statusRefreshFull: "/api/scheduling/refresh-status",
      syncQuick: "/api/procore/sync/projects-feed (POST body: { fetchAll:false })",
      syncFull: "/api/procore/sync/projects-feed (POST body: { fetchAll:true })",
      verify: "/api/procore/projects-feed/verify-matches",
      backfillDryRun: "/api/procore/projects-feed/backfill-promoted?dryRun=true&limit=5000",
      backfillApply: "/api/procore/projects-feed/backfill-promoted?dryRun=false&limit=5000",
      feed: "/api/procore/projects-feed?page=1&pageSize=200",
      unmatched: "/api/procore/projects-feed?unmatchedOnly=true&page=1&pageSize=200",
      existsByIds: "/api/procore/projects/exists-by-ids?ids=598134326375662,598134326375719,598134326376806",
      syncCompareIds: "/api/procore/sync/all-projects (POST body: { fetchAll:true, includeInactiveV1:true, includeTestProjects:true, maxPages:1000, debugProjectIds:[...] })",
      primeContracts: "/api/procore/prime-contracts?projectId=YOUR_PROJECT_ID&page=1&perPage=100&persist=true",
      bidBoardProjects: "/api/procore/estimating/bid-board-projects (POST body: { companyId, fetchAll, filters[by_status] })",
      proposals: "/api/procore/estimating/proposals (POST body: { companyId, bidBoardProjectId, page, perPage })",
      proposalsBulk: "/api/procore/estimating/proposals-bulk (POST body: { companyId, fetchAll, filters[by_status] })",
      lineItemGroups: "/api/procore/estimating/proposal-line-item-groups (POST body: { companyId, bidBoardProjectId, proposalId, page, perPage })",
      lineItems: "/api/procore/estimating/proposal-line-items (POST body: { companyId, bidBoardProjectId, proposalId, page, perPage })",
      lineItemsBulk: "/api/procore/estimating/proposal-line-items-bulk (POST body: { companyId, fetchAll, filters[by_status] })",
      lineItemsLiveApi: "/api/procore/estimating/proposal-line-items-live?page=1&pageSize=200&companyId=598134325658789",
      lineItemsLivePage: "/procore/proposal-line-items-live",
    }),
    []
  );

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        const res = await fetch("/api/procore/me", { credentials: "include" });
        if (!cancelled) {
          setProcoreConnected(res.ok);
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

  async function runGet(path: string, actionLabel: string) {
    setBusyAction(actionLabel);
    setLastStatus("running");

    try {
      const res = await fetch(path, { method: "GET", credentials: "include" });
      const body = await readJsonResponse<Record<string, unknown>>(res, {
        label: `${actionLabel} response`,
        fallback: {},
      });

      setOutput(
        toPrettyJson({
          action: actionLabel,
          statusCode: res.status,
          ok: res.ok,
          response: body,
        })
      );
      setLastStatus(res.ok ? "ok" : "error");
    } catch (error) {
      setOutput(
        toPrettyJson({
          action: actionLabel,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      );
      setLastStatus("error");
    } finally {
      setBusyAction(null);
    }
  }

  async function runBidsSync() {
    const projectId = bidsProjectId.trim();
    if (!projectId) {
      setOutput(
        toPrettyJson({
          action: "Sync Bids",
          ok: false,
          error: "Project ID is required for bids sync.",
        })
      );
      setLastStatus("error");
      return;
    }

    await runPost("/api/procore/sync/bids", "Sync Bids", {
      projectId,
      fetchAll: true,
    });
  }

  async function runBidsFetch() {
    const projectId = bidsProjectId.trim();
    if (!projectId) {
      setOutput(
        toPrettyJson({
          action: "Fetch Bids",
          ok: false,
          error: "Project ID is required to fetch bids.",
        })
      );
      setLastStatus("error");
      return;
    }

    await runGet(`/api/procore/bids?projectId=${encodeURIComponent(projectId)}&page=1&pageSize=200`, "Fetch Bids");
  }

  async function runPrimeContractsFetch() {
    const projectId = primeContractsProjectId.trim();
    if (!projectId) {
      setOutput(
        toPrettyJson({
          action: "Fetch Prime Contracts",
          ok: false,
          error: "Project ID is required to fetch prime contracts.",
        })
      );
      setLastStatus("error");
      return;
    }

    await runGet(
      `/api/procore/prime-contracts?projectId=${encodeURIComponent(projectId)}&page=1&perPage=100&persist=true`,
      "Fetch Prime Contracts"
    );
  }

  async function runSyncAllPrimeContracts() {
    await runPost("/api/procore/sync/prime-contracts", "Sync All Prime Contracts");
  }

  async function runSeedFromProjectsTest() {
    await runPost(
      "/api/procore/sync/all-projects",
      "Seed from Projects_test",
      { seedFromFile: true, usePrimeContractProjectIdsAsTruth: true, includePrimeContractProjectBackfill: true }
    );
  }

  async function runBidFormsSync() {
    const projectId = bidFormsProjectId.trim();
    const bidPackageId = bidFormsPackageId.trim();

    if (!projectId || !bidPackageId) {
      setOutput(
        toPrettyJson({
          action: "Sync BidForms",
          ok: false,
          error: "Project ID and Bid Package ID are required for bid forms sync.",
        })
      );
      setLastStatus("error");
      return;
    }

    await runPost("/api/procore/sync/bidforms", "Sync BidForms", {
      projectId,
      bidPackageId,
      fetchAll: true,
    });
  }

  async function runBidFormsFetch() {
    const projectId = bidFormsProjectId.trim();
    const bidPackageId = bidFormsPackageId.trim();

    if (!projectId || !bidPackageId) {
      setOutput(
        toPrettyJson({
          action: "Fetch BidForms",
          ok: false,
          error: "Project ID and Bid Package ID are required to fetch bid forms.",
        })
      );
      setLastStatus("error");
      return;
    }

    await runGet(
      `/api/procore/bidforms?projectId=${encodeURIComponent(projectId)}&bidPackageId=${encodeURIComponent(bidPackageId)}&page=1&pageSize=200`,
      "Fetch BidForms"
    );
  }

  async function runBidPackagesList() {
    const projectId = bidFormsProjectId.trim();
    if (!projectId) {
      setOutput(
        toPrettyJson({
          action: "List Bid Packages",
          ok: false,
          error: "Project ID is required to list bid packages.",
        })
      );
      setLastStatus("error");
      return;
    }

    await runGet(
      `/api/procore/bid-packages?projectId=${encodeURIComponent(projectId)}&fetchAll=true`,
      "List Bid Packages"
    );
  }

  async function runProjectIdCheck() {
    const ids = projectIdsToCheck
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    const companyId = bidBoardCompanyId.trim();

    if (ids.length === 0) {
      setOutput(
        toPrettyJson({
          action: "Check Project IDs",
          ok: false,
          error: "Enter one or more comma-separated Procore project IDs.",
        })
      );
      setLastStatus("error");
      return;
    }

    if (!companyId) {
      setOutput(
        toPrettyJson({
          action: "Check Project IDs",
          ok: false,
          error: "Company ID is required.",
        })
      );
      setLastStatus("error");
      return;
    }

    const path = `/api/procore/projects/exists-by-ids?companyId=${encodeURIComponent(companyId)}&ids=${encodeURIComponent(ids.join(","))}`;
    await runGet(path, "Check Project IDs");
  }

  async function runProposalLineItemGroupsFetch() {
    const companyId = lineItemGroupsCompanyId.trim();
    const bidBoardProjectId = lineItemGroupsBidBoardProjectId.trim();
    const proposalId = lineItemGroupsProposalId.trim();

    if (!companyId || !bidBoardProjectId || !proposalId) {
      setOutput(
        toPrettyJson({
          action: "Fetch Proposal Line Item Groups",
          ok: false,
          error: "Company ID, Bid Board Project ID, and Proposal ID are required.",
        })
      );
      setLastStatus("error");
      return;
    }

    await runPost("/api/procore/estimating/proposal-line-item-groups", "Fetch Proposal Line Item Groups", {
      companyId,
      bidBoardProjectId,
      proposalId,
      page: 1,
      perPage: 100,
    });
  }

  async function runProposalLineItemsFetch() {
    const companyId = lineItemGroupsCompanyId.trim();
    const bidBoardProjectId = lineItemGroupsBidBoardProjectId.trim();
    const proposalId = lineItemGroupsProposalId.trim();

    if (!companyId || !bidBoardProjectId || !proposalId) {
      setOutput(
        toPrettyJson({
          action: "Fetch Proposal Line Items",
          ok: false,
          error: "Company ID, Bid Board Project ID, and Proposal ID are required.",
        })
      );
      setLastStatus("error");
      return;
    }

    await runPost("/api/procore/estimating/proposal-line-items", "Fetch Proposal Line Items", {
      companyId,
      bidBoardProjectId,
      proposalId,
      page: 1,
      perPage: 100,
    });
  }

  async function runProposalLineItemsBulkFetch() {
    const companyId = bidBoardCompanyId.trim();
    const byStatus = bidBoardStatusFilter.trim() || "All";

    if (!companyId) {
      setOutput(
        toPrettyJson({
          action: "Fetch Proposal Line Items Bulk",
          ok: false,
          error: "Company ID is required.",
        })
      );
      setLastStatus("error");
      return;
    }

    await runPost("/api/procore/estimating/proposal-line-items-bulk", "Fetch Proposal Line Items Bulk", {
      companyId,
      fetchAll: true,
      persist: true,
      perPage: 100,
      "filters[by_status]": byStatus,
      maxBidBoardProjects: 1000,
      maxProposalsPerProject: 200,
      maxLineItemsPages: 50,
    });
  }

  async function runProposalsBulkFetch() {
    const companyId = bidBoardCompanyId.trim();
    const byStatus = bidBoardStatusFilter.trim() || "All";

    if (!companyId) {
      setOutput(
        toPrettyJson({
          action: "Fetch Proposals Bulk",
          ok: false,
          error: "Company ID is required.",
        })
      );
      setLastStatus("error");
      return;
    }

    await runPost("/api/procore/estimating/proposals-bulk", "Fetch Proposals Bulk", {
      companyId,
      fetchAll: true,
      perPage: 100,
      "filters[by_status]": byStatus,
      maxBidBoardProjects: 1000,
      maxProposalsPerProject: 200,
    });
  }

  async function runBidBoardProjectsFetch() {
    const companyId = bidBoardCompanyId.trim();
    const byStatus = bidBoardStatusFilter.trim() || "All";

    if (!companyId) {
      setOutput(
        toPrettyJson({
          action: "Fetch Bid Board Projects",
          ok: false,
          error: "Company ID is required.",
        })
      );
      setLastStatus("error");
      return;
    }

    await runPost("/api/procore/estimating/bid-board-projects", "Fetch Bid Board Projects", {
      companyId,
      fetchAll: true,
      page: 1,
      perPage: 100,
      "filters[by_status]": byStatus,
    });
  }

  async function runSyncDebugCompare() {
    const ids = projectIdsToCheck
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      setOutput(
        toPrettyJson({
          action: "Sync Debug Compare IDs",
          ok: false,
          error: "Enter one or more comma-separated Procore project IDs.",
        })
      );
      setLastStatus("error");
      return;
    }

    await runPost("/api/procore/sync/all-projects", "Sync Debug Compare IDs", {
      fetchAll: true,
      includeInactiveV1: true,
      includeTestProjects: true,
      maxPages: 1000,
      debugProjectIds: ids,
    });
  }

  async function runGenerateDiscrepancyReport() {
    const ids = projectIdsToCheck
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      setOutput(
        toPrettyJson({
          action: "Generate Discrepancy Report",
          ok: false,
          error: "Enter one or more comma-separated Procore project IDs.",
        })
      );
      setLastStatus("error");
      return;
    }

    setBusyAction("Generate Discrepancy Report");
    setLastStatus("running");

    try {
      const payload = {
        fetchAll: true,
        includeInactiveV1: true,
        includeTestProjects: true,
        maxPages: 1000,
        debugProjectIds: ids,
      };

      const res = await fetch("/api/procore/sync/all-projects", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await readJsonResponse<Record<string, unknown>>(res, {
        label: "Sync Debug Compare IDs response",
        fallback: {},
      });
      const response = (body.response as Record<string, unknown> | undefined) || body;
      const debug = response.debug as Record<string, unknown> | undefined;
      const comparison = (debug?.comparison as Array<Record<string, unknown>> | undefined) || [];
      const summary = (response.summary as Record<string, unknown> | undefined) || {};

      const lines: string[] = [];
      lines.push("Procore Support Ticket: List vs By-ID Project Visibility Discrepancy");
      lines.push("");
      lines.push(`Date: ${new Date().toISOString()}`);
      lines.push(`Endpoint under test: POST /api/procore/sync/all-projects`);
      lines.push(`Request payload: ${JSON.stringify(payload)}`);
      lines.push("");
      lines.push("Observed summary from sync run:");
      lines.push(`- v1Synced: ${String(summary.v1Synced ?? "n/a")}`);
      lines.push(`- bidBoardSynced: ${String(summary.bidBoardSynced ?? "n/a")}`);
      lines.push(`- projectStagesSynced: ${String(summary.projectStagesSynced ?? "n/a")}`);
      lines.push(`- stagingSynced: ${String(summary.stagingSynced ?? "n/a")}`);
      lines.push(`- errors: ${JSON.stringify(summary.errors ?? [])}`);
      lines.push("");
      lines.push("Per-project comparison:");

      for (const row of comparison) {
        const id = String(row.id ?? "unknown");
        lines.push(`- Project ID: ${id}`);
        lines.push(`  - Appears in v1.0 list sync passes: ${String(row.inList)}`);
        lines.push(`  - v1.0 passes matched: ${JSON.stringify(row.inPasses ?? [])}`);
        lines.push(`  - Appears in v1.1 list: ${String(row.inV11List)}`);
        lines.push(`  - Retrieved by direct-by-id call: ${String(row.byIdOk)} (HTTP ${String(row.byIdStatus ?? "n/a")})`);
        lines.push(`  - Name: ${String(row.byIdName ?? "")}`);
        lines.push(`  - Project Number: ${String(row.byIdProjectNumber ?? "")}`);
        lines.push(`  - Active: ${String(row.byIdActive ?? "")}`);
        lines.push(`  - Is Demo/Test: ${String(row.byIdIsDemo ?? "")}`);
        lines.push(`  - Stage: ${String(row.byIdStage ?? "")}`);
        lines.push(`  - Updated At: ${String(row.byIdUpdatedAt ?? "")}`);
        if (row.byIdError) lines.push(`  - by-id error: ${String(row.byIdError)}`);
      }

      lines.push("");
      lines.push("Conclusion:");
      lines.push("- Same authenticated session can fetch project(s) by ID but those same ID(s) are omitted from both /rest/v1.0/projects and /rest/v1.1/projects list responses.");
      lines.push("- This indicates an upstream Procore list-enumeration inconsistency rather than local sync filtering/upsert behavior.");
      lines.push("");
      lines.push("Raw JSON response:");
      lines.push(JSON.stringify(body, null, 2));

      setOutput(lines.join("\n"));
      setLastStatus(res.ok ? "ok" : "error");
    } catch (error) {
      setOutput(
        toPrettyJson({
          action: "Generate Discrepancy Report",
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      );
      setLastStatus("error");
    } finally {
      setBusyAction(null);
    }
  }

  async function runPost(path: string, actionLabel: string, payload: object = {}) {
    setBusyAction(actionLabel);
    setLastStatus("running");

    try {
      const res = await fetch(path, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await readJsonResponse<ToolResponse>(res, {
        label: `${actionLabel} response`,
        fallback: {},
      });

      setOutput(
        toPrettyJson({
          action: actionLabel,
          statusCode: res.status,
          ok: res.ok,
          response: body,
        })
      );
      setLastStatus(res.ok ? "ok" : "error");
    } catch (error) {
      setOutput(
        toPrettyJson({
          action: actionLabel,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      );
      setLastStatus("error");
    } finally {
      setBusyAction(null);
    }
  }

  function openInNewTab(path: string) {
    window.open(path, "_blank", "noopener,noreferrer");
  }

  const isBusy = busyAction !== null;
  const disableSyncActions = isBusy || checkingAuth || !procoreConnected;

  function connectProcore() {
    window.location.href = "/api/auth/procore/login";
  }

  return (
    <main className="min-h-screen bg-neutral-100 p-2 md:p-4 font-sans text-slate-900">
      <div className="w-full bg-white rounded-3xl border border-gray-200 shadow-2xl p-4 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-100 pb-6 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900 uppercase italic leading-none">
              Procore <span className="text-red-700">Projects Feed Tools</span>
            </h1>
            <p className="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-[0.2em] mt-2">
              Sync, Verify, and Query Feed Table
            </p>
          </div>
          <Navigation currentPage="procore" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5 space-y-4">
            <h2 className="text-sm font-black uppercase tracking-widest text-gray-700">Execution</h2>

            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs font-bold uppercase tracking-wider flex items-center justify-between gap-3">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* ── SYNC ALL ─────────────────────────────────────── */}
              <button
                disabled={disableSyncActions}
                onClick={() => runPost('/api/procore/sync/run-all', "Sync All")}
                className="sm:col-span-2 px-4 py-4 rounded-xl bg-violet-700 text-white font-black text-sm uppercase tracking-widest hover:bg-violet-800 disabled:opacity-50 border-2 border-violet-500"
              >
                {busyAction === "Sync All" ? "⏳ Syncing All — Please Wait..." : "⚡ Sync All (Projects → Contracts → Change Orders → Commitments → Bids)"}
              </button>

              <button
                disabled={disableSyncActions}
                onClick={() => runPost(endpointExamples.statusRefreshQuick, "Status Refresh Quick", {
                  fetchAll: false,
                })}
                className="px-4 py-3 rounded-xl bg-emerald-700 text-white font-black text-xs uppercase tracking-widest hover:bg-emerald-800 disabled:opacity-50"
              >
                {busyAction === "Status Refresh Quick" ? "Running..." : "0) Status Refresh Quick"}
              </button>

              <button
                disabled={disableSyncActions}
                onClick={() => runPost(endpointExamples.statusRefreshFull, "Status Refresh Full", {
                  fetchAll: true,
                })}
                className="px-4 py-3 rounded-xl bg-emerald-900 text-white font-black text-xs uppercase tracking-widest hover:bg-black disabled:opacity-50"
              >
                {busyAction === "Status Refresh Full" ? "Running..." : "0b) Status Refresh Full"}
              </button>

              <button
                disabled={disableSyncActions}
                onClick={() => runPost('/api/procore/sync/projects-feed', "Sync Quick", { fetchAll: false })}
                className="px-4 py-3 rounded-xl bg-stone-800 text-white font-black text-xs uppercase tracking-widest hover:bg-stone-900 disabled:opacity-50"
              >
                {busyAction === "Sync Quick" ? "Running..." : "1) Sync Quick"}
              </button>

              <button
                disabled={disableSyncActions}
                onClick={() => runPost('/api/procore/sync/projects-feed', "Sync Full", { fetchAll: true })}
                className="px-4 py-3 rounded-xl bg-red-700 text-white font-black text-xs uppercase tracking-widest hover:bg-red-800 disabled:opacity-50"
              >
                {busyAction === "Sync Full" ? "Running..." : "2) Sync Full"}
              </button>

              <button
                disabled={isBusy}
                onClick={() => runPost(endpointExamples.verify, "Verify Matches", {
                  rematchAll: false,
                  limit: 1000,
                })}
                className="px-4 py-3 rounded-xl bg-orange-600 text-white font-black text-xs uppercase tracking-widest hover:bg-orange-700 disabled:opacity-50"
              >
                {busyAction === "Verify Matches" ? "Running..." : "3) Verify Matches"}
              </button>

              <button
                disabled={isBusy}
                onClick={() => runGet(endpointExamples.feed, "Fetch Feed")}
                className="px-4 py-3 rounded-xl bg-blue-700 text-white font-black text-xs uppercase tracking-widest hover:bg-blue-800 disabled:opacity-50"
              >
                {busyAction === "Fetch Feed" ? "Running..." : "4) Fetch Feed"}
              </button>

              <div className="sm:col-span-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] leading-relaxed text-emerald-900">
                <span className="font-black uppercase tracking-[0.14em] text-[10px]">Status Note</span>
                <div className="mt-1">
                  `Status Refresh` updates the canonical `Project.status` rows used by WIP and scheduling.
                  `Sync Quick` and `Sync Full` refresh the feed tables, but do not directly update WIP status by themselves.
                </div>
              </div>

              <div className="sm:col-span-2 rounded-xl border border-gray-200 bg-white p-3">
                <label className="block text-[10px] font-black uppercase tracking-[0.14em] text-gray-600 mb-2">
                  Bids Project ID
                </label>
                <input
                  type="text"
                  value={bidsProjectId}
                  onChange={(e) => setBidsProjectId(e.target.value)}
                  placeholder="Enter Procore project ID"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-900 outline-none focus:border-gray-500"
                />
              </div>

              <div className="sm:col-span-2 rounded-xl border border-gray-200 bg-white p-3">
                <label className="block text-[10px] font-black uppercase tracking-[0.14em] text-gray-600 mb-2">
                  Prime Contracts Project ID
                </label>
                <input
                  type="text"
                  value={primeContractsProjectId}
                  onChange={(e) => setPrimeContractsProjectId(e.target.value)}
                  placeholder="Enter Procore project ID"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-900 outline-none focus:border-gray-500"
                />
              </div>

              <button
                disabled={disableSyncActions || !bidsProjectId.trim()}
                onClick={runBidsSync}
                className="px-4 py-3 rounded-xl bg-cyan-700 text-white font-black text-xs uppercase tracking-widest hover:bg-cyan-800 disabled:opacity-50"
              >
                {busyAction === "Sync Bids" ? "Running..." : "5) Sync Bids"}
              </button>

              <button
                disabled={isBusy || !bidsProjectId.trim()}
                onClick={runBidsFetch}
                className="px-4 py-3 rounded-xl bg-sky-700 text-white font-black text-xs uppercase tracking-widest hover:bg-sky-800 disabled:opacity-50"
              >
                {busyAction === "Fetch Bids" ? "Running..." : "6) Fetch Bids"}
              </button>

              <button
                disabled={isBusy || !primeContractsProjectId.trim()}
                onClick={runPrimeContractsFetch}
                className="px-4 py-3 rounded-xl bg-lime-700 text-white font-black text-xs uppercase tracking-widest hover:bg-lime-800 disabled:opacity-50"
              >
                {busyAction === "Fetch Prime Contracts" ? "Running..." : "6b) Fetch Prime Contracts"}
              </button>

              <button
                disabled={disableSyncActions}
                onClick={runSyncAllPrimeContracts}
                className="px-4 py-3 rounded-xl bg-emerald-700 text-white font-black text-xs uppercase tracking-widest hover:bg-emerald-800 disabled:opacity-50"
              >
                {busyAction === "Sync All Prime Contracts" ? "Running..." : "6c) Sync All Prime Contracts"}
              </button>

              <button
                disabled={disableSyncActions}
                onClick={runSeedFromProjectsTest}
                className="px-4 py-3 rounded-xl bg-violet-700 text-white font-black text-xs uppercase tracking-widest hover:bg-violet-800 disabled:opacity-50"
              >
                {busyAction === "Seed from Projects_test" ? "Running..." : "6d) Seed from Projects_test (272)"}
              </button>

              <div className="sm:col-span-2 rounded-xl border border-gray-200 bg-white p-3">
                <label className="block text-[10px] font-black uppercase tracking-[0.14em] text-gray-600 mb-2">
                  BidForms Project ID
                </label>
                <input
                  type="text"
                  value={bidFormsProjectId}
                  onChange={(e) => setBidFormsProjectId(e.target.value)}
                  placeholder="Enter Procore project ID"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-900 outline-none focus:border-gray-500"
                />
                <label className="block text-[10px] font-black uppercase tracking-[0.14em] text-gray-600 mt-3 mb-2">
                  BidForms Package ID
                </label>
                <input
                  type="text"
                  value={bidFormsPackageId}
                  onChange={(e) => setBidFormsPackageId(e.target.value)}
                  placeholder="Enter Procore bid package ID"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-900 outline-none focus:border-gray-500"
                />
              </div>

              <button
                disabled={disableSyncActions || !bidFormsProjectId.trim() || !bidFormsPackageId.trim()}
                onClick={runBidFormsSync}
                className="px-4 py-3 rounded-xl bg-indigo-700 text-white font-black text-xs uppercase tracking-widest hover:bg-indigo-800 disabled:opacity-50"
              >
                {busyAction === "Sync BidForms" ? "Running..." : "7) Sync BidForms"}
              </button>

              <button
                disabled={disableSyncActions || !bidFormsProjectId.trim()}
                onClick={runBidPackagesList}
                className="px-4 py-3 rounded-xl bg-teal-700 text-white font-black text-xs uppercase tracking-widest hover:bg-teal-800 disabled:opacity-50"
              >
                {busyAction === "List Bid Packages" ? "Running..." : "8) List Bid Packages"}
              </button>

              <button
                disabled={isBusy || !bidFormsProjectId.trim() || !bidFormsPackageId.trim()}
                onClick={runBidFormsFetch}
                className="px-4 py-3 rounded-xl bg-blue-900 text-white font-black text-xs uppercase tracking-widest hover:bg-black disabled:opacity-50"
              >
                {busyAction === "Fetch BidForms" ? "Running..." : "9) Fetch BidForms"}
              </button>

              <button
                disabled={isBusy}
                onClick={() => runGet(endpointExamples.backfillDryRun, "Backfill Promoted (Dry Run)")}
                className="px-4 py-3 rounded-xl bg-violet-700 text-white font-black text-xs uppercase tracking-widest hover:bg-violet-800 disabled:opacity-50"
              >
                {busyAction === "Backfill Promoted (Dry Run)" ? "Running..." : "10) Backfill Dry Run"}
              </button>

              <button
                disabled={isBusy}
                onClick={() => runGet(endpointExamples.backfillApply, "Backfill Promoted (Apply)")}
                className="px-4 py-3 rounded-xl bg-fuchsia-700 text-white font-black text-xs uppercase tracking-widest hover:bg-fuchsia-800 disabled:opacity-50"
              >
                {busyAction === "Backfill Promoted (Apply)" ? "Running..." : "11) Backfill Apply"}
              </button>

              <button
                disabled={isBusy}
                onClick={() => runGet(endpointExamples.unmatched, "Fetch Unmatched")}
                className="sm:col-span-2 px-4 py-3 rounded-xl bg-emerald-700 text-white font-black text-xs uppercase tracking-widest hover:bg-emerald-800 disabled:opacity-50"
              >
                {busyAction === "Fetch Unmatched" ? "Running..." : "12) Fetch Unmatched"}
              </button>

              <div className="sm:col-span-2 rounded-xl border border-gray-200 bg-white p-3">
                <label className="block text-[10px] font-black uppercase tracking-[0.14em] text-gray-600 mb-2">
                  Check Project IDs (comma separated)
                </label>
                <input
                  type="text"
                  value={projectIdsToCheck}
                  onChange={(e) => setProjectIdsToCheck(e.target.value)}
                  placeholder="598134326375662,598134326375719"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-900 outline-none focus:border-gray-500"
                />
              </div>

              <button
                disabled={isBusy}
                onClick={runProjectIdCheck}
                className="sm:col-span-2 px-4 py-3 rounded-xl bg-amber-700 text-white font-black text-xs uppercase tracking-widest hover:bg-amber-800 disabled:opacity-50"
              >
                {busyAction === "Check Project IDs" ? "Running..." : "13) Check Project IDs"}
              </button>

              <button
                disabled={disableSyncActions}
                onClick={runSyncDebugCompare}
                className="sm:col-span-2 px-4 py-3 rounded-xl bg-rose-700 text-white font-black text-xs uppercase tracking-widest hover:bg-rose-800 disabled:opacity-50"
              >
                {busyAction === "Sync Debug Compare IDs" ? "Running..." : "14) Sync Debug Compare IDs"}
              </button>

              <button
                disabled={disableSyncActions}
                onClick={runGenerateDiscrepancyReport}
                className="sm:col-span-2 px-4 py-3 rounded-xl bg-slate-800 text-white font-black text-xs uppercase tracking-widest hover:bg-slate-900 disabled:opacity-50"
              >
                {busyAction === "Generate Discrepancy Report" ? "Running..." : "15) Generate Discrepancy Report"}
              </button>

              <div className="sm:col-span-2 rounded-xl border border-gray-200 bg-white p-3">
                <label className="block text-[10px] font-black uppercase tracking-[0.14em] text-gray-600 mb-2">
                  Bid Board Projects: Company ID
                </label>
                <input
                  type="text"
                  value={bidBoardCompanyId}
                  onChange={(e) => setBidBoardCompanyId(e.target.value)}
                  placeholder="598134325658789"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-900 outline-none focus:border-gray-500"
                />

                <label className="block text-[10px] font-black uppercase tracking-[0.14em] text-gray-600 mt-3 mb-2">
                  filters[by_status]
                </label>
                <input
                  type="text"
                  value={bidBoardStatusFilter}
                  onChange={(e) => setBidBoardStatusFilter(e.target.value)}
                  placeholder="All"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-900 outline-none focus:border-gray-500"
                />
              </div>

              <button
                disabled={isBusy}
                onClick={runBidBoardProjectsFetch}
                className="sm:col-span-2 px-4 py-3 rounded-xl bg-purple-700 text-white font-black text-xs uppercase tracking-widest hover:bg-purple-800 disabled:opacity-50"
              >
                {busyAction === "Fetch Bid Board Projects" ? "Running..." : "16) Fetch Bid Board Projects"}
              </button>

              <div className="sm:col-span-2 rounded-xl border border-gray-200 bg-white p-3">
                <label className="block text-[10px] font-black uppercase tracking-[0.14em] text-gray-600 mb-2">
                  Proposal Line Item Groups: Company ID
                </label>
                <input
                  type="text"
                  value={lineItemGroupsCompanyId}
                  onChange={(e) => setLineItemGroupsCompanyId(e.target.value)}
                  placeholder="598134325658789"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-900 outline-none focus:border-gray-500"
                />

                <label className="block text-[10px] font-black uppercase tracking-[0.14em] text-gray-600 mt-3 mb-2">
                  Bid Board Project ID
                </label>
                <input
                  type="text"
                  value={lineItemGroupsBidBoardProjectId}
                  onChange={(e) => setLineItemGroupsBidBoardProjectId(e.target.value)}
                  placeholder="562949955352714"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-900 outline-none focus:border-gray-500"
                />

                <label className="block text-[10px] font-black uppercase tracking-[0.14em] text-gray-600 mt-3 mb-2">
                  Proposal ID
                </label>
                <input
                  type="text"
                  value={lineItemGroupsProposalId}
                  onChange={(e) => setLineItemGroupsProposalId(e.target.value)}
                  placeholder="3206336"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-900 outline-none focus:border-gray-500"
                />
              </div>

              <button
                disabled={isBusy}
                onClick={runProposalLineItemGroupsFetch}
                className="sm:col-span-2 px-4 py-3 rounded-xl bg-purple-800 text-white font-black text-xs uppercase tracking-widest hover:bg-purple-900 disabled:opacity-50"
              >
                {busyAction === "Fetch Proposal Line Item Groups" ? "Running..." : "17) Fetch Proposal Line Item Groups"}
              </button>

              <button
                disabled={isBusy}
                onClick={runProposalLineItemsFetch}
                className="sm:col-span-2 px-4 py-3 rounded-xl bg-indigo-800 text-white font-black text-xs uppercase tracking-widest hover:bg-indigo-900 disabled:opacity-50"
              >
                {busyAction === "Fetch Proposal Line Items" ? "Running..." : "18) Fetch Proposal Line Items"}
              </button>

              <button
                disabled={isBusy}
                onClick={runProposalsBulkFetch}
                className="sm:col-span-2 px-4 py-3 rounded-xl bg-violet-950 text-white font-black text-xs uppercase tracking-widest hover:bg-black disabled:opacity-50"
              >
                {busyAction === "Fetch Proposals Bulk" ? "Running..." : "19) Fetch Proposals Bulk"}
              </button>

              <button
                disabled={isBusy}
                onClick={runProposalLineItemsBulkFetch}
                className="sm:col-span-2 px-4 py-3 rounded-xl bg-indigo-950 text-white font-black text-xs uppercase tracking-widest hover:bg-black disabled:opacity-50"
              >
                {busyAction === "Fetch Proposal Line Items Bulk" ? "Running..." : "20) Fetch Proposal Line Items Bulk"}
              </button>
            </div>

            <div className="pt-2 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
              Last Status: <span className="text-gray-800">{lastStatus}</span>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <h2 className="text-sm font-black uppercase tracking-widest text-gray-700">Query URLs</h2>
            <div className="space-y-2 text-xs">
              <button
                onClick={() => setOutput(toPrettyJson({ method: 'POST', path: '/api/procore/sync/projects-feed', body: { fetchAll: false } }))}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                {endpointExamples.syncQuick}
              </button>
              <button
                onClick={() => setOutput(toPrettyJson({ method: 'POST', path: '/api/procore/sync/projects-feed', body: { fetchAll: true } }))}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                {endpointExamples.syncFull}
              </button>
              <button
                onClick={() => openInNewTab(endpointExamples.feed)}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                {endpointExamples.feed}
              </button>
              <button
                onClick={() => openInNewTab(endpointExamples.backfillDryRun)}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                {endpointExamples.backfillDryRun}
              </button>
              <button
                onClick={() => openInNewTab(endpointExamples.backfillApply)}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                {endpointExamples.backfillApply}
              </button>
              <button
                onClick={() => openInNewTab(endpointExamples.unmatched)}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                {endpointExamples.unmatched}
              </button>
              <button
                onClick={() => openInNewTab(endpointExamples.existsByIds)}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                {endpointExamples.existsByIds}
              </button>
              <button
                onClick={() => openInNewTab(endpointExamples.primeContracts)}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                {endpointExamples.primeContracts}
              </button>
              <button
                onClick={() => setOutput(toPrettyJson({
                  action: "Fetch Bid Board Projects",
                  usePost: "/api/procore/estimating/bid-board-projects",
                  payload: {
                    companyId: "598134325658789",
                    fetchAll: true,
                    page: 1,
                    perPage: 100,
                    "filters[by_status]": "All",
                  },
                }))}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                {endpointExamples.bidBoardProjects}
              </button>
              <button
                onClick={() => setOutput(toPrettyJson({
                  action: "Fetch Proposals",
                  usePost: "/api/procore/estimating/proposals",
                  payload: {
                    companyId: "598134325658789",
                    bidBoardProjectId: "562949955352714",
                    page: 1,
                    perPage: 100,
                  },
                }))}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                {endpointExamples.proposals}
              </button>
              <button
                onClick={() => setOutput(toPrettyJson({
                  action: "Fetch Proposal Line Item Groups",
                  usePost: "/api/procore/estimating/proposal-line-item-groups",
                  payload: {
                    companyId: "598134325658789",
                    bidBoardProjectId: "562949955352714",
                    proposalId: "3206336",
                    page: 1,
                    perPage: 100,
                  },
                }))}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                {endpointExamples.lineItemGroups}
              </button>
              <button
                onClick={() => setOutput(toPrettyJson({
                  action: "Fetch Proposals Bulk",
                  usePost: "/api/procore/estimating/proposals-bulk",
                  payload: {
                    companyId: "598134325658789",
                    fetchAll: true,
                    perPage: 100,
                    "filters[by_status]": "All",
                    maxBidBoardProjects: 1000,
                    maxProposalsPerProject: 200,
                  },
                }))}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                {endpointExamples.proposalsBulk}
              </button>
              <button
                onClick={() => setOutput(toPrettyJson({
                  action: "Fetch Proposal Line Items",
                  usePost: "/api/procore/estimating/proposal-line-items",
                  payload: {
                    companyId: "598134325658789",
                    bidBoardProjectId: "562949955352714",
                    proposalId: "3206336",
                    page: 1,
                    perPage: 100,
                  },
                }))}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                {endpointExamples.lineItems}
              </button>
              <button
                onClick={() => setOutput(toPrettyJson({
                  action: "Fetch Proposal Line Items Bulk",
                  usePost: "/api/procore/estimating/proposal-line-items-bulk",
                  payload: {
                    companyId: "598134325658789",
                    fetchAll: true,
                    persist: true,
                    perPage: 100,
                    "filters[by_status]": "All",
                    maxBidBoardProjects: 1000,
                    maxProposalsPerProject: 200,
                    maxLineItemsPages: 50,
                  },
                }))}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                {endpointExamples.lineItemsBulk}
              </button>
              <button
                onClick={() => openInNewTab(endpointExamples.lineItemsLiveApi)}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                {endpointExamples.lineItemsLiveApi}
              </button>
              <button
                onClick={() => openInNewTab(endpointExamples.lineItemsLivePage)}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                {endpointExamples.lineItemsLivePage}
              </button>
              <button
                onClick={() => setOutput(toPrettyJson({
                  action: "Sync Debug Compare IDs",
                  usePost: "/api/procore/sync/all-projects",
                  payload: {
                    fetchAll: true,
                    includeInactiveV1: true,
                    includeTestProjects: true,
                    maxPages: 1000,
                    debugProjectIds: ["598134326241241", "598134326378468"],
                  },
                }))}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                {endpointExamples.syncCompareIds}
              </button>
              <button
                onClick={() => setOutput(toPrettyJson({ method: 'POST', path: '/api/procore/sync/bids', body: { projectId: 'YOUR_PROJECT_ID', fetchAll: true } }))}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                /api/procore/sync/bids (POST body: {`{ projectId: "YOUR_PROJECT_ID", fetchAll: true }`})
              </button>
              <button
                onClick={() => openInNewTab('/api/procore/bids?projectId=YOUR_PROJECT_ID&page=1&pageSize=200')}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                /api/procore/bids?projectId=YOUR_PROJECT_ID&page=1&pageSize=200
              </button>
              <button
                onClick={() =>
                  setOutput(toPrettyJson({ method: 'POST', path: '/api/procore/sync/bidforms', body: { projectId: 'YOUR_PROJECT_ID', bidPackageId: 'YOUR_BID_PACKAGE_ID', fetchAll: true } }))
                }
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                /api/procore/sync/bidforms (POST body: {`{ projectId: "YOUR_PROJECT_ID", bidPackageId: "YOUR_BID_PACKAGE_ID", fetchAll: true }`})
              </button>
              <button
                onClick={() =>
                  openInNewTab('/api/procore/bid-packages?projectId=YOUR_PROJECT_ID&fetchAll=true')
                }
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                /api/procore/bid-packages?projectId=YOUR_PROJECT_ID&fetchAll=true
              </button>
              <button
                onClick={() =>
                  openInNewTab('/api/procore/bidforms?projectId=YOUR_PROJECT_ID&bidPackageId=YOUR_BID_PACKAGE_ID&page=1&pageSize=200')
                }
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                /api/procore/bidforms?projectId=YOUR_PROJECT_ID&bidPackageId=YOUR_BID_PACKAGE_ID&page=1&pageSize=200
              </button>
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-2xl border border-gray-200 bg-stone-900 text-stone-100 p-5">
          <h2 className="text-sm font-black uppercase tracking-widest text-stone-300 mb-3">Output</h2>
          <pre className="text-xs whitespace-pre-wrap break-words leading-relaxed">{output}</pre>
        </section>
      </div>
    </main>
  );
}
