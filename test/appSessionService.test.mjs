import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppSessionService } from '../src/lib/appSessionService.ts';
import { encryptAppCredential, decryptAppCredential, hashAppSessionToken } from '../src/lib/appSessionCrypto.ts';
import { APP_SESSION_ABSOLUTE_SECONDS, safeAppReturnTo } from '../src/lib/appSignInPolicy.ts';

process.env.PROCORE_APP_SESSION_SECRET = 'test-only-secret-with-more-than-thirty-two-bytes';
const identity = { id: 'user-1', email: 'operator@example.test', name: 'Operator', companyIds: ['company-1'] };
const tokens = { access_token: 'first-access', refresh_token: 'first-refresh', expires_in: 5400 };

function fixture() {
  let now = new Date('2026-10-08T12:00:00Z');
  const records = new Map();
  let active = true;
  let known = true;
  let refreshCount = 0;
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date) && 'gt' in value) return row[key] > value.gt;
    return value instanceof Date ? row[key]?.getTime() === value.getTime() : row[key] === value;
  });
  const db = {
    user: { findFirst: async () => known ? { isActive: active } : null },
    employee: { findFirst: async () => null },
    appLoginSession: {
      create: async ({ data }) => {
        const row = { revokedAt: null, credentialsInvalid: false, refreshStartedAt: null, ...data };
        records.set(data.tokenHash, structuredClone(row));
        return structuredClone(row);
      },
      findUnique: async ({ where }) => structuredClone(records.get(where.tokenHash) || null),
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of records.values()) if (matches(row, where)) { Object.assign(row, structuredClone(data)); count++; }
        return { count };
      },
    },
  };
  const provider = {
    refresh: async () => { refreshCount++; return { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 5400 }; },
    identify: async () => identity,
  };
  const service = createAppSessionService(db, provider, 'company-1', () => now);
  return { service, records, provider, db, advance: (seconds) => { now = new Date(now.getTime() + seconds * 1000); },
    deactivate: () => { active = false; }, unknown: () => { known = false; }, refreshCount: () => refreshCount };
}

test('credentials are authenticated encryption bound to the session and cookies contain only a random identifier', async () => {
  const f = fixture();
  const { token } = await f.service.create(identity, tokens);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const saved = f.records.get(hashAppSessionToken(token));
  assert.ok(!JSON.stringify(saved).includes('first-access'));
  assert.ok(!JSON.stringify(saved).includes('first-refresh'));
  assert.equal(decryptAppCredential(saved.accessToken, saved.tokenHash), 'first-access');
  assert.throws(() => decryptAppCredential(saved.accessToken, 'another-session'));
  assert.throws(() => decryptAppCredential(saved.accessToken.slice(0, -4) + 'xxxx', saved.tokenHash));
  assert.notEqual(encryptAppCredential('same-token', 'same-session'), encryptAppCredential('same-token', 'same-session'));
  assert.equal((await f.service.resolve(token)).user.sub, 'procore|user-1');
});

test('unapproved users, inactive users and other-company identities cannot start a session', async () => {
  const f = fixture();
  await assert.rejects(f.service.create({ ...identity, companyIds: ['other-company'] }, tokens), /ACCESS_DENIED/);
  f.unknown();
  await assert.rejects(f.service.create(identity, tokens), /ACCESS_DENIED/);
  const inactive = fixture(); inactive.deactivate();
  await assert.rejects(inactive.service.create(identity, tokens), /ACCESS_DENIED/);
  assert.equal(f.records.size, 0);
});

test('app login outlives the API access token, then renews credentials without requiring another login', async () => {
  const f = fixture();
  const { token } = await f.service.create(identity, tokens);
  f.advance(5500);
  assert.equal((await f.service.resolve(token)).user.email, identity.email);
  assert.equal(f.refreshCount(), 0, 'ordinary identity resolution never calls Procore');
  const renewed = await f.service.resolve(token, true);
  assert.equal(renewed.accessToken, 'new-access');
  assert.equal(renewed.needsReconnect, false);
  assert.equal(f.refreshCount(), 1);
  const row = f.records.get(hashAppSessionToken(token));
  assert.equal(decryptAppCredential(row.refreshToken, row.tokenHash), 'new-refresh');
});

test('concurrent requests spend a rotating refresh token only once', async () => {
  const f = fixture(); const { token } = await f.service.create(identity, tokens);
  f.advance(5400);
  const results = await Promise.all(Array.from({ length: 12 }, () => f.service.resolve(token, true)));
  assert.equal(f.refreshCount(), 1);
  assert.ok(results.every((session) => session?.user.email === identity.email));
});

test('logout, local deactivation, idle expiration and absolute expiration invalidate sessions', async () => {
  for (const action of ['logout', 'deactivate', 'idle', 'absolute']) {
    const f = fixture(); const { token } = await f.service.create(identity, tokens);
    if (action === 'logout') await f.service.revoke(token);
    if (action === 'deactivate') f.deactivate();
    if (action === 'idle') f.advance(3 * 86400);
    if (action === 'absolute') f.advance(APP_SESSION_ABSOLUTE_SECONDS);
    assert.equal(await f.service.resolve(token, true), null, action);
  }
  const f = fixture(); assert.equal(await f.service.resolve('forged-cookie'), null);
});

test('rolling activity extends idle expiration but never the original absolute deadline', async () => {
  const f = fixture(); const { token, session } = await f.service.create(identity, tokens);
  for (let day = 1; day < 30; day++) {
    f.advance(86400);
    assert.ok(await f.service.resolve(token, true));
    assert.equal(f.records.get(session.tokenHash).absoluteExpiresAt.getTime(), session.absoluteExpiresAt.getTime());
  }
  f.advance(86400);
  assert.equal(await f.service.resolve(token, true), null);
});

test('provider revocation or a changed user/company invalidates the app session', async () => {
  for (const failure of ['revoked', 'identity', 'company']) {
    const f = fixture(); const { token } = await f.service.create(identity, tokens); f.advance(5400);
    if (failure === 'revoked') f.provider.refresh = async () => { throw Object.assign(new Error('revoked'), { status: 400 }); };
    if (failure === 'identity') f.provider.identify = async () => ({ ...identity, id: 'someone-else' });
    if (failure === 'company') f.provider.identify = async () => ({ ...identity, companyIds: [] });
    assert.equal(await f.service.resolve(token, true), null);
  }
});

test('unknown refresh outcome is never replayed and retains read-only report access', async () => {
  const f = fixture(); const { token } = await f.service.create(identity, tokens); f.advance(5400);
  let attempts = 0;
  f.provider.refresh = async () => { attempts++; throw new Error('connection lost after sending refresh'); };
  const result = await f.service.resolve(token, true);
  assert.equal(result.user.email, identity.email);
  assert.equal(result.needsReconnect, true);
  assert.equal(result.accessToken, null);
  await f.service.resolve(token, true);
  assert.equal(attempts, 1);
});

test('logout during token renewal cannot resurrect the session', async () => {
  const f = fixture(); const { token } = await f.service.create(identity, tokens); f.advance(5400);
  f.provider.refresh = async () => {
    await f.service.revoke(token);
    return { ...tokens, refresh_token: 'rotated-token' };
  };
  assert.equal(await f.service.resolve(token, true), null);
});

test('return destinations reject external redirects and login loops while retaining safe deep links', () => {
  for (const target of ['https://evil.test', '//evil.test', '/\\evil.test', '/login?returnTo=/', '/api/auth/login', '/dev-login', '/auth/start', '/\n/evil.test']) {
    assert.equal(safeAppReturnTo(target), '/', target);
  }
  assert.equal(safeAppReturnTo('/kpi?year=2026'), '/kpi?year=2026');
  assert.equal(safeAppReturnTo('/auth/complete?returnTo=%2Fkpi'), '/auth/complete?returnTo=%2Fkpi');
});
