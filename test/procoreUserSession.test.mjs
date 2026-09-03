import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createProcoreUserSessionCookieValue,
  verifyProcoreUserSessionCookieValue,
} from '../src/lib/procoreUserSession.ts';

test('Procore user sessions are signed, normalized, and reject tampering', async () => {
  const previousSecret = process.env.PROCORE_USER_SESSION_SECRET;
  process.env.PROCORE_USER_SESSION_SECRET = 'test-only-procore-user-session-secret';

  try {
    const value = await createProcoreUserSessionCookieValue('Mervin@PMCDecor.com', 120);
    assert.ok(value);
    assert.equal((await verifyProcoreUserSessionCookieValue(value))?.email, 'mervin@pmcdecor.com');

    const tampered = `${value.slice(0, -1)}${value.endsWith('a') ? 'b' : 'a'}`;
    assert.equal(await verifyProcoreUserSessionCookieValue(tampered), null);
    assert.equal(await createProcoreUserSessionCookieValue('not-an-email', 120), null);
  } finally {
    if (previousSecret === undefined) delete process.env.PROCORE_USER_SESSION_SECRET;
    else process.env.PROCORE_USER_SESSION_SECRET = previousSecret;
  }
});
