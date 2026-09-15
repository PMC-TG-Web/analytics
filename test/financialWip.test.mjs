import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateFinancialWip,
  calculateQboIncomeReconciliation,
  calculateSoldContractValue,
  calculateEstimatingSoldContracts,
  isInternalFinancialProject,
  projectNumberMatchesYear,
  financialDate,
  financialSoldDates,
  resolveSoldYear,
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

test("sold year uses contract date, then project number, then project start date", () => {
  const cases = [
    [{ contractDate: "2025-12-31", procoreProjectNumber: "2601-TEST", startDate: "2027-01-01" }, 2025, "contract_date"],
    [{ contractDate: new Date("2026-01-01T00:00:00Z"), procoreProjectNumber: "2501-TEST" }, 2026, "contract_date"],
    [{ contractDate: "bad", procoreProjectNumber: "2501-TEST", startDate: "2026-02-01" }, 2025, "project_number"],
    [{ contractDate: "", procoreProjectNumber: "WG-26-001", startDate: "2025-02-01" }, 2026, "project_number"],
    [{ contractDate: null, procoreProjectNumber: "NO-YEAR", startDate: "2026-02-01" }, 2026, "start_date"],
    [{ procoreProjectNumber: null, startDate: "2025-02-01" }, 2025, "start_date"],
    [{ procoreProjectNumber: "PMC-OPS", startDate: "bad" }, null, null],
  ];
  for (const [input, soldYear, soldYearSource] of cases) {
    assert.deepEqual(resolveSoldYear(input), { soldYear, soldYearSource });
  }
});

test("sold dates validate calendar days and preserve the recorded year across timezones", () => {
  for (const invalid of ["2026-02-30", "2026-02-29", "2026-13-01", "2026-00-01", "2026", "", null, 0, new Date(NaN)]) {
    assert.equal(financialDate(invalid), null);
  }
  assert.equal(financialDate("2024-02-29"), "2024-02-29");
  assert.equal(financialDate("2025-12-31T23:00:00-05:00"), "2025-12-31");
  assert.equal(financialDate("2026-01-01T01:00:00+05:00"), "2026-01-01");
});

test("sold breakdown and total use identical date precedence without changing values or identity rules", () => {
  const result = calculateEstimatingSoldContracts([
    estimate({ contractDate: "2025-12-31" }),
    estimate({ procoreProjectId: "prior-number", projectNumber: "2501-TEST", contractDate: "2026-02-01" }),
    estimate({ procoreProjectId: "prior-number", projectNumber: "2501-TEST", contractDate: "2026-02-01" }),
    estimate({ procoreProjectId: "start-only", projectNumber: "NO-YEAR", startDate: "2026-03-01", sales: 2000 }),
    estimate({ procoreProjectId: "job-year", contractDate: "invalid", startDate: "2025-03-01", sales: 3000 }),
    estimate({ procoreProjectId: "archived", projectArchived: true, contractDate: "2026-01-01" }),
    estimate({ procoreProjectId: "unsold", status: "Lost", contractDate: "2026-01-01" }),
  ], 2026);
  assert.equal(result.projectCount, 3);
  assert.equal(result.contractValue, 6150);
  assert.equal(result.projects.reduce((sum, row) => sum + row.contractValue, 0), result.contractValue);
  assert.deepEqual(new Set(result.projects.map(row => row.soldYearSource)), new Set(["contract_date", "start_date", "project_number"]));
  assert.equal(calculateSoldContractValue(result.projects, 2026).contractValue, result.contractValue);
  assert.equal(calculateEstimatingSoldContracts([estimate()], NaN).projectCount, 0);
});

test("sold date mirrors use scoped external IDs and the earliest approved contract date", () => {
  const contract = (overrides = {}) => ({
    company_id: "company", project_procore_id: "project", project_id: "local-wrong",
    status: "Approved", contract_date: "2026-02-01", payload: {}, ...overrides,
  });
  const staging = (overrides = {}) => ({
    companyId: "company", source: "procore_v1_projects", externalId: "project",
    procoreProjectId: "project", payload: { start_date: "2026-05-01" }, ...overrides,
  });
  const contracts = [
    contract(), contract({ contract_date: new Date("2025-12-01T00:00:00Z"), status: "Executed" }),
    contract({ contract_date: "2024-01-01", status: "Draft" }),
    contract({ contract_date: "2023-01-01", payload: { deleted_at: "2026-01-01" } }),
    contract({ contract_date: "2022-01-01", company_id: "other" }),
    contract({ project_procore_id: "payload-date", contract_date: null, payload: { contract_date: "2026-03-01" } }),
    contract({ project_procore_id: "invalid", contract_date: "2026-02-30" }),
  ];
  const projects = [
    staging(), staging({ companyId: "other", payload: { start_date: "2024-01-01" } }),
    staging({ source: "procore_bid_board", payload: { start_date: "2023-01-01" } }),
    staging({ procoreProjectId: null, externalId: "unlinked", payload: { start_date: "2026-04-01" } }),
  ];
  const dates = financialSoldDates(contracts, projects, "company");
  assert.deepEqual(dates.get("project"), { contractDate: "2025-12-01", startDate: "2026-05-01" });
  assert.deepEqual(dates.get("payload-date"), { contractDate: "2026-03-01", startDate: null });
  assert.deepEqual(dates.get("unlinked"), { contractDate: null, startDate: "2026-04-01" });
  assert.equal(dates.has("local-wrong"), false);
  assert.equal(dates.has("invalid"), false);
  assert.deepEqual(financialSoldDates([...contracts].reverse(), projects, "company"), dates);
});
