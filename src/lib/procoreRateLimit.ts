type HeaderReader = Pick<Headers, "get">;

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
