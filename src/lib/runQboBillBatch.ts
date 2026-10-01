import { prisma } from './prisma';
import { advanceBillBatch, batchError, type BatchContext, type BatchStep } from './qboBillBatch';
import { billProjectExclusion } from './qboBillProjectPolicy';
import { billBatchEnabled, claimBillBatch, finishBillBatchTick, markBatchWrite, saveBillBatchStep } from './qboBillBatchStore';
import { refreshBillBatchSources } from './qboBillBatchSources';
import { loadQboDirectCosts } from './loadQboDirectCosts';
import { loadQboBillReview } from './loadQboBillReview';
import { requestQboBillBridge } from './qboBillBridge';
import { matchQboCustomer } from './qboCustomerMatch';
import { ensureQboBudgetReadiness } from './ensureQboBudgetReadiness';

export async function runQboBillBatchTick() {
  if (!billBatchEnabled()) return { active: false };
  const run = await claimBillBatch();
  if (!run) return { active: false };
  try {
    const item = await prisma.qboBillBatchProject.findFirst({ where: { runId: run.id, status: { in: ['queued', 'waiting'] }, nextAttemptAt: { lte: new Date() } }, orderBy: [{ nextAttemptAt: 'asc' }, { projectName: 'asc' }] });
    if (!item) return { active: true, waiting: true };
    const scope = { companyId: run.companyId, projectId: item.projectId, month: run.month, actor: run.requestedBy };
    let step: BatchStep;
    try {
      const excluded = billProjectExclusion(run.companyId, item.projectId);
      if (excluded) {
        const message = item.writeStartedAt ? `${excluded} A previous save requires reconciliation before its outcome can be confirmed.` : `Skipped: ${excluded}`;
        step = { status: item.writeStartedAt ? 'needs_attention' : 'skipped', message, issues: item.writeStartedAt ? [message] : [] };
      } else {
        if (Date.now() - run.createdAt.getTime() > 24 * 60 * 60_000) throw new Error('This run could not finish within 24 hours. Review the issue and retry unresolved projects.');
        step = await advanceBillBatch({ ...item, context: item.context as BatchContext }, {
          refresh: stage => refreshBillBatchSources(run.companyId, item.projectId, run.month, stage),
          draft: () => loadQboDirectCosts(run.companyId, item.projectId, run.month),
          review: draft => loadQboBillReview(run.companyId, item.projectId, run.month, draft, true),
          customer: matchQboCustomer,
          options: draft => requestQboBillBridge({ ...scope, operation: 'setup-options', draft }),
          plan: draft => requestQboBillBridge({ ...scope, operation: 'budget-plan', draft }),
          budget: (draft, products) => ensureQboBudgetReadiness(run.companyId, item.projectId, draft.projectNumber || '', products),
          // Existing material/equipment offset policy was explicitly approved for this workflow.
          setup: (draft, customerId) => requestQboBillBridge({ ...scope, operation: 'setup', draft, customerId, otherCostsConfirmed: true }),
          markWrite: () => markBatchWrite(run.id, run.leaseToken, item.projectId),
          post: (draft, fingerprint) => requestQboBillBridge({ ...scope, operation: 'post', draft, fingerprint }),
        });
      }
    } catch (error) { step = batchError(error, item.attempts); }
    await saveBillBatchStep(run.id, run.leaseToken, item.projectId, item.stage, step);
    return { active: true, runId: run.id, projectId: item.projectId, status: step.status };
  } finally { await finishBillBatchTick(run.id, run.leaseToken); }
}
