import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIncrementalActualsWindow,
  buildReconciliationActualsWindow,
  formatProcoreDate,
  procoreLookbackWindow,
} from "../src/lib/procoreDateWindow.ts";

test("Procore dates stay on the Eastern calendar day before midnight", () => {
  assert.equal(formatProcoreDate(new Date("2026-07-29T03:55:00Z")), "2026-07-28");
});

test("incremental Actuals uses a small overlap after the initial bootstrap", () => {
  assert.deepEqual(buildIncrementalActualsWindow({
    now: new Date("2026-09-02T12:00:00Z"),
    lastSuccessAt: new Date("2026-09-02T11:00:00Z"),
    initialLookbackDays: 45,
    overlapDays: 3,
  }), {
    startDate: "2026-08-30",
    endDate: "2026-09-02",
    mode: "incremental",
    overlapDays: 3,
  });
});

test("reconciliation rotates through bounded historical chunks", () => {
  const first = buildReconciliationActualsWindow({
    now: new Date("2026-09-02T12:00:00Z"),
    lastResult: null,
    totalLookbackDays: 400,
    chunkDays: 100,
  });
  assert.equal(first.startDate, "2026-05-25");
  assert.equal(first.endDate, "2026-09-02");
  assert.equal(first.reconciliationCursor.nextOffsetDays, 100);
  assert.equal(first.reconciliationCursor.completedCycle, false);

  const second = buildReconciliationActualsWindow({
    now: new Date("2026-09-02T12:00:00Z"),
    lastResult: { reconciliationCursor: first.reconciliationCursor },
    totalLookbackDays: 400,
    chunkDays: 100,
  });
  assert.equal(second.startDate, "2026-02-14");
  assert.equal(second.endDate, "2026-05-25");
  assert.equal(second.reconciliationCursor.nextOffsetDays, 200);
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
