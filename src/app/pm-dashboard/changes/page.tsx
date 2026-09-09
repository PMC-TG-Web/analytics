"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PM_DASHBOARD_TIME_ZONE } from "@/lib/pmDashboard";
import { PM_CHANGE_TYPES, type PmChangeType } from "@/lib/pmDashboardChanges";

type ChangeItem = {
  id: string;
  type: PmChangeType;
  sourceId: string;
  contractId: string | null;
  number: string | null;
  title: string;
  description: string | null;
  status: string | null;
  amount: string | null;
  updatedAt: string;
  sourceUrl: string | null;
  project: { id: string; number: string | null; name: string; manager: string | null };
};

type ChangesResponse = {
  success: boolean;
  error?: string;
  user?: { email: string; name: string };
  latestSync?: string | null;
  items?: ChangeItem[];
};

const TYPE_META: Record<PmChangeType, { label: string; short: string; color: string; active: string }> = {
  change_event: {
    label: "Change Events",
    short: "CE",
    color: "border-violet-200 bg-violet-50 text-violet-800",
    active: "border-violet-300 bg-violet-50 text-violet-800",
  },
  pco: {
    label: "PCOs",
    short: "PCO",
    color: "border-amber-200 bg-amber-50 text-amber-800",
    active: "border-amber-300 bg-amber-50 text-amber-800",
  },
  pcco: {
    label: "PCCOs",
    short: "PCCO",
    color: "border-teal-200 bg-teal-50 text-teal-800",
    active: "border-teal-300 bg-teal-50 text-teal-800",
  },
};

function formatMoney(value: string | null): string | null {
  if (!value) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function ChangeCard({ item }: { item: ChangeItem }) {
  const meta = TYPE_META[item.type];
  const amount = formatMoney(item.amount);
  const content = (
    <article className="group rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
      <div className="flex items-start gap-2.5">
        <span className={`flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg border px-1.5 text-[10px] font-black ${meta.color}`} aria-hidden="true">
          {meta.short}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-sm font-extrabold leading-5 text-slate-950">{item.title}</h3>
            {item.sourceUrl && <span className="text-sm text-slate-400 transition group-hover:text-teal-700" aria-hidden="true">↗</span>}
          </div>
          <p className="mt-1 truncate text-[11px] font-semibold text-slate-500">
            {item.project.number ? `${item.project.number} · ` : ""}{item.project.name}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide">
        {item.number && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">#{item.number}</span>}
        {item.status && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">{item.status}</span>}
        {amount && <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">{amount}</span>}
      </div>
    </article>
  );

  return item.sourceUrl ? (
    <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="block no-underline" aria-label={`Open ${item.title} in Procore`}>
      {content}
    </a>
  ) : content;
}

function LoadingState() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-6xl animate-pulse">
        <div className="h-8 w-52 rounded bg-slate-200" />
        <div className="mt-3 h-4 w-80 max-w-full rounded bg-slate-200" />
        <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((key) => <div key={key} className="h-24 rounded-2xl bg-white shadow-sm" />)}
        </div>
      </div>
    </main>
  );
}

export default function PmDashboardChangesPage() {
  const [data, setData] = useState<ChangesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTypes, setActiveTypes] = useState<Set<PmChangeType>>(new Set(PM_CHANGE_TYPES));
  const [projectId, setProjectId] = useState("all");

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/pm-dashboard/changes", { cache: "no-store", credentials: "include" });
      const payload = await response.json().catch(() => ({})) as ChangesResponse;
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to load open changes.");
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load open changes.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const items = useMemo(() => data?.items || [], [data?.items]);
  const projects = useMemo(() => Array.from(new Map(items.map((item) => [item.project.id, item.project])).values())
    .sort((a, b) => a.name.localeCompare(b.name)), [items]);
  const filtered = useMemo(() => items.filter((item) => (
    activeTypes.has(item.type) && (projectId === "all" || item.project.id === projectId)
  )), [activeTypes, items, projectId]);
  const grouped = useMemo(() => Array.from(new Map(projects.map((project) => [
    project.id,
    { project, items: filtered.filter((item) => item.project.id === project.id) },
  ])).values()).filter((group) => group.items.length > 0), [filtered, projects]);

  const toggleType = (type: PmChangeType) => {
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
      <div className="mx-auto max-w-6xl">
        <nav className="mb-5 inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm" aria-label="PM dashboard views">
          <Link href="/pm-dashboard" className="rounded-lg px-3 py-2 text-xs font-black text-slate-500 no-underline transition hover:text-teal-800">5-Day Work</Link>
          <span className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-black text-white">Open Changes</span>
        </nav>

        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-teal-700">
              <span className="h-2 w-2 rounded-full bg-teal-500" />
              Change management
            </div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Open changes</h1>
            <p className="mt-2 text-sm font-medium text-slate-500">
              {data?.user?.name ? `${data.user.name} · ` : ""}Change Events, PCOs, and PCCOs on your projects.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-semibold text-slate-500">
              {data?.latestSync ? `Updated ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: PM_DASHBOARD_TIME_ZONE }).format(new Date(data.latestSync))}` : "Waiting for first background sync"}
            </p>
            <button type="button" onClick={() => void load(true)} disabled={refreshing} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black text-slate-700 shadow-sm transition hover:border-teal-500 hover:text-teal-800 disabled:cursor-wait disabled:opacity-60">
              {refreshing ? "Refreshing…" : "Refresh view"}
            </button>
          </div>
        </header>

        {error ? (
          <section className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-5" role="alert">
            <p className="font-black text-rose-900">We couldn’t load open changes.</p>
            <p className="mt-1 text-sm text-rose-700">{error}</p>
          </section>
        ) : (
          <>
            <section className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Open changes summary">
              {[
                ["All open", items.length, "Across your projects", "text-slate-950"],
                ["Change Events", items.filter((item) => item.type === "change_event").length, "Open or pending", "text-violet-700"],
                ["PCOs", items.filter((item) => item.type === "pco").length, "Not yet approved", "text-amber-700"],
                ["PCCOs", items.filter((item) => item.type === "pcco").length, "Not yet approved", "text-teal-700"],
              ].map(([label, value, detail, color]) => (
                <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
                  <p className={`mt-2 text-3xl font-black ${color}`}>{value}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-400">{detail}</p>
                </div>
              ))}
            </section>

            <section className="mt-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2" aria-label="Filter change types">
                {PM_CHANGE_TYPES.map((type) => {
                  const meta = TYPE_META[type];
                  const active = activeTypes.has(type);
                  return (
                    <button key={type} type="button" aria-pressed={active} onClick={() => toggleType(type)} className={`rounded-xl border px-3 py-2 text-xs font-black transition ${active ? meta.active : "border-slate-200 bg-white text-slate-400"}`}>
                      {meta.label} <span className="ml-1 opacity-60">{items.filter((item) => item.type === type).length}</span>
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

            <div className="mt-5 space-y-4">
              {grouped.map(({ project, items: projectItems }) => (
                <section key={project.id} className="rounded-2xl border border-slate-200 bg-slate-100/60 p-3 sm:p-4">
                  <div className="mb-3 flex items-center justify-between gap-3 px-1">
                    <div className="min-w-0">
                      <p className="truncate text-base font-black text-slate-950">{project.name}</p>
                      {project.number && <p className="mt-0.5 text-[11px] font-bold text-slate-500">{project.number}</p>}
                    </div>
                    <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-white px-2 text-xs font-black text-slate-600">{projectItems.length}</span>
                  </div>
                  <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                    {projectItems.map((item) => <ChangeCard key={item.id} item={item} />)}
                  </div>
                </section>
              ))}
            </div>

            {filtered.length === 0 && (
              <section className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
                <p className="text-lg font-black text-slate-800">No open changes in this view.</p>
                <p className="mt-2 text-sm text-slate-500">Try another filter, or enjoy the clean slate.</p>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
