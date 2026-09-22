import test from 'node:test';
import assert from 'node:assert/strict';
import { readBillResponse } from '../src/lib/qboBillResponse.ts';

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
