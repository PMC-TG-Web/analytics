type HeaderReader = Pick<Headers, "get">;

export type ProcoreQuotaObservation = {
  limit: number | null;
  remaining: number | null;
  resetAt: Date | null;
  cooldownUntil: Date | null;
  rateLimited: boolean;
};

export function procoreBackgroundReserve(value: string | undefined) {
  if (value === undefined || value.trim() === "") return 100;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 100;
}

function retryAfterDelayMs(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const when = Date.parse(value);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - nowMs);
}

/**
 * Procore commonly returns x-rate-limit-reset without Retry-After. Waiting for
 * that epoch avoids exhausting every exponential retry before the window has
 * actually reopened.
 */
export function procoreRateLimitDelayMs(
  headers: HeaderReader,
  options: {
    fallbackMs: number;
    maxDelayMs: number;
    nowMs?: number;
    resetPaddingMs?: number;
  },
): number {
  const nowMs = options.nowMs ?? Date.now();
  const retryAfterMs = retryAfterDelayMs(headers.get("retry-after"), nowMs) ?? 0;
  const resetSeconds = Number(headers.get("x-rate-limit-reset"));
  const resetDelayMs = Number.isFinite(resetSeconds) && resetSeconds > 0
    ? Math.max(0, resetSeconds * 1_000 - nowMs + (options.resetPaddingMs ?? 100))
    : 0;
  const requestedDelayMs = Math.max(0, options.fallbackMs, retryAfterMs, resetDelayMs);
  return Math.min(Math.max(0, options.maxDelayMs), Math.ceil(requestedDelayMs));
}

function nonNegativeHeaderNumber(headers: HeaderReader, names: string[]) {
  for (const name of names) {
    const raw = headers.get(name);
    if (raw === null || raw.trim() === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

export function procoreQuotaObservation(
  headers: HeaderReader,
  status: number,
  options: {
    reserve: number;
    fallbackCooldownMs: number;
    nowMs?: number;
    resetPaddingMs?: number;
  },
): ProcoreQuotaObservation {
  const nowMs = options.nowMs ?? Date.now();
  const limit = nonNegativeHeaderNumber(headers, ["x-rate-limit-limit", "x-ratelimit-limit"]);
  const remaining = nonNegativeHeaderNumber(headers, ["x-rate-limit-remaining", "x-ratelimit-remaining"]);
  const resetSeconds = nonNegativeHeaderNumber(headers, ["x-rate-limit-reset", "x-ratelimit-reset"]);
  const retryAfterMs = retryAfterDelayMs(headers.get("retry-after"), nowMs);
  const resetAtMs = resetSeconds && resetSeconds * 1_000 > nowMs
    ? resetSeconds * 1_000 + (options.resetPaddingMs ?? 1_500)
    : retryAfterMs !== null
      ? nowMs + retryAfterMs + (options.resetPaddingMs ?? 1_500)
      : null;
  const rateLimited = status === 429;
  const configuredReserve = Math.max(0, options.reserve);
  const effectiveReserve = limit === null
    ? configuredReserve
    : Math.min(configuredReserve, Math.max(1, Math.floor(limit * 0.2)));
  const reserveReached = remaining !== null && remaining <= effectiveReserve;
  const cooldownUntilMs = rateLimited || reserveReached
    ? resetAtMs ?? nowMs + Math.max(1_000, options.fallbackCooldownMs)
    : null;

  return {
    limit,
    remaining,
    resetAt: resetAtMs === null ? null : new Date(resetAtMs),
    cooldownUntil: cooldownUntilMs === null ? null : new Date(cooldownUntilMs),
    rateLimited,
  };
}
