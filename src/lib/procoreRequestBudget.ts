import type { ProcoreQuotaObservation } from './procoreRateLimit';

export type ProcoreRequestLane = 'background' | 'interactive';
export type ProcoreBudgetWindow = { limit: number; remaining: number; resetAt: number };
export type ProcoreGateState = {
  leaseId: string | null;
  leaseUntil: number;
  interactiveUntil: number;
  blockedUntil: number;
  windows: ProcoreBudgetWindow[];
};

export const PROCORE_REQUEST_LEASE_MS = 30_000;
export const PROCORE_INTERACTIVE_PRIORITY_MS = 15_000;

export function reserveProcoreRequest(state: ProcoreGateState, lane: ProcoreRequestLane, now: number, reserve: number) {
  const windows = state.windows.filter(window => window.resetAt > now);
  const interactiveUntil = lane === 'interactive'
    ? Math.max(state.interactiveUntil, now + PROCORE_INTERACTIVE_PRIORITY_MS)
    : state.interactiveUntil;
  let retryAt = state.blockedUntil > now ? state.blockedUntil : 0;
  for (const window of windows) {
    const floor = lane === 'background' ? Math.min(reserve, Math.max(1, Math.floor(window.limit * 0.25))) : 0;
    if (window.remaining <= floor) retryAt = Math.max(retryAt, window.resetAt);
  }
  if (lane === 'background' && interactiveUntil > now) retryAt = Math.max(retryAt, interactiveUntil);
  // Poll a held lease briefly; do not reserve a future send that could jump the
  // interactive queue or use stale quota. A crashed owner expires automatically.
  if (state.leaseId && state.leaseUntil > now) retryAt = Math.max(retryAt, now + 250);
  return {
    retryAt,
    interactiveUntil,
    windows: retryAt ? windows : windows.map(window => ({ ...window, remaining: Math.max(0, window.remaining - 1) })),
  };
}

export function observeProcoreBudget(windows: ProcoreBudgetWindow[], observation: ProcoreQuotaObservation | null, now: number) {
  const active = windows.filter(window => window.resetAt > now);
  if (observation?.limit === null || observation?.limit === undefined || observation.remaining === null) return active;
  // Headers can alternate between an hourly window and a short spike window.
  // Keep both; a new short-window response must not erase the hourly budget.
  const resetAt = observation.resetAt?.getTime();
  if (!resetAt || resetAt <= now) return active;
  return [
    ...active.filter(window => window.limit !== observation.limit),
    { limit: observation.limit, remaining: observation.remaining, resetAt },
  ];
}

export function procoreUsageEndpoint(method: string, path: string) {
  // Never persist query values, project IDs, tokens, or payloads in usage metrics.
  const pathname = path.split('?')[0].replace(/\b\d{5,}\b/g, ':id');
  return `${method.toUpperCase()} ${pathname}`.slice(0, 250);
}
