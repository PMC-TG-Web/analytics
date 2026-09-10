import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { normalizeCommitmentMakerVendorName, COMMITMENT_MAKER_VENDOR_NAME } from "../src/lib/procore/commitmentMaker.ts";

const route = fs.readFileSync("src/app/api/procore/commitments-live/maker/route.ts", "utf8");
const source = route.slice(route.indexOf("async function addVendorToProject("), route.indexOf("type PlannedLine ="));
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function setup(vendors, responses = []) {
  const writes = [];
  const context = {
    normalizeCommitmentMakerVendorName, COMMITMENT_MAKER_VENDOR_NAME,
    readId: (record) => String(record.id || ""), vendorName: (record) => record.name || "",
    fetchProjectVendors: async () => { if (vendors instanceof Error) throw vendors; return vendors; },
    procoreJson: async (params) => { writes.push(params); return responses.shift() || { ok: false, status: 403, payload: {} }; },
    rejectedMutation: () => new Error("Unknown mutation outcome"),
  };
  vm.createContext(context);
  vm.runInContext(compiled, context);
  return { writes, run: () => context.addVendorToProject({
    accessToken: "test", companyId: "company", projectId: "project", vendorId: "company-vendor",
  }) };
}

test("an active exact project vendor skips enrollment even when its mirror is empty", async () => {
  const f = setup([{ id: "company-vendor", name: "Paradise Masonry, LLC", is_active: true }]);
  await f.run();
  assert.equal(f.writes.length, 0);
});

test("another same-name ID does not prove the selected vendor is enrolled", async () => {
  const f = setup([{ id: "legacy-vendor", name: "Paradise Masonry, LLC" }], [{ ok: true, status: 201, payload: {} }]);
  await f.run();
  assert.equal(f.writes.length, 1);
  assert.match(f.writes[0].path, /vendors\/company-vendor\/actions\/add/);
});

test("a failed live membership read cannot trigger an enrollment write", async () => {
  const f = setup(new Error("Procore rate limit"));
  await assert.rejects(f.run(), /rate limit/);
  assert.equal(f.writes.length, 0);
});

test("an inactive vendor or changed vendor name blocks creation", async () => {
  for (const vendor of [
    { id: "company-vendor", name: "Paradise Masonry, LLC", is_active: false },
    { id: "company-vendor", name: "Different Vendor" },
  ]) {
    const f = setup([vendor]);
    await assert.rejects(f.run());
    assert.equal(f.writes.length, 0);
  }
});

test("new-PO selection prioritizes the company vendor over historical PO vendor IDs", () => {
  const start = route.indexOf("const companyVendors = companyVendorRows");
  const selection = route.slice(start, route.indexOf("const projectVendors = projectVendorRows", start));
  const companyPriority = selection.indexOf("Number(right.company_vendor === true)");
  const historicalPriority = selection.indexOf("preferredVendorUsage.get(readId(right))");
  assert.ok(companyPriority >= 0 && historicalPriority > companyPriority);
  // Existing PO appends still retain the exact target's vendor, rather than switching it.
  assert.match(route, /readId\(vendor\) === targetVendorId/);
});
