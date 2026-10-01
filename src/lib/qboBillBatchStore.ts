import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { batchTerminal, type BatchStep } from './qboBillBatch';
import { eligibleBillProjects } from './qboBillProjectPolicy';

export function billBatchEnabled() { return process.env.QBO_BILL_BATCH_ENABLED === 'true'; }
export function billBatchMaxProjects() {
  const value = process.env.QBO_BILL_BATCH_MAX_PROJECTS || '1';
  return /^[1-9]\d*$/.test(value) && Number(value) <= 100 ? Number(value) : 1;
}
export async function billBatchProjectOptions(companyId: string) {
  const projects = await prisma.pmcProject.findMany({ where: { companyId }, select: { procoreProjectId: true, projectName: true }, orderBy: { projectName: 'asc' } });
  return eligibleBillProjects(companyId, projects);
}
export async function assertNoActiveBillBatch(companyId: string) {
  if (!billBatchEnabled()) return;
  const run = await prisma.qboBillBatchRun.findUnique({ where: { activeKey: companyId }, select: { month: true } });
  if (run) throw new Error(`The ${run.month} monthly update is running. Wait for its results before saving an individual bill or changing its QBO setup.`);
}
export function validateBatchScope(companyId: string, month: string) {
  if (companyId !== process.env.PROCORE_COMPANY_ID || !/^\d+$/.test(companyId) || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Choose a valid company and month.');
}
export async function startBillBatch(companyId: string, month: string, actor: string, requestKey: string, retryOf?: string, projectIds?: unknown) {
  validateBatchScope(companyId, month);
  if (!billBatchEnabled()) throw new Error('Monthly batch updates are not enabled.');
  if (!/^[a-f0-9-]{36}$/i.test(requestKey) || !actor || actor.length > 254) throw new Error('Invalid batch request.');
  const selected = projectIds === undefined && retryOf ? null : projectIds;
  if (!(projectIds === undefined && retryOf) && (!Array.isArray(selected) || !selected.length || selected.some(id => typeof id !== 'string' || !/^\d+$/.test(id)) || new Set(selected).size !== selected.length)) throw new Error('Select the projects to update. Each project must appear once.');
  const ids = selected as string[] | null;
  if (ids && ids.length > billBatchMaxProjects()) throw new Error(`Select no more than ${billBatchMaxProjects()} project(s) for this run.`);
  const previous = await prisma.qboBillBatchRun.findUnique({ where: { companyId_requestKey: { companyId, requestKey } }, include: { projects: true } });
  if (previous) {
    if (previous.month !== month) throw new Error('This request belongs to a different month. Refresh before starting another run.');
    if ((previous.retryOf || undefined) !== retryOf || (ids && (ids.length !== previous.projects.length || previous.projects.some(p => !ids.includes(p.projectId))))) throw new Error('This request belongs to a different project selection. Refresh before starting another run.');
    return previous;
  }
  const active = await prisma.qboBillBatchRun.findUnique({ where: { activeKey: companyId } });
  if (active) return active;
  // Explicit canonical IDs only; names are display labels, never joins.
  let projects = await billBatchProjectOptions(companyId);
  if (ids) {
    projects = projects.filter(p => ids.includes(p.procoreProjectId));
    if (projects.length !== ids.length) throw new Error('A selected project is unavailable for this company. Refresh the project list.');
  }
  if (retryOf) {
    const source = await prisma.qboBillBatchRun.findFirst({ where: { id: retryOf, companyId, month, status: 'complete' }, include: { projects: { where: { status: 'needs_attention' } } } });
    if (!source) throw new Error('Choose a completed run for this company and month.');
    const unresolved = new Set(source.projects.map(p => p.projectId));
    if (ids?.some(id => !unresolved.has(id))) throw new Error('Retry only unresolved projects from the selected run.');
    projects = projects.filter(p => unresolved.has(p.procoreProjectId));
  }
  if (!projects.length) throw new Error('No projects need processing.');
  if (projects.length > billBatchMaxProjects()) throw new Error(`This run exceeds the ${billBatchMaxProjects()}-project limit. Select a smaller group to update.`);
  try {
    return await prisma.qboBillBatchRun.create({ data: { companyId, month, requestedBy: actor, requestKey, activeKey: companyId, retryOf,
      projects: { create: projects.map(p => ({ projectId: p.procoreProjectId, projectName: p.projectName })) } } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // Recheck request scope after a concurrent insert wins the unique key.
      const duplicate = await prisma.qboBillBatchRun.findUnique({ where: { companyId_requestKey: { companyId, requestKey } } });
      if (duplicate) return startBillBatch(companyId, month, actor, requestKey, retryOf, projectIds);
      const winner = await prisma.qboBillBatchRun.findUnique({ where: { activeKey: companyId } });
      if (winner) return winner;
    }
    throw error;
  }
}
export async function getBillBatch(companyId: string, month: string) {
  validateBatchScope(companyId, month);
  const run = await prisma.qboBillBatchRun.findFirst({ where: { companyId, month }, orderBy: { createdAt: 'desc' }, include: { projects: { orderBy: { projectName: 'asc' } } } });
  if (!run) return null;
  return { id: run.id, companyId, month, status: run.status, requestedBy: run.requestedBy, createdAt: run.createdAt, finishedAt: run.finishedAt,
    total: run.projects.length, finished: run.projects.filter(p => batchTerminal(p.status)).length,
    projects: run.projects.map(({ projectId, projectName, status, stage, message, issues, issueSources, billNumber }) => ({ projectId, projectName, status, stage, message, issues, issueSources, billNumber })) };
}
export async function claimBillBatch() {
  const run = await prisma.qboBillBatchRun.findFirst({ where: { status: 'running', OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, orderBy: { createdAt: 'asc' } });
  if (!run) return null;
  const token = randomUUID();
  const claim = await prisma.qboBillBatchRun.updateMany({ where: { id: run.id, status: 'running', OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, data: { leaseToken: token, leaseUntil: new Date(Date.now() + 180_000) } });
  return claim.count ? { ...run, leaseToken: token } : null;
}
export async function saveBillBatchStep(runId: string, token: string, projectId: string, previousStage: string, step: BatchStep) {
  await prisma.$transaction(async tx => {
    // Touch the parent under its fencing token; a stale worker cannot commit progress.
    const owned = await tx.qboBillBatchRun.updateMany({ where: { id: runId, leaseToken: token, leaseUntil: { gt: new Date() } }, data: { updatedAt: new Date() } });
    if (!owned.count) throw new Error('Batch worker lease expired.');
    await tx.qboBillBatchProject.update({ where: { runId_projectId: { runId, projectId } }, data: {
      status: step.status, stage: step.stage, message: step.message, context: step.context as Prisma.InputJsonValue | undefined,
      issues: (step.issues || []) as Prisma.InputJsonValue, issueSources: (step.issueSources || []) as Prisma.InputJsonValue,
      billNumber: step.billNumber, writeStartedAt: step.clearWrite ? null : undefined,
      attempts: step.status === 'waiting' && (!step.stage || step.stage === previousStage) ? { increment: 1 } : 0,
      nextAttemptAt: new Date(Date.now() + (step.retryMs || 0)),
    } });
  });
}
export async function markBatchWrite(runId: string, token: string, projectId: string) {
  await prisma.$transaction(async tx => {
    const owned = await tx.qboBillBatchRun.updateMany({ where: { id: runId, leaseToken: token, leaseUntil: { gt: new Date() } }, data: { updatedAt: new Date() } });
    if (!owned.count) throw new Error('Batch worker lease expired before saving.');
    await tx.qboBillBatchProject.update({ where: { runId_projectId: { runId, projectId } }, data: { writeStartedAt: new Date() } });
  });
}
export async function finishBillBatchTick(id: string, token: string) {
  await prisma.$transaction(async tx => {
    const remaining = await tx.qboBillBatchProject.count({ where: { runId: id, status: { in: ['queued', 'waiting'] } } });
    await tx.qboBillBatchRun.updateMany({ where: { id, leaseToken: token }, data: { leaseToken: null, leaseUntil: null,
      ...(!remaining ? { status: 'complete', activeKey: null, finishedAt: new Date() } : {}) } });
  });
}
