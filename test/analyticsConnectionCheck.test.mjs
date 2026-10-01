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

test('Billing probe selects only Billing credentials and performs bounded read-only checks', async () => {
 process.env.PROCORE_SYNC_SECRET='test-key'; process.env.PROCORE_BILLING_CLIENT_ID='billing-client'; process.env.PROCORE_BILLING_CLIENT_SECRET='billing-secret'; process.env.PROCORE_COMPANY_ID='2';
 const original=global.fetch; const calls=[];
 global.fetch=async(url,options)=>{ calls.push({url,options}); return calls.length===1?Response.json({access_token:'billing-sensitive-token'}):Response.json([]); };
 try {
  const response=await check(new Request('http://test',{method:'POST',headers:{'x-sync-secret':'test-key'},body:JSON.stringify({connection:'billing',projectId:'3'})}));
  const text=await response.text(), body=JSON.parse(text);
  assert.equal(body.connection,'billing'); assert.equal(body.reads.length,6); assert.equal(calls.length,8);
  assert.equal(calls[0].options.body.get('client_id'),'billing-client');
  for(const call of calls.slice(1)) { assert.equal(call.options.method,undefined); assert.equal(call.options.headers.Authorization,'Bearer billing-sensitive-token'); }
  assert.doesNotMatch(text,/billing-sensitive-token|billing-client|billing-secret/);
 } finally { global.fetch=original; }
});

test('Billing diagnostic stops on permission rejection and rejects duplicate credentials', async () => {
 process.env.PROCORE_SYNC_SECRET='test-key'; process.env.PROCORE_BILLING_CLIENT_ID='billing-client'; process.env.PROCORE_BILLING_CLIENT_SECRET='billing-secret'; process.env.PROCORE_COMPANY_ID='2';
 const original=global.fetch; let calls=0;
 global.fetch=async()=>++calls===1?Response.json({access_token:'token'}):Response.json({}, {status:calls===3?403:200});
 const request=()=>new Request('http://test',{method:'POST',headers:{'x-sync-secret':'test-key'},body:JSON.stringify({connection:'billing',projectId:'3'})});
 try {
  const body=await(await check(request())).json(); assert.equal(body.reads.length,1); assert.equal(body.reads[0].status,403); assert.equal(calls,3);
  process.env.PROCORE_BILLING_CLIENT_ID=process.env.PROCORE_ANALYTICS_SYNC_CLIENT_ID;
  assert.equal((await check(request())).status,409); assert.equal(calls,3);
 } finally { global.fetch=original; }
});
