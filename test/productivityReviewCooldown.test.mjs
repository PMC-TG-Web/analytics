import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateReviewEligibleAt,
  isCompleteBidBoardStatus,
  isReviewEligible,
  parseBidBoardStatusChangedAt,
} from "../src/lib/productivityReviewCooldown.ts";

test("only Complete starts the productivity review cooldown", () => {
  assert.equal(isCompleteBidBoardStatus("COMPLETE"), true);
  assert.equal(isCompleteBidBoardStatus(" Complete "), true);
  assert.equal(isCompleteBidBoardStatus("Post-Construction"), false);
});

test("Bid Board last_status_change is the authoritative start", () => {
  const changedAt = parseBidBoardStatusChangedAt(
    {
      last_status_change: "2026-07-30T12:46:24.376002Z",
      updated_at: "2026-07-31T12:00:00Z",
    },
    new Date("2026-08-01T00:00:00Z"),
  );
  assert.equal(changedAt.toISOString(), "2026-07-30T12:46:24.376Z");
});

test("review eligibility begins exactly thirty days after Complete", () => {
  const completedAt = new Date("2026-07-01T14:00:00Z");
  const eligibleAt = calculateReviewEligibleAt(completedAt);
  assert.equal(eligibleAt.toISOString(), "2026-07-31T14:00:00.000Z");
  assert.equal(isReviewEligible({
    bidBoardStatus: "Complete",
    reviewEligibleAt: eligibleAt,
    now: new Date("2026-07-31T13:59:59Z"),
  }), false);
  assert.equal(isReviewEligible({
    bidBoardStatus: "Complete",
    reviewEligibleAt: eligibleAt,
    now: new Date("2026-07-31T14:00:00Z"),
  }), true);
});
