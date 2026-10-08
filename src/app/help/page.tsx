'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { expandAssignedPermissions } from '@/lib/permissions';
import {
  canAccessHelpGuide,
  groupHelpGuidesByCategory,
  HELP_GUIDES,
  helpGuidePath,
} from '@/lib/helpGuides';

type PermissionState =
  | { status: 'loading' }
  | { status: 'ready'; permissions: string[] }
  | { status: 'failed' };

export default function HelpDirectoryPage() {
  const { user, loading } = useAuth();
  const [permissionState, setPermissionState] = useState<PermissionState>({ status: 'loading' });
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (loading || !user?.email) return;
    const controller = new AbortController();
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
        setPermissionState({ status: 'ready', permissions: expandAssignedPermissions(assigned) });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        setPermissionState({ status: 'failed' });
      }
    })();
    return () => controller.abort();
  }, [loading, user?.email]);

  const visibleGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    // Route guards still enforce access on each guide; if the permission read
    // fails we list everything rather than hide the directory entirely.
    const accessible = permissionState.status === 'ready'
      ? HELP_GUIDES.filter((guide) => canAccessHelpGuide(permissionState.permissions, guide))
      : [...HELP_GUIDES];
    const filtered = term
      ? accessible.filter((guide) => [guide.title, guide.pageLabel, guide.summary, guide.category]
        .some((value) => value.toLowerCase().includes(term)))
      : accessible;
    return groupHelpGuidesByCategory(filtered);
  }, [permissionState, search]);

  const hiddenCount = permissionState.status === 'ready'
    ? HELP_GUIDES.length - HELP_GUIDES.filter((guide) => canAccessHelpGuide(permissionState.permissions, guide)).length
    : 0;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-teal-950 via-teal-900 to-slate-900 px-6 py-6 text-white">
            <div className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-teal-100">Help</div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Page guides</h1>
            <p className="mt-2 max-w-3xl text-sm text-teal-50/85">
              Plain-language explanations of each Analytics page: what it is for, where its data comes from, and how to use it.
              Pick a guide to read the details, then jump straight to the page.
            </p>
          </div>
          <div className="px-6 py-4">
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
              Find a guide
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Page name or topic"
                className="mt-1 block h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm md:max-w-md"
              />
            </label>
          </div>
        </section>

        {permissionState.status === 'loading' && !loading && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-500">Loading your pages…</div>
        )}

        {visibleGroups.map((group) => (
          <section key={group.category} className="space-y-3">
            <h2 className="px-1 text-xs font-black uppercase tracking-[0.2em] text-slate-500">{group.category}</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {group.guides.map((guide) => (
                <article key={guide.slug} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-lg font-black tracking-tight text-slate-900">{guide.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">{guide.summary}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link href={helpGuidePath(guide)} className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-teal-700">
                      Read the guide
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

        {permissionState.status !== 'loading' && visibleGroups.length === 0 && (
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
