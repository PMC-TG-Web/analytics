export const STRUCTURE_STAGES = [
  { step: 'purchase-order-line-item-details', path: '/api/procore/sync/purchase-order-line-item-details' },
  { step: 'budget-line-items', path: '/api/procore/sync/budget-line-items' },
  { step: 'potential-change-orders', path: '/api/procore/sync/change-order-packages', syncScope: 'potential' },
  { step: 'change-order-packages', path: '/api/procore/sync/change-order-packages', syncScope: 'packages' },
  { step: 'commitment-change-order-line-items', path: '/api/procore/sync/commitment-change-order-line-items' },
] as const;

export const STRUCTURE_STAGE_TIMEOUT_MS = 40_000;

const easternHour = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23',
});

// Daily structure work only runs from 02:00-06:00 Eastern. An elapsed 24-hour
// delay after a daytime recovery would miss that window again the next day.
export function nextStructureRunMinutes(now = new Date()): number {
  const hourMs = 60 * 60_000;
  const currentHour = Math.floor(now.getTime() / hourMs) * hourMs;
  for (let offset = 1; offset <= 26; offset += 1) {
    const candidate = currentHour + offset * hourMs;
    const hour = Number(easternHour.format(new Date(candidate)));
    const previousHour = Number(easternHour.format(new Date(candidate - hourMs)));
    // Spring DST skips 02:00; 03:00 is that night's first scheduler tick.
    if (hour === 2 || (hour === 3 && previousHour === 1)) {
      return (candidate - now.getTime()) / 60_000;
    }
  }
  throw new Error('Unable to find the next Eastern nightly structure window');
}

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
