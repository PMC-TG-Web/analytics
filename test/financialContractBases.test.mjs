import assert from "node:assert/strict";
import test from "node:test";
import { financialContractBases } from "../src/lib/financialContractBases.ts";
import { resolveProjectContractValue } from "../src/lib/projectProfitabilityContractValue.js";
import { calculateEstimatingSoldContracts } from "../src/lib/financialWip.ts";

function contract(overrides = {}) {
  return {
    company_id: "company-1", prime_contract_id: "contract-1",
    project_procore_id: "project-1", project_id: "project-1", status: "Approved",
    payload: { grand_total: "114593.30", revised_contract_amount: "169480.66" },
    ...overrides,
  };
}

test("original contract prevents a change-only estimate from appearing overbilled", () => {
  const bases = financialContractBases([contract()], "company-1");
  const result = resolveProjectContractValue({
    procoreProjectId: "project-1",
    procoreBaseEstimate: bases.get("project-1"),
    procoreApprovedChangeOrders: 54887.36,
    qboEstimateTotal: null,
    netBilled: 147685.38,
  });
  assert.equal(result.contractValue, 169480.66);
  assert.equal(result.remainingToBill, 21795.28);
  assert.equal(result.billingProgressPercent, 87.14);

  const sold = calculateEstimatingSoldContracts([{
    bidBoardId: "board-1", procoreProjectId: "project-1", projectNumber: "2601 - Test",
    projectArchived: false, status: "In Progress", sales: 21795.30,
    originalContractValue: bases.get("project-1"), approvedChangeOrderAmount: 54887.36,
  }], 2026);
  assert.equal(sold.contractValue, result.contractValue);
});

test("contract bases scope company and project IDs, ignore drafts/deletions, and count distinct contracts once", () => {
  const rows = [
    contract(), contract(),
    contract({ prime_contract_id: "contract-2", payload: { grand_total: 100 } }),
    contract({ company_id: "other-company", prime_contract_id: "foreign" }),
    contract({ status: "Draft", prime_contract_id: "draft" }),
    contract({ status: "Terminated", prime_contract_id: "terminated" }),
    contract({ prime_contract_id: "deleted", payload: { grand_total: 500, deleted_at: "2026-09-01" } }),
    contract({ prime_contract_id: "other-project", project_procore_id: "project-2", project_id: "project-2" }),
  ];
  assert.deepEqual([...financialContractBases(rows, "company-1")], [["project-1", 114693.30], ["project-2", 114593.30]]);
});

test("missing original amounts stay unavailable instead of using revised totals or partial sums", () => {
  for (const value of [null, "", "invalid", Infinity]) {
    const bases = financialContractBases([
      contract(),
      contract({ prime_contract_id: "invalid", payload: { grand_total: value, revised_contract_amount: 200000 } }),
    ], "company-1");
    assert.equal(bases.get("project-1"), null);
  }
  assert.equal(financialContractBases([contract({ payload: { grand_total: 0 } })], "company-1").get("project-1"), 0);
});
