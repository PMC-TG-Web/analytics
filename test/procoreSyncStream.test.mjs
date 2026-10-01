import assert from 'node:assert/strict';
import test from 'node:test';
import { streamSyncResponse } from '../src/lib/procoreSyncStream.ts';
test('heartbeat arrives before long work finishes and preserves valid JSON', async () => {
 let finish;
 const pending = new Promise(resolve => { finish = resolve; });
 const response = streamSyncResponse(() => pending, 5);
 const reader = response.body.getReader();
 const first = await reader.read();
 assert.match(new TextDecoder().decode(first.value), /^\s+$/);
 finish(Response.json({ success: true, saved: 12 }));
 let text = '';
 for (;;) { const next = await reader.read(); if (next.done) break; text += new TextDecoder().decode(next.value); }
 assert.deepEqual(JSON.parse(text), { success: true, saved: 12, httpStatus: 200 });
});
test('streamed failures retain rate limit status, deadline and request count', async () => {
 const response = streamSyncResponse(async () => Response.json({ error: 'Quota cooldown' }, { status: 429, headers: { 'x-procore-rate-limit-until': '2026-09-25T12:00:00Z', 'x-procore-api-request-count': '4' } }));
 const body = await response.json();
 assert.equal(body.success, false); assert.equal(body.rateLimited, true); assert.equal(body.httpStatus, 429);
 assert.equal(body.rateLimitUntil, '2026-09-25T12:00:00Z'); assert.equal(body.apiRequests, 4);
});
test('exceptions become explicit failures and disconnected readers are safe', async () => {
 assert.deepEqual(await streamSyncResponse(async () => { throw new Error('Failed'); }).json(), { success: false, error: 'Failed' });
 let finish;
 const pending = new Promise(resolve => { finish = resolve; });
 const response = streamSyncResponse(() => pending, 5);
 await response.body.cancel(); finish(Response.json({ success: true }));
 await new Promise(resolve => setTimeout(resolve, 15));
});
