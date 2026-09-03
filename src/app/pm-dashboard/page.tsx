"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { dateKeyInTimeZone, PM_DASHBOARD_TIME_ZONE, type PmDashboardItemType } from "@/lib/pmDashboard";

type DashboardItem = {
  id: string;
  type: PmDashboardItemType;
  sourceId: string;
  number: string | null;
  title: string;
  description: string | null;
  status: string | null;
  dueAt: string;
  startsAt: string | null;
  endsAt: string | null;
  assigneeEmails: string[];
  assigneeNames: string[];
  sourceUrl: string | null;
  project: { id: string; number: string | null; name: string; manager: string | null } | null;
};

type DashboardResponse = {
  success: boolean;
  error?: string;
  user?: { email: string; name: string };
  window?: { timeZone: string; dateKeys: string[] };
  latestSync?: string | null;
  calendar?: { connected: boolean; latestSync: string | null };
  items?: DashboardItem[];
};

const TYPE_META: Record<PmDashboardItemType, { label: string; short: string; color: string; dot: string }> = {
  rfi: { label: "RFIs", short: "R", color: "border-amber-200 bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  task: { label: "Tasks", short: "T", color: "border-blue-200 bg-blue-50 text-blue-800", dot: "bg-blue-500" },
  meeting: { label: "Meetings", short: "M", color: "border-violet-200 bg-violet-50 text-violet-800", dot: "bg-violet-500" },
  outlook: { label: "Outlook", short: "O", color: "border-sky-200 bg-sky-50 text-sky-800", dot: "bg-sky-500" },
};

// Timed items (Procore meetings, Outlook events) are never "overdue"; they simply pass.
const TIMED_TYPES: ReadonlySet<PmDashboardItemType> = new Set(["meeting", "outlook"]);

function itemDateKey(item: DashboardItem): string {
  return dateKeyInTimeZone(new Date(item.dueAt), PM_DASHBOARD_TIME_ZONE);
}

function formatDay(dateKey: string, todayKey: string): { eyebrow: string; title: string } {
  const date = new Date(`${dateKey}T12:00:00Z`);
  const tomorrow = new Date(`${todayKey}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowKey = tomorrow.toISOString().slice(0, 10);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date);
  const calendar = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
  return {
    eyebrow: dateKey === todayKey ? "Today" : dateKey === tomorrowKey ? "Tomorrow" : weekday,
    title: calendar,
  };
}

function formatTime(item: DashboardItem): string {
  if (!TIMED_TYPES.has(item.type) || !item.startsAt) return "Due";
  if (item.type === "outlook" && item.status === "All day") return "All day";
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: PM_DASHBOARD_TIME_ZONE,
  });
  const start = formatter.format(new Date(item.startsAt));
  return item.type === "outlook" && item.endsAt ? `${start} – ${formatter.format(new Date(item.endsAt))}` : start;
}

function ItemCard({ item, overdue = false }: { item: DashboardItem; overdue?: boolean }) {
  const meta = TYPE_META[item.type];
  const subtitle = item.project
    ? `${item.project.number ? `${item.project.number} · ` : ""}${item.project.name}`
    : item.description || "Outlook calendar";
  const content = (
    <article className="group rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
      <div className="flex items-start gap-2.5">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[11px] font-black ${meta.color}`} aria-hidden="true">
          {meta.short}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 text-sm font-extrabold leading-5 text-slate-900">{item.title}</p>
            {item.sourceUrl && <span className="text-sm text-slate-400 transition group-hover:text-teal-700" aria-hidden="true">↗</span>}
          </div>
          <p className="mt-1 truncate text-[11px] font-semibold text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide">
        <span className={`rounded-full px-2 py-1 ${overdue ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"}`}>
          {overdue ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: PM_DASHBOARD_TIME_ZONE }).format(new Date(item.dueAt)) : formatTime(item)}
        </span>
        {item.number && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">#{item.number}</span>}
        {item.status && item.status !== "All day" && <span className="truncate rounded-full bg-slate-100 px-2 py-1 text-slate-600">{item.status}</span>}
      </div>
    </article>
  );

  const linkLabel = item.type === "outlook" ? `Open ${item.title} in Outlook` : `Open ${item.title} in Procore`;
  return item.sourceUrl ? (
    <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="block no-underline" aria-label={linkLabel}>
      {content}
    </a>
  ) : content;
}

function LoadingState() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px] animate-pulse">
        <div className="h-8 w-64 rounded bg-slate-200" />
        <div className="mt-3 h-4 w-96 max-w-full rounded bg-slate-200" />
        <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((key) => <div key={key} className="h-24 rounded-2xl bg-white shadow-sm" />)}
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((key) => <div key={key} className="h-72 rounded-2xl bg-white shadow-sm" />)}
        </div>
      </div>
    </main>
  );
}

export default function PmDashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTypes, setActiveTypes] = useState<Set<PmDashboardItemType>>(new Set(["rfi", "task", "meeting", "outlook"]));
  const [projectId, setProjectId] = useState("all");

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/pm-dashboard", { cache: "no-store", credentials: "include" });
      const payload = await response.json().catch(() => ({})) as DashboardResponse;
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to load your work queue.");
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load your work queue.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const items = useMemo(() => data?.items || [], [data?.items]);
  const dateKeys = data?.window?.dateKeys || [];
  const todayKey = dateKeys[0] || dateKeyInTimeZone(new Date(), PM_DASHBOARD_TIME_ZONE);
  const filtered = useMemo(() => items.filter((item) => (
    activeTypes.has(item.type) && (projectId === "all" || item.project?.id === projectId)
  )), [activeTypes, items, projectId]);
  const overdue = filtered.filter((item) => !TIMED_TYPES.has(item.type) && itemDateKey(item) < todayKey);
  const projects = useMemo(() => Array.from(new Map(items.flatMap((item) => (item.project ? [[item.project.id, item.project] as const] : []))).values())
    .sort((a, b) => a.name.localeCompare(b.name)), [items]);
  const counts = {
    total: filtered.length,
    overdue: overdue.length,
    today: filtered.filter((item) => itemDateKey(item) === todayKey).length,
    meetings: filtered.filter((item) => TIMED_TYPES.has(item.type)).length,
  };

  const toggleType = (type: PmDashboardItemType) => {
    setActiveTypes((current) => {
      const next = new Set(current);
      if (next.has(type) && next.size > 1) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  if (loading) return <LoadingState />;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px]">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-teal-700">
              <span className="h-2 w-2 rounded-full bg-teal-500" />
              Personal work queue
            </div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">My next 5 workdays</h1>
            <p className="mt-2 text-sm font-medium text-slate-500">
              {data?.user?.name ? `${data.user.name} · ` : ""}Open RFIs, tasks, and upcoming meetings across your projects{data?.calendar?.connected ? ", plus your Outlook calendar" : ""}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-semibold text-slate-500">
              {data?.latestSync ? `Updated ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: PM_DASHBOARD_TIME_ZONE }).format(new Date(data.latestSync))}` : "Waiting for first background sync"}
            </p>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black text-slate-700 shadow-sm transition hover:border-teal-500 hover:text-teal-800 disabled:cursor-wait disabled:opacity-60"
            >
              {refreshing ? "Refreshing…" : "Refresh view"}
            </button>
          </div>
        </header>

        {error && (
          <section className="mt-6 flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-5 sm:flex-row sm:items-center sm:justify-between" role="alert">
            <div>
              <p className="font-black text-rose-900">We couldn’t load your work queue.</p>
              <p className="mt-1 text-sm text-rose-700">{error}</p>
            </div>
            <button type="button" onClick={() => void load()} className="rounded-lg bg-rose-700 px-4 py-2 text-xs font-black text-white">Try again</button>
          </section>
        )}

        {!error && (
          <>
            <section className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Work queue summary">
              {[
                ["Open items", counts.total, "Overdue + next five workdays", "text-slate-950"],
                ["Overdue", counts.overdue, counts.overdue ? "Needs attention" : "Nothing overdue", counts.overdue ? "text-rose-700" : "text-emerald-700"],
                ["Due today", counts.today, "Tasks, RFIs, and meetings", "text-teal-700"],
                ["Meetings & events", counts.meetings, "Upcoming in this window", "text-violet-700"],
              ].map(([label, value, detail, color]) => (
                <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
                  <p className={`mt-2 text-3xl font-black ${color}`}>{value}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-400">{detail}</p>
                </div>
              ))}
            </section>

            <section className="mt-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2" aria-label="Filter item types">
                {(Object.keys(TYPE_META) as PmDashboardItemType[]).map((type) => {
                  const active = activeTypes.has(type);
                  const meta = TYPE_META[type];
                  const count = items.filter((item) => item.type === type).length;
                  return (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleType(type)}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black transition ${active ? meta.color : "border-slate-200 bg-white text-slate-400"}`}
                    >
                      <span className={`h-2 w-2 rounded-full ${active ? meta.dot : "bg-slate-300"}`} />
                      {meta.label}<span className="opacity-60">{count}</span>
                    </button>
                  );
                })}
              </div>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
                Project
                <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="min-w-0 rounded-xl border-slate-300 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800 sm:max-w-72">
                  <option value="all">All my projects</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.number ? `${project.number} · ` : ""}{project.name}</option>)}
                </select>
              </label>
            </section>

            {overdue.length > 0 && (
              <section className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-rose-600">Past due</p>
                    <h2 className="mt-1 text-lg font-black text-rose-950">Clear these first</h2>
                  </div>
                  <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-black text-rose-700">{overdue.length}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {overdue.map((item) => <ItemCard key={item.id} item={item} overdue />)}
                </div>
              </section>
            )}

            <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5" aria-label="Five-day work queue">
              {dateKeys.map((dateKey) => {
                const day = formatDay(dateKey, todayKey);
                const dayItems = filtered.filter((item) => itemDateKey(item) === dateKey);
                return (
                  <div key={dateKey} className={`min-h-72 rounded-2xl border p-3 ${dateKey === todayKey ? "border-teal-300 bg-teal-50/50" : "border-slate-200 bg-slate-100/60"}`}>
                    <div className="flex items-center justify-between px-1 py-1">
                      <div>
                        <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${dateKey === todayKey ? "text-teal-700" : "text-slate-500"}`}>{day.eyebrow}</p>
                        <h2 className="mt-0.5 text-lg font-black text-slate-900">{day.title}</h2>
                      </div>
                      <span className={`flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-black ${dateKey === todayKey ? "bg-teal-700 text-white" : "bg-white text-slate-600"}`}>{dayItems.length}</span>
                    </div>
                    <div className="mt-3 space-y-2.5">
                      {dayItems.map((item) => <ItemCard key={item.id} item={item} />)}
                      {dayItems.length === 0 && (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-3 py-8 text-center">
                          <p className="text-sm font-bold text-slate-400">No open items</p>
                          <p className="mt-1 text-[11px] text-slate-400">Your day is clear.</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>

            {filtered.length === 0 && items.length === 0 && (
              <section className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
                <p className="text-lg font-black text-slate-800">Your queue is clear.</p>
                <p className="mt-2 text-sm text-slate-500">New RFIs, tasks, and meetings will appear here after the background sync.</p>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
