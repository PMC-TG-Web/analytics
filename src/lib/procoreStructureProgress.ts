export const STRUCTURE_STAGES = [
  { step: 'purchase-order-line-item-details', path: '/api/procore/sync/purchase-order-line-item-details' },
  { step: 'budget-line-items', path: '/api/procore/sync/budget-line-items' },
  { step: 'change-order-packages', path: '/api/procore/sync/change-order-packages' },
  { step: 'commitment-change-order-line-items', path: '/api/procore/sync/commitment-change-order-line-items' },
] as const;

export const STRUCTURE_STAGE_TIMEOUT_MS = 40_000;

// Only an unfinished, recent cycle can supply checkpoints. A completed cycle's
// last_result must never make the next daily refresh skip its reads.
export function structureProgress<T extends { step: string; status: string }>(
  previous: unknown, now = new Date(),
): { cycleStartedAt: string; steps: T[] } {
  const saved = previous as { structureProgress?: { cycleStartedAt?: string; steps?: T[] } } | null;
  const progress = saved?.structureProgress;
  const started = Date.parse(progress?.cycleStartedAt || '');
  const steps = progress?.steps;
  if (Number.isFinite(started) && now.getTime() >= started && now.getTime() - started < 24 * 60 * 60_000
    && Array.isArray(steps) && steps.length < STRUCTURE_STAGES.length
    && steps.every((step, index) => step?.status === 'ok' && step.step === STRUCTURE_STAGES[index].step)) {
    return { cycleStartedAt: progress!.cycleStartedAt!, steps: [...steps] };
  }
  return { cycleStartedAt: now.toISOString(), steps: [] };
}
