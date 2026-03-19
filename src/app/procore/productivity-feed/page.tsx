"use client";

import { useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";

type ProductivityFeedLog = {
  id?: string | number;
  log_date?: string;
  date?: string;
  status?: string;
  company?: string;
  contract?: string;
  line_item_description?: string;
  quantity_used?: string | number;
  quantity_delivered?: string | number;
  notes?: string;
  daily_log_segment_id?: string | number;
  created_by?: {
    id?: string | number;
    name?: string;
    login?: string;
  };
};

type FeedResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  count?: number;
  page?: number;
  perPage?: number;
  persistence?: {
    attempted: number;
    saved: number;
    skipped: number;
    projectLinked: boolean;
  };
  logs?: ProductivityFeedLog[];
};

export default function ProcoreProductivityFeedPage() {
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [procoreConnected, setProcoreConnected] = useState(false);
  const [projectId, setProjectId] = useState("598134326278124");
  const [logDate, setLogDate] = useState("");
  const [startDate, setStartDate] = useState("2025-08-01");
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [createdByIds, setCreatedByIds] = useState("");
  const [dailyLogSegmentId, setDailyLogSegmentId] = useState("123456");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(100);
  const [persist, setPersist] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<FeedResponse | null>(null);

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

  const hasRows = (response?.logs?.length || 0) > 0;

  const queryPreview = useMemo(() => {
    const params = new URLSearchParams();
    params.set("projectId", projectId);
    if (logDate) params.set("log_date", logDate);
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    if (createdByIds.trim()) params.set("created_by_ids", createdByIds.trim());
    if (dailyLogSegmentId.trim()) params.set("filters[daily_log_segment_id]", dailyLogSegmentId.trim());
    params.set("page", String(page));
    params.set("per_page", String(perPage));
    params.set("persist", String(persist));
    return `/api/procore/productivity-logs?${params.toString()}`;
  }, [projectId, logDate, startDate, endDate, createdByIds, dailyLogSegmentId, page, perPage, persist]);

  async function loadFeed(nextPage = page) {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("projectId", projectId.trim());
      if (logDate) params.set("log_date", logDate);
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      if (createdByIds.trim()) params.set("created_by_ids", createdByIds.trim());
      if (dailyLogSegmentId.trim()) params.set("filters[daily_log_segment_id]", dailyLogSegmentId.trim());
      params.set("page", String(nextPage));
      params.set("per_page", String(perPage));
      params.set("persist", String(persist));

      const res = await fetch(`/api/procore/productivity-logs?${params.toString()}`, {
        method: "GET",
        credentials: "include",
      });

      const json = (await res.json()) as FeedResponse;
      if (!res.ok || !json.success) {
        setError(json.error || "Failed to load productivity feed");
        if (res.status === 401) {
          setProcoreConnected(false);
        }
        setResponse(null);
        return;
      }

      setResponse(json);
      setPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setResponse(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFeed(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              Project ID
              <input
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
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
              Page
              <input
                type="number"
                min={1}
                value={page}
                onChange={(e) => setPage(Math.max(1, Number(e.target.value || "1")))}
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
              onClick={() => loadFeed(1)}
              disabled={loading || !projectId.trim() || checkingAuth || !procoreConnected}
              className="px-4 py-2 rounded-xl bg-blue-700 text-white font-black text-xs uppercase tracking-widest hover:bg-blue-800 disabled:opacity-50"
            >
              {loading ? "Loading..." : "Run Feed"}
            </button>

            <button
              onClick={() => loadFeed(Math.max(1, page - 1))}
              disabled={loading || page <= 1}
              className="px-4 py-2 rounded-xl bg-gray-700 text-white font-black text-xs uppercase tracking-widest hover:bg-gray-800 disabled:opacity-50"
            >
              Prev
            </button>

            <button
              onClick={() => loadFeed(page + 1)}
              disabled={loading || !hasRows}
              className="px-4 py-2 rounded-xl bg-gray-700 text-white font-black text-xs uppercase tracking-widest hover:bg-gray-800 disabled:opacity-50"
            >
              Next
            </button>
          </div>

          <div className="mt-3 p-3 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 break-all">
            {queryPreview}
          </div>
        </section>

        {error && (
          <section className="mb-6 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {error}
          </section>
        )}

        <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-700 mb-2">Prisma Write Result</h2>
          <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>Fetched: <span className="font-bold">{response?.count ?? 0}</span></div>
            <div>Attempted Saves: <span className="font-bold">{response?.persistence?.attempted ?? 0}</span></div>
            <div>Saved: <span className="font-bold">{response?.persistence?.saved ?? 0}</span></div>
            <div>Skipped: <span className="font-bold">{response?.persistence?.skipped ?? 0}</span></div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[1200px] w-full border-collapse">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {[
                    "Log Date",
                    "Log ID",
                    "Created By",
                    "Status",
                    "Company",
                    "Contract",
                    "Line Item",
                    "Qty Used",
                    "Qty Delivered",
                    "Daily Segment",
                    "Notes",
                  ].map((label) => (
                    <th key={label} className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-wider text-gray-600">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {response?.logs?.length ? (
                  response.logs.map((log, index) => (
                    <tr key={`${log.id || "row"}-${index}`} className="border-b border-gray-100">
                      <td className="px-3 py-2 text-sm text-gray-800">{log.log_date || log.date || "-"}</td>
                      <td className="px-3 py-2 text-sm text-gray-800">{log.id || "-"}</td>
                      <td className="px-3 py-2 text-sm text-gray-800">{log.created_by?.name || log.created_by?.login || "-"}</td>
                      <td className="px-3 py-2 text-sm text-gray-800">{log.status || "-"}</td>
                      <td className="px-3 py-2 text-sm text-gray-800">{log.company || "-"}</td>
                      <td className="px-3 py-2 text-sm text-gray-800">{log.contract || "-"}</td>
                      <td className="px-3 py-2 text-sm text-gray-800">{log.line_item_description || "-"}</td>
                      <td className="px-3 py-2 text-sm text-gray-800">{log.quantity_used ?? "-"}</td>
                      <td className="px-3 py-2 text-sm text-gray-800">{log.quantity_delivered ?? "-"}</td>
                      <td className="px-3 py-2 text-sm text-gray-800">{log.daily_log_segment_id ?? "-"}</td>
                      <td className="px-3 py-2 text-sm text-gray-800">{log.notes || "-"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={11} className="px-3 py-4 text-center text-sm text-gray-500">
                      {loading ? "Loading rows..." : "No rows found for the current filters."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
