import test from "node:test";
import assert from "node:assert/strict";

import { shouldStopBidBoardPagination } from "../src/lib/procoreBidBoardPagination.ts";
import { assessBidBoardCoverage } from "../src/lib/procoreBidBoardCoverage.ts";

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

test("known missing Bid Board rows do not lower current service-account coverage", () => {
  assert.deepEqual(
    assessBidBoardCoverage({ fetchedRows: 154, expectedVisibleRows: 155 }),
    { coverage: 154 / 155, complete: true },
  );
  assert.deepEqual(
    assessBidBoardCoverage({ fetchedRows: 154, expectedVisibleRows: 158 }),
    { coverage: 154 / 158, complete: false },
  );
});

test("an empty Bid Board response is never authoritative", () => {
  assert.equal(
    assessBidBoardCoverage({ fetchedRows: 0, expectedVisibleRows: 0 }).complete,
    false,
  );
});
