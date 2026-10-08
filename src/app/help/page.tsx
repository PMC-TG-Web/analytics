'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { expandAssignedPermissions } from '@/lib/permissions';
import {
  canAccessHelpGuide,
  groupHelpGuidesByCategory,
  HELP_GUIDE_SUMMARIES,
  helpGuidePath,
} from '@/lib/helpGuides/catalog';

type PermissionState =
  | { status: 'loading' }
  | { status: 'ready'; permissions: string[]; email: string }
  | { status: 'failed' };

export default function HelpDirectoryPage() {
  const { user, loading } = useAuth();
  const [permissionState, setPermissionState] = useState<PermissionState>({ status: 'loading' });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [retry, setRetry] = useState(0);
  const ready = permissionState.status === 'ready' && permissionState.email === user?.email;

  useEffect(() => {
    if (loading || !user?.email) return;
    const controller = new AbortController();
    let cancelled = false;
    const timeout = setTimeout(() => controller.abort(), 15000);
    (async () => {
      try {
        const response = await fetch('/api/permissions/me', {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Permission request failed');
        const payload = await response.json() as { data?: { permissions?: unknown } };
        const assigned = Array.isArray(payload.data?.permissions)
          ? payload.data.permissions.filter((value): value is string => typeof value === 'string')
          : [];
        if (!cancelled) setPermissionState({ status: 'ready', permissions: expandAssignedPermissions(assigned), email: user.email });
      } catch {
        if (!cancelled) setPermissionState({ status: 'failed' });
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); };
  }, [loading, user?.email, retry]);

  const accessible = useMemo(() => ready && permissionState.status === 'ready'
    ? HELP_GUIDE_SUMMARIES.filter((guide) => canAccessHelpGuide(permissionState.permissions, guide))
    : [], [permissionState, ready]);

  const visibleGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = accessible.filter((guide) => (!category || guide.category === category)
      && (!term || [guide.title, guide.pageLabel, guide.summary, guide.quickStart, guide.category]
        .some((value) => value.toLowerCase().includes(term))));
    return groupHelpGuidesByCategory(filtered);
  }, [accessible, search, category]);

  const hiddenCount = ready
    ? HELP_GUIDE_SUMMARIES.length - accessible.length
    : 0;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-teal-950 via-teal-900 to-slate-900 px-6 py-6 text-white">
            <div className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-teal-100">Help</div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Get to know your pages</h1>
            <p className="mt-2 max-w-3xl text-sm text-teal-50/85">
              Start with the basics below. Each detailed guide explains what the page does, how to use it,
              where its data comes from, and how to interpret what you see.
            </p>
          </div>
          <div className="grid gap-4 px-6 py-5 text-sm sm:grid-cols-3">
            <div><h2 className="font-bold">1. Find your page</h2><p className="mt-1 leading-6 text-slate-600">Use the same name you see in navigation, or search a topic such as labor, billing, or crews.</p></div>
            <div><h2 className="font-bold">2. Follow the first steps</h2><p className="mt-1 leading-6 text-slate-600">Each guide walks through a first visit and explains the main fields with an example.</p></div>
            <div><h2 className="font-bold">3. Check the context</h2><p className="mt-1 leading-6 text-slate-600">Dates, filters, status, and data freshness matter. An estimate, an invoice, and a payment measure different things.</p></div>
          </div>
          <div className="flex flex-wrap items-end gap-4 border-t border-slate-100 px-6 py-4">
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
              Find a guide
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                type="search"
                placeholder="Page name or topic"
                className="mt-1 block h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm md:max-w-md"
              />
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
              Area
              <select value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 block h-11 max-w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
                <option value="">All areas</option>
                {[...new Set(accessible.map((guide) => guide.category))].sort().map((name) => <option key={name}>{name}</option>)}
              </select>
            </label>
            {(search || category) && <button onClick={() => { setSearch(''); setCategory(''); }} className="h-11 rounded-lg px-3 text-sm font-semibold text-teal-800 hover:bg-teal-50">Clear filters</button>}
          </div>
        </section>

        {!ready && permissionState.status !== 'failed' && (
          <div role="status" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-500">Loading your pages…</div>
        )}
        {permissionState.status === 'failed' && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950">
          We could not load your page access. <button onClick={() => { setPermissionState({ status: 'loading' }); setRetry((value) => value + 1); }} className="ml-2 font-bold underline">Try again</button>
        </div>}
        {ready && <p role="status" className="px-1 text-sm text-slate-600">{visibleGroups.reduce((count, group) => count + group.guides.length, 0)} guides shown · Guides follow your page access.</p>}

        {visibleGroups.map((group) => (
          <section key={group.category} className="space-y-3">
            <h2 className="px-1 text-xs font-black uppercase tracking-[0.2em] text-slate-500">{group.category}</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {group.guides.map((guide) => (
                <article key={guide.slug} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-lg font-black tracking-tight text-slate-900">{guide.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{guide.summary}</p>
                  <div className="mt-4 flex-1 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700"><span className="font-bold text-slate-900">Start here: </span>{guide.quickStart}</div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link href={helpGuidePath(guide)} className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-teal-700">
                      Detailed guide<span className="sr-only"> for {guide.pageLabel}</span> →
                    </Link>
                    <Link href={guide.pagePath} className="rounded-lg border border-teal-700 px-4 py-2 text-sm font-black text-teal-800 transition hover:bg-teal-50">
                      Go to {guide.pageLabel} →
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}

        {ready && visibleGroups.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-500">
            {search.trim() ? 'No guides match your search.' : 'No guides are available for the pages you can access yet.'}
          </div>
        )}

        {hiddenCount > 0 && (
          <p className="px-1 pb-4 text-xs text-slate-500">
            {hiddenCount} {hiddenCount === 1 ? 'guide is' : 'guides are'} hidden because you do not have access to {hiddenCount === 1 ? 'that page' : 'those pages'}.
          </p>
        )}
      </div>
    </main>
  );
}
