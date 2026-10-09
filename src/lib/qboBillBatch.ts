import { billProductSetupNeeded as productSetupNeeded } from './qboBillProductSetup.js';
// Pure state machine: each step is persisted before another project/operation starts.
export const batchStages = ['catalog', 'purchase_orders', 'daily_logs', 'timecards', 'review', 'setup_options', 'setup_budget', 'setup', 'bill_budget', 'prepare', 'post', 'verify'] as const;
export type BatchStage = typeof batchStages[number];
export type BatchStatus = 'queued' | 'waiting' | 'created' | 'updated' | 'current' | 'empty' | 'skipped' | 'needs_attention';
export type BatchContext = { customerId?: string; products?: string[]; fingerprint?: string; hadBill?: boolean; setupCompleted?: boolean };
export type BatchItem = { projectId: string; stage: string; attempts: number; context: BatchContext; writeStartedAt?: Date | null };
export type BatchReview = { action: string; connected: boolean; billId: string | null; billNumber: string | null; canPost: boolean; fingerprint: string | null; issues: string[]; products: Record<string, string> };
export type BatchDraft = { projectName: string; projectNumber: string | null; lines: { lineKey: string }[]; issues: string[]; issueSources: unknown[] };
export type BatchStep = { stage?: BatchStage; status: BatchStatus; message: string; context?: BatchContext; issues?: string[]; issueSources?: unknown[]; billNumber?: string | null; retryMs?: number; clearWrite?: boolean };
export type BatchDependencies<D extends BatchDraft> = {
  refresh(stage: BatchStage): Promise<void>;
  draft(): Promise<D>;
  review(draft: D): Promise<BatchReview>;
  options(draft: D): Promise<{ customerId: string | null; customers: { id: string; name: string; fullName: string }[] }>;
  customer(name: string, options: { id: string; name: string; fullName: string }[]): string | null;
  plan(draft: D): Promise<{ products: string[] }>;
  budget(draft: D, products: string[]): Promise<{ ready: boolean; message: string; retryAfterMs?: number }>;
  setup(draft: D, customerId: string): Promise<{ complete: boolean; remaining: number }>;
  markWrite(): Promise<void>;
  post(draft: D, fingerprint: string): Promise<{ billNumber: string; updated?: boolean; alreadyCurrent?: boolean }>;
};
export class BatchWait extends Error {
  retryMs: number;
  constructor(message: string, retryMs = 60_000) { super(message); this.retryMs = retryMs; }
}
export const batchTerminal = (status: string) => ['created', 'updated', 'current', 'empty', 'skipped', 'needs_attention'].includes(status);
export function batchError(error: unknown, attempts: number, writing = false): BatchStep {
  const message = error instanceof Error ? error.message : 'The project could not finish. Open its review for details.';
  if (writing) return { status: 'waiting', stage: 'verify', retryMs: 60_000, message: 'Checking whether QBO saved the bill before any further write.' };
  if (error instanceof BatchWait) return { status: 'waiting', retryMs: error.retryMs, message };
  if (attempts < 5 && /429|rate.limit|capacity|cooldown|offline|unavailable|timeout|timed out|still processing|disconnected|HTTP 50[234]/i.test(message)) return { status: 'waiting', retryMs: Math.min(300_000, 30_000 * 2 ** attempts), message };
  return { status: 'needs_attention', message, issues: [message] };
}
export async function advanceBillBatch<D extends BatchDraft>(item: BatchItem, deps: BatchDependencies<D>): Promise<BatchStep> {
  const context = { ...item.context };
  const stage = item.writeStartedAt ? 'verify' : item.stage;
  const next = (stage: BatchStage, message: string): BatchStep => ({ stage, status: 'queued', context, message });
  const block = (issues: string[], draft?: D): BatchStep => ({ status: 'needs_attention', message: issues[0], issues, issueSources: draft?.issueSources || [] });
  if (['catalog', 'purchase_orders', 'daily_logs', 'timecards'].includes(stage)) {
    await deps.refresh(stage as BatchStage);
    return next(batchStages[batchStages.indexOf(stage as BatchStage) + 1], `${stage.replaceAll('_', ' ')} refreshed.`);
  }
  const draft = await deps.draft();
  if (draft.issues.length) return block(draft.issues, draft);
  if (stage === 'review' || stage === 'prepare' || stage === 'verify') {
    const review = await deps.review(draft);
    if (!review.connected && review.issues.length) throw new Error(review.issues.join(' '));
    if (review.action === 'current') return { status: stage === 'verify' ? (context.hadBill ? 'updated' : 'created') : 'current', message: 'Bill is current in QBO.', billNumber: review.billNumber, clearWrite: true };
    if (stage === 'verify') return block(['The previous save could not be verified as current. Open the project review to check QBO before retrying.']);
    if (review.action === 'reconcile') return block(review.issues.length ? review.issues : ['QBO changes require reconciliation. Open the project review.'], draft);
    if (!draft.lines.length && !review.billId && !review.issues.length) return { status: 'empty', message: 'No eligible monthly costs.' };
    const setupOnly = productSetupNeeded(draft, review);
    if (review.issues.length && !setupOnly) return block(review.issues, draft);
    if (!review.connected || setupOnly) {
      if (context.setupCompleted) return block(review.issues.length ? review.issues : ['Product setup finished but required mappings are still unavailable. Open the project setup to review.'], draft);
      delete context.fingerprint;
      return next('setup_options', 'Matching the QBO project and refreshing required products.');
    }
    if (review.issues.length) return block(review.issues, draft);
    if (stage === 'review') return next('bill_budget', 'Checking required Procore budget codes.');
    if (!review.canPost || !review.fingerprint) return block(['The bill is not ready to save. Open the project review.']);
    context.fingerprint = review.fingerprint;
    context.hadBill = !!review.billId;
    return next('post', 'Ready to save the complete monthly bill.');
  }
  if (stage === 'setup_options') {
    const options = await deps.options(draft);
    const customerId = options.customerId || deps.customer(draft.projectName, options.customers);
    if (!customerId) return block(['Choose the QBO customer/project in project setup; no unique exact match was found.']);
    context.customerId = customerId;
    return next('setup_budget', 'QBO project matched. Checking missing cost codes.');
  }
  if (stage === 'setup_budget' || stage === 'bill_budget') {
    let products: string[];
    if (stage === 'setup_budget') products = (await deps.plan(draft)).products;
    else {
      const review = await deps.review(draft);
      if (review.action !== 'reconcile' && productSetupNeeded(draft, review) && !context.setupCompleted) {
        delete context.fingerprint;
        return next('setup_options', 'Refreshing product assignments before checking budget codes.');
      }
      if (review.issues.length || review.action === 'reconcile') return block(review.issues.length ? review.issues : ['QBO changes require reconciliation.'], draft);
      products = draft.lines.map(line => review.products[line.lineKey]);
      if (products.some(name => !name)) return next('setup_options', 'Setting up missing products.');
    }
    if (!products.length) return block(['No QBO products were available for budget-code verification.']);
    const result = await deps.budget(draft, products);
    if (!result.ready) return { ...next(stage, result.message), status: 'waiting', retryMs: result.retryAfterMs || 60_000 };
    return next(stage === 'setup_budget' ? 'setup' : 'prepare', result.message);
  }
  if (stage === 'setup') {
    if (!context.customerId) return next('setup_options', 'Matching the QBO project.');
    const result = await deps.setup(draft, context.customerId);
    if (result.complete) context.setupCompleted = true;
    return next(result.complete ? 'review' : 'setup', result.complete ? 'Products are ready.' : `${result.remaining} product mappings remaining.`);
  }
  if (stage === 'post') {
    if (!context.fingerprint) return next('prepare', 'Refreshing the bill review.');
    // Persist intent first. A timeout/crash resumes with a live read, never a blind save.
    await deps.markWrite();
    try {
      const receipt = await deps.post(draft, context.fingerprint);
      return { status: receipt.alreadyCurrent ? 'current' : receipt.updated ? 'updated' : 'created', message: `${receipt.billNumber} saved in QBO.`, billNumber: receipt.billNumber, clearWrite: true };
    } catch (error) {
      // This exact host rejection occurs before its writer runs.
      if (error instanceof Error && error.message === 'Monthly costs or mappings changed. Reopen the project review before posting.') return { ...next('review', 'Source costs changed; rebuilding the review before saving.'), clearWrite: true };
      return batchError(error, item.attempts, true);
    }
  }
  throw new Error('Unrecognized batch stage. Review the saved run.');
}
