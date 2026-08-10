import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCsrfRequest } from '../src/lib/csrfProtection.ts';

const APP_URL = 'https://analyticspmc.netlify.app/api/accounting/project-profitability/refresh';

test('safe HTTP methods do not require browser source headers', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.deepEqual(validateCsrfRequest({ method, requestUrl: APP_URL }), { allowed: true });
  }
});

test('same-origin browser writes are allowed', () => {
  assert.deepEqual(
    validateCsrfRequest({
      method: 'POST',
      requestUrl: APP_URL,
      origin: 'https://analyticspmc.netlify.app',
    }),
    { allowed: true }
  );
});

test('an embedded Analytics page remains same-origin even when displayed in Procore', () => {
  assert.deepEqual(
    validateCsrfRequest({
      method: 'PATCH',
      requestUrl: 'https://analyticspmc.netlify.app/api/procore/projects/123',
      origin: 'https://analyticspmc.netlify.app',
      referer: 'https://analyticspmc.netlify.app/procore',
    }),
    { allowed: true }
  );
});

test('same-origin referer is accepted when Origin is unavailable', () => {
  assert.deepEqual(
    validateCsrfRequest({
      method: 'DELETE',
      requestUrl: APP_URL,
      referer: 'https://analyticspmc.netlify.app/accounting/project-profitability?view=projects',
    }),
    { allowed: true }
  );
});

test('cross-origin and source-less browser writes are rejected', () => {
  assert.deepEqual(
    validateCsrfRequest({
      method: 'POST',
      requestUrl: APP_URL,
      origin: 'https://attacker.example',
    }),
    { allowed: false, reason: 'cross-origin' }
  );

  assert.deepEqual(
    validateCsrfRequest({ method: 'POST', requestUrl: APP_URL }),
    { allowed: false, reason: 'missing-source' }
  );
});

test('malformed and opaque origins are rejected', () => {
  assert.deepEqual(
    validateCsrfRequest({ method: 'POST', requestUrl: APP_URL, origin: 'null' }),
    { allowed: false, reason: 'invalid-source' }
  );
});
