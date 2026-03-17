"use client";

import React, { useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";

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
  const [bidFormsProjectId, setBidFormsProjectId] = useState<string>("");
  const [bidFormsPackageId, setBidFormsPackageId] = useState<string>("");

  const endpointExamples = useMemo(
    () => ({
      syncQuick: "/api/procore/sync/projects-feed?fetchAll=false",
      syncFull: "/api/procore/sync/projects-feed?fetchAll=true",
      verify: "/api/procore/projects-feed/verify-matches",
      backfillDryRun: "/api/procore/projects-feed/backfill-promoted?dryRun=true&limit=5000",
      backfillApply: "/api/procore/projects-feed/backfill-promoted?dryRun=false&limit=5000",
      feed: "/api/procore/projects-feed?page=1&pageSize=200",
      unmatched: "/api/procore/projects-feed?unmatchedOnly=true&page=1&pageSize=200",
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
      const text = await res.text();
      const body = text ? JSON.parse(text) : {};

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

    await runGet(`/api/procore/sync/bids?projectId=${encodeURIComponent(projectId)}&fetchAll=true`, "Sync Bids");
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

    await runGet(
      `/api/procore/sync/bidforms?projectId=${encodeURIComponent(projectId)}&bidPackageId=${encodeURIComponent(bidPackageId)}&fetchAll=true`,
      "Sync BidForms"
    );
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

      const text = await res.text();
      const body = text ? (JSON.parse(text) as ToolResponse) : {};

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
              <button
                disabled={disableSyncActions}
                onClick={() => runGet(endpointExamples.syncQuick, "Sync Quick")}
                className="px-4 py-3 rounded-xl bg-stone-800 text-white font-black text-xs uppercase tracking-widest hover:bg-stone-900 disabled:opacity-50"
              >
                {busyAction === "Sync Quick" ? "Running..." : "1) Sync Quick"}
              </button>

              <button
                disabled={disableSyncActions}
                onClick={() => runGet(endpointExamples.syncFull, "Sync Full")}
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
            </div>

            <div className="pt-2 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
              Last Status: <span className="text-gray-800">{lastStatus}</span>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <h2 className="text-sm font-black uppercase tracking-widest text-gray-700">Query URLs</h2>
            <div className="space-y-2 text-xs">
              <button
                onClick={() => openInNewTab(endpointExamples.syncQuick)}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                {endpointExamples.syncQuick}
              </button>
              <button
                onClick={() => openInNewTab(endpointExamples.syncFull)}
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
                onClick={() => openInNewTab('/api/procore/sync/bids?projectId=YOUR_PROJECT_ID&fetchAll=true')}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                /api/procore/sync/bids?projectId=YOUR_PROJECT_ID&fetchAll=true
              </button>
              <button
                onClick={() => openInNewTab('/api/procore/bids?projectId=YOUR_PROJECT_ID&page=1&pageSize=200')}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                /api/procore/bids?projectId=YOUR_PROJECT_ID&page=1&pageSize=200
              </button>
              <button
                onClick={() =>
                  openInNewTab('/api/procore/sync/bidforms?projectId=YOUR_PROJECT_ID&bidPackageId=YOUR_BID_PACKAGE_ID&fetchAll=true')
                }
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 font-bold hover:bg-gray-100"
              >
                /api/procore/sync/bidforms?projectId=YOUR_PROJECT_ID&bidPackageId=YOUR_BID_PACKAGE_ID&fetchAll=true
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
