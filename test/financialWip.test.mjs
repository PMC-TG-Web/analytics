import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateFinancialWip,
  calculateQboIncomeReconciliation,
  calculateSoldContractValue,
  calculateEstimatingSoldContracts,
  isInternalFinancialProject,
  projectNumberMatchesYear,
} from "../src/lib/financialWip.ts";

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
    ytdBilled: 300,
    revenueOnly: false,
    openReceivables: null,
    billingProgressPercent: 40,
    ...overrides,
  };
}

test("financial WIP separates positive unbilled work from overbilling", () => {
  const result = calculateFinancialWip([
    project({ qboCustomerId: "1", contractValue: 1000, netBilled: 400 }),
    project({ qboCustomerId: "2", contractValue: 500, netBilled: 650 }),
    project({ qboCustomerId: "3", contractValue: null, netBilled: 100, revenueOnly: true }),
  ], 300);

  assert.deepEqual(result.summary, {
    projectCount: 3,
    includedProjectCount: 2,
    unavailableProjectCount: 1,
    contractValue: 1500,
    contractProjectCount: 2,
    billedProjectCount: 3,
    billedWithoutContractProjectCount: 0,
    billedWithoutContractDollars: 0,
    revenueOnlyProjectCount: 1,
    revenueOnlyBilledDollars: 100,
    netBilled: 1150,
    contractBackedNetBilled: 1050,
    unbilledDollars: 600,
    overbilledDollars: 150,
    averageMonthlyBilled: 300,
    leadTimeMonths: 2,
  });
  assert.equal(result.projects[0].remainingToBill, 600);
  assert.equal(result.projects[1].remainingToBill, -150);
});

test("QBO income reconciliation bridges selected, filtered, and non-project income", () => {
  const result = calculateQboIncomeReconciliation({
    companyIncome: 6_371_150.94,
    incomeByCustomerId: {
      selected: 5_374_722.98,
      filtered: 877_039.68,
    },
    projectCustomerIds: ["selected", "filtered"],
    selectedProjectCustomerIds: ["selected"],
  });

  assert.deepEqual(result, {
    companyIncome: 6_371_150.94,
    selectedProjectIncome: 5_374_722.98,
    filteredProjectIncome: 877_039.68,
    nonProjectIncome: 119_388.28,
    reconciledTotal: 6_371_150.94,
    difference: 0,
  });
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

test("contract year follows the Procore project number convention", () => {
  assert.equal(projectNumberMatchesYear("2603 - WC", 2026), true);
  assert.equal(projectNumberMatchesYear("2601-MW", 2026), true);
  assert.equal(projectNumberMatchesYear("PROJECT-2026-A", 2026), true);
  assert.equal(projectNumberMatchesYear("2508 - SC", 2026), false);
  assert.equal(projectNumberMatchesYear("WG-25-001", 2026), false);
  assert.equal(projectNumberMatchesYear("PMC-OPS", 2026), false);
});

test("sold contract value uses one current-year project population", () => {
  assert.deepEqual(calculateSoldContractValue([
    { procoreProjectNumber: "2603 - WC", contractValue: 1_000_000.25 },
    { procoreProjectNumber: "PROJECT-2026-A", contractValue: 250_000 },
    { procoreProjectNumber: "2604 - Missing", contractValue: null },
    { procoreProjectNumber: "2508 - SC", contractValue: 900_000 },
  ], 2026), {
    year: 2026,
    projectCount: 3,
    contractProjectCount: 2,
    contractValue: 1_250_000.25,
  });
});

function estimate(overrides = {}) {
  return {
    bidBoardId: "board-1",
    procoreProjectId: "procore-1",
    projectNumber: "2603 - WC",
    projectName: "Test Project",
    status: "In Progress",
    projectArchived: false,
    sales: 1000,
    approvedChangeOrderAmount: 50,
    ...overrides,
  };
}

test("Financial WIP excludes PMC Operations by its internal job number or exact name", () => {
  assert.equal(isInternalFinancialProject({ procoreProjectNumber: " PMC-OPS " }), true);
  assert.equal(isInternalFinancialProject({ projectName: "pmc operations" }), true);
  assert.equal(isInternalFinancialProject({ procoreProjectName: "PMC Operations" }), true);
  assert.equal(isInternalFinancialProject({ projectName: "PMC Operations Addition", procoreProjectNumber: "2601 - POA" }), false);
  assert.equal(isInternalFinancialProject({ projectName: "Dutch Cousins Campground", procoreProjectNumber: "2510 - DCC" }), false);
  assert.equal(isInternalFinancialProject({}), false);
});

test("sold projects include accepted jobs without Procore or QBO setup and completed jobs", () => {
  const result = calculateEstimatingSoldContracts([
    estimate(),
    estimate({ bidBoardId: "board-2", procoreProjectId: null, status: "Accepted", sales: 2000, approvedChangeOrderAmount: 0 }),
    estimate({ bidBoardId: "board-3", procoreProjectId: "procore-3", status: "Complete", sales: 3000 }),
  ], 2026);
  assert.equal(result.projectCount, 3);
  assert.equal(result.contractProjectCount, 3);
  assert.equal(result.contractValue, 6100);
  assert.equal(result.projects.reduce((sum, row) => sum + row.contractValue, 0), result.contractValue);
  assert.ok(result.projects.some(row => row.id === "bid:board-2"));
});

test("sold projects exclude unsold statuses, archived jobs, and previous-year numbers", () => {
  const result = calculateEstimatingSoldContracts([
    ...["Bid Submitted", "Estimating", "Lost", "Cancelled", "Unknown", ""].map((status, index) =>
      estimate({ procoreProjectId: `unsold-${index}`, status })),
    estimate({ procoreProjectId: "archived", projectArchived: true }),
    estimate({ procoreProjectId: "previous", projectNumber: "2508 - SC" }),
    estimate({ procoreProjectId: "no-number", projectNumber: "" }),
    estimate({ status: " ACCEPTED " }),
  ], 2026);
  assert.equal(result.projectCount, 1);
  assert.equal(result.contractValue, 1050);
});

test("sold projects deduplicate explicit IDs while retaining distinct jobs with the same name and number", () => {
  const result = calculateEstimatingSoldContracts([
    estimate(),
    estimate({ bidBoardId: "alternate-board" }),
    estimate({ procoreProjectId: null, bidBoardId: "accepted-board", status: "Accepted" }),
    estimate({ procoreProjectId: null, bidBoardId: "accepted-board", status: "Accepted" }),
    estimate({ procoreProjectId: "procore-2", bidBoardId: "board-2" }),
  ], 2026);
  assert.equal(result.projectCount, 3);
  assert.equal(result.contractValue, 3150);
});

test("sold contract coverage preserves missing estimates and explicit zero values", () => {
  const result = calculateEstimatingSoldContracts([
    estimate({ sales: null }),
    estimate({ procoreProjectId: "missing-source", sales: 0, customFields: { estimatingSource: "no estimate" } }),
    estimate({ procoreProjectId: "zero", sales: 0, approvedChangeOrderAmount: 0 }),
    estimate({ procoreProjectId: "invalid", sales: Number.NaN }),
    estimate({ procoreProjectId: "decimal", sales: 1000.126, approvedChangeOrderAmount: -10.12 }),
  ], 2026);
  assert.equal(result.projectCount, 5);
  assert.equal(result.contractProjectCount, 2);
  assert.equal(result.contractValue, 990.01);
  assert.equal(result.projects.find(row => row.id === "procore:zero").contractValue, 0);
});
