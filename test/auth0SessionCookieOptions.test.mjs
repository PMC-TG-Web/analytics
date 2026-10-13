import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveAuth0SessionCookieOptions } from '../src/lib/auth0SessionCookie.ts';

test('resolveAuth0SessionCookieOptions uses lax non-secure cookies on local HTTP in development', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAppBaseUrl = process.env.APP_BASE_URL;

  try {
    process.env.NODE_ENV = 'development';
    process.env.APP_BASE_URL = 'http://localhost:3000';

    const cookie = resolveAuth0SessionCookieOptions();
    assert.deepEqual(cookie, { sameSite: 'lax', secure: false });
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.APP_BASE_URL = originalAppBaseUrl;
  }
});

test('resolveAuth0SessionCookieOptions keeps secure none cookies in production', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  try {
    process.env.NODE_ENV = 'production';

    const cookie = resolveAuth0SessionCookieOptions('http://localhost:3000');
    assert.deepEqual(cookie, { sameSite: 'none', secure: true });
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

test('resolveAuth0SessionCookieOptions keeps secure none cookies for HTTPS origins in development', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  try {
    process.env.NODE_ENV = 'development';

    const cookie = resolveAuth0SessionCookieOptions('https://analytics.example.com');
    assert.deepEqual(cookie, { sameSite: 'none', secure: true });
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});
