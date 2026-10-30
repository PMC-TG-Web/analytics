export const ONBOARDING_STEPS = [
  "bid-board-projects", "estimate-proposal-line-items", "purchase-order-line-item-details",
  "budget-line-items", "change-order-packages", "commitment-change-order-line-items",
  "timecard-entries", "productivity-logs",
] as const;

export const ONBOARDING_STAGE_TIMEOUT_MS = 40_000;

export function onboardingProgress<T extends { step: string; status: string }>(previous: unknown, now = new Date()) {
  const saved = (previous as { onboardingProgress?: {
    cycleStartedAt: string; steps: T[]; bidBoardIds: string[];
  } } | null)?.onboardingProgress;
  const started = Date.parse(saved?.cycleStartedAt || "");
  if (saved && Number.isFinite(started) && started <= now.getTime() && started > now.getTime() - 86_400_000
    && Array.isArray(saved.steps) && saved.steps.length < ONBOARDING_STEPS.length
    && saved.steps.every((step, index) => step?.status === "ok" && step.step === ONBOARDING_STEPS[index])
    && Array.isArray(saved.bidBoardIds) && saved.bidBoardIds.every(id => typeof id === "string" && id.trim())
    && (saved.steps.length < 2 || saved.bidBoardIds.length > 0)) {
    return { cycleStartedAt: saved.cycleStartedAt, steps: [...saved.steps], bidBoardIds: [...saved.bidBoardIds] };
  }
  return { cycleStartedAt: now.toISOString(), steps: [] as T[], bidBoardIds: [] as string[] };
}
