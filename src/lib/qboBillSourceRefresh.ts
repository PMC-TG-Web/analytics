import { prisma } from './prisma';
import { directCostMonth } from './qboDirectCosts';
import { acquireProcoreWorker, releaseProcoreWorker } from './procoreSyncQueue';

// One project per request, shared across tabs/machines, using the existing worker lane.
export async function refreshQboBillSources(companyId: string, month: string, sync: (projectId: string) => Promise<void>) {
  const { start, end } = directCostMonth(month);
  const lease = await acquireProcoreWorker(companyId);
  if (!lease.acquired) return { status: 'waiting', reason: lease.reason };
  try {
    const logs = await prisma.productivityLog.findMany({ where: { procoreCompanyId: companyId, date: { gte: start, lt: end } }, distinct: ['procoreProjectId'], select: { procoreProjectId: true } });
    const ids = logs.map(log => log.procoreProjectId);
    const states = await prisma.procoreSyncProjectState.findMany({ where: { companyId, dataset: 'bill_review_po', projectId: { in: ids } } });
    const byId = new Map(states.map(state => [state.projectId, state]));
    const now = new Date();
    const projectId = ids.filter(id => !byId.has(id) || byId.get(id)!.nextRunAt <= now)
      .sort((a, b) => (byId.get(a)?.lastAttemptAt?.getTime() || 0) - (byId.get(b)?.lastAttemptAt?.getTime() || 0))[0];
    if (!projectId) return { status: 'current' };
    const where = { companyId_projectId_dataset: { companyId, projectId, dataset: 'bill_review_po' } };
    const attempt = { lastAttemptAt: now, nextRunAt: new Date(now.getTime() + 5 * 60_000) };
    await prisma.procoreSyncProjectState.upsert({ where, create: { companyId, projectId, dataset: 'bill_review_po', ...attempt }, update: attempt });
    try {
      await sync(projectId);
      const checkedAt = new Date();
      await prisma.procoreSyncProjectState.update({ where, data: { lastSuccessAt: checkedAt, lastError: null, failureCount: 0 } });
      return { status: 'synced', projectId, checkedAt: checkedAt.toISOString() };
    } catch {
      await prisma.procoreSyncProjectState.update({ where, data: { lastError: 'PO refresh failed; automatic retry scheduled.', failureCount: { increment: 1 } } });
      throw new Error('A PO refresh failed. Automatic checks will retry; existing costs remain visible.');
    }
  } finally { await releaseProcoreWorker(companyId, lease.leaseId); }
}
