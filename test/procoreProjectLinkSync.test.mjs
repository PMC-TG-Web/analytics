import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadModule(makeRequest = async () => []) {
  const source = fs.readFileSync("src/lib/procoreProjectLinkSync.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const require = (id) => {
    if (id === "@/lib/procore") return { makeRequest };
    if (id === "@/lib/commitmentMakerAccess") {
      return { createCommitmentMakerAccessToken: async () => "a".repeat(43) };
    }
    throw new Error(`Unexpected import: ${id}`);
  };
  vm.runInNewContext(
    `(function(require, module, exports) { ${output} })(require, module, module.exports);`,
    { require, module, URL, URLSearchParams, process },
  );
  return module.exports;
}

const folder = { id: 10, name: "Job-Schedule", document_type: "folder" };
const file = {
  id: 20,
  name: "PMC_Job_Schedule.xlsx",
  document_type: "file",
  parent_id: 10,
  file: {
    current_version: {
      id: 30,
      url: "https://us02.procore.com/fas/api/v5/files/fallback",
      prostore_file: { url: "https://us02.procore.com/fas/api/v5/files/current" },
    },
  },
};

test("finds the workbook inside Job-Schedule despite separator variations", () => {
  const { findJobScheduleDocument } = loadModule();
  const wrongFolderFile = { ...file, id: 21, parent_id: 999 };
  const result = findJobScheduleDocument([folder, wrongFolderFile, file]);
  assert.equal(result.status, "found");
  assert.equal(String(result.file.id), "20");
  assert.equal(result.folderId, "10");
});

test("uses only HTTPS URLs hosted by Procore", () => {
  const { jobScheduleFileUrl } = loadModule();
  assert.equal(jobScheduleFileUrl(file), "https://us02.procore.com/fas/api/v5/files/current");
  assert.equal(jobScheduleFileUrl({
    file: { current_version: { url: "https://files.example.com/workbook.xlsx" } },
  }), null);
});

test("adds one Project Home link while preserving existing link order", () => {
  const { buildProjectLinksBulkUpdate } = loadModule();
  const result = buildProjectLinksBulkUpdate([
    { id: 2, title: "Second", url: "https://example.com/2", position: 2 },
    { id: 1, title: "First", url: "https://example.com/1", position: 1 },
  ], "Job Schedule", "https://us02.procore.com/fas/api/v5/files/current");
  assert.equal(result.action, "created");
  assert.deepEqual(JSON.parse(JSON.stringify(result.body)), [
    { id: "1", title: "First", url: "https://example.com/1" },
    { id: "2", title: "Second", url: "https://example.com/2" },
    { title: "Job Schedule", url: "https://us02.procore.com/fas/api/v5/files/current" },
  ]);
});

test("updates the existing named link and becomes idempotent", () => {
  const { buildProjectLinksBulkUpdate } = loadModule();
  const existing = [{ id: 8, title: "job schedule", url: "https://us02.procore.com/old", position: 1 }];
  const updated = buildProjectLinksBulkUpdate(existing, "Job Schedule", "https://us02.procore.com/new");
  assert.equal(updated.action, "updated");
  assert.deepEqual(JSON.parse(JSON.stringify(updated.body)), [
    { id: "8", title: "Job Schedule", url: "https://us02.procore.com/new" },
  ]);

  const unchanged = buildProjectLinksBulkUpdate(updated.body, "Job Schedule", "https://us02.procore.com/new");
  assert.equal(unchanged.action, "unchanged");
  assert.equal(unchanged.changed, false);
});

test("renames the previously managed Job Schedule link without creating a duplicate", () => {
  const { buildProjectLinksBulkUpdate } = loadModule();
  const result = buildProjectLinksBulkUpdate([
    { id: 8, title: "Job Schedule", url: "https://us02.procore.com/current", position: 1 },
  ], "PMC Job Schedule", "https://us02.procore.com/current");

  assert.equal(result.action, "updated");
  assert.deepEqual(JSON.parse(JSON.stringify(result.body)), [
    { id: "8", title: "PMC Job Schedule", url: "https://us02.procore.com/current" },
  ]);
});

test("builds a signed project-specific HTTPS Commitment Maker URL", () => {
  const { commitmentMakerProjectUrl } = loadModule();
  assert.equal(
    commitmentMakerProjectUrl("598134326626273", "https://analyticspmc.netlify.app/analytics?old=true", "a".repeat(43)),
    `https://analyticspmc.netlify.app/procore/commitments-live/maker?projectId=598134326626273&source=procore-project-home&access=${"a".repeat(43)}`,
  );
  assert.throws(
    () => commitmentMakerProjectUrl("not-a-project", "https://analyticspmc.netlify.app", "a".repeat(43)),
    /numeric Procore project ID/,
  );
  assert.throws(
    () => commitmentMakerProjectUrl("598134326626273", "http://analyticspmc.netlify.app", "a".repeat(43)),
    /must use HTTPS/,
  );
  assert.throws(
    () => commitmentMakerProjectUrl("598134326626273", "https://analyticspmc.netlify.app", "unsigned"),
    /signed Commitment Maker project access token/,
  );
});

test("sync fetches Documents v2 and sends the full ordered Links v2 bulk update", async () => {
  const calls = [];
  const makeRequest = async (path, _token, options) => {
    calls.push({ path, options });
    if (path.includes("/documents?")) return [folder, file];
    if (path.endsWith("/links?page=1&per_page=100")) {
      return [{ id: 7, title: "Safety", url: "https://example.com/safety", position: 1 }];
    }
    if (path.endsWith("/links/bulk_update")) {
      return [...JSON.parse(options.body).slice(0, 1), {
        id: 9,
        title: "PMC Job Schedule",
        url: "https://us02.procore.com/fas/api/v5/files/current",
      }];
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const { syncJobScheduleProjectLink } = loadModule(makeRequest);
  const result = await syncJobScheduleProjectLink({ token: "token", companyId: "55", projectId: "66" });

  assert.equal(result.status, "created");
  assert.equal(result.linkId, "9");
  assert.match(calls[0].path, /^\/rest\/v2\.0\/projects\/66\/documents\?/);
  assert.equal(calls[2].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[2].options.body), [
    { id: "7", title: "Safety", url: "https://example.com/safety" },
    { title: "PMC Job Schedule", url: "https://us02.procore.com/fas/api/v5/files/current" },
  ]);
});

test("sync adds the project-specific Commitment Maker link while preserving existing links", async () => {
  const calls = [];
  const makeRequest = async (path, _token, options) => {
    calls.push({ path, options });
    if (path.endsWith("/links?page=1&per_page=100")) {
      return [{ id: 7, title: "PMC Job Schedule", url: "https://us02.procore.com/file", position: 1 }];
    }
    if (path.endsWith("/links/bulk_update")) {
      return JSON.parse(options.body).map((link, index) => ({ id: link.id || String(20 + index), ...link }));
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const { syncCommitmentMakerProjectLink } = loadModule(makeRequest);
  const result = await syncCommitmentMakerProjectLink({
    token: "token",
    companyId: "55",
    projectId: "598134326626273",
    baseUrl: "https://analyticspmc.netlify.app",
  });

  assert.equal(result.status, "created");
  assert.equal(
    result.url,
    `https://analyticspmc.netlify.app/procore/commitments-live/maker?projectId=598134326626273&source=procore-project-home&access=${"a".repeat(43)}`,
  );
  assert.deepEqual(JSON.parse(calls[1].options.body), [
    { id: "7", title: "PMC Job Schedule", url: "https://us02.procore.com/file" },
    {
      title: "Commitment Maker",
      url: `https://analyticspmc.netlify.app/procore/commitments-live/maker?projectId=598134326626273&source=procore-project-home&access=${"a".repeat(43)}`,
    },
  ]);
});
