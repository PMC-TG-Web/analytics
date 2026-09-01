import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadModule(prisma = {}) {
  const source = fs.readFileSync("src/lib/procoreCommitmentMakerChangeOrderClaims.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const require = (id) => {
    if (id === "node:crypto") return { randomUUID: () => "lease-token" };
    if (id === "@prisma/client") return { Prisma: { PrismaClientKnownRequestError: class extends Error {} } };
    if (id === "@/lib/prisma") return { prisma };
    throw new Error(`Unexpected import: ${id}`);
  };
  vm.runInNewContext(`(function(require, module, exports) { ${output} })(require, module, module.exports);`, {
    require,
    module,
  });
  return module.exports;
}

const now = new Date("2026-09-01T16:00:00.000Z");

function claim(overrides = {}) {
  return {
    targetKind: "existing_purchase_order",
    requestedTargetCommitmentId: "800",
    targetCommitmentId: "800",
    status: "failed",
    leaseExpiresAt: new Date("2026-09-01T15:59:00.000Z"),
    ...overrides,
  };
}

test("blocks a source CO from a different PO", () => {
  const { commitmentMakerChangeOrderClaimBlockReason } = loadModule();
  assert.equal(
    commitmentMakerChangeOrderClaimBlockReason(
      claim(),
      { targetKind: "existing_purchase_order", requestedTargetCommitmentId: "801" },
      now,
    ),
    "This change order is already assigned to PO 800 and cannot be added to a different PO.",
  );
});

test("blocks completed and concurrently leased source CO applications", () => {
  const { commitmentMakerChangeOrderClaimBlockReason } = loadModule();
  assert.equal(
    commitmentMakerChangeOrderClaimBlockReason(
      claim({ status: "completed" }),
      { targetKind: "existing_purchase_order", requestedTargetCommitmentId: "800" },
      now,
    ),
    "This change order was already added to PO 800.",
  );
  assert.equal(
    commitmentMakerChangeOrderClaimBlockReason(
      claim({ status: "claimed", leaseExpiresAt: new Date("2026-09-01T16:05:00.000Z") }),
      { targetKind: "existing_purchase_order", requestedTargetCommitmentId: "800" },
      now,
    ),
    "This change order is already being added to a purchase order.",
  );
});

test("allows only failed or expired retries for the original target", () => {
  const { commitmentMakerChangeOrderClaimBlockReason } = loadModule();
  assert.equal(
    commitmentMakerChangeOrderClaimBlockReason(
      claim(),
      { targetKind: "existing_purchase_order", requestedTargetCommitmentId: "800" },
      now,
    ),
    null,
  );
  assert.equal(
    commitmentMakerChangeOrderClaimBlockReason(
      claim({ status: "claimed" }),
      { targetKind: "existing_purchase_order", requestedTargetCommitmentId: "800" },
      now,
    ),
    null,
  );
});

test("blocks historical successful imports that are not yet in the claim ledger", async () => {
  const prisma = {
    commitmentMakerChangeOrderAlias: {
      findMany: async () => [],
    },
    auditLog: {
      findMany: async () => [{
        entityId: "800",
        changes: {
          projectId: "project-1",
          sourceChangeOrder: { sourceKind: "potential_change_order", packageId: "100" },
        },
      }],
    },
  };
  const { inspectCommitmentMakerChangeOrderClaim } = loadModule(prisma);

  assert.equal(await inspectCommitmentMakerChangeOrderClaim({
    companyId: "company-1",
    projectId: "project-1",
    aliases: [{ sourceKind: "potential_change_order", sourceId: "100" }],
    targetKind: "existing_purchase_order",
    requestedTargetCommitmentId: "801",
  }), "This change order is already assigned to PO 800 and cannot be added to a different PO.");
});

test("enforces source uniqueness before any Procore mutation", () => {
  const migration = fs.readFileSync(
    "prisma/migrations/20260901160000_add_commitment_maker_change_order_claims/migration.sql",
    "utf8",
  );
  const route = fs.readFileSync("src/app/api/procore/commitments-live/maker/route.ts", "utf8");

  assert.match(migration, /PRIMARY KEY \(company_id, project_id, source_kind, source_id\)/);
  assert.match(migration, /FROM "AuditLog" audit/);
  assert.match(migration, /potential_change_order\.package_id = application\.source_id/);
  assert.ok(route.indexOf("claimCommitmentMakerChangeOrder({") < route.indexOf("addVendorToProject({"));
  assert.ok(route.indexOf("setCommitmentMakerChangeOrderTarget({") < route.indexOf("fetchContractLineItems({"));
  assert.match(route, /!commitmentUsesParadiseVendor\(claimedCommitment, plan\.vendor\.id\)/);
});
