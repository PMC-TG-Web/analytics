import assert from "node:assert/strict";
import test from "node:test";
import { runCommitmentMakerRequest } from "../src/lib/commitmentMakerRequest.ts";

const start = Date.parse("2026-09-09T18:00:00Z");
function response(status, payload) { return new Response(JSON.stringify(payload), { status }); }
function pause(seconds = 30, extra = {}) {
  return response(429, { rateLimited: true, retryable: true, rateLimitUntil: new Date(start + seconds * 1_000).toISOString(), ...extra });
}
function fixture(responses) {
  let time = start, calls = 0, received = 0;
  const waits = [];
  const controller = new AbortController();
  const options = {
    signal: controller.signal, now: () => time,
    wait: async (ms) => { waits.push(ms); time += ms; },
    onResponse: () => { received++; },
    request: async () => {
      calls++;
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (!next) throw new Error("Unexpected extra request");
      return next;
    },
  };
  return { options, controller, waits, calls: () => calls, received: () => received };
}

test("keeps a partial 19-line response private and returns only the completed result", async () => {
  const f = fixture([pause(30, { results: [{ success: false, contractId: "po-1", createdLineItems: 19 }] }),
    response(200, { success: true, results: [{ contractId: "po-1", success: true, createdLineItems: 20 }] })]);
  const result = await runCommitmentMakerRequest(f.options);
  assert.equal(result.payload.success, true);
  assert.equal(result.payload.results[0].contractId, "po-1");
  assert.deepEqual(f.waits, [30_000]);
  assert.equal(f.calls(), 2);
});

for (const [status, extra] of [[429, { outcomeUnknown: true }], [429, { retryable: false }], [502, {}], [504, {}], [409, {}]]) {
  test(`does not repeat unsafe or unsuccessful writes (${status}, ${JSON.stringify(extra)})`, async () => {
    const f = fixture([response(status, { rateLimited: true, retryable: true,
      rateLimitUntil: new Date(start + 30_000).toISOString(), ...extra })]);
    assert.equal((await runCommitmentMakerRequest(f.options)).response.status, status);
    assert.equal(f.calls(), 1);
    assert.equal(f.waits.length, 0);
  });
}

test("a network failure on continuation is not mistaken for the previous confirmed response", async () => {
  const f = fixture([pause(), new Error("connection lost")]);
  await assert.rejects(runCommitmentMakerRequest(f.options), /connection lost/);
  assert.equal(f.calls(), 2);
  assert.equal(f.received(), 1);
});

test("leaving the page during the wait prevents the next write", async () => {
  const f = fixture([pause(), response(200, { success: true })]);
  f.options.wait = async () => f.controller.abort();
  await assert.rejects(runCommitmentMakerRequest(f.options), { name: "AbortError" });
  assert.equal(f.calls(), 1);
});

test("the default timer is cancelled when the page is closed", async () => {
  const f = fixture([pause()]);
  delete f.options.wait;
  const pending = runCommitmentMakerRequest(f.options);
  setTimeout(() => f.controller.abort(), 0);
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(f.calls(), 1);
});

test("sustained throttling ends with a plain error instead of spinning forever", async () => {
  const f = fixture(Array.from({ length: 11 }, () => pause(1)));
  const { payload } = await runCommitmentMakerRequest(f.options);
  assert.equal(f.calls(), 11);
  assert.match(payload.error, /couldn’t finish/);
  assert.doesNotMatch(payload.error, /429|rate limit|retry/i);
});

test("does not invent a delay for missing reset metadata", async () => {
  const f = fixture([response(429, { rateLimited: true, retryable: true })]);
  assert.match((await runCommitmentMakerRequest(f.options)).payload.error, /couldn’t finish/);
  assert.equal(f.calls(), 1);
});

test("honors a one-hour reset without making requests during the wait", async () => {
  const f = fixture([pause(3600), response(200, { success: true })]);
  assert.equal((await runCommitmentMakerRequest(f.options)).payload.success, true);
  assert.deepEqual(f.waits, [3_600_000]);
});

test('read-only preparation steps keep the spinner and forward only the server continuation ID', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const f = fixture([...Array.from({ length: 15 }, () => response(202, { preparing: true, retryable: true,
    preparationId: id, resumeAt: new Date(start + 250).toISOString() })), pause(30), response(200, { success: true })]);
  const tokens = [];
  const request = f.options.request;
  f.options.request = async token => { tokens.push(token); return request(); };
  assert.equal((await runCommitmentMakerRequest(f.options)).payload.success, true);
  assert.equal(tokens[0], undefined);
  assert.ok(tokens.slice(1).every(token => token === id));
  assert.equal(f.calls(), 17);
});

test('invalid preparation and cancelled waits cannot submit another request', async () => {
  const f = fixture([response(202, { preparing: true, retryable: true, preparationId: 'bad', resumeAt: new Date(start).toISOString() })]);
  await assert.rejects(runCommitmentMakerRequest(f.options), /couldn’t finish/);
  assert.equal(f.calls(), 1);
  const paused = fixture([response(202, { preparing: true, retryable: true,
    preparationId: '11111111-1111-4111-8111-111111111111', resumeAt: new Date(start).toISOString() })]);
  paused.options.wait = async () => paused.controller.abort();
  await assert.rejects(runCommitmentMakerRequest(paused.options), { name: 'AbortError' });
  assert.equal(paused.calls(), 1);
});
