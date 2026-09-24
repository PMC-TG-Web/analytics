import { prisma } from './prisma';
import { acquireProcoreWorker, releaseProcoreWorker } from './procoreSyncQueue';
import { getClientCredentialsToken, makeRequest, withProcoreLiveApiBypassForSyncSecret } from './procore';
import { budgetCodesForProducts, recentBudgetCodesCover, ensureBudgetCodeStep, type BudgetPending, type Wbs, type Budget } from './qboBudgetReadiness';

export async function ensureQboBudgetReadiness(companyId: string, projectId: string, projectNumber: string, products: string[]) {
  if (companyId !== process.env.PROCORE_COMPANY_ID || !/^\d+$/.test(projectId)) throw new Error('Invalid Procore budget setup identity.');
  const codes = budgetCodesForProducts(projectNumber, products);
  const project = await prisma.pmcProject.findFirst({ where: { companyId, procoreProjectId: projectId } });
  if (!project || project.projectNumber?.trim() !== projectNumber.trim()) throw new Error('Project identity changed. Refresh the bill review.');
  const where = { companyId_projectId_dataset: { companyId, projectId, dataset: 'qbo_bill_budget_setup' } };
  const previous = await prisma.procoreSyncProjectState.findUnique({ where });
  // A known budget entry needs no live API request on every bill save. Never
  // allow a snapshot to conceal an uncertain outstanding mutation.
  if (!previous?.lastError) {
    const snapshot = previous?.lastResult as { version?: number; projectNumber?: string; verifiedAt?: string; codes?: string[] } | null;
    if (snapshot?.version === 1 && snapshot.projectNumber === projectNumber.trim() && Array.isArray(snapshot.codes) && snapshot.verifiedAt && recentBudgetCodesCover(codes, snapshot.codes.map(code => ({ code, verifiedAt: snapshot.verifiedAt! })))) return { ready: true, remaining: 0, message: 'Procore budget codes were recently verified.' };
    const mirrored = await prisma.budgetLineItem.findMany({ where: { companyId, projectId }, select: { costCode: true, syncedAt: true } });
    if (recentBudgetCodesCover(codes, mirrored.map(row => ({ code: row.costCode || '', verifiedAt: row.syncedAt })))) return { ready: true, remaining: 0, message: 'Procore budget codes are present in the current synchronized budget.' };
  }
  const lease = await acquireProcoreWorker(companyId);
  if (!lease.acquired) return { ready: false, remaining: codes.length, retryAfterMs: 5000, message: lease.reason === 'rate_limit_cooldown' ? 'Waiting for Procore API capacity before checking budget codes. No bill has been saved.' : 'Waiting for the current Procore sync before checking budget codes.' };
  try {
    const state = await prisma.procoreSyncProjectState.findUnique({ where });
    const pending = state?.lastError ? JSON.parse(state.lastError) as BudgetPending : null;
    const savePending = async (value: BudgetPending | null) => {
      const data = { lastError: value ? JSON.stringify(value) : null, lastAttemptAt: new Date(), nextRunAt: new Date() };
      await prisma.procoreSyncProjectState.upsert({ where, create: { companyId, projectId, dataset: 'qbo_bill_budget_setup', ...data }, update: data });
    };
    const secret = process.env.PROCORE_SYNC_SECRET || process.env.SYNC_SECRET;
    if (!secret) throw new Error('Procore budget setup requires the configured server sync connection.');
    return await withProcoreLiveApiBypassForSyncSecret(new Request('http://internal/qbo-budget-setup', { headers: { 'x-sync-secret': secret } }), async () => {
      const token = await getClientCredentialsToken();
      const list = async <T>(path: string): Promise<T[]> => {
        const all: T[] = [];
        for (let page = 1; page <= 10; page++) {
          const result = await makeRequest(`${path}${path.includes('?') ? '&' : '?'}page=${page}&per_page=100`, token, {}, companyId);
          const batch = Array.isArray(result) ? result : (result as { data?: unknown }).data;
          if (!Array.isArray(batch)) throw new Error('Procore budget list was incomplete.');
          all.push(...batch);
          if (batch.length < 100) return all;
        }
        throw new Error('Procore budget list exceeded the supported size. No incomplete list can authorize a write.');
      };
      const create = async <T>(path: string, body: unknown) => {
        try {
          const result = await makeRequest(path, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, companyId);
          return ((result as { data?: unknown }).data || result) as T;
        } catch (error) {
          // Definitive rejections are safe to retry; timeouts/5xx retain the intent.
          const status = (error as { status?: number }).status;
          if (status && [400, 401, 403, 404, 422, 429].includes(status)) await savePending(null);
          throw error;
        }
      };
      return ensureBudgetCodeStep(codes, {
        pending, savePending,
        budgets: async () => {
          const rows = await list<Budget>(`/rest/v1.1/budget_line_items?project_id=${projectId}`);
          const lastResult = { version: 1, projectNumber: projectNumber.trim(), verifiedAt: new Date().toISOString(), codes: rows.map(row => row.wbs_code?.flat_code).filter(Boolean) };
          await prisma.procoreSyncProjectState.upsert({ where, create: { companyId, projectId, dataset: 'qbo_bill_budget_setup', lastResult }, update: { lastResult } });
          return rows;
        },
        wbs: () => list(`/rest/v1.0/projects/${projectId}/work_breakdown_structure/wbs_codes`),
        segments: async id => {
          // This endpoint returns the full collection and ignores pagination.
          const result = await makeRequest(`/rest/v1.0/projects/${projectId}/work_breakdown_structure/segments/${id}/segment_items`, token, {}, companyId);
          const rows = Array.isArray(result) ? result : (result as { data?: unknown; segment_items?: unknown }).data || (result as { segment_items?: unknown }).segment_items;
          if (!Array.isArray(rows)) throw new Error('Procore segment list was incomplete.');
          return rows;
        },
        createWbs: body => create<Wbs>(`/rest/v1.0/projects/${projectId}/work_breakdown_structure/wbs_codes`, body),
        createBudget: id => create<Budget>('/rest/v1.1/budget_line_items', { project_id: Number(projectId), budget_line_item: { wbs_code_id: id, original_budget_amount: '0.00', calculation_strategy: 'manual' } }),
      });
    });
  } catch (error) {
    if ((error as { status?: number }).status === 429) return { ready: false, remaining: codes.length, retryAfterMs: 5000, message: 'Waiting for Procore API capacity. Budget progress is saved; no bill has been posted.' };
    throw error;
  } finally { await releaseProcoreWorker(companyId, lease.leaseId); }
}
