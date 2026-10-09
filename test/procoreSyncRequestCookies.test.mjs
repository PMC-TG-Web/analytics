import test from 'node:test';
import assert from 'node:assert/strict';
import { readProcoreSyncCookieValues } from '../src/lib/procoreSyncRequestCookies.ts';

test('secret-authenticated sync workers do not access Next request cookies', async () => {
  let cookieReads = 0;
  const result = await readProcoreSyncCookieValues(true, async () => {
    cookieReads += 1;
    throw new Error('cookies() is outside a request scope');
  });

  assert.deepEqual(result, { accessToken: '', companyId: '' });
  assert.equal(cookieReads, 0);
});

test('interactive sync requests retain Procore cookie credentials', async () => {
  const values = new Map([
    ['procore_access_token', { value: 'user-token' }],
    ['procore_company_id', { value: 'company-1' }],
  ]);
  const result = await readProcoreSyncCookieValues(false, async () => ({ get: name => values.get(name) }));

  assert.deepEqual(result, { accessToken: 'user-token', companyId: 'company-1' });
});
