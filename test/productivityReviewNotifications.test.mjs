import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function isValidEmail(value) {
  const email = value.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parsePmcdecorEmailList(value) {
  const emails = value
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!emails.length || emails.some((email) => (
    !isValidEmail(email) || email.slice(email.lastIndexOf("@") + 1) !== "pmcdecor.com"
  ))) {
    throw new Error("Email recipients must use the exact @pmcdecor.com domain.");
  }
  return [...new Set(emails)];
}

function loadModule(environment = {}) {
  const source = fs.readFileSync("src/lib/productivityReviewNotifications.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const require = (id) => {
    if (id === "@/lib/productivityReviewEmail") {
      return { isValidNotificationEmail: isValidEmail };
    }
    if (id === "@/lib/timecardNotification") {
      return { parsePmcdecorEmailList };
    }
    throw new Error(`Unexpected import: ${id}`);
  };
  vm.runInNewContext(
    `(function(require, module, exports) { ${output} })(require, module, module.exports);`,
    { require, module, process: { env: environment } },
  );
  return module.exports;
}

test("normalizes and deduplicates exact PMC productivity recipients", () => {
  const { getProductivityReviewNotificationConfig } = loadModule({
    PRODUCTIVITY_REVIEW_TO_EMAILS: "PM@PMCDECOR.COM, pm@pmcdecor.com, field@pmcdecor.com",
  });

  assert.deepEqual(
    Array.from(getProductivityReviewNotificationConfig().to),
    ["pm@pmcdecor.com", "field@pmcdecor.com"],
  );
});

test("rejects external recipients in review and completion email configuration", () => {
  const reviewConfig = loadModule({
    PRODUCTIVITY_REVIEW_TO_EMAILS: "pm@pmcdecor.com, vendor@example.com",
  });
  const completeConfig = loadModule({
    PRODUCTIVITY_COMPLETE_TO_EMAILS: "customer@example.com",
  });

  assert.throws(
    () => reviewConfig.getProductivityReviewNotificationConfig(),
    /exact @pmcdecor\.com domain/,
  );
  assert.throws(
    () => completeConfig.getProductivityCompleteNotificationConfig(),
    /exact @pmcdecor\.com domain/,
  );
});