import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  calculateEstimatingSoldContracts, calculateSoldContractValue, financialSoldDates, financialWipSoldDates, resolveSoldYear,
} from "../src/lib/financialWip.ts";

const companyId = "598134325805519";
const field = "custom_field_598134325926617";
const staging = (id, date, overrides = {}) => ({
  companyId, source: "procore_v1_projects", externalId: id, procoreProjectId: id,
  payload: { custom_fields: { [field]: { data_type: "datetime", value: date } }, start_date: "2027-02-01" },
  ...overrides,
});

test("WIP uses the project Contract Date even when prime date, job number and start date disagree", () => {
  const projects = [staging("project", "2026-01-02T05:00:00Z")];
  const dates = financialWipSoldDates(projects, companyId);
  assert.deepEqual(dates.get("project"), { contractDate: "2026-01-02", startDate: "2027-02-01" });
  const sold = calculateEstimatingSoldContracts([{
    bidBoardId: "bid", procoreProjectId: "project", projectNumber: "2505-KE",
    projectName: "Test", status: "Complete", projectArchived: false,
    sales: 100, originalContractValue: 200, approvedChangeOrderAmount: 50,
    ...dates.get("project"),
  }], 2026);
  assert.equal(sold.projectCount, 1);
  assert.equal(sold.contractValue, 250);
  assert.equal(sold.projects[0].soldYearSource, "contract_date");
  assert.equal(sold.projects[0].contractDate, "2026-01-02");

  // The legacy prime-contract extractor differs; neither Sold card should use it.
  const legacyDates = financialSoldDates([{
    company_id: companyId, project_procore_id: "project", project_id: "project",
    status: "Approved", contract_date: "2025-11-20", payload: {},
  }], projects, companyId);
  assert.equal(legacyDates.get("project").contractDate, "2025-11-20");
});

test("QBO Sold uses the same project Contract Date loader as Financial WIP", () => {
  for (const route of ['accounting/project-profitability', 'analytics/monthly-hours']) {
    const source = readFileSync(new URL(`../src/app/api/${route}/route.ts`, import.meta.url), 'utf8');
    assert.match(source, /await loadFinancialWipSoldDates\(|loadFinancialWipSoldDates\(companyId\)/);
    assert.doesNotMatch(source, /\bloadFinancialSoldDates\(/);
  }
  const dates = financialWipSoldDates([
    staging('moved-in', '2026-01-01'),
    staging('moved-out', '2025-12-31'),
    staging('number-fallback', null),
    staging('start-fallback', 'invalid', { payload: { start_date: '2026-02-01' } }),
  ], companyId);
  const result = calculateSoldContractValue([
    { procoreProjectNumber: '2501', contractValue: 100, ...dates.get('moved-in') },
    { procoreProjectNumber: '2601', contractValue: 500, ...dates.get('moved-out') },
    { procoreProjectNumber: '2602', contractValue: 200, ...dates.get('number-fallback') },
    { procoreProjectNumber: 'NO-YEAR', contractValue: 300, ...dates.get('start-fallback') },
  ], 2026);
  assert.deepEqual(result, { year: 2026, projectCount: 3, contractProjectCount: 3, contractValue: 600 });
});

test("missing or invalid project Contract Dates retain job-number and start-date fallbacks", () => {
  for (const value of [null, "", "not a date", "2026-02-30"]) {
    const dates = financialWipSoldDates([staging("project", value)], companyId).get("project");
    assert.equal(dates.contractDate, null);
    assert.deepEqual(resolveSoldYear({ ...dates, procoreProjectNumber: "2505-KE" }), {
      soldYear: 2025, soldYearSource: "project_number",
    });
    assert.deepEqual(resolveSoldYear({ ...dates, procoreProjectNumber: "NO-YEAR" }), {
      soldYear: 2027, soldYearSource: "start_date",
    });
  }
  const dates = financialWipSoldDates([staging("project", null, {
    payload: { contract_date: "2026-01-01", signed_contract_received_date: "2026-02-01" },
  })], companyId).get("project");
  assert.deepEqual(resolveSoldYear({ ...dates, procoreProjectNumber: "NO-YEAR" }), {
    soldYear: null, soldYearSource: null,
  });
});

test("project date reads keep company, source and external project identities separate", () => {
  const rows = [
    staging("project", "2026-10-01T04:00:00Z"),
    staging("project", "2024-01-01", { companyId: "other" }),
    staging("project", "2023-01-01", { source: "procore_bid_board" }),
    staging("external", "2026-03-01", { procoreProjectId: null }),
    staging("deleted", "2026-04-01", { payload: { deleted_at: "2026-05-01" } }),
    staging("", "2026-04-01"),
  ];
  const dates = financialWipSoldDates(rows, companyId);
  assert.deepEqual([...dates.keys()], ["project", "external"]);
  assert.equal(dates.get("project").contractDate, "2026-10-01");
  assert.equal(dates.get("external").contractDate, "2026-03-01");
  assert.equal(financialWipSoldDates(rows, "other").get("project").contractDate, null);
});
