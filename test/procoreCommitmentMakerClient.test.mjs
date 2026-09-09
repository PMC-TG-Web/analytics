import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { AsyncLocalStorage } from "node:async_hooks";
import ts from "typescript";

function loadModule(file, dependencies = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(`(function(require, module, exports) { ${output} })(require, module, module.exports);`, {
    require: (id) => {
      if (dependencies[id]) return dependencies[id];
      throw new Error(`Unexpected import: ${id}`);
    },
    module, Response, Headers, AbortSignal, Error, Date, console, setTimeout,
  });
  return module.exports;
}

const rateLimits = loadModule("src/lib/procoreRateLimit.ts");
const { createCommitmentMakerProcoreClient, CommitmentMakerRateLimitError, withCommitmentMakerProcoreClient, commitmentMakerProcoreJson } = loadModule(
  "src/lib/procoreCommitmentMakerClient.ts", {
    "node:async_hooks": { AsyncLocalStorage },
    "@/lib/procoreRateLimit": rateLimits,
  },
);
const start = Date.parse("2026-09-09T16:00:00Z");
const params = { companyId: "company", accessToken: "test-token", path: "/line_items", method: "POST", body: { description: "L&M Curing Compound" } };
const ok = (id = 1, headers = {}) => new Response(JSON.stringify({ id }), { status: 201, headers });
const throttled = (seconds) => new Response("rate limited", { status: 429, headers: { "Retry-After": String(seconds) } });

function fixture(responses, observeQuota) {
  let time = start;
  const calls = [], waits = [], observations = [];
  const client = createCommitmentMakerProcoreClient({
    apiUrl: "https://example.invalid", reserve: 100,
    now: () => time,
    sleep: async (ms) => { waits.push(ms); time += ms; },
    observeQuota: observeQuota ?? (async (company, observation) => observations.push({ company, observation })),
    fetch: async (url, options) => {
      calls.push({ url, ...options });
      const next = responses.shift();
      if (!next) throw new Error("Unexpected extra request");
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return { client, calls, waits, observations };
}

for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
  test(`${method} retries an explicit 429 after the provider reset`, async () => {
    const f = fixture([throttled(2), ok()]);
    const result = await f.client({ ...params, method });
    assert.equal(result.ok, true);
    assert.deepEqual(f.waits, [2_000]);
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[0].body, f.calls[1].body);
    assert.equal(f.calls[1].headers["Procore-Company-Id"], "company");
    assert.equal(f.observations[0].observation.rateLimited, true);
  });
}

test("19 confirmed lines are not replayed when line 20 is throttled", async () => {
  const f = fixture([...Array.from({ length: 19 }, (_, i) => ok(i + 1)), throttled(2), ok(20)]);
  const accepted = [];
  for (let i = 1; i <= 20; i++) {
    const result = await f.client({ ...params, body: { line: i } });
    accepted.push(result.payload.id);
  }
  assert.deepEqual(accepted, Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(f.calls.length, 21);
  assert.deepEqual(f.calls.map((call) => JSON.parse(call.body).line), [...accepted, 20]);
});

test("long reset is returned intact without sending another request early", async () => {
  const f = fixture([throttled(60)]);
  await assert.rejects(f.client(params), (error) => {
    assert.ok(error instanceof CommitmentMakerRateLimitError);
    assert.equal(error.status, 429);
    assert.equal(error.rateLimitUntil, new Date(start + 60_000).toISOString());
    return true;
  });
  // Even a caller probing an alternative endpoint cannot consume more quota.
  await assert.rejects(f.client({ ...params, path: "/fallback" }), CommitmentMakerRateLimitError);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.waits, []);
});

test("all calls in a request share the eight-second wait budget", async () => {
  const f = fixture([throttled(5), ok(), throttled(5), ok()]);
  assert.equal((await f.client(params)).ok, true);
  await assert.rejects(f.client(params), CommitmentMakerRateLimitError);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.waits, [5_000]);
});

test("zero remaining on a successful write pauses before the next line", async () => {
  const f = fixture([ok(1, {
    "X-Rate-Limit-Remaining": "0", "X-Rate-Limit-Reset": String(start / 1_000 + 3),
  }), ok(2)]);
  assert.equal((await f.client(params)).payload.id, 1);
  assert.equal(f.waits.length, 0);
  assert.equal((await f.client(params)).payload.id, 2);
  assert.deepEqual(f.waits, [4_500]);
  assert.equal(f.observations.length, 1);
});

test("reserve observation pauses background work without blocking interactive balance", async () => {
  const f = fixture([ok(1, {
    "X-Rate-Limit-Limit": "25", "X-Rate-Limit-Remaining": "5", "X-Rate-Limit-Reset": String(start / 1_000 + 3),
  }), ok(2)]);
  await f.client(params);
  await f.client(params);
  assert.deepEqual(f.waits, []);
  assert.equal(f.observations.length, 1);
  assert.equal(f.observations[0].observation.cooldownUntil.toISOString(), new Date(start + 4_500).toISOString());
});

test("uses the later of Retry-After and reset, including reset padding", async () => {
  const response = throttled(1);
  response.headers.set("X-Rate-Limit-Reset", String(start / 1_000 + 8));
  const f = fixture([response]);
  await assert.rejects(f.client(params), (error) => error.rateLimitUntil === new Date(start + 9_500).toISOString());
  assert.deepEqual(f.waits, []);
});

test("persistent 429 without headers stops after two retries", async () => {
  const f = fixture(Array.from({ length: 4 }, () => new Response(null, { status: 429 })));
  await assert.rejects(f.client(params), CommitmentMakerRateLimitError);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.waits, [1_000, 2_000]);
});

for (const response of [new Error("socket disconnected"), Object.assign(new Error("deadline"), { name: "TimeoutError" }), {
  status: 201, ok: true, text: async () => { throw new Error("body interrupted"); },
}]) {
  test(`does not retry an uncertain mutation: ${response.message ?? "unreadable accepted body"}`, async () => {
    const f = fixture([response, ok()]);
    assert.equal((await f.client(params)).status, 504);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.waits, []);
  });
}

for (const status of [401, 403, 422, 500, 503]) {
  test(`does not replay a ${status} response`, async () => {
    const f = fixture([new Response("error", { status }), ok()]);
    assert.equal((await f.client(params)).status, status);
    assert.equal(f.calls.length, 1);
  });
}

test("quota persistence failure cannot replay an accepted write", async () => {
  const f = fixture([ok(12, { "X-Rate-Limit-Remaining": "1" })], async () => { throw new Error("database unavailable"); });
  assert.equal((await f.client(params)).payload.id, 12);
  assert.equal(f.calls.length, 1);
});

test("concurrent incoming requests have isolated clients and wait budgets", async () => {
  const run = (id) => withCommitmentMakerProcoreClient({
    apiUrl: "https://example.invalid", reserve: 100, observeQuota: async () => {},
    fetch: async () => { await Promise.resolve(); return ok(id); },
  }, async () => (await commitmentMakerProcoreJson(params)).payload.id);
  assert.deepEqual(await Promise.all([run(1), run(2)]), [1, 2]);
});
