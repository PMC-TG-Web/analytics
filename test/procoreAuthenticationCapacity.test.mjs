import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import ts from 'typescript';
import * as connection from '../src/lib/procoreConnection.ts';
import * as limits from '../src/lib/procoreRateLimit.ts';
import { reserveProcoreRequest, PROCORE_AUTHENTICATION_RESERVE } from '../src/lib/procoreRequestBudget.ts';

function fixture() {
  const now = Date.now();
  let state = { leaseId: null, leaseUntil: 0, interactiveUntil: 0, blockedUntil: 0,
    windows: [{ limit: 600, remaining: 20, resetAt: now + 3600000 }] };
  const calls = [];
  const admissions = [];
  let configuredProvider;
  const imports = {
    'node:async_hooks': { AsyncLocalStorage }, '@/lib/procoreConnection': connection,
    '@/lib/procoreRateLimit': limits,
    '@/lib/procoreQuotaControl': { recordProcoreQuotaObservation: async () => {}, getProcoreBackgroundCooldown: async () => null },
    '@/lib/procoreRequestGate': {
      checkProcoreAuthenticationCapacity: async () => { calls.push('preflight'); },
      waitForProcoreRequestPermit: async (company, lane) => {
        admissions.push({ company, lane, connection: connection.currentProcoreConnection() });
        const decision = reserveProcoreRequest(state, lane, now, 200, PROCORE_AUTHENTICATION_RESERVE);
        state = { ...state, windows: decision.windows, interactiveUntil: decision.interactiveUntil };
        return { permit: decision.retryAt ? null : { company, lane }, retryAt: decision.retryAt };
      },
      completeProcoreRequestPermit: async () => {},
    },
    '@/lib/prisma': { prisma: {} },
    '@/lib/appSessionService': { createAppSessionService: (_db, provider) => { configuredProvider = provider; return {}; } },
  };
  function load(path) {
    const mod = { exports: {} };
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', 'process', 'fetch', 'console', code)(id => {
      assert.ok(id in imports, id); return imports[id];
    }, mod, mod.exports, { env: { PROCORE_COMPANY_ID: 'company', PROCORE_LIVE_API_ENABLED: 'true', APP_BASE_URL: 'https://app.example.test' } }, async url => {
      calls.push(url);
      if (url.endsWith('/me')) return Response.json({ id: 'user', login: 'employee@example.test', name: 'Employee' });
      if (url.includes('/companies?')) return Response.json([{ id: 'company' }]);
      if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'new', refresh_token: 'rotated', expires_in: 5400 });
      assert.fail('Unexpected network request');
    }, { log() {}, warn() {}, error() {} });
    return mod.exports;
  }
  const api = load('src/lib/procore.ts');
  imports['@/lib/procore'] = api;
  load('src/lib/appSession.ts');
  return { api, calls, admissions, configuredProvider };
}

test('ordinary traffic pauses at the reserve while actual login identity reads still succeed', async () => {
  const f = fixture();
  for (let attempt = 0; attempt < 20; attempt++) {
    await assert.rejects(f.api.makeRequest('/rest/v1.0/projects', 'ordinary-token'), error => error.status === 429);
  }
  assert.equal(f.calls.length, 0);
  const identity = await connection.withProcoreConnection('analytics-sync', () => f.api.getProcoreSignInIdentity('login-token'));
  assert.equal(identity.email, 'employee@example.test');
  assert.deepEqual(identity.companyIds, ['company']);
  assert.equal(f.calls.length, 2);
  assert.ok(f.admissions.slice(-2).every(call => call.lane === 'authentication' && call.connection === 'shared'));
  assert.equal(connection.currentProcoreConnection(), 'shared');
});

test('the production session provider wires the read-only preflight before rotating refresh and authentication identity', async () => {
  const f = fixture();
  assert.equal(f.configuredProvider.prepareRefresh, f.api.prepareProcoreSignIn);
  await f.configuredProvider.prepareRefresh();
  const tokens = await f.configuredProvider.refresh('original');
  await f.configuredProvider.identify(tokens.access_token);
  assert.equal(f.calls[0], 'preflight');
  assert.ok(f.calls[1].endsWith('/oauth/token'));
  assert.ok(f.admissions.every(call => call.lane === 'authentication'));
});
