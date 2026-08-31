import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadModule() {
  const source = fs.readFileSync("src/lib/procore/commitmentMakerChangeOrders.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const require = (id) => {
    if (id === "@/lib/procore/commitmentMaker") return { COMMITMENT_MAKER_COST_TYPE: "O" };
    throw new Error(`Unexpected import: ${id}`);
  };
  vm.runInNewContext(`(function(require, module, exports) { ${output} })(require, module, module.exports);`, {
    require,
    module,
  });
  return module.exports;
}

test("builds commitment lines directly from an approved change order SOV", () => {
  const { approvedChangeOrderCommitmentGroup } = loadModule();
  const group = approvedChangeOrderCommitmentGroup(
    { packageId: "500", number: "001", title: "Added sidewalk" },
    [{
      quantity: "9.5",
      unit_cost: "144.3400",
      uom: "cy",
      wbs_code: { flat_code: "03-300-30-20.CON", description: "Site Concrete Material.Concrete" },
      cost_code: { full_code: "03-300-30-20", name: "Site Concrete Material" },
    }],
  );

  assert.equal(group.name, "CO 001 — Added sidewalk");
  assert.equal(group.lineItems.length, 1);
  assert.deepEqual(
    { ...group.lineItems[0] },
    {
      costCode: "03-300-30-20",
      costType: "CON",
      sourceWbsCodeId: null,
      description: "Site Concrete Material",
      quantity: 9.5,
      uom: "cy",
      unitCost: 144.34,
      subtotalOverride: null,
    },
  );
});

test("retains distinct source WBS assignments for same-code approved CO lines", () => {
  const { approvedChangeOrderCommitmentGroup } = loadModule();
  const group = approvedChangeOrderCommitmentGroup(
    { packageId: "500", number: "001", title: "Equipment" },
    [
      {
        quantity: "1",
        unit_cost: "137",
        uom: "ea",
        cost_code: { full_code: "03-300-20-30", name: "SOG Concrete Equipment" },
        wbs_code: { id: "equipment", flat_code: "03-300-20-30.E" },
        line_item_type: { code: "E", name: "Equipment" },
      },
      {
        quantity: "1",
        unit_cost: "1440",
        uom: "ea",
        cost_code: { full_code: "03-300-20-30", name: "SOG Concrete Equipment" },
        wbs_code: { id: "subcontract", flat_code: "03-300-20-30.S" },
        line_item_type: { code: "S", name: "Subcontractors" },
      },
    ],
  );

  assert.deepEqual(
    group.lineItems.map((line) => ({ costType: line.costType, sourceWbsCodeId: line.sourceWbsCodeId })),
    [
      { costType: "E", sourceWbsCodeId: "equipment" },
      { costType: "S", sourceWbsCodeId: "subcontract" },
    ],
  );
});

test("omits invalid source lines instead of inventing commitment values", () => {
  const { approvedChangeOrderCommitmentGroup } = loadModule();
  const group = approvedChangeOrderCommitmentGroup(
    { packageId: "500", number: "", title: "CO" },
    [{ cost_code: "03-100", quantity: 0, unit_cost: 10 }],
  );
  assert.equal(group.lineItems.length, 0);
});

test("exposes an approved PCO only while it is not already part of a PCCO", () => {
  const { isAvailableApprovedPotentialChangeOrder } = loadModule();
  assert.equal(isAvailableApprovedPotentialChangeOrder({
    id: 100,
    status: "approved",
    change_order_package_acronym_number: "PCCO #",
  }), true);
  assert.equal(isAvailableApprovedPotentialChangeOrder({
    id: 100,
    status: "approved",
    change_order_package_acronym_number: "PCCO #001",
  }), false);
  assert.equal(isAvailableApprovedPotentialChangeOrder({
    id: 100,
    status: "pending",
    change_order_package_acronym_number: "PCCO #",
  }), false);
});
