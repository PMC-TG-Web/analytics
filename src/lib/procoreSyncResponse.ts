type ResponseDetail = Record<string, unknown>;

function asDetail(detail: unknown): ResponseDetail | null {
  return detail && typeof detail === "object" && !Array.isArray(detail)
    ? detail as ResponseDetail
    : null;
}

export function procoreSyncDetailHasErrors(detail: unknown) {
  const value = asDetail(detail);
  if (!value) return false;
  return value.success === false || (Array.isArray(value.errors) && value.errors.length > 0);
}

export function procoreSyncResponseIsRateLimited(status: number, detail: unknown) {
  if (status === 429) return true;
  const value = asDetail(detail);
  if (value?.rateLimited === true || value?.rate_limited === true) return true;

  // Successful sync endpoints sometimes include a recovered 429 in diagnostic
  // metadata. That is not an active rate limit and must not fail the project.
  if (value?.success !== false && !procoreSyncDetailHasErrors(value)) return false;

  return /\b429\b|rate limit|too many requests|surpassed the max number of requests/i.test(
    JSON.stringify(detail),
  );
}

export function procoreSyncRateLimitUntil(detail: unknown) {
  const seen = new Set<unknown>();
  const candidates: unknown[] = [detail];
  while (candidates.length > 0) {
    const current = candidates.shift();
    if (current === null || current === undefined || seen.has(current)) continue;
    seen.add(current);

    if (typeof current === "string") {
      const match = current.match(/(?:cooldown|rate limit)[^\n]*?until\s+(\d{4}-\d{2}-\d{2}T[^\s"']+)/i);
      if (match) {
        const parsed = new Date(match[1].replace(/[.,;]+$/, ""));
        if (Number.isFinite(parsed.getTime())) return parsed;
      }
      continue;
    }
    if (Array.isArray(current)) {
      candidates.push(...current);
      continue;
    }
    if (typeof current !== "object") continue;

    const record = current as Record<string, unknown>;
    for (const key of ["rateLimitUntil", "rate_limit_until", "cooldownUntil", "cooldown_until"]) {
      const value = record[key];
      if (!value) continue;
      const parsed = value instanceof Date ? value : new Date(String(value));
      if (Number.isFinite(parsed.getTime())) return parsed;
    }
    candidates.push(...Object.values(record));
  }
  return null;
}

export function procoreApiErrorIsNotFound(error: unknown) {
  const status = Number((error as { status?: unknown } | null)?.status || 0);
  if (status === 404) return true;

  const message = error instanceof Error ? error.message : String(error ?? "");
  return /(?:^|\D)404(?:\D|$)/.test(message);
}
