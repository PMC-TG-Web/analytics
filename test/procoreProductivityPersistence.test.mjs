import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadModule(prisma) {
  const source = fs.readFileSync("src/lib/procoreProductivity.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const require = (id) => {
    if (id === "@/lib/prisma") return { prisma };
    if (id === "@prisma/client") return { Prisma: {} };
    throw new Error(`Unexpected import: ${id}`);
  };
  vm.runInNewContext(
    `(function(require, module, exports) { ${output} })(require, module, module.exports);`,
    { require, module },
  );
  return module.exports;
}

function createPrismaMock(existingLogs = []) {
  const rawStatements = [];
  let upsertCount = 0;
  return {
    prisma: {
      project: { findFirst: async () => null },
      productivityLog: {
        findMany: async () => existingLogs,
        upsert: async () => { upsertCount += 1; },
      },
      $executeRawUnsafe: async (statement) => { rawStatements.push(statement); },
    },
    rawStatements,
    getUpsertCount: () => upsertCount,
  };
}

const sampleLog = {
  id: "productivity-1",
  date: "2026-08-31",
  notes: "Installed block",
};

test("skips unpacked productivity writes when the caller opts out", async () => {
  const mock = createPrismaMock();
  const { persistProductivityLogs } = loadModule(mock.prisma);
  const result = await persistProductivityLogs([sampleLog], {
    projectId: "project-1",
    createProjectIfMissing: false,
    persistUnpackedFields: false,
  });
  assert.equal(result.saved, 1);
  assert.equal(mock.getUpsertCount(), 1);
  assert.deepEqual(mock.rawStatements, []);
});

test("preserves unpacked productivity writes by default", async () => {
  const mock = createPrismaMock();
  const { persistProductivityLogs } = loadModule(mock.prisma);
  await persistProductivityLogs([sampleLog], {
    projectId: "project-1",
    createProjectIfMissing: false,
  });
  assert.equal(mock.getUpsertCount(), 1);
  assert.equal(mock.rawStatements.length, 2);
  assert.match(mock.rawStatements[0], /DELETE FROM productivity_log_unpacked_fields/);
  assert.match(mock.rawStatements[1], /INSERT INTO productivity_log_unpacked_fields/);
});

test("skips unchanged productivity records during scheduled persistence", async () => {
  const updatedAt = new Date("2026-08-31T14:30:00.000Z");
  const mock = createPrismaMock([{
    id: "productivity-1",
    projectId: null,
    procoreCompanyId: "company-1",
    procoreProjectId: "project-1",
    procoreUpdatedAt: updatedAt,
  }]);
  const { persistProductivityLogs } = loadModule(mock.prisma);
  const result = await persistProductivityLogs([{
    ...sampleLog,
    updated_at: updatedAt.toISOString(),
  }], {
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

test("productivity sync forwards the unpacked-fields option", () => {
  const source = fs.readFileSync(
    "src/app/api/procore/sync/productivity-projects/route.ts",
    "utf8",
  );
  assert.match(source, /const persistUnpackedFields = body\.persistUnpackedFields/);
  assert.match(source, /persistProductivityLogs\([\s\S]*?persistUnpackedFields,[\s\S]*?\}\)/);
});