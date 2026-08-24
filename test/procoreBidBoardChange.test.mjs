import test from "node:test";
import assert from "node:assert/strict";

import { bidBoardPayloadChanged } from "../src/lib/procoreBidBoardChange.ts";

test("new Bid Board projects require an estimate detail sync", () => {
  assert.equal(bidBoardPayloadChanged(undefined, { id: "123" }), true);
});

test("object key order does not create a false Bid Board change", () => {
  assert.equal(
    bidBoardPayloadChanged(
      { id: "123", stats: { total: 10, count: 2 } },
      { stats: { count: 2, total: 10 }, id: "123" },
    ),
    false,
  );
});

test("JSONB floating-point round trips do not requeue unchanged totals", () => {
  assert.equal(
    bidBoardPayloadChanged(
      { id: "123", stats: { total: 462372.34269816 } },
      { id: "123", stats: { total: 462372.34269816004 } },
    ),
    false,
  );
  assert.equal(
    bidBoardPayloadChanged(
      { id: "123", stats: { total: 462372.34 } },
      { id: "123", stats: { total: 462372.35 } },
    ),
    true,
  );
});

test("local missing-row markers do not create a false Bid Board change", () => {
  assert.equal(
    bidBoardPayloadChanged(
      {
        id: "123",
        updated_at: "2026-07-29T12:00:00Z",
        sync_missing_from_procore: true,
        sync_missing_at: "2026-07-29T12:05:00Z",
      },
      { id: "123", updated_at: "2026-07-29T12:00:00Z" },
    ),
    false,
  );
});

test("Procore edits enqueue a fresh estimate detail sync", () => {
  assert.equal(
    bidBoardPayloadChanged(
      { id: "123", updated_at: "2026-07-29T12:00:00Z", stats: { total: 10 } },
      { id: "123", updated_at: "2026-07-29T12:01:00Z", stats: { total: 12 } },
    ),
    true,
  );
});
