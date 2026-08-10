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
