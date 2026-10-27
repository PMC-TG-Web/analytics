import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { streamSyncResponse } from '@/lib/procoreSyncStream';
import {
  makeRequest, procoreConfig, getClientCredentialsToken, hasValidProcoreSyncSecret,
  withProcoreLiveApiBypassForSyncSecret,
} from '@/lib/procore';
import { getCanonicalProjectIdsForCompany } from '@/lib/procoreCanonicalProjectIds';
import { fetchBudgetSnapshot } from '@/lib/procoreBudgetSnapshot';
import { startBudgetSnapshot, persistBudgetSnapshot } from '@/lib/procoreBudgetLineItems';

export async function POST(request: Request) {
  if (hasValidProcoreSyncSecret(request)) return streamSyncResponse(() => runSync(request));
  return runSync(request);
}

async function runSync(request: Request) {
  return withProcoreLiveApiBypassForSyncSecret(request, async () => {
    try {
      const body = await request.json().catch(() => ({}));
      const limitProjects = Math.max(1, Math.min(10000, Number.parseInt(String(body?.limitProjects || '100'), 10) || 100));
      const perPage = Math.min(200, Math.max(1, Number.parseInt(String(body?.perPage || '100'), 10) || 100));
      // Normal sync means a complete collection. Explicit partial reads retain
      // upsert compatibility but never authorize absence or report full success.
      const fetchAll = body?.fetchAll !== false;
      const cookieStore = await cookies();
      const userAccessToken = String(cookieStore.get('procore_access_token')?.value || body?.accessToken || '').trim();
      const companyId = String(body?.companyId || cookieStore.get('procore_company_id')?.value || procoreConfig.companyId || '').trim();
      if (!companyId) return NextResponse.json({ success: false, error: 'A Procore company ID is required.' }, { status: 400 });
      let accessToken = userAccessToken;
      if (!accessToken) {
        try { accessToken = await getClientCredentialsToken(); }
        catch (error) {
          if ((error as { status?: number })?.status === 429) throw error;
          return NextResponse.json({ success: false, error: 'Missing access token. Please login via OAuth.' }, { status: 401 });
        }
      }
      // A user token may have narrower visibility despite complete pagination.
      const authoritativeConnection = !userAccessToken;
      const explicit = Array.isArray(body?.projectIds) ? body.projectIds : String(body?.projectIds || '').split(',');
      const explicitProjectIds = [...new Set<string>(explicit.map((id: unknown) => String(id || '').trim()).filter(Boolean))];
      const projectIds = explicitProjectIds.length ? explicitProjectIds : await getCanonicalProjectIdsForCompany(companyId, limitProjects);
      if (!projectIds.length) return NextResponse.json({ success: false, error: 'No canonical Procore project IDs found for this company. Run All Projects Sync first.' }, { status: 400 });

      let projectsScanned = 0, projectsSkippedAccess = 0, fetched = 0, upserted = 0, missing = 0;
      let projectsComplete = 0, warningsTruncated = 0, errorsTruncated = 0, rateLimited = false;
      const warnings: string[] = [], errors: string[] = [];
      const projects: Array<{ projectId: string; complete: boolean; reconciled: boolean; fetched: number; upserted: number; missing: number }> = [];
      const warn = (message: string) => { if (warnings.length < 100) warnings.push(message); else warningsTruncated += 1; };
      const fail = (message: string) => { if (errors.length < 200) errors.push(message); else errorsTruncated += 1; };
      for (const projectId of projectIds) {
        projectsScanned += 1;
        try {
          const startedAt = await startBudgetSnapshot();
          const snapshot = await fetchBudgetSnapshot({ companyId, projectId, fetchAll, perPage,
            request: endpoint => makeRequest(endpoint, accessToken, { method: 'GET' }, companyId) });
          fetched += snapshot.items.length;
          const saved = await persistBudgetSnapshot({ companyId, projectId, items: snapshot.items, startedAt,
            complete: snapshot.complete, reconcileAbsent: snapshot.complete && authoritativeConnection });
          upserted += saved.upserted;
          missing += saved.missing;
          projects.push({ projectId, complete: snapshot.complete, reconciled: saved.reconciled, fetched: snapshot.items.length,
            upserted: saved.upserted, missing: saved.missing });
          if (snapshot.complete) projectsComplete += 1;
          else fail(`project:${projectId} budget collection was explicitly limited; missing rows were not reconciled.`);
          if (snapshot.complete && !authoritativeConnection) warn(`project:${projectId} user-token refresh updated visible rows only; absence requires the company sync connection.`);
        } catch (error) {
          const status = Number((error as { status?: number })?.status || 0);
          const message = error instanceof Error ? error.message : String(error);
          if (status === 403 || status === 404) {
            projectsSkippedAccess += 1;
            warn(`project:${projectId} budget source unavailable (${status}); saved snapshot preserved.`);
          }
          fail(`project:${projectId} budget snapshot => ${message}`);
          if (status === 429) { rateLimited = true; break; }
        }
      }
      const complete = projectsComplete === projectIds.length && errors.length === 0 && errorsTruncated === 0;
      return NextResponse.json({ success: complete, complete,
        message: complete ? 'Company budget line items sync complete' : 'Budget sync incomplete; unverified snapshots were preserved',
        data: { companyId, projectsLimit: limitProjects, projectsScanned, projectsSkippedAccess, fetched, upserted,
          missing, projectsComplete, projects, authoritativeConnection, warningsTruncated, errorsTruncated, warnings, errors },
      }, { status: rateLimited ? 429 : 200 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rateLimitUntil = (error as { rateLimitUntil?: Date })?.rateLimitUntil;
      const headers = rateLimitUntil instanceof Date && Number.isFinite(rateLimitUntil.getTime())
        ? { 'x-procore-rate-limit-until': rateLimitUntil.toISOString() } : undefined;
      return NextResponse.json({ success: false, complete: false, error: `Failed to sync company budget line items: ${message}` },
        { status: (error as { status?: number })?.status === 429 ? 429 : 500, headers });
    }
  });
}

export async function GET() {
  return NextResponse.json({ success: false, error: 'Budget line items sync requires POST.' }, { status: 405, headers: { Allow: 'POST' } });
}
