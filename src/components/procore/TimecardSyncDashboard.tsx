"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";

type EntrySyncResponse = {
  success?: boolean;
  error?: string;
  companyId?: string;
  totalProjectsChecked?: number;
  projectsWithActivity?: number;
  totalEntriesFetched?: number;
  totalEntriesSaved?: number;
  totalProjectsCreated?: number;
  errors?: string[];
  activeProjects?: Array<{
    projectId: string;
    projectNumber: string | null;
    projectName: string;
    entryCount: number;
    savedCount: number;
    skippedCount: number;
    projectCreated: boolean;
    linkedProjectId: string | null;
  }>;
};

type TimeTypeSyncResponse = {
  success?: boolean;
  error?: string;
  companyId?: string;
  totalProjectsChecked?: number;
  projectsWithTypes?: number;
  totalTypesFetched?: number;
  totalTypesSaved?: number;
  totalProjectsCreated?: number;
  errors?: string[];
  activeProjects?: Array<{
    projectId: string;
    projectNumber: string | null;
    projectName: string;
    typeCount: number;
    savedCount: number;
    skippedCount: number;
    projectCreated: boolean;
    linkedProjectId: string | null;
  }>;
};

function ResultsCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 text-center">
      <div className="text-2xl font-black text-gray-900">{value}</div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
        {label}
      </div>
    </div>
  );
}

export default function TimecardSyncDashboard() {
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [procoreConnected, setProcoreConnected] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [perPage, setPerPage] = useState(100);
  const [persist, setPersist] = useState(true);

  const [logDate, setLogDate] = useState("");
  const [startDate, setStartDate] = useState("2025-08-01");
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [createdByIds, setCreatedByIds] = useState("");
  const [dailyLogSegmentId, setDailyLogSegmentId] = useState("");

  const [entriesLoading, setEntriesLoading] = useState(false);
  const [timeTypesLoading, setTimeTypesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [timeTypesError, setTimeTypesError] = useState<string | null>(null);
  const [entriesResponse, setEntriesResponse] = useState<EntrySyncResponse | null>(null);
  const [timeTypesResponse, setTimeTypesResponse] = useState<TimeTypeSyncResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        const res = await fetch("/api/procore/auth-status", { credentials: "include" });
        const json = (await res.json()) as { connected?: boolean };
        if (!cancelled) setProcoreConnected(Boolean(json.connected));
      } catch {
        if (!cancelled) setProcoreConnected(false);
      } finally {
        if (!cancelled) setCheckingAuth(false);
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
      setEntriesError(oauthError);
      setTimeTypesError(oauthError);
    }

    if (status === "authenticated") {
      setCheckingAuth(true);
      fetch("/api/procore/auth-status", { credentials: "include" })
        .then((res) => res.json())
        .then((json: { connected?: boolean }) => {
          setProcoreConnected(Boolean(json.connected));
          if (json.connected) {
            window.history.replaceState({}, "", window.location.pathname);
            setEntriesError(null);
            setTimeTypesError(null);
          }
        })
        .catch(() => setProcoreConnected(false))
        .finally(() => setCheckingAuth(false));
    }
  }, []);

  function connectProcore() {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/api/auth/procore/login?returnTo=${encodeURIComponent(returnTo)}`;
  }

  async function syncEntries() {
    setEntriesLoading(true);
    setEntriesError(null);

    try {
      const res = await fetch("/api/procore/sync/timecard-entries", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
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

      const json = (await res.json()) as EntrySyncResponse;
      if (!res.ok || !json.success) {
        setEntriesError(json.error || "Failed to sync timecard entries");
        if (res.status === 401) setProcoreConnected(false);
        setEntriesResponse(null);
        return;
      }

      setEntriesResponse(json);
    } catch (err) {
      setEntriesError(err instanceof Error ? err.message : "Unknown error");
      setEntriesResponse(null);
    } finally {
      setEntriesLoading(false);
    }
  }

  async function syncTimeTypes() {
    setTimeTypesLoading(true);
    setTimeTypesError(null);

    try {
      const res = await fetch("/api/procore/sync/timecard-time-types", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companyId.trim() || undefined,
          perPage,
          persist,
        }),
      });

      const json = (await res.json()) as TimeTypeSyncResponse;
      if (!res.ok || !json.success) {
        setTimeTypesError(json.error || "Failed to sync timecard time types");
        if (res.status === 401) setProcoreConnected(false);
        setTimeTypesResponse(null);
        return;
      }

      setTimeTypesResponse(json);
    } catch (err) {
      setTimeTypesError(err instanceof Error ? err.message : "Unknown error");
      setTimeTypesResponse(null);
    } finally {
      setTimeTypesLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-100 p-2 md:p-4 font-sans text-slate-900">
      <div className="w-full rounded-3xl border border-gray-200 bg-white p-4 shadow-2xl md:p-8">
        <div className="mb-6 flex flex-col gap-4 border-b border-gray-100 pb-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-black uppercase italic leading-none tracking-tight text-gray-900 md:text-3xl">
              Procore <span className="text-red-700">Timecards</span>
            </h1>
            <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 md:text-xs">
              Entries + Time Types in One Dashboard
            </p>
          </div>
          <Navigation currentPage="procore" />
        </div>

        <section className="mb-6 rounded-2xl border border-gray-200 bg-gray-50 p-5">
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs font-bold uppercase tracking-wider">
            <span>
              Procore Auth: {checkingAuth ? "Checking..." : procoreConnected ? "Connected" : "Not Connected"}
            </span>
            {!procoreConnected && !checkingAuth && (
              <button
                onClick={connectProcore}
                className="rounded-lg bg-red-700 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white hover:bg-red-800"
              >
                Connect Procore
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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

            <label className="inline-flex items-center gap-2 self-end pb-2 text-xs font-bold uppercase tracking-wider text-gray-700">
              <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} />
              Write to Prisma
            </label>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-black uppercase tracking-widest text-gray-800">
                  Timecard Entries
                </h2>
                <p className="mt-1 text-xs font-semibold text-gray-500">
                  GET /rest/v1.0/projects/{"{"}project_id{"}"}/timecard_entries
                </p>
              </div>
              <button
                onClick={syncEntries}
                disabled={entriesLoading || checkingAuth || !procoreConnected}
                className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {entriesLoading ? "Syncing..." : "Sync Entries"}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

              <label className="text-xs font-bold uppercase tracking-wider text-gray-600 md:col-span-2">
                filters[daily_log_segment_id]
                <input
                  value={dailyLogSegmentId}
                  onChange={(e) => setDailyLogSegmentId(e.target.value)}
                  placeholder="Optional"
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
            </div>

            {entriesError && (
              <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
                {entriesError}
              </div>
            )}

            {entriesResponse && (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <ResultsCard label="Projects Checked" value={entriesResponse.totalProjectsChecked ?? 0} />
                  <ResultsCard label="Projects With Entries" value={entriesResponse.projectsWithActivity ?? 0} />
                  <ResultsCard label="Entries Fetched" value={entriesResponse.totalEntriesFetched ?? 0} />
                  <ResultsCard label="Entries Saved" value={entriesResponse.totalEntriesSaved ?? 0} />
                  <ResultsCard label="Projects Created" value={entriesResponse.totalProjectsCreated ?? 0} />
                </div>

                {(entriesResponse.errors?.length ?? 0) > 0 && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                    <p className="mb-2 text-xs font-black uppercase tracking-wider text-red-700">
                      Errors ({entriesResponse.errors!.length})
                    </p>
                    <ul className="space-y-1 text-xs text-red-600">
                      {entriesResponse.errors!.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {(entriesResponse.activeProjects?.length ?? 0) > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-gray-200">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-100">
                        <tr>
                          {["Project #", "Project Name", "Entries", "Saved", "Skipped", "Linked ID"].map((header) => (
                            <th
                              key={header}
                              className="px-3 py-2 text-left font-black uppercase tracking-wider text-gray-600"
                            >
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {entriesResponse.activeProjects!.map((project) => (
                          <tr key={project.projectId} className="border-t border-gray-100 hover:bg-gray-50">
                            <td className="px-3 py-2 font-semibold">{project.projectNumber ?? "-"}</td>
                            <td className="px-3 py-2">{project.projectName}</td>
                            <td className="px-3 py-2 text-center">{project.entryCount}</td>
                            <td className="px-3 py-2 text-center font-bold text-emerald-700">{project.savedCount}</td>
                            <td className="px-3 py-2 text-center text-gray-500">{project.skippedCount}</td>
                            <td className="px-3 py-2 text-[10px] text-gray-400">{project.linkedProjectId ?? "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-black uppercase tracking-widest text-gray-800">
                  Timecard Time Types
                </h2>
                <p className="mt-1 text-xs font-semibold text-gray-500">
                  GET /rest/v1.0/timecard_time_types
                </p>
              </div>
              <button
                onClick={syncTimeTypes}
                disabled={timeTypesLoading || checkingAuth || !procoreConnected}
                className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {timeTypesLoading ? "Syncing..." : "Sync Time Types"}
              </button>
            </div>

            <p className="text-sm text-gray-600">
              Uses the shared company and paging settings above, then loops all projects and requests project-scoped timecard time types.
            </p>

            {timeTypesError && (
              <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
                {timeTypesError}
              </div>
            )}

            {timeTypesResponse && (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <ResultsCard label="Projects Checked" value={timeTypesResponse.totalProjectsChecked ?? 0} />
                  <ResultsCard label="Projects With Types" value={timeTypesResponse.projectsWithTypes ?? 0} />
                  <ResultsCard label="Types Fetched" value={timeTypesResponse.totalTypesFetched ?? 0} />
                  <ResultsCard label="Types Saved" value={timeTypesResponse.totalTypesSaved ?? 0} />
                  <ResultsCard label="Projects Created" value={timeTypesResponse.totalProjectsCreated ?? 0} />
                </div>

                {(timeTypesResponse.errors?.length ?? 0) > 0 && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                    <p className="mb-2 text-xs font-black uppercase tracking-wider text-red-700">
                      Errors ({timeTypesResponse.errors!.length})
                    </p>
                    <ul className="space-y-1 text-xs text-red-600">
                      {timeTypesResponse.errors!.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {(timeTypesResponse.activeProjects?.length ?? 0) > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-gray-200">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-100">
                        <tr>
                          {["Project #", "Project Name", "Types", "Saved", "Skipped", "Linked ID"].map((header) => (
                            <th
                              key={header}
                              className="px-3 py-2 text-left font-black uppercase tracking-wider text-gray-600"
                            >
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {timeTypesResponse.activeProjects!.map((project) => (
                          <tr key={project.projectId} className="border-t border-gray-100 hover:bg-gray-50">
                            <td className="px-3 py-2 font-semibold">{project.projectNumber ?? "-"}</td>
                            <td className="px-3 py-2">{project.projectName}</td>
                            <td className="px-3 py-2 text-center">{project.typeCount}</td>
                            <td className="px-3 py-2 text-center font-bold text-emerald-700">{project.savedCount}</td>
                            <td className="px-3 py-2 text-center text-gray-500">{project.skippedCount}</td>
                            <td className="px-3 py-2 text-[10px] text-gray-400">{project.linkedProjectId ?? "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
