import { prisma } from './prisma';
import { runAllProjectsSync } from './procoreAllProjectsSync';
import { withAnalyticsSyncProcoreConnection } from './procoreConnection';
import { acquireProcoreWorker, releaseProcoreWorker } from './procoreSyncQueue';
import { procoreSyncDetailHasErrors, procoreSyncRateLimitUntil, procoreSyncResponseIsRateLimited } from './procoreSyncResponse';

// Run in the Netlify background process. An HTTP hop back to Next.js gives the
// full write pass only 60 seconds, regardless of the route's maxDuration.
export function runProjectReconciliation(params: { origin: string; secret: string; signal: AbortSignal }) {
  return withAnalyticsSyncProcoreConnection(async () => {
    const companyId = String(process.env.PROCORE_COMPANY_ID || '598134325805519').trim();
    const worker = await acquireProcoreWorker(companyId, 14);
    if (!worker.acquired) return {
      success: false, skipped: true, reason: worker.reason,
      rateLimitUntil: worker.control?.rate_limit_until?.toISOString(),
    };
    const startedAt = Date.now();
    let logId: bigint | undefined;
    try {
      const log = await prisma.syncLog.create({
        data: { companyId, triggeredBy: 'project-reconciliation', steps: [] },
        select: { id: true },
      });
      logId = log.id;
      const response = await runAllProjectsSync(new Request(`${params.origin}/api/procore/sync/all-projects`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-secret': params.secret },
        body: JSON.stringify({ companyId, fetchAll: true, forceUserOAuth: false,
          includeInactiveV1: false, includeTestProjects: false, maxPages: 200 }),
        signal: params.signal,
      }));
      const detail = await response.json().catch(() => null);
      const apiRequests = Number.parseInt(response.headers.get('x-procore-api-request-count') || '0', 10) || 0;
      const rateLimited = procoreSyncResponseIsRateLimited(response.status, detail);
      const headerUntil = response.headers.get('x-procore-rate-limit-until');
      const rateLimitUntil = procoreSyncRateLimitUntil(detail)?.toISOString() || headerUntil || undefined;
      const success = response.ok && detail?.success === true && !rateLimited
        && !procoreSyncDetailHasErrors(detail) && !procoreSyncDetailHasErrors(detail?.summary);
      // Identity conflicts can fill the log before its trailing errors. Keep
      // persistence failures first so a complete-but-failed pass is actionable.
      const errors = Array.isArray(detail?.summary?.errors) ? detail.summary.errors : [];
      const error = success ? null : JSON.stringify(errors.length
        ? { errors, identityConflictCount: detail.summary.identityConflicts?.length || 0 }
        : detail || `Project reconciliation returned HTTP ${response.status}`).slice(0, 4_000);
      const totalMs = Date.now() - startedAt;
      await prisma.syncLog.update({ where: { id: logId }, data: {
        finishedAt: new Date(), success, totalMs, error,
        steps: [{ step: 'all-active-projects', status: success ? 'ok' : 'error', httpStatus: response.status, apiRequests }],
      } });
      return { success, companyId, logId: logId.toString(), totalMs, apiRequests, detail, rateLimited, rateLimitUntil };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (logId !== undefined) await prisma.syncLog.update({ where: { id: logId }, data: {
        finishedAt: new Date(), success: false, totalMs: Date.now() - startedAt, error: message.slice(0, 4_000),
      } }).catch(() => undefined);
      return { success: false, error: message };
    } finally {
      await releaseProcoreWorker(companyId, worker.leaseId);
    }
  });
}
