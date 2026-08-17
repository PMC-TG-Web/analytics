import assert from "node:assert/strict";
import test from "node:test";
import { calculateFinancialWip } from "../src/lib/financialWip.ts";

function project(overrides) {
  return {
    qboCustomerId: "1",
    projectName: "Test Project",
    customerName: "Test Customer",
    procoreProjectId: "procore-1",
    procoreProjectNumber: "P-1",
    procoreProjectName: "Test Project",
    procoreStatus: "In Progress",
    contractValue: 1000,
    contractValueSource: "procore",
    netBilled: 400,
    billingProgressPercent: 40,
    ...overrides,
  };
}

test("financial WIP separates positive unbilled work from overbilling", () => {
  const result = calculateFinancialWip([
    project({ qboCustomerId: "1", contractValue: 1000, netBilled: 400 }),
    project({ qboCustomerId: "2", contractValue: 500, netBilled: 650 }),
    project({ qboCustomerId: "3", contractValue: null, netBilled: 100 }),
  ], 300);

  assert.deepEqual(result.summary, {
    projectCount: 3,
    includedProjectCount: 2,
    unavailableProjectCount: 1,
    contractValue: 1500,
    netBilled: 1050,
    unbilledDollars: 600,
    overbilledDollars: 150,
    averageMonthlyBilled: 300,
    leadTimeMonths: 2,
  });
  assert.equal(result.projects[0].remainingToBill, 600);
  assert.equal(result.projects[1].remainingToBill, -150);
});

test("financial WIP has no lead time when the YTD monthly average is unavailable", () => {
  const result = calculateFinancialWip([project({})], 0);
  assert.equal(result.summary.leadTimeMonths, null);
});

test("financial WIP lead time divides sold backlog by average monthly billing", () => {
  const result = calculateFinancialWip([
    project({ contractValue: 5_775_207, netBilled: 0 }),
  ], 889_033);

  assert.ok(Math.abs(result.summary.leadTimeMonths - 6.49605470213142) < 1e-12);
});
