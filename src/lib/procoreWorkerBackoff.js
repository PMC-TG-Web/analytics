// Procore reports a small short-window quota (observed limit 25, reset within
// seconds). Hitting the reserve arms a company-wide cooldown that every worker
// sharing the lease sees for a few seconds. Background loops previously
// abandoned the rest of their tick on the first such skip, which starved the
// actuals and nightly-structure queues even though quota reopened almost
// immediately. This helper turns those brief pauses into bounded waits.

export const DEFAULT_MAX_COOLDOWN_WAIT_MS = 45_000;
export const DEFAULT_WORKER_BUSY_WAIT_MS = 1_000;
export const COOLDOWN_WAIT_PADDING_MS = 250;

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Latest cooldown timestamp surfaced by a sync route response, whether the
 * route skipped before claiming work or deferred a project mid-sync.
 */
export function procoreWorkerResultRateLimitUntil(result) {
  if (!result || typeof result !== "object") return null;
  let latest = parseDate(result.rateLimitUntil);
  const steps = Array.isArray(result.steps) ? result.steps : [];
  for (const step of steps) {
    if (!step || step.rateLimited !== true) continue;
    const until = parseDate(step.rateLimitUntil);
    if (until && (!latest || until > latest)) latest = until;
  }
  return latest;
}

export function procoreWorkerResultRateLimited(result) {
  if (!result || typeof result !== "object") return false;
  if (result.deferred === true) return true;
  if (result.skipped === true && result.reason === "rate_limit_cooldown") return true;
  const steps = Array.isArray(result.steps) ? result.steps : [];
  return steps.some((step) => step && step.rateLimited === true);
}

/**
 * Decide how a background worker loop should react to one sync route response.
 *
 * Returns one of:
 *   { action: "wait", waitMs, reason: "worker_busy" | "rate_limit_cooldown" }
 *   { action: "stop", reason }
 *   { action: "proceed" }
 */
export function procoreWorkerRetryPlan(result, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const deadlineMs = options.deadlineMs ?? Number.POSITIVE_INFINITY;
  const maxCooldownWaitMs = options.maxCooldownWaitMs ?? DEFAULT_MAX_COOLDOWN_WAIT_MS;
  const busyWaitMs = options.busyWaitMs ?? DEFAULT_WORKER_BUSY_WAIT_MS;

  if (!result || typeof result !== "object") return { action: "proceed" };

  if (result.skipped === true && result.reason === "worker_busy") {
    if (nowMs + busyWaitMs >= deadlineMs) return { action: "stop", reason: "deadline" };
    return { action: "wait", waitMs: busyWaitMs, reason: "worker_busy" };
  }

  if (procoreWorkerResultRateLimited(result)) {
    const until = procoreWorkerResultRateLimitUntil(result);
    if (!until) return { action: "stop", reason: "rate_limit_cooldown" };
    const waitMs = Math.max(0, until.getTime() - nowMs) + COOLDOWN_WAIT_PADDING_MS;
    if (waitMs > maxCooldownWaitMs) return { action: "stop", reason: "rate_limit_cooldown" };
    if (nowMs + waitMs >= deadlineMs) return { action: "stop", reason: "deadline" };
    return { action: "wait", waitMs, reason: "rate_limit_cooldown" };
  }

  if (result.skipped === true) {
    return { action: "stop", reason: String(result.reason || "skipped") };
  }

  return { action: "proceed" };
}
