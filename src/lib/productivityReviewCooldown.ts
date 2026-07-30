export const PRODUCTIVITY_REVIEW_COOLDOWN_DAYS = 30;
export const PRODUCTIVITY_COMPLETE_STATUS = "Complete";

const DAY_MS = 24 * 60 * 60 * 1000;

export function isCompleteBidBoardStatus(status: unknown): boolean {
  return String(status ?? "").trim().toLowerCase() === "complete";
}

export function parseBidBoardStatusChangedAt(
  payload: unknown,
  fallback: Date,
): Date {
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
  for (const candidate of [record.last_status_change, record.updated_at]) {
    const parsed = new Date(String(candidate ?? ""));
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return fallback;
}

export function calculateReviewEligibleAt(completedAt: Date): Date {
  return new Date(completedAt.getTime() + PRODUCTIVITY_REVIEW_COOLDOWN_DAYS * DAY_MS);
}

export function isReviewEligible(params: {
  bidBoardStatus: unknown;
  reviewEligibleAt: Date | string | null | undefined;
  now?: Date;
}): boolean {
  if (!isCompleteBidBoardStatus(params.bidBoardStatus)) return false;
  if (!params.reviewEligibleAt) return false;
  const eligibleAt = new Date(params.reviewEligibleAt);
  if (!Number.isFinite(eligibleAt.getTime())) return false;
  return eligibleAt <= (params.now || new Date());
}
