/** Preserve provider reset metadata without suggesting that a partial clone can be replayed. */
export function cloneRateLimitResponse(error: unknown, nowMs = Date.now()) {
  if (!error || typeof error !== "object" || !("status" in error) || error.status !== 429) return null;
  const value = "rateLimitUntil" in error ? error.rateLimitUntil : undefined;
  const parsed = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
  const untilMs = Number.isFinite(parsed) && parsed > nowMs ? parsed : nowMs + 60_000;
  return {
    rateLimited: true,
    rateLimitUntil: new Date(untilMs).toISOString(),
    error: "Submittal clone paused because Procore's request limit was reached.",
    headers: { "Retry-After": String(Math.max(1, Math.ceil((untilMs - nowMs) / 1_000))), "Cache-Control": "no-store" },
  };
}
