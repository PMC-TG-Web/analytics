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
      description: "CO1 - #4 Rebar",
      quantity: 9.5,
      uom: "cy",
      unitCost: 144.34,
      subtotalOverride: null,
    },
  );
});

test("uses the customer CO reference in the title before the package sequence", () => {
  const {
    approvedChangeOrderCommitmentGroup,
    commitmentMakerChangeOrderReferenceNumber,
  } = loadModule();

  assert.equal(
    commitmentMakerChangeOrderReferenceNumber('CO#4: Credit Back Cut Off Walls', '003'),
    '4',
  );
  assert.equal(commitmentMakerChangeOrderReferenceNumber('Winter concrete costs', '002'), '2');
  assert.equal(commitmentMakerChangeOrderReferenceNumber('CO 005 - Added pier', '006'), '5');

  const group = approvedChangeOrderCommitmentGroup(
    { packageId: '500', number: '003', title: 'CO#4: Credit Back Cut Off Walls' },
    [{
      description: 'Site Concrete Labor',
      quantity: '10',
      unit_cost: '49.4',
      uom: 'hours',
      wbs_code: { id: 'labor', flat_code: '03-300-30-10.L' },
    }],
  );
  assert.equal(group.name, 'CO 4 — CO#4: Credit Back Cut Off Walls');
  assert.equal(group.lineItems[0].description, 'CO4 - Site Concrete Labor');
});


test("prefixes every split PCO commitment line with the normalized CO number", () => {
  const {
    approvedChangeOrderCommitmentGroup,
    enrichApprovedChangeOrderLinesFromEstimate,
  } = loadModule();
  const sourceLines = enrichApprovedChangeOrderLinesFromEstimate(
    [{ quantity: "8", amount: "77.74", uom: "ea", cost_code: "03-200-10-20" }],
    [
      { name: "#4 Rebar - 20' Pc", quantity: "6", uom: "ea", itemCost: "44.46" },
      { name: "#6 Rebar - 20' Pc", quantity: "2", uom: "ea", itemCost: "33.28" },
    ],
  );

  const group = approvedChangeOrderCommitmentGroup(
    { packageId: "500", number: "002", title: "P1 Pier" },
    sourceLines,
  );

  assert.deepEqual(
    group.lineItems.map((line) => line.description),
    ["CO2 - #4 Rebar - 20' Pc", "CO2 - #6 Rebar - 20' Pc"],
  );
});
test("splits uniquely matching estimate items into separate PCO lines", () => {
  const { enrichApprovedChangeOrderLinesFromEstimate } = loadModule();
  const lines = enrichApprovedChangeOrderLinesFromEstimate(
    [{ quantity: "8", unit_cost: "9.7175", amount: "77.74", uom: "ea" }],
    [
      { name: "#4 Rebar - 20' Pc", quantity: "6", uom: "EA", itemCost: "44.46" },
      { name: "#6 Rebar - 20' Pc", quantity: "2", uom: "EA", itemCost: "33.28" },
      { name: "Shop Drawings", quantity: "0.1", uom: "EA", itemCost: "4.90" },
    ],
  );

  assert.deepEqual(lines.map((line) => ({
    description: line.description,
    quantity: line.quantity,
    unitCost: line.unit_cost,
    amount: line.amount,
  })), [
    { description: "#4 Rebar - 20' Pc", quantity: 6, unitCost: 7.41, amount: 44.46 },
    { description: "#6 Rebar - 20' Pc", quantity: 2, unitCost: 16.64, amount: 33.28 },
  ]);
});

test("uses estimate sales details for marked-up credit PCO lines", () => {
  const { enrichApprovedChangeOrderLinesFromEstimate } = loadModule();
  const lines = enrichApprovedChangeOrderLinesFromEstimate(
    [{ quantity: "10", unit_cost: "-49.4", amount: "-494", uom: "hours" }],
    [
      {
        name: "Site Concrete Labor - Ramp",
        quantity: "6",
        uom: "HOURS",
        laborCost: "228",
        laborSales: "296.4",
      },
      {
        name: "Site Concrete Labor - Curb",
        quantity: "4",
        uom: "HOURS",
        laborCost: "152",
        laborSales: "197.6",
      },
    ],
  );

  assert.deepEqual(lines.map((line) => ({
    description: line.description,
    quantity: line.quantity,
    unitCost: line.unit_cost,
    amount: line.amount,
  })), [
    { description: "Site Concrete Labor - Ramp", quantity: 6, unitCost: -49.4, amount: -296.4 },
    { description: "Site Concrete Labor - Curb", quantity: 4, unitCost: -49.4, amount: -197.6 },
  ]);
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
    status: "approved",
    change_order_package_acronym_number: "CCO #001",
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

test("claims a PCCO and every contained PCO as the same source operation", () => {
  const { commitmentMakerChangeOrderSourceAliases } = loadModule();
  const aliases = (changeOrder, potentialChangeOrderIds) => JSON.parse(JSON.stringify(
    commitmentMakerChangeOrderSourceAliases(changeOrder, potentialChangeOrderIds),
  ));

  assert.deepEqual(aliases({
    packageId: "700",
    number: "002",
    title: "Added pier",
    sourceKind: "change_order_package",
  }, ["100", "101", "100", ""]), [
    { sourceKind: "change_order_package", sourceId: "700" },
    { sourceKind: "potential_change_order", sourceId: "100" },
    { sourceKind: "potential_change_order", sourceId: "101" },
  ]);

  assert.deepEqual(aliases({
    packageId: "100",
    number: "PCO-1",
    title: "Added pier",
    sourceKind: "potential_change_order",
  }, ["ignored"]), [
    { sourceKind: "potential_change_order", sourceId: "100" },
  ]);
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

test("loads Commitment Maker project data from synchronized tables without blocking on Procore", () => {
  const route = fs.readFileSync("src/app/api/procore/commitments-live/maker/route.ts", "utf8");
  const getHandler = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));

  assert.match(getHandler, /fetchApprovedChangeOrdersFromAllDatabaseSources/);
  assert.match(getHandler, /fetchExistingPurchaseOrdersFromDatabase/);
  assert.match(route, /procore_company_vendors_live\.findMany/);
  assert.match(route, /record\.vendorName \|\| vendorNames\.get\(record\.vendorId \|\| ""\)/);
  assert.match(route, /const targetVendorId = targetCommitment \? commitmentVendorId\(targetCommitment\) : ""/);
  assert.match(route, /preferredVendorUsage\.get\(readId\(right\)\)/);
  assert.match(route, /params\.target !== "existing_purchase_order"/);
  assert.doesNotMatch(getHandler, /getClientCredentialsToken|fetchApprovedChangeOrders\(|fetchCommitments\(/);
});

test("rejects failed preview responses before storing preview state", () => {
  const page = fs.readFileSync("src/app/procore/commitments-live/maker/page.tsx", "utf8");
  const responseFailureCheck = page.indexOf('if (!response.ok && mode === "preview")');
  const previewStateUpdate = page.indexOf("setPreview(nextPreview)");

  assert.ok(responseFailureCheck >= 0);
  assert.ok(previewStateUpdate > responseFailureCheck);
  assert.match(page, /typeof nextPreview\.success !== "boolean"/);
  assert.match(page, /!Array\.isArray\(nextPreview\.validationErrors\)/);
  assert.match(page, /!nextPreview\.totals/);
});

test("keeps approved change-order preview within the interactive response window", () => {
  const route = fs.readFileSync("src/app/api/procore/commitments-live/maker/route.ts", "utf8");
  const resolver = route.slice(
    route.indexOf("async function resolveApprovedChangeOrder"),
    route.indexOf("async function resolveChangeOrderSourceAliases"),
  );

  assert.match(resolver, /fetchApprovedChangeOrdersFromAllDatabaseSources/);
  assert.match(resolver, /if \(!params\.useLive\) return \{ changeOrder: storedMatch, liveLines: null \}/);
  assert.match(resolver, /potential_change_orders\/\$\{encodeURIComponent\(storedMatch\.packageId\)\}/);
  assert.match(resolver, /change_order_packages\/\$\{encodeURIComponent\(storedMatch\.packageId\)\}/);
  assert.match(resolver, /liveLines: storedMatch\.sourceKind === "change_order_package"/);
  assert.match(route, /resolvedSourceChangeOrder\?\.liveLines !== null/);
  assert.match(route, /fetchCommitmentMakerPlanDataFromDatabase/);
  assert.match(route, /useSynchronizedData: true/);
  assert.match(route, /const requiresLiveProcore = mode === "create" \|\| !changeOrderPackageId/);
  assert.match(route, /useLive: mode === "create"/);
  assert.match(route, /await enqueueCommitmentMakerTasks/);
  assert.doesNotMatch(route, /resolveCommitmentMakerChangeOrderTaskAssignees/);
  assert.doesNotMatch(route, /async function fetchApprovedChangeOrders\(/);
  assert.match(route, /const \[sourceAliases, plan\] = await Promise\.all/);
});

test("bounds live Procore calls and safely shortens detailed line creation", () => {
  const route = fs.readFileSync("src/app/api/procore/commitments-live/maker/route.ts", "utf8");
  const page = fs.readFileSync("src/app/procore/commitments-live/maker/page.tsx", "utf8");

  assert.match(route, /PROCORE_READ_TIMEOUT_MS = 8_000/);
  assert.match(route, /PROCORE_MUTATION_TIMEOUT_MS = 12_000/);
  assert.match(route, /signal: AbortSignal\.timeout/);
  assert.ok(route.indexOf("await response.text()") < route.indexOf("} catch (error) {"));
  assert.match(route, /LINE_CREATE_CONCURRENCY = 4/);
  assert.match(route, /await Promise\.allSettled\(batch\.map/);
  assert.match(route, /failures\.find\(\(error\) => error instanceof ProcoreMutationOutcomeUnknownError\)/);
  assert.match(route, /error instanceof ProcoreMutationOutcomeUnknownError/);
  assert.match(route, /if \(failure\?\.outcomeUnknown !== true\)/);
  assert.match(route, /changeOrderClaim\?\.reconcileUnconfirmedCreate/);
  assert.match(route, /useLiveWbsRecords: !sourceChangeOrder/);
  assert.match(route, /could not be verified live on this project/);
  assert.match(route, /The selected change order could not be verified live/);
  assert.match(route, /Adding \$\{COMMITMENT_MAKER_VENDOR_NAME\} to the project/);
  assert.doesNotMatch(page, /No Procore changes were confirmed/);
  assert.match(page, /Procore may still have applied part or all of it/);
  assert.match(page, /!createOutcomeUnknown/);
  assert.match(page, /setCreateOutcomeUnknown\(true\)/);
  assert.match(page, /mode === "create" && !receivedResponse/);
  assert.ok(page.indexOf("const responseText = await response.text()") < page.indexOf("receivedResponse = true"));
});

test("removes only exact PCO lines before releasing the PO assignment", () => {
  const route = fs.readFileSync("src/app/api/procore/commitments-live/maker/route.ts", "utf8");
  const deleteHandler = route.slice(
    route.indexOf("async function handleDelete"),
    route.indexOf("export async function GET"),
  );
  const middleware = fs.readFileSync("middleware.ts", "utf8");
  const page = fs.readFileSync("src/app/procore/commitments-live/maker/page.tsx", "utf8");

  assert.match(deleteHandler, /Number\(audit\.reusedLineItems\) !== 0/);
  assert.match(deleteHandler, /commitmentMakerOwnedLineItemsFromAudit\(audit, expectedLineCount\)/);
  assert.match(deleteHandler, /auditedCommitmentLineRemovals\(ownedLines, existingLines\)/);
  assert.match(deleteHandler, /historicalCommitmentLineRemovals\(plannedLines, existingLines\)/);
  assert.match(deleteHandler, /alreadyAbsentLineItems = expectedLineCount - lineIds\.length/);
  assert.match(deleteHandler, /readText\(audit\.fingerprint\) !== plan\.groups\[0\]\.fingerprint/);
  assert.match(deleteHandler, /line_items\/\$\{encodeURIComponent\(lineId\)\}/);
  assert.match(deleteHandler, /method: "DELETE"/);
  assert.match(deleteHandler, /remainingIds\.has\(lineId\)/);
  assert.match(deleteHandler, /body: removalLines\[index\]\.payload/);
  assert.match(deleteHandler, /auditedCommitmentLineRemovals\(removalLines, restoredLines\)/);
  assert.match(deleteHandler, /markCommitmentMakerChangeOrderRemovalUncertain/);
  assert.ok(deleteHandler.indexOf('body: { status: "Approved" }') < deleteHandler.indexOf("completeCommitmentMakerChangeOrderRemoval(removalClaim)"));
  assert.ok(deleteHandler.indexOf("completeCommitmentMakerChangeOrderRemoval(removalClaim)") < deleteHandler.indexOf('action: "remove-lines"'));
  assert.match(deleteHandler, /failCommitmentMakerChangeOrderRemoval/);
  assert.doesNotMatch(deleteHandler, /method: "DELETE"[\s\S]{0,200}commitment_contracts[^\n]*,$/m);
  assert.match(middleware, /\['GET', 'POST', 'DELETE'\]/);
  assert.match(page, /Delete from PO/);
  assert.match(page, /The purchase order itself will not be deleted/);
});
