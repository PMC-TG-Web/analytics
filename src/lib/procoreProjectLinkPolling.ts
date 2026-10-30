type LinkResult = Record<string, unknown> & { status?: unknown; checkedAt?: unknown };

const DAY_MINUTES = 24 * 60;
const ready = (result: LinkResult) => ["created", "updated", "unchanged"].includes(String(result.status));

export function cachedCommitmentMakerLink(previous: unknown, explicit = false, now = new Date()) {
  const result = (previous as { commitmentMaker?: LinkResult } | null)?.commitmentMaker;
  const checked = Date.parse(String(result?.checkedAt || ""));
  if (!explicit && result && ready(result) && checked <= now.getTime()
    && checked > now.getTime() - DAY_MINUTES * 60_000) {
    // Preserve the original verification timestamp; retries must not extend it.
    return { ...result, cached: true };
  }
  return null;
}

export function projectLinkPolling(previous: unknown, jobScheduleStatus: unknown, commitmentMakerCheckedAt?: unknown, now = new Date()) {
  const missing = ["missing_folder", "missing_file", "missing_file_url"].includes(String(jobScheduleStatus));
  const parsed = Number((previous as { missingDocumentChecks?: unknown } | null)?.missingDocumentChecks);
  const prior = Number.isFinite(parsed) ? Math.max(0, Math.min(8, Math.trunc(parsed))) : 0;
  const missingDocumentChecks = missing ? Math.min(8, prior + 1) : 0;
  const checked = Date.parse(String(commitmentMakerCheckedAt || ""));
  const linkDueMinutes = Number.isFinite(checked) && checked <= now.getTime()
    ? Math.max(1, DAY_MINUTES - (now.getTime() - checked) / 60_000) : DAY_MINUTES;
  return {
    missingDocumentChecks,
    nextRunMinutes: Math.min(linkDueMinutes, missing ? Math.min(DAY_MINUTES, 15 * 2 ** (missingDocumentChecks - 1)) : DAY_MINUTES),
  };
}
