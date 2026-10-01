import test from 'node:test';
import assert from 'node:assert/strict';
import check from '../netlify/functions/analytics-connection-check.mts';
test('connection probe rejects unauthenticated calls without fetching',async()=>{
 process.env.PROCORE_SYNC_SECRET='test-key';const original=global.fetch;global.fetch=()=>assert.fail('No unauthenticated network');
 try {assert.equal((await check(new Request('http://test',{method:'POST'}))).status,401);}finally{global.fetch=original;}
});
test('connection probe reports statuses without exposing credentials or token',async()=>{
 process.env.PROCORE_SYNC_SECRET='test-key';process.env.PROCORE_ANALYTICS_SYNC_CLIENT_ID='client-test';process.env.PROCORE_ANALYTICS_SYNC_CLIENT_SECRET='secret-test';process.env.PROCORE_COMPANY_ID='2';
 const original=global.fetch;let calls=0;global.fetch=async()=>++calls===1?Response.json({access_token:'sensitive-token'}):Response.json([]);
 try{const response=await check(new Request('http://test',{method:'POST',headers:{'x-sync-secret':'test-key'}}));const body=await response.text();assert.equal(JSON.parse(body).authenticated,true);assert.equal(JSON.parse(body).projectReadStatus,200);assert.doesNotMatch(body,/sensitive-token|secret-test|client-test/);assert.equal(calls,2);}finally{global.fetch=original;}
});