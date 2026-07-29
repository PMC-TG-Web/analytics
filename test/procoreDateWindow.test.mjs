import assert from "node:assert/strict";
import test from "node:test";
import {
  formatProcoreDate,
  procoreLookbackWindow,
} from "../src/lib/procoreDateWindow.ts";

test("Procore dates stay on the Eastern calendar day before midnight", () => {
  assert.equal(formatProcoreDate(new Date("2026-07-29T03:55:00Z")), "2026-07-28");
});

test("Procore dates advance after Eastern midnight", () => {
  assert.equal(formatProcoreDate(new Date("2026-07-29T04:01:00Z")), "2026-07-29");
});

test("actuals lookback windows use Eastern dates at both ends", () => {
  assert.deepEqual(procoreLookbackWindow(new Date("2026-07-29T03:55:00Z"), 45), {
    startDate: "2026-06-13",
    endDate: "2026-07-28",
  });
});
