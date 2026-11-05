import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

export async function enqueueQboBillRelay(body: unknown, timeoutMs = 50_000, database: Pick<Prisma.TransactionClient, 'qboBillRelayHost' | 'qboBillRelayJob'> = prisma) {
  const request = body as { operation?: string; companyId?: string };
  if (!['open-ar', 'catalog', 'status', 'prepare', 'post', 'budget-plan', 'setup-options', 'setup', 'reconcile-preview', 'reconcile-confirm'].includes(request.operation || '') || !/^\d+$/.test(request.companyId || '')) throw new Error('Invalid QBO relay request.');
  const hostId = process.env.QBO_BILL_RELAY_HOST_ID || 'primary';
  const host = await database.qboBillRelayHost.findUnique({ where: { id: hostId } });
  if (!host || host.companyId !== request.companyId || Date.now() - host.updatedAt.getTime() > 20_000) throw new Error('The QBO host computer is offline. Turn it on and sign in, then refresh the review.');
  const id = randomUUID();
  const maximum = request.operation === 'open-ar' ? 300_000 : 50_000;
  const lifetime = Number.isFinite(timeoutMs) ? Math.max(1000, Math.min(maximum, timeoutMs)) : 50_000;
  const expiresAt = new Date(Date.now() + lifetime);
  await database.qboBillRelayJob.create({ data: { id, hostId, companyId: request.companyId!, operation: request.operation!, payload: body as Prisma.InputJsonValue, expiresAt } });
  return { id, expiresAt };
}

export async function requestQboBillRelay<T>(body: unknown, readTimeoutMs?: number): Promise<T> {
  const request = body as { operation?: string };
  const timeoutMs = ['catalog', 'status'].includes(request.operation || '') && Number.isFinite(readTimeoutMs)
    ? Math.max(1000, Math.min(50_000, readTimeoutMs!)) : 50_000;
  const { id } = await enqueueQboBillRelay(body, timeoutMs);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 450));
    const job = await prisma.qboBillRelayJob.findUnique({ where: { id } });
    if (job?.state === 'succeeded') return job.result as T;
    if (job?.state === 'failed') throw new Error(job.error || 'The shared QBO service could not complete this request.');
  }
  // Only cancel a request that never started. A running write may finish after the browser timeout.
  await prisma.qboBillRelayJob.updateMany({ where: { id, state: 'queued' }, data: { state: 'expired', finishedAt: new Date() } });
  throw new Error(request.operation === 'open-ar'
    ? 'The QBO host is busy or disconnected. The previous A/R snapshot was retained. Retry Refresh from QBO.'
    : 'The QBO host is still processing or disconnected. Refresh the review to check the saved bill before retrying.');
}
