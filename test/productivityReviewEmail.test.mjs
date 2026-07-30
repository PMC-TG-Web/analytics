import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import fs from "node:fs";
import vm from "node:vm";

function loadModule() {
  const source = fs.readFileSync("src/lib/productivityReviewEmail.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(module, exports) { ${output} })(module, module.exports);`, {
    module,
  });
  return module.exports;
}

const {
  buildProductivityReadyEmail,
  buildProductivityReviewEmail,
  isValidNotificationEmail,
} = loadModule();

test("validates notification email addresses", () => {
  assert.equal(isValidNotificationEmail("office@example.com"), true);
  assert.equal(isValidNotificationEmail("not-an-email"), false);
  assert.equal(isValidNotificationEmail("a @example.com"), false);
});

test("builds a review email and escapes project content", () => {
  const email = buildProductivityReviewEmail({
    projectId: "123",
    projectNumber: "2601",
    projectName: "<Unsafe & Project>",
    reviewerEmail: "reviewer@example.com",
    reviewedAt: new Date("2026-07-30T16:00:00.000Z"),
    weightedCompletion: 0.9134,
    recipientEmail: "office@example.com",
    projectUrl: "https://example.com/analytics/productivity?projectId=123",
  });

  assert.match(email.subject, /2601/);
  assert.match(email.text, /91\.3%/);
  assert.doesNotMatch(email.html, /<Unsafe/);
  assert.match(email.html, /&lt;Unsafe &amp; Project&gt;/);
});

test("builds the thirty-day ready-for-review reminder", () => {
  const email = buildProductivityReadyEmail({
    projectNumber: "2601",
    projectName: "Ready Project",
    completedAt: new Date("2026-07-01T12:00:00Z"),
    eligibleAt: new Date("2026-07-31T12:00:00Z"),
    projectUrl: "https://example.com/analytics/productivity?projectId=123",
  });
  assert.match(email.subject, /ready for review/i);
  assert.match(email.text, /30-day review date/i);
  assert.match(email.html, /Review Field Productivity/);
});
