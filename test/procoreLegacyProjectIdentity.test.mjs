import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync("src/lib/procoreLegacyProjectIdentity.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function load(prisma) {
  const module = { exports: {} };
  const warnings = [];
  new Function("require", "module", "exports", "console", compiled)(id => {
    assert.equal(id, "@/lib/prisma");
    return { prisma };
  }, module, module.exports, { warn: (...args) => warnings.push(args) });
  return { ...module.exports, warnings };
}

const base = { companyId: "company-a", projectId: "project-a", createProjectIfMissing: true };
function legacy(id, { projectId = "project-a", companyId = "company-a", bidBoardId = null, ...rest } = {}) {
  return {
    id, procoreId: projectId, bidBoardId, projectName: "Same project name", projectNumber: "123",
    customFields: companyId ? { procoreCompanyId: companyId } : {}, projectArchived: false, ...rest,
  };
}
function snapshot(overrides = {}) {
  return {
    projects: [], canonicalProjects: [], canonicalBidBoards: [], projectLinks: [], bidBoardLinks: [], ...overrides,
  };
}

function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some(branch => matches(row, branch));
    if (key === "customFields") return value.path.reduce((current, field) => current?.[field], row.customFields) === value.equals;
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
    if (key === "companyId_procoreProjectId" || key === "companyId_bidBoardId") return matches(row, value);
    return row[key] === value;
  });
}

// Optimistic serializable transactions commit an isolated snapshot atomically.
// Concurrent stale writes fail and lose every staged Project/link/header write.
function database(initial = {}, forcedCommitErrors = []) {
  let state = structuredClone(snapshot(initial));
  let version = 0;
  let sequence = 0;
  let attempts = 0;
  const options = [];
  const prisma = {
    async $transaction(operation, settings) {
      attempts += 1;
      options.push(settings);
      const startVersion = version;
      const staged = structuredClone(state);
      let changed = false;
      function delegate(key, kind = "") {
        return {
          findMany: async ({ where } = {}) => structuredClone(staged[key].filter(row => matches(row, where))),
          findUnique: async ({ where }) => structuredClone(staged[key].find(row => matches(row, where)) || null),
          create: async ({ data }) => {
            if (kind === "projectLink" && staged[key].some(row => row.projectId === data.projectId
              || (row.companyId === data.companyId && row.procoreProjectId === data.procoreProjectId))) {
              throw Object.assign(new Error("Unique project link"), { code: "P2002" });
            }
            if (kind === "bidLink" && staged[key].some(row => row.companyId === data.companyId && row.bidBoardId === data.bidBoardId)) {
              throw Object.assign(new Error("Unique bid link"), { code: "P2002" });
            }
            const row = kind === "project" ? { id: `new-${++sequence}`, ...structuredClone(data) } : structuredClone(data);
            staged[key].push(row);
            changed = true;
            return structuredClone(row);
          },
          update: async ({ where, data }) => {
            const index = staged[key].findIndex(row => matches(row, where));
            assert.ok(index >= 0);
            staged[key][index] = { ...staged[key][index], ...structuredClone(data) };
            changed = true;
            return structuredClone(staged[key][index]);
          },
        };
      }
      const result = await operation({
        project: delegate("projects", "project"),
        pmcProject: delegate("canonicalProjects"),
        pmcBidBoardProject: delegate("canonicalBidBoards"),
        procoreLegacyProjectLink: delegate("projectLinks", "projectLink"),
        procoreLegacyBidBoardLink: delegate("bidBoardLinks", "bidLink"),
      });
      if (changed) {
        if (forcedCommitErrors.length) throw Object.assign(new Error("Forced retry"), { code: forcedCommitErrors.shift() });
        if (version !== startVersion) throw Object.assign(new Error("Concurrent transaction"), { code: "P2034" });
        state = staged;
        version += 1;
      }
      return result;
    },
  };
  return { prisma, state: () => structuredClone(state), attempts: () => attempts, options };
}

test("an exact Procore ID wins without consulting matching names or numbers", async () => {
  const db = database({ projects: [legacy("same-name", { projectId: "other" }), legacy("exact")] });
  const { resolveProcoreLegacyProject } = load(db.prisma);
  const result = await resolveProcoreLegacyProject({ ...base, projectName: "Same project name", projectNumber: "123" });
  assert.equal(result.project.id, "exact");
  assert.equal(result.created, false);
  assert.equal(db.state().projects[0].procoreId, "other");
});

test("same names, numbers, and local IDs cannot establish an external identity", async () => {
  const db = database({ projects: [legacy("project-a", { projectId: null })] });
  const api = load(db.prisma);
  const missing = await api.resolveProcoreLegacyProject({ ...base, createProjectIfMissing: false });
  assert.equal(missing.reason, "project-not-linked");
  const created = await api.resolveProcoreLegacyProject(base);
  assert.equal(created.created, true);
  assert.notEqual(created.project.id, "project-a");
  assert.equal(db.state().projects.length, 2);
});

test("missing company or external identity never opens a write transaction", async () => {
  const db = database();
  const api = load(db.prisma);
  assert.equal((await api.resolveProcoreLegacyProject({ ...base, companyId: null })).reason, "missing-company-id");
  assert.equal((await api.resolveProcoreLegacyProject({ ...base, projectId: "" })).reason, "missing-project-id");
  assert.equal((await api.resolveProcoreLegacyProject({ ...base, projectId: "", bidBoardId: "project-a" })).reason, "missing-project-id");
  assert.equal((await api.resolveBidBoardLegacyProject({ ...base, procoreProjectId: "project-a", bidBoardId: "" })).reason, "missing-bid-board-id");
  assert.equal(db.attempts(), 0);
});

test("equal external IDs in different companies remain different local projects", async () => {
  const db = database({ projects: [legacy("other-company", { companyId: "company-b" })] });
  const result = await load(db.prisma).resolveProcoreLegacyProject(base);
  assert.equal(result.created, true);
  assert.notEqual(result.project.id, "other-company");
  assert.equal(db.state().projects[0].customFields.procoreCompanyId, "company-b");
});

test("an unscoped exact legacy row needs a singleton canonical company witness", async () => {
  const row = legacy("scheduled", { companyId: null, customer: "Retained", customFields: { procoreId: "project-a", note: "preserve" } });
  for (const canonicalProjects of [[], [{ companyId: "company-b", procoreProjectId: "project-a" }], [
    { companyId: "company-a", procoreProjectId: "project-a" }, { companyId: "company-b", procoreProjectId: "project-a" },
  ]]) {
    const db = database({ projects: [row], canonicalProjects });
    assert.equal((await load(db.prisma).resolveProcoreLegacyProject(base)).reason, "unverified-legacy-company");
    assert.deepEqual(db.state().projects, [row]);
    assert.equal(db.state().projectLinks.length, 0);
  }
  const db = database({ projects: [row], canonicalProjects: [{ companyId: "company-a", procoreProjectId: "project-a" }] });
  const result = await load(db.prisma).resolveProcoreLegacyProject(base);
  assert.equal(result.project.id, "scheduled");
  assert.equal(result.project.customer, "Retained");
  assert.equal(result.project.customFields.note, "preserve");
  assert.equal(result.project.customFields.procoreCompanyId, "company-a");
});

test("numeric JSON external IDs resolve exactly without changing their existing representation", async () => {
  const db = database({ projects: [legacy("numeric", { projectId: null, customFields: { procoreProjectId: 123456, procoreCompanyId: "company-a" } })] });
  const result = await load(db.prisma).resolveProcoreLegacyProject({ ...base, projectId: "123456" });
  assert.equal(result.project.id, "numeric");
  assert.equal(result.project.customFields.procoreProjectId, 123456);
});

test("conflicting project, bid, and company metadata blocks all changes", async () => {
  for (const [fields, reason] of [
    [{ procoreProjectId: "other", procoreCompanyId: "company-a" }, "conflicting-project-ids"],
    [{ procoreCompanyId: "company-a", companyId: "company-b" }, "conflicting-company-ids"],
    [{ procoreCompanyId: "company-a", procoreProjectId: { id: "project-a" } }, "conflicting-project-ids"],
  ]) {
    const row = legacy("conflicted", { customFields: fields });
    const db = database({ projects: [row] });
    const result = await load(db.prisma).resolveProcoreLegacyProject(base);
    assert.equal(result.reason, reason);
    assert.deepEqual(db.state().projects, [row]);
    assert.equal(db.state().projectLinks.length, 0);
  }
});

test("duplicate exact matches never choose the newer or active row", async () => {
  const rows = [legacy("old", { projectArchived: true }), legacy("new", { updatedAt: new Date() })];
  const db = database({ projects: rows });
  const result = await load(db.prisma).resolveProcoreLegacyProject(base);
  assert.equal(result.reason, "ambiguous-legacy-projects");
  assert.deepEqual(db.state().projects, rows);
  assert.equal(db.state().projectLinks.length, 0);
});

test("previously retired merge rows require review even as the sole exact match", async () => {
  const row = legacy("retired", { customFields: { procoreCompanyId: "company-a", mergedBy: "procore_webhook" } });
  const db = database({ projects: [row] });
  assert.equal((await load(db.prisma).resolveProcoreLegacyProject(base)).reason, "retired-legacy-project");
  assert.deepEqual(db.state().projects, [row]);
});

test("an established bridge cannot hide duplicate or conflicting legacy evidence", async () => {
  for (const projects of [[legacy("linked"), legacy("duplicate")], [legacy("linked", { projectId: "other" })], []]) {
    const db = database({ projects, projectLinks: [{ companyId: "company-a", procoreProjectId: "project-a", projectId: "linked" }] });
    const result = await load(db.prisma).resolveProcoreLegacyProject(base);
    assert.equal(result.status, "conflict");
    assert.deepEqual(db.state().projects, projects);
  }
});

test("a legacy project already claimed by another identity cannot be relinked", async () => {
  const db = database({ projects: [legacy("claimed")], projectLinks: [{ companyId: "company-a", procoreProjectId: "other", projectId: "claimed" }] });
  assert.equal((await load(db.prisma).resolveProcoreLegacyProject(base)).reason, "legacy-project-already-linked");
});

test("Bid Board IDs cannot match Procore project IDs just because their strings agree", async () => {
  const db = database({ projects: [legacy("bid", { projectId: null, bidBoardId: "project-a" })] });
  const result = await load(db.prisma).resolveProcoreLegacyProject(base);
  assert.equal(result.created, true);
  assert.notEqual(result.project.id, "bid");
});

test("pure bids are retained and explicit promotion preserves the same local project", async () => {
  const db = database();
  const api = load(db.prisma);
  const bid = await api.resolveBidBoardLegacyProject({ companyId: "company-a", bidBoardId: "bid-a", createProjectIfMissing: true });
  assert.equal(bid.project.procoreId, null);
  const promotionDb = database({ ...db.state(), canonicalBidBoards: [{ companyId: "company-a", bidBoardId: "bid-a", procoreProjectId: "project-a" }] });
  const promoted = await load(promotionDb.prisma).resolveBidBoardLegacyProject({
    companyId: "company-a", bidBoardId: "bid-a", procoreProjectId: "project-a", createProjectIfMissing: true,
  });
  assert.equal(promoted.project.id, bid.project.id);
  assert.equal(promoted.project.procoreId, "project-a");
  assert.equal(promotionDb.state().projects.length, 1);
  assert.equal(promotionDb.state().projectLinks.length, 1);
  assert.equal(promotionDb.state().bidBoardLinks.length, 1);
});

test("a bid payload missing its project ID reuses the existing project through the saved exact relationship", async () => {
  const state = {
    projects: [legacy("existing-project")],
    canonicalBidBoards: [{ companyId: "company-a", bidBoardId: "bid-a", procoreProjectId: "project-a" }],
  };
  const db = database(state);
  const api = load(db.prisma);
  const input = { companyId: "company-a", bidBoardId: "bid-a", createProjectIfMissing: true };
  const decision = api.classifyLegacyProjectIdentity(input, snapshot(state));
  const result = await api.resolveBidBoardLegacyProject(input);
  assert.equal(decision.projectId, "existing-project");
  assert.equal(result.project.id, "existing-project");
  assert.equal(result.project.procoreId, "project-a");
  assert.equal(result.project.bidBoardId, "bid-a");
  assert.equal(result.created, false);
  assert.equal(db.state().projects.length, 1);
});

test("a project-only sync discovers an exact canonical bid relationship before creating a duplicate", async () => {
  const db = database({
    projects: [legacy("existing-bid", { projectId: null, bidBoardId: "bid-a", companyId: null })],
    canonicalBidBoards: [
      { companyId: "company-a", bidBoardId: "bid-a", procoreProjectId: "project-a" },
      { companyId: "company-a", bidBoardId: "bid-b", procoreProjectId: "project-a" },
    ],
  });
  const result = await load(db.prisma).resolveProcoreLegacyProject(base);
  assert.equal(result.project.id, "existing-bid");
  assert.equal(result.project.procoreId, "project-a");
  assert.equal(result.created, false);
  assert.equal(db.state().projects.length, 1);
});

test("separate legacy rows for linked project and bid remain a conflict instead of a merge", async () => {
  const db = database({
    projects: [legacy("project"), legacy("bid", { projectId: null, bidBoardId: "bid-a" })],
    canonicalBidBoards: [{ companyId: "company-a", bidBoardId: "bid-a", procoreProjectId: "project-a" }],
  });
  const result = await load(db.prisma).resolveProcoreLegacyProject(base);
  assert.equal(result.reason, "ambiguous-legacy-projects");
  assert.equal(db.state().projects.length, 2);
  assert.equal(db.state().projectLinks.length, 0);
});

test("promotion with an absent or mismatched canonical relationship makes no changes", async () => {
  for (const canonicalBidBoards of [[], [{ companyId: "company-a", bidBoardId: "bid-a", procoreProjectId: "other" }]]) {
    const db = database({ projects: [legacy("bid", { projectId: null, bidBoardId: "bid-a" })], canonicalBidBoards });
    const result = await load(db.prisma).resolveProcoreLegacyProject({ ...base, bidBoardId: "bid-a" });
    assert.equal(result.reason, "unverified-bid-project-relationship");
    assert.equal(db.state().projects[0].procoreId, null);
  }
});

test("a conflicting explicit bid ID is not replaced by another bid for the same project", async () => {
  const db = database({
    projects: [legacy("project", { bidBoardId: "bid-a" })],
    canonicalBidBoards: [{ companyId: "company-a", bidBoardId: "bid-b", procoreProjectId: "project-a" }],
  });
  const result = await load(db.prisma).resolveBidBoardLegacyProject({
    companyId: "company-a", bidBoardId: "bid-b", procoreProjectId: "project-a", createProjectIfMissing: true,
  });
  assert.equal(result.reason, "conflicting-bid-board-ids");
  assert.equal(db.state().projects[0].bidBoardId, "bid-a");
});

test("metadata callbacks run after identity stamping inside the same transaction", async () => {
  const db = database({ projects: [legacy("scheduled", { projectId: null, customFields: { procoreProjectId: "project-a", procoreCompanyId: "company-a", note: "keep" } })] });
  const result = await load(db.prisma).resolveProcoreLegacyProject({
    ...base,
    updateProject: async (tx, project, resolution) => {
      assert.equal(project.procoreId, "project-a");
      assert.equal(resolution.created, false);
      return tx.project.update({ where: { id: project.id }, data: { projectName: "Renamed", customFields: { ...project.customFields, note: "updated" } } });
    },
  });
  assert.equal(result.project.id, "scheduled");
  assert.equal(result.project.projectName, "Renamed");
  assert.equal(db.state().projectLinks[0].projectId, "scheduled");
  assert.equal(db.options[0].isolationLevel, "Serializable");
});

test("callbacks cannot change or remove identity and all staged writes roll back", async () => {
  for (const data of [{ procoreId: "other" }, { procoreId: null }, { customFields: {} }]) {
    const db = database();
    await assert.rejects(load(db.prisma).resolveProcoreLegacyProject({
      ...base, updateProject: (tx, project) => tx.project.update({ where: { id: project.id }, data }),
    }), /verified identity/);
    assert.equal(db.state().projects.length, 0);
    assert.equal(db.state().projectLinks.length, 0);
  }
});

test("callback errors cannot leave a partial local project or bridge", async () => {
  const db = database();
  await assert.rejects(load(db.prisma).resolveProcoreLegacyProject({ ...base, updateProject: async () => { throw new Error("Header failed"); } }), /Header failed/);
  assert.equal(db.state().projects.length, 0);
  assert.equal(db.state().projectLinks.length, 0);
});

test("repeated and simultaneous ingestion creates one project and one scoped bridge", async () => {
  const db = database();
  const api = load(db.prisma);
  const results = await Promise.all([api.resolveProcoreLegacyProject(base), api.resolveProcoreLegacyProject(base)]);
  assert.equal(results[0].project.id, results[1].project.id);
  assert.equal(results.filter(result => result.created).length, 1);
  assert.equal(db.state().projects.length, 1);
  assert.equal(db.state().projectLinks.length, 1);
  assert.equal((await api.resolveProcoreLegacyProject(base)).project.id, results[0].project.id);
  assert.ok(db.attempts() >= 4, "A concurrent losing transaction retries");
});

test("unique-constraint retries roll back the losing project; unrelated errors propagate", async () => {
  const db = database({}, ["P2002"]);
  const result = await load(db.prisma).resolveProcoreLegacyProject(base);
  assert.equal(result.status, "created");
  assert.equal(db.attempts(), 2);
  assert.equal(db.state().projects.length, 1);
  const failed = database({}, ["P1001"]);
  await assert.rejects(load(failed.prisma).resolveProcoreLegacyProject(base), error => error.code === "P1001");
  assert.equal(failed.state().projects.length, 0);
});

test("the exported read-only classifier uses the same ambiguity decision without database writes", () => {
  const api = load({ $transaction: () => assert.fail("Classifier must be pure") });
  const result = api.classifyLegacyProjectIdentity(base, snapshot({ projects: [legacy("one"), legacy("two")] }));
  assert.equal(result.reason, "ambiguous-legacy-projects");
  assert.equal(result.projectId, null);
});

test("the additive migration has separate namespaces and does not modify existing records", () => {
  const migration = fs.readFileSync("prisma/migrations/20261026170000_procore_legacy_project_identity/migration.sql", "utf8").replace(/--.*$/gm, "");
  assert.match(migration, /PRIMARY KEY \("company_id", "procore_project_id"\)/);
  assert.match(migration, /PRIMARY KEY \("company_id", "bid_board_id"\)/);
  assert.equal((migration.match(/UNIQUE \("project_id"\)/g) || []).length, 1);
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE|INSERT|DROP|TRUNCATE)\s+(?!RESTRICT|CASCADE)/i);
  assert.equal((migration.match(/ON DELETE RESTRICT/g) || []).length, 2);
  assert.match(migration.trim(), /^BEGIN;[\s\S]*COMMIT;$/);
});
