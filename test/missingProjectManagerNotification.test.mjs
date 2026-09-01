import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadModule(send) {
  const source = fs.readFileSync("src/lib/missingProjectManagerNotification.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const require = (id) => {
    if (id === "resend") {
      return { Resend: class { emails = { send }; } };
    }
    throw new Error(`Unexpected import: ${id}`);
  };
  vm.runInNewContext(
    `(function(require, module, exports) { ${output} })(require, module, module.exports);`,
    { require, module, process: { env: { RESEND_API_KEY: "test-key" } }, encodeURIComponent },
  );
  return module.exports;
}

test("emails only Todd with a deterministic missing-PM alert", async () => {
  let payload;
  let options;
  const { notifyMissingProjectManager } = loadModule(async (nextPayload, nextOptions) => {
    payload = nextPayload;
    options = nextOptions;
    return { data: { id: "email-1" }, error: null };
  });

  const result = await notifyMissingProjectManager({
    companyId: "company",
    projectId: "project",
    projectNumber: "2601",
    projectName: "Test Project",
    taskTitle: "Verify CO 001 Is in Commitments",
    workflowKey: "commitment-maker-123",
    details: ["Change order: 001"],
  });

  assert.deepEqual(Array.from(payload.to), ["todd@pmcdecor.com"]);
  assert.match(payload.subject, /Project Manager needed/);
  assert.match(payload.text, /no active Project Manager/);
  assert.equal(options.idempotencyKey, "pmc-missing-pm-company-project-commitment-maker-123");
  assert.equal(result.recipient, "todd@pmcdecor.com");
});