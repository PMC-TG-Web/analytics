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

    // Change a signature byte, not the final base64 character's unused padding bits.
    const [payload, signature] = value.split('.');
    const tampered = `${payload}.${signature.startsWith('a') ? 'b' : 'a'}${signature.slice(1)}`;
    assert.equal(await verifyProcoreUserSessionCookieValue(tampered), null);
    assert.equal(await createProcoreUserSessionCookieValue('not-an-email', 120), null);
  } finally {
    if (previousSecret === undefined) delete process.env.PROCORE_USER_SESSION_SECRET;
    else process.env.PROCORE_USER_SESSION_SECRET = previousSecret;
  }
});
