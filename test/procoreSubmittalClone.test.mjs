import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(file, dependencies = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(`(function(require, module, exports) { ${output} })(require, module, module.exports);`, {
    require: id => {
      if (dependencies[id]) return dependencies[id];
      throw new Error(`Unexpected import: ${id}`);
    },
    module, Date, Error, Response, console,
    setTimeout: callback => callback(),
  });
  return module.exports;
}

const rateLimits = load("src/lib/procoreCloneRateLimit.ts");
const reset = "2099-01-01T00:00:00.000Z";
const throttled = () => Object.assign(new Error("quota exhausted"), { status: 429, rateLimitUntil: new Date(reset) });
const pkg = { id: 10, number: "1", title: "Package" };
const submittals = [1, 2, 3].map(id => ({ id, number: String(id), title: `Submittal ${id}`, submittal_package: pkg }));

function fixture(override = () => undefined) {
  const calls = [];
  let inFlight = 0, maxInFlight = 0, bypasses = 0;
  const { POST } = load("src/app/api/procore/submittals/clone/route.ts", {
    "next/server": { NextResponse: Response },
    "next/headers": { cookies: async () => ({ get: () => ({ value: "test-token" }) }) },
    "@/lib/procoreCloneRateLimit": rateLimits,
    "@/lib/procore": {
      procoreConfig: { companyId: "target-company" },
      getClientCredentialsToken: async () => { throw new Error("Unexpected token fallback"); },
      withProcoreLiveApiBypassForAuthenticatedSession: async (request, operation) => { bypasses++; return operation(); },
      makeRequest: async (path, token, options, companyId, quietStatuses) => {
        const call = { path, token, ...options, companyId, quietStatuses };
        calls.push(call);
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        try {
          await Promise.resolve();
          const custom = await override(call, calls);
          if (custom !== undefined) return custom;
          if (call.method === "POST") return { id: 100 + calls.length };
          if (path.includes("submittal_packages")) return path.includes("/source/") ? [pkg] : [{ ...pkg, id: 20 }];
          if (path.includes("submittals?")) return submittals;
          return submittals.find(item => path.endsWith(`/${item.id}`));
        } finally { inFlight--; }
      },
    },
  });
  return {
    calls, maxInFlight: () => maxInFlight, bypasses: () => bypasses,
    run: body => POST(new Request("https://example.invalid/api/procore/submittals/clone", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceCompanyId: "source-company", sourceProjectId: "source", targetCompanyId: "target-company", targetProjectId: "target", ...body }),
    })),
  };
}

test("quota metadata preserves Date/string reset and supplies a finite fallback", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  for (const value of [new Date(now + 90_000), new Date(now + 90_000).toISOString()]) {
    const result = rateLimits.cloneRateLimitResponse({ status: 429, rateLimitUntil: value }, now);
    assert.equal(result.headers["Retry-After"], "90");
    assert.equal(result.rateLimitUntil, new Date(now + 90_000).toISOString());
  }
  for (const value of [undefined, "invalid", new Date(now - 1)]) {
    assert.equal(rateLimits.cloneRateLimitResponse({ status: 429, rateLimitUntil: value }, now).headers["Retry-After"], "60");
  }
  assert.equal(rateLimits.cloneRateLimitResponse({ status: 403 }, now), null);
});

test("initial package 429 stops reads and returns a retryable no-write pause", async () => {
  const f = fixture(() => { throw throttled(); });
  const response = await f.run({ dryRun: false });
  const body = await response.json();
  assert.equal(response.status, 429);
  assert.equal(body.rateLimitUntil, reset);
  assert.equal(body.retryable, true);
  assert.match(body.details, /No records were created/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(Number(response.headers.get("retry-after")) > 0);
  assert.equal(f.calls.length, 1);
});

test("dry run serializes reads through the shared client with exact company IDs", async () => {
  const f = fixture();
  const response = await f.run({});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.counts.sourceSubmittals, 3);
  assert.equal(body.readyForLiveClone, true);
  assert.equal(f.maxInFlight(), 1);
  assert.equal(f.bypasses(), 1);
  assert.equal(f.calls.length, 6);
  for (const call of f.calls) {
    assert.equal(call.companyId, call.path.includes("/source/") ? "source-company" : "target-company");
    assert.equal(call.cache, "no-store");
    assert.equal(call.method, "GET");
  }
});

test("detail 429 prevents further detail reads and all writes", async () => {
  const f = fixture(call => { if (call.path.endsWith("submittals/2")) throw throttled(); });
  const response = await f.run({ dryRun: false });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).retryable, true);
  assert.ok(f.calls.every(call => call.method === "GET"));
  assert.ok(!f.calls.some(call => call.path.endsWith("submittals/3")));
});

test("partial submittal creation preserves accepted results and stops at 429", async () => {
  let writes = 0;
  const f = fixture(call => {
    if (call.method === "POST" && ++writes === 2) throw throttled();
  });
  const response = await f.run({ dryRun: false });
  const body = await response.json();
  assert.equal(response.status, 429);
  assert.equal(writes, 2);
  assert.equal(body.retryable, false);
  assert.equal(body.success, false);
  assert.equal(body.readyForLiveClone, false);
  assert.equal(body.counts.createdSubmittals, 1);
  assert.equal(body.counts.failedSubmittals, 1);
  assert.equal(body.createResults[0].sourceId, "1");
  assert.equal(body.createResults[0].ok, true);
  assert.equal(body.createResults[1].sourceId, "2");
  assert.equal(body.rateLimitUntil, reset);
});

test("package 429 retains earlier package results and prevents submittal writes", async () => {
  const f = fixture(call => {
    if (call.method === "GET" && call.path.includes("/target/") && call.path.includes("submittal_packages")) return [];
    if (call.method === "GET" && call.path.includes("/source/") && call.path.includes("submittal_packages")) return [pkg, { id: 11, title: "Second" }, { id: 12, title: "Third" }];
    if (call.method === "POST" && JSON.parse(call.body).submittal_package?.title === "Second") throw throttled();
  });
  const response = await f.run({ dryRun: false, cloneSubmittals: false });
  const body = await response.json();
  assert.equal(response.status, 429);
  assert.equal(body.counts.createdPackages, 1);
  assert.equal(body.packageCreateResults.length, 2);
  assert.equal(body.createResults.length, 0);
  assert.equal(body.retryable, false);
  assert.ok(f.calls.every(call => call.path.includes("submittal_packages")));
});

test("successful live batch retains response shape and submitted payload", async () => {
  const f = fixture();
  const response = await f.run({ dryRun: false, createOffset: 1, createLimit: 1 });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.counts.createdSubmittals, 1);
  const [call] = f.calls.filter(call => call.method === "POST");
  assert.equal(JSON.parse(call.body).submittal.number, "2");
  assert.equal(JSON.parse(call.body).submittal.submittal_package_id, 20);
});

test("unknown mutation outcomes are not retried or misreported as quota pauses", async () => {
  let firstWrites = 0;
  const f = fixture(call => {
    if (call.method === "POST" && JSON.parse(call.body).submittal.number === "1") {
      firstWrites++;
      throw new Error("connection ended");
    }
  });
  const response = await f.run({ dryRun: false });
  const body = await response.json();
  assert.equal(firstWrites, 1);
  assert.equal(body.success, false);
  assert.equal(body.rateLimited, undefined);
  assert.equal(body.failedCreateResults.length, 1);
});
