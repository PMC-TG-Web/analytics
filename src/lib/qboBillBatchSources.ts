import { NextRequest } from 'next/server';
import { prisma } from './prisma';
import { withBillingProcoreConnection } from './procoreConnection';
import { BatchWait, type BatchStage } from './qboBillBatch';
import { acquireProcoreWorker, releaseProcoreWorker } from './procoreSyncQueue';
import { withProcoreLiveApiBypassForSyncSecret } from './procore';
import { refreshQboCostCatalog } from './qboCostCatalogSync';
import { procoreSyncDetailHasErrors, procoreSyncResponseIsRateLimited } from './procoreSyncResponse';
import { procoreMonthWindow } from './procoreDateWindow';
import { POST as purchaseOrders } from '@/app/api/procore/sync/purchase-order-line-item-details/route';
import { POST as dailyLogs } from '@/app/api/procore/sync/productivity-projects/route';
import { POST as timecards } from '@/app/api/procore/sync/timecard-entries/route';

export async function refreshBillBatchSources(companyId: string, projectId: string, month: string, stage: BatchStage) {
  return withBillingProcoreConnection(() => refreshSources(companyId, projectId, month, stage));
}

async function refreshSources(companyId: string, projectId: string, month: string, stage: BatchStage) {
  const dates = procoreMonthWindow(month);
  const lease = await acquireProcoreWorker(companyId);
  if (!lease.acquired) throw new BatchWait('Waiting for Procore sync capacity.');
  try {
    const secret = process.env.PROCORE_SYNC_SECRET || process.env.SYNC_SECRET;
    if (!secret) throw new Error('The Procore sync connection is not configured.');
    const request = new NextRequest('http://internal/api/procore/sync/bill-batch', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-secret': secret, 'x-procore-connection': 'billing' },
      body: JSON.stringify({ companyId, projectIds: [projectId], ...dates,
        concurrency: 1, persist: true, persistUnpackedFields: false, forceUserOAuth: false }) });
    await withProcoreLiveApiBypassForSyncSecret(request, async () => {
      if (stage === 'catalog') {
        await refreshQboCostCatalog(companyId);
        const state = await prisma.procoreSyncProjectState.findUnique({ where: { companyId_projectId_dataset: { companyId, projectId: '__company__', dataset: 'qbo_cost_catalog' } } });
        if (!state?.lastSuccessAt || state.lastError || Date.now() - state.lastSuccessAt.getTime() > 10 * 60_000) throw new BatchWait('Waiting for a successful current Cost Catalog refresh.');
        return;
      }
      const handler = stage === 'purchase_orders' ? purchaseOrders : stage === 'daily_logs' ? dailyLogs : timecards;
      const response = await handler(request);
      const data = await response.json();
      if (procoreSyncResponseIsRateLimited(response.status, data)) throw new BatchWait('Waiting for Procore API capacity.', 300_000);
      if (!response.ok || procoreSyncDetailHasErrors(data) || procoreSyncDetailHasErrors(data.summary) || data.activeProjects?.some((p: { status?: string }) => /unavailable|error/i.test(p.status || ''))) {
        throw new Error(`${stage.replaceAll('_', ' ')} refresh did not complete${response.ok ? '' : ` (HTTP ${response.status})`}. ${[...(data.errors || data.summary?.errors || []), data.error || '', data.details || ''].join(' ').slice(0, 1200)}`);
      }
    });
  } finally { await releaseProcoreWorker(companyId, lease.leaseId); }
}
