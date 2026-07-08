// POST /api/procore/sync/run-all
// Runs every necessary sync in sequence:
//   projects feed → prime contracts → change-order packages →
//   commitment contracts → commitment CO line items → bids →
//   timecard entries → productivity logs → budget line items
// Each step is attempted independently so a failure in one does not abort the rest.
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getClientCredentialsToken, procoreConfig, withProcoreLiveApiBypassForSyncSecret } from '@/lib/procore';
import { prisma } from '@/lib/prisma';

const SYNC_SECRET = process.env.PROCORE_SYNC_SECRET || '';

type StepResult = {
  step: string;
  ok: boolean;
  status?: number;
  summary?: unknown;
  error?: string;
};

function readNum(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parsePositiveInt(value: unknown, defaultValue: number, minValue = 1): number {
  const parsed = readNum(value);
  if (parsed === undefined) return defaultValue;
  return Math.max(minValue, Math.floor(parsed));
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchProjectIdsForCompany(companyId: string, maxProjects = 0): Promise<string[]> {
  const rows = await prisma.pmcProject.findMany({
    where: {
      companyId,
      procoreProjectId: { not: null },
    },
    select: { procoreProjectId: true },
    orderBy: { procoreProjectId: 'asc' },
    take: maxProjects > 0 ? maxProjects : undefined,
  });

  const seen = new Set<string>();
  const projectIds: string[] = [];
  for (const row of rows) {
    const projectId = String(row.procoreProjectId || '').trim();
    if (!projectId || seen.has(projectId)) continue;
    seen.add(projectId);
    projectIds.push(projectId);
  }

  return projectIds;
}

async function callSync(
  origin: string,
  path: string,
  body: Record<string, unknown>,
  accessToken: string,
  companyId: string
): Promise<StepResult> {
  const label = path.replace('/api/procore/sync/', '');
  try {
    const res = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `procore_access_token=${accessToken}; procore_company_id=${companyId}`,
        ...(SYNC_SECRET ? { 'x-sync-secret': SYNC_SECRET } : {}),
      },
      body: JSON.stringify(body),
    });
    let data: unknown;
    try { data = await res.json(); } catch { data = null; }
    return { step: label, ok: res.ok, status: res.status, summary: data };
  } catch (err) {
    return { step: label, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function callChunkedSync(params: {
  origin: string;
  path: string;
  baseBody: Record<string, unknown>;
  accessToken: string;
  companyId: string;
  projectIds: string[];
  chunkSize: number;
  gapMs: number;
}) {
  const chunks = chunkArray(params.projectIds, params.chunkSize);
  const chunkResults: StepResult[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const projectIds = chunks[i];
    const result = await callSync(
      params.origin,
      params.path,
      {
        ...params.baseBody,
        projectIds,
        concurrency: 1,
      },
      params.accessToken,
      params.companyId
    );
    chunkResults.push(result);

    if (i < chunks.length - 1 && params.gapMs > 0) {
      await sleep(params.gapMs);
    }
  }

  const successes = chunkResults.filter((result) => result.ok).length;
  const failures = chunkResults.length - successes;
  const label = params.path.replace('/api/procore/sync/', '');

  return {
    step: `${label}:chunked`,
    ok: failures === 0,
    status: failures === 0 ? 200 : 207,
    summary: {
      mode: 'chunked',
      totalProjects: params.projectIds.length,
      chunkSize: params.chunkSize,
      chunksTotal: chunkResults.length,
      chunksSucceeded: successes,
      chunksFailed: failures,
      failedChunks: chunkResults
        .map((result, index) => ({
          index,
          ok: result.ok,
          status: result.status,
          error: result.error,
        }))
        .filter((item) => !item.ok)
        .slice(0, 12),
    },
  } satisfies StepResult;
}

export async function POST(request: Request) {
  return withProcoreLiveApiBypassForSyncSecret(request, async () => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const cookieStore = await cookies();
    const cookieAccessToken = cookieStore.get('procore_access_token')?.value || '';
    const bodyAccessToken = String(body.accessToken || '').trim();
    const companyId = String(
      body.companyId || cookieStore.get('procore_company_id')?.value || procoreConfig.companyId || ''
    ).trim();

    let accessToken = bodyAccessToken || cookieAccessToken;
    if (!accessToken) {
      try {
        accessToken = await getClientCredentialsToken();
      } catch {
        return NextResponse.json(
          { success: false, error: 'Missing access token. Provide accessToken or configure client credentials.' },
          { status: 401 }
        );
      }
    }

    if (!companyId) {
      return NextResponse.json({ success: false, error: 'Missing companyId.' }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    const started = Date.now();
    const results: StepResult[] = [];
    const chunkHeavySync = body.chunkHeavySync !== false;
    const chunkSize = parsePositiveInt(body.chunkSize, 3, 1);
    const chunkGapMs = parsePositiveInt(body.chunkGapMs, 800, 0);
    const maxChunkProjects = Math.max(0, parsePositiveInt(body.maxChunkProjects, 0, 0));

    // Rolling date window: 90 days back → today (covers timecards & productivity)
    const today = new Date().toISOString().split('T')[0];
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // 1. Projects feed — must run first; all downstream syncs read project IDs from this table
    results.push(await callSync(origin, '/api/procore/sync/all-projects', { companyId, fetchAll: true }, accessToken, companyId));

    // 2. Prime contracts
    results.push(await callSync(origin, '/api/procore/sync/prime-contracts', { companyId, concurrency: 2 }, accessToken, companyId));

    // 3. Change-order packages
    results.push(await callSync(origin, '/api/procore/sync/change-order-packages', { companyId, limitProjects: 10000, concurrency: 2 }, accessToken, companyId));

    // 4. Commitment contracts (subcontracts)
    results.push(await callSync(origin, '/api/procore/sync/commitment-contracts', { companyId, concurrency: 2 }, accessToken, companyId));

    // 5. Commitment change-order line items (depends on commitment contracts existing)
    results.push(await callSync(origin, '/api/procore/sync/commitment-change-order-line-items', { companyId, concurrency: 2 }, accessToken, companyId));

    // 6. Bids (company-wide)
    results.push(await callSync(origin, '/api/procore/sync/bids', { companyId, companyWide: true, fetchAll: true }, accessToken, companyId));

    let chunkProjectIds: string[] = [];
    if (chunkHeavySync) {
      try {
        chunkProjectIds = await fetchProjectIdsForCompany(companyId, maxChunkProjects);
      } catch (err) {
        results.push({
          step: 'chunk-project-id-load',
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 7. Timecard entries — rolling 90-day window, concurrency 2 to stay safe
    if (chunkProjectIds.length > 0) {
      results.push(
        await callChunkedSync({
          origin,
          path: '/api/procore/sync/timecard-entries',
          baseBody: { companyId, startDate: ninetyDaysAgo, endDate: today, perPage: 100 },
          accessToken,
          companyId,
          projectIds: chunkProjectIds,
          chunkSize,
          gapMs: chunkGapMs,
        })
      );
    } else {
      results.push(await callSync(origin, '/api/procore/sync/timecard-entries', { companyId, startDate: ninetyDaysAgo, endDate: today, concurrency: 2 }, accessToken, companyId));
    }

    // 8. Productivity logs — rolling 90-day window, concurrency 2 to stay safe
    if (chunkProjectIds.length > 0) {
      results.push(
        await callChunkedSync({
          origin,
          path: '/api/procore/sync/productivity-projects',
          baseBody: { companyId, startDate: ninetyDaysAgo, endDate: today, perPage: 100 },
          accessToken,
          companyId,
          projectIds: chunkProjectIds,
          chunkSize,
          gapMs: chunkGapMs,
        })
      );
    } else {
      results.push(await callSync(origin, '/api/procore/sync/productivity-projects', { companyId, startDate: ninetyDaysAgo, endDate: today, concurrency: 2 }, accessToken, companyId));
    }

    // 9. Budget line items (company-wide, all projects)
    results.push(await callSync(origin, '/api/procore/sync/budget-line-items', { companyId, limitProjects: 10000, fetchAll: true }, accessToken, companyId));

    // 10. Purchase order line item contract details (required for productivity-cost-code join)
    if (chunkProjectIds.length > 0) {
      results.push(
        await callChunkedSync({
          origin,
          path: '/api/procore/sync/purchase-order-line-item-details',
          baseBody: { companyId, perPage: 50 },
          accessToken,
          companyId,
          projectIds: chunkProjectIds,
          chunkSize,
          gapMs: chunkGapMs,
        })
      );
    } else {
      results.push(await callSync(origin, '/api/procore/sync/purchase-order-line-item-details', { companyId, concurrency: 2, perPage: 100 }, accessToken, companyId));
    }

    // 11. Company users (cached for DB-first /api/procore/company-users)
    results.push(await callSync(origin, '/api/procore/sync/company-users', { companyId }, accessToken, companyId));

    // 12. Company vendors (cached for DB-first /api/procore/vendors)
    results.push(await callSync(origin, '/api/procore/sync/vendors', { companyId }, accessToken, companyId));

    // 13. Estimating catalogs (cached for DB-first /api/procore/estimating/catalogs)
    results.push(await callSync(origin, '/api/procore/sync/estimating-catalogs', { companyId }, accessToken, companyId));

    const elapsedMs = Date.now() - started;
    const allOk = results.every((r) => r.ok);

    return NextResponse.json({
      success: allOk,
      companyId,
      elapsedMs,
      steps: results,
    });
  });
}
