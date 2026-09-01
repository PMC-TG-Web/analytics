import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadModule(prisma) {
  const source = fs.readFileSync("src/lib/procoreTimecardEntries.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const require = (id) => {
    if (id === "@/lib/prisma") return { prisma };
    if (id === "@/lib/timecardNotification") return { extractTimesheetId: () => null };
    if (id === "@prisma/client") return { Prisma: {} };
    throw new Error(`Unexpected import: ${id}`);
  };
  vm.runInNewContext(
    `(function(require, module, exports) { ${output} })(require, module, module.exports);`,
    { require, module, process: { env: {} } },
  );
  return module.exports;
}

function createPrismaMock(existingEntries = []) {
  const rawStatements = [];
  let upsertCount = 0;
  return {
    prisma: {
      project: { findFirst: async () => null },
      timecardEntry: {
        findMany: async () => existingEntries,
        upsert: async ({ where }) => {
          upsertCount += 1;
          return { id: where.id };
        },
      },
      $executeRawUnsafe: async (statement) => { rawStatements.push(statement); },
    },
    rawStatements,
    getUpsertCount: () => upsertCount,
  };
}

const updatedAt = new Date("2026-08-31T14:30:00.000Z");
const sampleEntry = {
  id: "timecard-1",
  date: "2026-08-31",
  hours: 8,
  updated_at: updatedAt.toISOString(),
};

test("skips unchanged timecards during scheduled persistence", async () => {
  const mock = createPrismaMock([{
    id: "tc_timecard-1_project-1",
    projectId: null,
    procoreCompanyId: "company-1",
    procoreProjectId: "project-1",
    procoreUpdatedAt: updatedAt,
  }]);
  const { persistTimecardEntries } = loadModule(mock.prisma);
  const result = await persistTimecardEntries([sampleEntry], {
    companyId: "company-1",
    projectId: "project-1",
    createProjectIfMissing: false,
    persistUnpackedFields: false,
  });
  assert.equal(result.saved, 0);
  assert.equal(result.skipped, 1);
  assert.equal(mock.getUpsertCount(), 0);
  assert.deepEqual(mock.rawStatements, []);
});

test("persists changed timecards without unpacked-field writes", async () => {
  const mock = createPrismaMock([]);
  const { persistTimecardEntries } = loadModule(mock.prisma);
  const result = await persistTimecardEntries([sampleEntry], {
    companyId: "company-1",
    projectId: "project-1",
    createProjectIfMissing: false,
    persistUnpackedFields: false,
  });
  assert.equal(result.saved, 1);
  assert.equal(result.skipped, 0);
  assert.equal(mock.getUpsertCount(), 1);
  assert.deepEqual(mock.rawStatements, []);
});