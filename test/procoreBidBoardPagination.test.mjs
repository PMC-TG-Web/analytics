import test from "node:test";
import assert from "node:assert/strict";

import { shouldStopBidBoardPagination } from "../src/lib/procoreBidBoardPagination.ts";

test("a short Procore Bid Board page does not end pagination", () => {
  assert.equal(
    shouldStopBidBoardPagination({ pageItemCount: 98, newProjectCount: 98 }),
    false
  );
});

test("pagination ends on an empty or fully repeated page", () => {
  assert.equal(
    shouldStopBidBoardPagination({ pageItemCount: 0, newProjectCount: 0 }),
    true
  );
  assert.equal(
    shouldStopBidBoardPagination({ pageItemCount: 98, newProjectCount: 0 }),
    true
  );
});
