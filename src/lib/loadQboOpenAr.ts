import { prisma } from './prisma';
import { enqueueQboBillRelay } from './qboBillRelay';
import { OpenArDataError, isOpenArStale, parseOpenArReport, type OpenArHealth } from './qboOpenAr';
import { saveQboOpenArSnapshot } from './saveQboOpenArSnapshot.ts';

export async function loadQboOpenAr(companyId: string) {
  const snapshot = await prisma.qboOpenArSnapshot.findFirst({
    where: { companyId }, orderBy: [{ sourceGeneratedAt: 'desc' }, { importedAt: 'desc' }],
    select: { payload: true },
  });
  if (!snapshot) return null;
  const report = parseOpenArReport(snapshot.payload);
  if (report.companyId !== companyId) throw new OpenArDataError('The saved A/R snapshot belongs to another company.');
  return report;
}

export async function queueQboOpenAr(companyId: string, hourly = false) {
  if (process.env.QBO_BILL_RELAY_ENABLED !== 'true') throw new OpenArDataError('The shared QBO report relay is not configured for this application.');
  const hostId = process.env.QBO_BILL_RELAY_HOST_ID || 'primary';
  return prisma.$transaction(async database => {
    // Fence the initially empty scope too: scheduled and manual requests share this lock.
    await database.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`qbo-open-ar:${hostId}:${companyId}`}, 0))`;
    const now = new Date();
    const scope = { companyId, hostId, operation: 'open-ar' };
    const existing = await database.qboBillRelayJob.findFirst({
      where: { ...scope, OR: [{ state: 'processing' }, { state: 'queued', expiresAt: { gt: now } }] },
      orderBy: { createdAt: 'desc' }, select: { id: true },
    });
    if (existing) return { id: existing.id, state: 'queued' as const };
    if (hourly) {
      const completed = await database.qboBillRelayJob.findFirst({
        where: { ...scope, state: 'succeeded', createdAt: { gte: new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000) } },
        orderBy: { createdAt: 'desc' }, select: { id: true },
      });
      if (completed) return { id: completed.id, state: 'succeeded' as const };
    }
    const job = await enqueueQboBillRelay({ operation: 'open-ar', companyId }, 300_000, database);
    return { id: job.id, state: 'queued' as const };
  }, { maxWait: 5000, timeout: 10000 });
}

export async function loadQboOpenArHealth(companyId: string): Promise<OpenArHealth> {
  const hostId = process.env.QBO_BILL_RELAY_HOST_ID || 'primary';
  const [host, job] = await Promise.all([
    prisma.qboBillRelayHost.findUnique({ where: { id: hostId }, select: { companyId: true, updatedAt: true } }),
    prisma.qboBillRelayJob.findFirst({
      where: { companyId, hostId, operation: 'open-ar' }, orderBy: { createdAt: 'desc' },
      select: { state: true, createdAt: true, finishedAt: true, expiresAt: true },
    }),
  ]);
  return {
    hostOnline: !!host && host.companyId === companyId && Date.now() - host.updatedAt.getTime() <= 20_000,
    latestRefresh: job ? {
      state: ['queued', 'processing'].includes(job.state) && job.expiresAt.getTime() <= Date.now() ? 'expired' : job.state,
      requestedAt: job.createdAt.toISOString(), finishedAt: job.finishedAt?.toISOString() || null,
    } : null,
  };
}

export async function completeQboOpenAr(companyId: string, id: string) {
  const job = await prisma.qboBillRelayJob.findFirst({
    where: { id, companyId, hostId: process.env.QBO_BILL_RELAY_HOST_ID || 'primary', operation: 'open-ar' },
    select: { id: true, state: true, expiresAt: true, result: true, error: true },
  });
  if (!job) throw new OpenArDataError('This A/R refresh was not found for the configured company.');
  if (job.state !== 'succeeded') {
    if (job.state === 'failed' && job.error) throw new OpenArDataError(`QBO refresh failed: ${job.error} The previous report was retained.`);
    if (['failed', 'expired'].includes(job.state) || job.expiresAt.getTime() <= Date.now()) {
      throw new OpenArDataError('The QBO refresh failed or expired. Check the host connection and retry. The previous report was retained.');
    }
    if (!['queued', 'processing'].includes(job.state)) throw new OpenArDataError('The A/R refresh has an unexpected status.');
    return { refresh: { id, state: job.state }, report: null };
  }
  const report = await saveQboOpenArSnapshot(prisma, companyId, job.result);
  return { refresh: { id, state: 'succeeded' }, report };
}

export async function loadQboOpenArAlertStatus(companyId: string) {
  const hostId = process.env.QBO_BILL_RELAY_HOST_ID || 'primary';
  const [health, snapshot, failure] = await Promise.all([
    loadQboOpenArHealth(companyId),
    prisma.qboOpenArSnapshot.findFirst({
      where: { companyId }, orderBy: { sourceGeneratedAt: 'desc' }, select: { sourceGeneratedAt: true, importedAt: true },
    }),
    prisma.qboBillRelayJob.findFirst({
      where: { companyId, hostId, operation: 'open-ar', OR: [
        { state: { in: ['failed', 'expired'] } },
        { state: { in: ['queued', 'processing'] }, expiresAt: { lte: new Date() } },
      ] },
      orderBy: { createdAt: 'desc' }, select: { id: true, state: true, expiresAt: true, finishedAt: true },
    }),
  ]);
  const lastReadAt = snapshot?.sourceGeneratedAt.toISOString() ?? null;
  let reason: 'offline' | 'failed' | 'expired' | 'missing' | 'stale' | null = null;
  if (!health.hostOnline) reason = 'offline';
  else if (health.latestRefresh?.state === 'failed') reason = 'failed';
  else if (health.latestRefresh?.state === 'expired') reason = 'expired';
  else if (failure && (!snapshot || (failure.finishedAt ?? failure.expiresAt) > snapshot.importedAt)) {
    // A retry waiting in the queue does not establish that the report recovered.
    reason = failure.state === 'failed' ? 'failed' : 'expired';
  }
  else if (!lastReadAt) reason = 'missing';
  else if (isOpenArStale(lastReadAt, Date.now())) reason = 'stale';
  return { reason, lastReadAt, lastFailureId: failure?.id ?? null };
}
