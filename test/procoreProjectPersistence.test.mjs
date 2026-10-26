import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { selectProcoreSourceProjectLink } from "../src/lib/procoreSourceProjectLink.ts";

const project = { id: "local-exact", projectNumber: "6459", projectName: "Renamed source project" };
const params = {
  companyId: "company-a", projectId: "source-project", projectName: "Duplicate name",
  projectNumber: "shared-number", createProjectIfMissing: true, persistUnpackedFields: false,
};
const sourceRecord = { id: "source-record", date: "2026-10-26", hours: 8, updated_at: "2026-10-26T12:00:00.000Z" };

const writers = [
  { name: "timecards", file: "procoreTimecardEntries", fn: "persistTimecardEntries", models: ["timecardEntry"], key: "tc_source-record_source-project", mode: "number" },
  { name: "productivity", file: "procoreProductivity", fn: "persistProductivityLogs", models: ["productivityLog"], key: "source-record", mode: "number" },
  { name: "time types", file: "procoreTimecardTimeTypes", fn: "persistTimecardTimeTypes", models: ["timecardTimeType"], mode: "id" },
  { name: "commitments", file: "procoreCommitmentContracts", fn: "persistCommitmentContracts", models: ["commitmentContract"], mode: "id" },
  { name: "purchase-order details", file: "procorePurchaseOrderLineItemDetails", fn: "persistPurchaseOrderLineItemDetails", models: ["purchaseOrderContract", "purchaseOrderLineItemContractDetail"], mode: "id", header: true },
  { name: "change-order details", file: "procoreChangeOrderLineItems", fn: "persistChangeOrderLineItems", models: ["commitmentChangeOrder", "commitmentChangeOrderLineItem"], mode: "id", header: true },
];

function loadWriter(writer, { existing, resolution, concurrentLink }) {
  const writes = [];
  const resolutions = [];
  const reports = [];
  const prisma = {
    project: new Proxy({}, { get() { throw new Error("Persistence must not match legacy projects independently"); } }),
    $executeRawUnsafe: async () => 1,
  };
  for (const model of writer.models) {
    const row = existing ? { id: writer.key || `${model}-existing`, ...existing } : null;
    const recordWrite = (data) => {
      const currentRow = { ...row, ...concurrentLink };
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) currentRow[key] = value;
      }
      writes.push({ model, data, currentRow });
    };
    prisma[model] = {
      findMany: async () => row ? [row] : [],
      findFirst: async () => row,
      upsert: async ({ where, update, create }) => {
        recordWrite(row ? update : create);
        return { id: where.id };
      },
      update: async ({ where, data }) => { recordWrite(data); return { id: where.id }; },
      create: async ({ data }) => { recordWrite(data); return { id: data.id }; },
    };
  }
  const output = ts.transpileModule(fs.readFileSync(`src/lib/${writer.file}.ts`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const require = (id) => {
    if (id === "@/lib/prisma") return { prisma };
    if (id === "@prisma/client") return { Prisma: {} };
    if (id === "@/lib/procoreLegacyProjectIdentity") return {
      resolveProcoreLegacyProject: async (args) => { resolutions.push(args); return resolution; },
    };
    if (id === "@/lib/procoreSourceProjectLink") return {
      selectProcoreSourceProjectLink,
      reportProcoreSourceProjectLinkConflicts: (source, identity, count) => reports.push({ source, identity, count }),
    };
    if (id === "@/lib/timecardNotification") return { extractTimesheetId: () => null };
    if (id === "@/lib/dailyLogTimeNotificationStore") return { enqueueDailyLogTimeNotifications: async () => 0 };
    throw new Error(`Unexpected import: ${id}`);
  };
  vm.runInNewContext(`(function(require, module, exports) { ${output} })(require, module, module.exports);`, {
    module, require, process: { env: {} }, console,
  });
  return {
    writes, resolutions, reports,
    run: (extraParams = {}) => writer.header
      ? module.exports[writer.fn]({ id: "source-header" }, [sourceRecord], { ...params, ...extraParams })
      : module.exports[writer.fn]([sourceRecord], { ...params, ...extraParams }),
  };
}

for (const writer of writers) {
  test(`${writer.name}: source data remains saved without a guessed project when identity conflicts`, async () => {
    const fixture = loadWriter(writer, { resolution: { project: null, created: false, status: "conflict", reason: "ambiguous-legacy-project" } });
    const result = await fixture.run();
    assert.equal(result.saved, 1);
    assert.equal(result.linkedProjectId, null);
    assert.equal(result.projectIdentity.status, "conflict");
    assert.equal(fixture.resolutions.length, 1);
    assert.equal(fixture.resolutions[0].companyId, params.companyId);
    assert.equal(fixture.resolutions[0].projectId, params.projectId);
    assert.equal(fixture.writes.length, writer.models.length);
    for (const { data } of fixture.writes) {
      assert.equal(data.projectId, undefined);
      assert.equal(data.jobKey, undefined);
      assert.equal(data.procoreCompanyId, params.companyId);
      assert.equal(data.procoreProjectId, params.projectId);
      assert.ok(data.customFields);
    }
  });

  test(`${writer.name}: unique exact identity links a new source row and preserves source IDs`, async () => {
    const fixture = loadWriter(writer, { resolution: { project, created: false, status: "linked" } });
    const result = await fixture.run();
    assert.equal(result.saved, 1);
    assert.equal(result.linkedProjectId, project.id);
    for (const { data } of fixture.writes) {
      assert.equal(data.projectId, project.id);
      assert.equal(data.jobKey, writer.mode === "number" ? project.projectNumber : project.id);
      assert.equal(data.procoreProjectId, params.projectId);
    }
  });

  test(`${writer.name}: an established historical link is preserved and reported, while source values refresh`, async () => {
    const fixture = loadWriter(writer, {
      existing: { projectId: "historical-link", jobKey: "historical-job" },
      resolution: { project, created: false, status: "linked" },
    });
    const result = await fixture.run();
    assert.equal(result.saved, 1);
    assert.equal(result.projectLinkConflicts, writer.models.length);
    for (const { data, currentRow } of fixture.writes) {
      assert.equal(data.projectId, undefined);
      assert.equal(data.jobKey, undefined);
      assert.equal(currentRow.projectId, "historical-link");
      assert.equal(currentRow.jobKey, "historical-job");
      assert.equal(data.procoreProjectId, params.projectId);
      assert.ok(data.customFields);
    }
    assert.equal(fixture.reports.at(-1).count, writer.models.length);
  });

  test(`${writer.name}: unresolved identity cannot erase an existing source attachment`, async () => {
    const fixture = loadWriter(writer, {
      existing: { projectId: "historical-link", jobKey: "historical-job" },
      resolution: { project: null, created: false, status: "conflict", reason: "missing-company" },
    });
    const result = await fixture.run();
    assert.equal(result.saved, 1);
    for (const { data, currentRow } of fixture.writes) {
      assert.equal(data.projectId, undefined);
      assert.equal(data.jobKey, undefined);
      assert.equal(currentRow.projectId, "historical-link");
      assert.equal(currentRow.jobKey, "historical-job");
    }
  });

  test(`${writer.name}: refreshing an already-linked row cannot restore a stale attachment after a concurrent relink`, async () => {
    const fixture = loadWriter(writer, {
      existing: { projectId: project.id, jobKey: "old-job" },
      resolution: { project, created: false, status: "linked" },
      concurrentLink: { projectId: "reviewed-link", jobKey: "reviewed-job" },
    });
    const result = await fixture.run();
    assert.equal(result.saved, 1);
    for (const { data, currentRow } of fixture.writes) {
      assert.equal(data.projectId, undefined);
      assert.equal(data.jobKey, undefined);
      assert.equal(currentRow.projectId, "reviewed-link");
      assert.equal(currentRow.jobKey, "reviewed-job");
    }
  });
}

for (const writer of writers.slice(0, 2)) {
  test(`${writer.name}: unchanged rows retain historical links and skip writes while reporting a conflict`, async () => {
    const fixture = loadWriter(writer, {
      existing: {
        projectId: "historical-link", jobKey: "historical-job", procoreCompanyId: params.companyId,
        procoreProjectId: params.projectId, procoreUpdatedAt: new Date(sourceRecord.updated_at),
      },
      resolution: { project, created: false, status: "linked" },
    });
    const result = await fixture.run();
    assert.equal(result.saved, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.projectLinkConflicts, 1);
    assert.equal(fixture.writes.length, 0);
  });

  test(`${writer.name}: default unpacked-field refresh still runs for unchanged source timestamps`, async () => {
    const fixture = loadWriter(writer, {
      existing: {
        projectId: project.id, jobKey: project.projectNumber, procoreCompanyId: params.companyId,
        procoreProjectId: params.projectId, procoreUpdatedAt: new Date(sourceRecord.updated_at),
      },
      resolution: { project, created: false, status: "linked" },
    });
    const result = await fixture.run({ persistUnpackedFields: true });
    assert.equal(result.saved, 1);
    assert.equal(fixture.writes.length, 1);
  });
}

test("source attachment selection leaves unlinked job metadata intact until exact identity resolves", () => {
  assert.deepEqual(selectProcoreSourceProjectLink({ projectId: null, jobKey: "legacy-number" }, null, "id"), {
    projectId: undefined, jobKey: "legacy-number", conflict: false,
    update: { projectId: undefined, jobKey: undefined },
  });
  assert.deepEqual(selectProcoreSourceProjectLink({ projectId: null }, project, "number"), {
    projectId: project.id, jobKey: project.projectNumber, conflict: false,
    update: { projectId: project.id, jobKey: project.projectNumber },
  });
});
