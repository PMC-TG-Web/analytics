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
      costType: "O",
      description: "Site Concrete Material",
      quantity: 9.5,
      uom: "cy",
      unitCost: 144.34,
      subtotalOverride: null,
    },
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
