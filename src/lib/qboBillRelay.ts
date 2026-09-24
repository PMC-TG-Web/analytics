import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

export async function requestQboBillRelay<T>(body: unknown): Promise<T> {
  const request = body as { operation?: string; companyId?: string };
  if (!['catalog', 'status', 'prepare', 'post', 'budget-plan', 'setup-options', 'setup', 'reconcile-preview', 'reconcile-confirm'].includes(request.operation || '') || !/^\d+$/.test(request.companyId || '')) throw new Error('Invalid QBO relay request.');
  const hostId = process.env.QBO_BILL_RELAY_HOST_ID || 'primary';
  const host = await prisma.qboBillRelayHost.findUnique({ where: { id: hostId } });
  if (!host || host.companyId !== request.companyId || Date.now() - host.updatedAt.getTime() > 20_000) throw new Error('The QBO host computer is offline. Turn it on and sign in, then refresh the review.');
  const id = randomUUID();
  await prisma.qboBillRelayJob.create({ data: { id, hostId, companyId: request.companyId!, operation: request.operation!, payload: body as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 50_000) } });
  const deadline = Date.now() + 50_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 450));
    const job = await prisma.qboBillRelayJob.findUnique({ where: { id } });
    if (job?.state === 'succeeded') return job.result as T;
    if (job?.state === 'failed') throw new Error(job.error || 'The shared QBO service could not complete this request.');
  }
  // Only cancel a request that never started. A running write may finish after the browser timeout.
  await prisma.qboBillRelayJob.updateMany({ where: { id, state: 'queued' }, data: { state: 'expired', finishedAt: new Date() } });
  throw new Error('The QBO host is still processing or disconnected. Refresh the review to check the saved bill before retrying.');
}
