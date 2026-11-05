import { createHash } from 'node:crypto';
import { prisma } from './prisma';
import { enqueueQboBillRelay } from './qboBillRelay';
import { OpenArDataError, parseOpenArReport } from './qboOpenAr';

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

export async function queueQboOpenAr(companyId: string) {
  if (process.env.QBO_BILL_RELAY_ENABLED !== 'true') throw new OpenArDataError('The shared QBO report relay is not configured for this application.');
  const existing = await prisma.qboBillRelayJob.findFirst({
    where: { companyId, hostId: process.env.QBO_BILL_RELAY_HOST_ID || 'primary', operation: 'open-ar', state: { in: ['queued', 'processing'] }, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }, select: { id: true },
  });
  const job = existing || await enqueueQboBillRelay({ operation: 'open-ar', companyId }, 300_000);
  return { id: job.id, state: 'queued' as const };
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
  const report = parseOpenArReport(job.result);
  if (report.companyId !== companyId) throw new OpenArDataError('The QBO host returned a different company. The previous report was retained.');
  const sourceHash = createHash('sha256').update(JSON.stringify(report)).digest('hex');
  await prisma.qboOpenArSnapshot.upsert({
    where: { sourceHash }, update: {},
    create: {
      companyId, realmId: report.realmId, environment: report.environment, sourceHash,
      sourceGeneratedAt: new Date(report.generatedAt), asOfDate: new Date(report.asOfDate), payload: report,
    },
  });
  return { refresh: { id, state: 'succeeded' }, report };
}
