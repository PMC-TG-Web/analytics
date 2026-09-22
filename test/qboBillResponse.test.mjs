import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchBillRead, readBillResponse } from '../src/lib/qboBillResponse.ts';

test('reads JSON success and preserves actionable JSON service errors', async () => {
  assert.deepEqual(await readBillResponse(Response.json({ rows: [] })), { rows: [] });
  assert.deepEqual(await readBillResponse(Response.json({ error: 'Choose a catalog item' }, { status: 409 })), { error: 'Choose a catalog item' });
});
test('HTML and malformed JSON never expose parser errors or response bodies', async () => {
  for (const status of [200, 403, 502, 504]) {
    await assert.rejects(readBillResponse(new Response('<HTML><HEAD>private response</HEAD></HTML>', { status, headers: { 'content-type': 'text/html' } })), e => e.message.includes(`HTTP ${status}`) && !/Unexpected token|private response|<HTML>/.test(e.message));
  }
  await assert.rejects(readBillResponse(new Response('<html>', { headers: { 'content-type': 'application/json' } })), /unreadable data/);
});
test('distinguishes sessions, permissions and login redirects', async () => {
  await assert.rejects(readBillResponse(Response.json({}, { status: 401 })), /session has expired/);
  await assert.rejects(readBillResponse(Response.json({}, { status: 403 })), /employee permissions/);
  await assert.rejects(readBillResponse({ status: 200, headers: new Headers({ 'content-type': 'text/html' }), redirected: true, url: 'https://example.test/login' }), /redirected to sign-in/);
});

test('safe reads retry transient HTML once, but never retry an access denial', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({url, options});
    return calls.length === 1 ? new Response('<HTML>', { status: 502, headers: { 'content-type': 'text/html' } }) : Response.json({ rows: [] });
  });
  assert.deepEqual(await readBillResponse(await fetchBillRead('/api/bills')), { rows: [] });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => !c.options.method && c.options.cache === 'no-store'));
  t.mock.method(globalThis, 'fetch', async () => { calls.push({}); return Response.json({}, { status: 403 }); });
  assert.equal((await fetchBillRead('/api/bills')).status, 403);
  assert.equal(calls.length, 3);
});

test('safe reads stop after one retry and respect cancellation', async t => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => { count++; return new Response('<HTML>', { status: 504 }); });
  assert.equal((await fetchBillRead('/api/bills')).status, 504);
  assert.equal(count, 2);
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => { controller.abort(); return new Response('', {status: 503}); });
  await fetchBillRead('/api/bills', controller.signal);
  assert.equal(count, 2);
});