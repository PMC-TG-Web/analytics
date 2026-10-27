import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { fetchBudgetSnapshot } from '../src/lib/procoreBudgetSnapshot.ts';
import { streamSyncResponse } from '../src/lib/procoreSyncStream.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../src/app/api/procore/sync/budget-line-items/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const companyId = '123';
const startedAt = new Date('2026-10-26T18:00:00Z');
const reset = new Date('2026-10-26T18:01:00Z');
const httpError = status => Object.assign(new Error(`Provider failure ${status}`), { status,
  ...(status === 429 ? { rateLimitUntil: reset } : {}) });

function setup({ cookieValues = {}, company = companyId, canonicalIds = ['456'], source, tokenError, persistenceError } = {}) {
  const calls = { source: [], snapshot: [], persist: [], canonical: [], started: 0, token: 0, bypass: 0 };
  let observedDeadline = null;
  const remember = error => {
    if (error?.rateLimitUntil instanceof Date) observedDeadline = error.rateLimitUntil;
    return error;
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    'next/headers': { cookies: async () => ({ get: name => name in cookieValues ? { value: cookieValues[name] } : undefined }) },
    '@/lib/procoreSyncStream': { streamSyncResponse },
    '@/lib/procore': {
      procoreConfig: { companyId: company },
      hasValidProcoreSyncSecret: request => request.headers.get('x-sync-secret') === 'test-secret',
      withProcoreLiveApiBypassForSyncSecret: async (request, operation) => {
        calls.bypass++;
        if (request.headers.get('x-sync-secret') !== 'test-secret') return operation();
        const response = await operation();
        // Preserve the same response metrics contract as the centralized client.
        response.headers.set('x-procore-api-request-count', String(calls.source.length));
        if (observedDeadline) response.headers.set('x-procore-rate-limit-until', observedDeadline.toISOString());
        return response;
      },
      getClientCredentialsToken: async () => {
        calls.token++;
        // OAuth failures carry their own deadline but do not update the shared
        // makeRequest metrics context; the route must preserve that deadline.
        if (tokenError) throw tokenError;
        return 'service-token';
      },
      makeRequest: async (endpoint, token, init, scopedCompanyId) => {
        assert.equal(init?.method, 'GET', 'Budget synchronization must only read Procore');
        assert.equal(scopedCompanyId, companyId);
        calls.source.push({ endpoint, token, init, companyId: scopedCompanyId });
        try {
          if (source) return await source(endpoint, calls.source.length);
          const url = new URL(endpoint, 'https://example.test');
          const projectId = url.searchParams.get('project_id') || /projects\/([^/]+)/.exec(url.pathname)?.[1];
          return url.searchParams.get('page') === '1'
            ? [{ id: `${projectId}7`, company_id: scopedCompanyId, project_id: projectId, quantity: 10 }]
            : [];
        } catch (error) { throw remember(error); }
      },
    },
    '@/lib/procoreCanonicalProjectIds': { getCanonicalProjectIdsForCompany: async (...args) => {
      calls.canonical.push(args);
      return canonicalIds;
    } },
    '@/lib/procoreBudgetSnapshot': { fetchBudgetSnapshot: async params => {
      calls.snapshot.push({ companyId: params.companyId, projectId: params.projectId, fetchAll: params.fetchAll, perPage: params.perPage });
      return fetchBudgetSnapshot(params);
    } },
    '@/lib/procoreBudgetLineItems': {
      startBudgetSnapshot: async () => { calls.started++; return startedAt; },
      persistBudgetSnapshot: async params => {
        calls.persist.push(params);
        if (persistenceError) throw persistenceError;
        return { upserted: params.items.length, missing: params.reconcileAbsent ? 2 : 0, reconciled: params.reconcileAbsent };
      },
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    id => { assert.ok(id in mocks, `Unexpected route dependency: ${id}`); return mocks[id]; }, module, module.exports,
  );
  return { ...module.exports, calls };
}

async function run(route, body = {}, secret = false) {
  const response = await route.POST(new Request('https://example.test/api/procore/sync/budget-line-items', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { 'x-sync-secret': 'test-secret' } : {}) },
    body: JSON.stringify(body),
  }));
  return { response, body: await response.json() };
}

test('default service sync fully enumerates source rows and authorizes exact-scoped reconciliation', async () => {
  const route = setup();
  const result = await run(route, { projectIds: ['456'] });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.complete, true);
  assert.equal(route.calls.bypass, 1);
  assert.equal(route.calls.token, 1);
  assert.equal(route.calls.source.length, 2);
  assert.equal(route.calls.snapshot[0].fetchAll, true);
  assert.equal(route.calls.persist.length, 1);
  assert.equal(route.calls.persist[0].companyId, companyId);
  assert.equal(route.calls.persist[0].projectId, '456');
  assert.equal(route.calls.persist[0].startedAt, startedAt);
  assert.equal(route.calls.persist[0].complete, true);
  assert.equal(route.calls.persist[0].reconcileAbsent, true);
  assert.deepEqual(route.calls.source.map(call => call.token), ['service-token', 'service-token']);
  for (const field of ['companyId', 'projectsLimit', 'projectsScanned', 'projectsSkippedAccess', 'fetched', 'upserted',
    'warningsTruncated', 'errorsTruncated', 'warnings', 'errors']) assert.ok(field in result.body.data, field);
  assert.equal(result.body.data.projectsComplete, 1);
  assert.equal(result.body.data.missing, 2);
  assert.deepEqual(result.body.data.errors, []);
});

for (const [name, cookieValues, body, token] of [
  ['cookie', { procore_access_token: 'user-cookie-token' }, {}, 'user-cookie-token'],
  ['body', {}, { accessToken: 'user-body-token' }, 'user-body-token'],
  ['cookie precedence', { procore_access_token: 'user-cookie-token' }, { accessToken: 'user-body-token' }, 'user-cookie-token'],
]) {
  test(`a ${name} user token never gains absence authority from full pagination`, async () => {
    const route = setup({ cookieValues });
    const result = await run(route, { ...body, projectIds: ['456'] });
    assert.equal(result.body.success, true);
    assert.equal(route.calls.token, 0);
    assert.equal(route.calls.persist[0].complete, true);
    assert.equal(route.calls.persist[0].reconcileAbsent, false);
    assert.equal(result.body.data.authoritativeConnection, false);
    assert.equal(result.body.data.missing, 0);
    assert.equal(result.body.data.warnings.length, 1);
    assert.ok(route.calls.source.every(call => call.token === token));
  });
}

test('sync-secret authentication does not turn a limited user token into company-wide visibility', async () => {
  const route = setup({ cookieValues: { procore_access_token: 'user-cookie-token' } });
  const result = await run(route, { projectIds: ['456'] }, true);
  assert.equal(result.body.httpStatus, 200);
  assert.equal(route.calls.persist[0].reconcileAbsent, false);
  assert.equal(result.body.data.authoritativeConnection, false);
});

test('explicit partial sync preserves upserts but reports incomplete without retiring absent rows', async () => {
  const route = setup();
  const result = await run(route, { projectIds: ['456'], fetchAll: false });
  assert.equal(result.body.success, false);
  assert.equal(result.body.complete, false);
  assert.equal(route.calls.source.length, 1);
  assert.equal(route.calls.persist[0].complete, false);
  assert.equal(route.calls.persist[0].reconcileAbsent, false);
  assert.equal(result.body.data.upserted, 1);
  assert.equal(result.body.data.projectsComplete, 0);
  assert.equal(result.body.data.errors.length, 1);
});

for (const [name, source, skipped] of [
  ['malformed source response', async () => ({}), 0],
  ['403 access failure', async () => { throw httpError(403); }, 1],
  ['404 from every supported endpoint', async () => { throw httpError(404); }, 1],
]) {
  test(`${name} preserves the saved snapshot and reports failure through the existing response shape`, async () => {
    const route = setup({ source });
    const result = await run(route, { projectIds: ['456'] });
    assert.equal(result.body.success, false);
    assert.equal(result.body.complete, false);
    assert.equal(route.calls.persist.length, 0);
    assert.equal(result.body.data.projectsScanned, 1);
    assert.equal(result.body.data.projectsSkippedAccess, skipped);
    assert.equal(result.body.data.upserted, 0);
    assert.equal(result.body.data.errors.length, 1);
    assert.equal(result.body.data.warnings.length, skipped);
  });
}

test('read-time throttling stops later projects and returns 429 without writing a snapshot', async () => {
  const error = httpError(429);
  const route = setup({ source: async () => { throw error; } });
  const result = await run(route, { projectIds: ['456', '789'] });
  assert.equal(result.response.status, 429);
  assert.equal(result.body.success, false);
  assert.equal(result.body.data.projectsScanned, 1);
  assert.equal(route.calls.source.length, 1);
  assert.equal(route.calls.started, 1);
  assert.equal(route.calls.persist.length, 0);
});

test('secret-authenticated streamed throttling retains the effective status and deadline in JSON', async () => {
  const route = setup({ source: async () => { throw httpError(429); } });
  const result = await run(route, { projectIds: ['456', '789'] }, true);
  assert.equal(result.response.status, 200, 'Streaming HTTP headers have already been sent');
  assert.equal(result.body.httpStatus, 429);
  assert.equal(result.body.rateLimited, true);
  assert.equal(result.body.rateLimitUntil, reset.toISOString());
  assert.equal(result.body.success, false);
  assert.equal(result.body.apiRequests, 1);
  assert.equal(route.calls.source.length, 1);
});

test('OAuth token throttling remains a 429 and cannot start budget reads or persistence', async () => {
  const route = setup({ tokenError: httpError(429) });
  const result = await run(route, { projectIds: ['456', '789'] });
  assert.equal(result.response.status, 429);
  assert.equal(result.response.headers.get('x-procore-rate-limit-until'), reset.toISOString());
  assert.equal(result.body.success, false);
  assert.equal(result.body.complete, false);
  assert.match(result.body.error, /429/);
  assert.equal(route.calls.token, 1);
  assert.equal(route.calls.started, 0);
  assert.equal(route.calls.source.length, 0);
  assert.equal(route.calls.persist.length, 0);
});

test('streamed OAuth throttling retains its effective 429 and provider reset', async () => {
  const route = setup({ tokenError: httpError(429) });
  const result = await run(route, { projectIds: ['456'] }, true);
  assert.equal(result.body.httpStatus, 429);
  assert.equal(result.body.rateLimited, true);
  assert.equal(result.body.rateLimitUntil, reset.toISOString());
  assert.equal(result.body.success, false);
  assert.equal(route.calls.source.length, 0);
});

test('persistence failure reports incomplete and does not count fetched rows as saved', async () => {
  const route = setup({ persistenceError: new Error('Concurrent snapshot changed; retry required') });
  const result = await run(route, { projectIds: ['456'] });
  assert.equal(result.body.success, false);
  assert.equal(result.body.complete, false);
  assert.equal(result.body.data.fetched, 1);
  assert.equal(result.body.data.upserted, 0);
  assert.equal(result.body.data.missing, 0);
  assert.equal(result.body.data.projectsComplete, 0);
  assert.match(result.body.data.errors[0], /Concurrent snapshot/);
});

for (const projectIds of [['456', ' 456 ', '789', '789'], '456, 456,789,789']) {
  test(`deduplicates ${Array.isArray(projectIds) ? 'array' : 'CSV'} project IDs before source reads`, async () => {
    const route = setup();
    const result = await run(route, { projectIds });
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.projectsScanned, 2);
    assert.deepEqual(route.calls.persist.map(call => call.projectId), ['456', '789']);
    assert.equal(route.calls.source.length, 4);
    assert.deepEqual(route.calls.canonical, []);
  });
}

test('canonical project fallback remains scoped to the selected company and requested project limit', async () => {
  const route = setup({ canonicalIds: ['456', '789'] });
  const result = await run(route, { companyId, limitProjects: 12 });
  assert.equal(result.body.success, true);
  assert.deepEqual(route.calls.canonical, [[companyId, 12]]);
  assert.equal(route.calls.persist.length, 2);
});

test('missing company or canonical scope cannot start a source snapshot', async () => {
  for (const config of [{ company: '' }, { canonicalIds: [] }]) {
    const route = setup(config);
    const result = await run(route);
    assert.equal(result.response.status, 400);
    assert.equal(result.body.success, false);
    assert.equal(route.calls.source.length, 0);
    assert.equal(route.calls.persist.length, 0);
  }
});

test('GET remains unsupported and performs no source or persistence work', async () => {
  const route = setup();
  const response = await route.GET();
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'POST');
  assert.equal((await response.json()).success, false);
  assert.equal(route.calls.source.length, 0);
  assert.equal(route.calls.persist.length, 0);
});
