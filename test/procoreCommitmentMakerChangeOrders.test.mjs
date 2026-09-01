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

test("uses the specific PCO item description instead of the generic cost code name", () => {
  const { approvedChangeOrderCommitmentGroup } = loadModule();
  const group = approvedChangeOrderCommitmentGroup(
    { packageId: "500", number: "001", title: "Added sidewalk" },
    [{
      description: "#4 Rebar",
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
      description: "#4 Rebar",
      quantity: 9.5,
      uom: "cy",
      unitCost: 144.34,
      subtotalOverride: null,
    },
  );
});

test("combines uniquely matching estimate items to describe a blended PCO line", () => {
  const { enrichApprovedChangeOrderLinesFromEstimate } = loadModule();
  const [line] = enrichApprovedChangeOrderLinesFromEstimate(
    [{ quantity: "8", unit_cost: "9.7175", amount: "77.74", uom: "ea" }],
    [
      { name: "#4 Rebar - 20' Pc", quantity: "6", uom: "EA", itemCost: "44.46" },
      { name: "#6 Rebar - 20' Pc", quantity: "2", uom: "EA", itemCost: "33.28" },
      { name: "Shop Drawings", quantity: "0.1", uom: "EA", itemCost: "4.90" },
    ],
  );

  assert.equal(line.description, "#4 Rebar - 20' Pc (6 ea) + #6 Rebar - 20' Pc (2 ea)");
});

test("does not invent an estimate description when more than one subset matches", () => {
  const { enrichApprovedChangeOrderLinesFromEstimate } = loadModule();
  const [line] = enrichApprovedChangeOrderLinesFromEstimate(
    [{ quantity: "2", amount: "20", uom: "ea" }],
    [
      { name: "First", quantity: "2", uom: "EA", itemCost: "20" },
      { name: "Second", quantity: "2", uom: "EA", itemCost: "20" },
    ],
  );

  assert.equal(line.description, undefined);
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

test("reuses the approved PO for an already-created change order before a partial draft", () => {
  const { selectExistingChangeOrderPurchaseOrder } = loadModule();
  const selected = selectExistingChangeOrderPurchaseOrder([
    { id: "100", title: "CO 001 — Added concrete", status: "Draft", vendorName: "Paradise Masonry, LLC" },
    { id: "101", title: "CO 001 — Added concrete", status: "Approved", vendorName: "Paradise Masonry, LLC" },
    { id: "102", title: "CO 001 — Added concrete", status: "Approved", vendorName: "Different Vendor" },
  ], "  CO 001 — Added concrete  ", "Paradise Masonry, LLC");

  assert.equal(selected?.id, "101");
});

test("uses a source marker to resume only the matching commitment change order", () => {
  const {
    commitmentChangeOrderDescription,
    selectExistingCommitmentChangeOrder,
  } = loadModule();
  const source = { packageId: "700", number: "002", title: "Added pier" };
  const description = commitmentChangeOrderDescription(source, "fingerprint-1");
  const selected = selectExistingCommitmentChangeOrder([
    {
      id: "900",
      contractId: "800",
      description,
      externalOriginData: "",
      status: "draft",
    },
    {
      id: "901",
      contractId: "different-contract",
      description,
      externalOriginData: "",
      status: "approved",
    },
    {
      id: "902",
      contractId: "800",
      description: "Created from another source.",
      externalOriginData: "",
      status: "approved",
    },
  ], "800", "700", "fingerprint-1");

  assert.equal(selected?.id, "900");
  assert.match(description, /PMC-COMMITMENT-MAKER:700:fingerprint-1/);
});

test("keeps commitment change order resource paths separate from legacy packages", () => {
  const {
    commitmentChangeOrderLineItemsPath,
    commitmentChangeOrderPath,
    commitmentChangeOrdersCollectionPath,
  } = loadModule();

  assert.equal(
    commitmentChangeOrdersCollectionPath("project id", "contract/id", 2),
    "/rest/v1.0/projects/project%20id/commitment_change_orders?view=extended&filters%5Bcontract_id%5D=contract%2Fid&page=2&per_page=100",
  );
  assert.equal(
    commitmentChangeOrderPath("project id", "co/id"),
    "/rest/v1.0/projects/project%20id/commitment_change_orders/co%2Fid",
  );
  assert.equal(
    commitmentChangeOrderLineItemsPath("company id", "project id", "co/id"),
    "/rest/v2.0/companies/company%20id/projects/project%20id/commitment_change_orders/co%2Fid/line_items",
  );
});

test("appends approved PCO lines directly to an existing commitment", () => {
  const route = fs.readFileSync("src/app/api/procore/commitments-live/maker/route.ts", "utf8");

  assert.match(route, /action: targetCommitment \? "append"/);
  assert.match(route, /commitment_contracts\/\$\{encodeURIComponent\(contractId\)\}\/line_items/);
  assert.doesNotMatch(route, /\/commitment_change_orders/);
});
