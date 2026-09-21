import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';
import { Prisma } from '@prisma/client';
import * as connection from '../src/lib/procoreConnection.ts';
import * as budget from '../src/lib/procoreRequestBudget.ts';
import * as rateLimits from '../src/lib/procoreRateLimit.ts';

test('shared gate SQL, lease ownership, cache identity and usage accounting work in PostgreSQL', {
  skip: process.env.PROCORE_CAPACITY_DATABASE_TEST !== '1',
}, async () => {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ log: [] });
  const rollback = new Error('Rollback isolated capacity test');
  function load(file, dependencies) {
    const module = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'module', 'exports', 'fetch', compiled)(id => {
      assert.ok(id in dependencies, `Unexpected dependency ${id}`);
      return dependencies[id];
    }, module, module.exports, () => assert.fail('Database test must never call Procore'));
    return module.exports;
  }
  try {
    await db.$transaction(async tx => {
      // Temporary tables shadow production names only on this connection. All
      // writes roll back; this test makes no HTTP calls and leaves no fixtures.
      const migration = readFileSync('prisma/migrations/20260917130000_procore_request_capacity/migration.sql', 'utf8');
      for (const statement of migration.split(';').map(value => value.trim()).filter(Boolean)) {
        await tx.$executeRawUnsafe(statement.replace(/^CREATE TABLE/, 'CREATE TEMP TABLE'));
      }
      const gate = load('src/lib/procoreRequestGate.ts', {
        '@prisma/client': { Prisma }, '@/lib/procoreConnection': connection,
        'node:crypto': { randomUUID }, '@/lib/prisma': { prisma: { $transaction: operation => operation(tx),
          $queryRaw: tx.$queryRaw.bind(tx) } },
        '@/lib/procoreRequestBudget': budget, '@/lib/procoreRateLimit': rateLimits,
      });
      await tx.$executeRawUnsafe('CREATE TEMP TABLE procore_pm_request_gates (LIKE procore_request_gates INCLUDING ALL)');
      await tx.$executeRawUnsafe('CREATE TEMP TABLE procore_pm_api_usage (LIKE procore_api_usage INCLUDING ALL)');
      await tx.$executeRawUnsafe('CREATE TEMP TABLE procore_cm_request_gates (LIKE procore_request_gates INCLUDING ALL)');
      await tx.$executeRawUnsafe('CREATE TEMP TABLE procore_cm_api_usage (LIKE procore_api_usage INCLUDING ALL)');
      const first = await gate.acquireProcoreRequestPermit('test-company', 'background');
      assert.ok(first.permit);
      const waiting = await gate.acquireProcoreRequestPermit('test-company', 'interactive');
      assert.equal(waiting.permit, null);
      assert.ok(waiting.retryAt > Date.now());
      const observation = { limit: 600, remaining: 150, resetAt: new Date(Date.now() + 600_000), cooldownUntil: null, rateLimited: false };
      await gate.completeProcoreRequestPermit({ permit: first.permit, observation, method: 'GET', path: '/rest/v1.0/projects/598134326714493', status: 200 });
      assert.equal((await gate.acquireProcoreRequestPermit('test-company', 'background')).permit, null);
      const deferred = await gate.coordinatedProcoreFetch('https://example.invalid/rest/v1.0/projects', {}, 'test-company');
      assert.equal(deferred.status, 429);
      assert.ok((await deferred.json()).rateLimitUntil);
      const foreground = await gate.acquireProcoreRequestPermit('test-company', 'interactive');
      assert.ok(foreground.permit);
      // Completing the expired owner again must not release the new owner.
      await gate.completeProcoreRequestPermit({ permit: first.permit, observation: null, method: 'GET', path: '/old', status: 200 });
      assert.equal((await gate.acquireProcoreRequestPermit('test-company', 'interactive')).permit, null);
      await gate.completeProcoreRequestPermit({ permit: foreground.permit, observation: null, method: 'POST', path: '/rest/v1.0/projects/598134326714493', status: 201 });
      const usage = await gate.procoreApiUsageSummary('test-company');
      assert.equal(usage.reduce((sum, row) => sum + row.requests, 0), 2);
      assert.ok(usage.every(row => !row.endpoint.includes('598134326714493')));
      const pm = await connection.withProcoreConnection('pm-dashboard', () => gate.acquireProcoreRequestPermit('test-company', 'background'));
      assert.ok(pm.permit, 'Shared priority/quota must not block PM');
      await gate.completeProcoreRequestPermit({ permit: pm.permit, observation: { ...observation, remaining: 0, rateLimited: true, cooldownUntil: observation.resetAt }, method: 'GET', path: '/rfis', status: 429 });
      assert.equal((await connection.withProcoreConnection('pm-dashboard', () => gate.acquireProcoreRequestPermit('test-company', 'interactive'))).permit, null);
      assert.ok((await gate.acquireProcoreRequestPermit('test-company', 'interactive')).permit, 'PM 429 must not block shared app');
      assert.equal((await gate.procoreApiUsageSummary('test-company')).reduce((sum, row) => sum + row.requests, 0), 2);
      assert.equal((await connection.withProcoreConnection('pm-dashboard', () => gate.procoreApiUsageSummary('test-company')))[0].rejected, 1);
      const cm = await connection.withProcoreConnection('commitment-maker', () => gate.acquireProcoreRequestPermit('test-company', 'interactive'));
      assert.ok(cm.permit, 'Other app leases and cooldowns cannot block Commitment Maker');
      await gate.completeProcoreRequestPermit({ permit: cm.permit, observation: null, method: 'GET', path: '/purchase_orders', status: 200 });
      assert.equal((await connection.withProcoreConnection('commitment-maker', () => gate.procoreApiUsageSummary('test-company')))[0].requests, 1);
      assert.equal((await gate.procoreApiUsageSummary('test-company')).reduce((sum, row) => sum + row.requests, 0), 2);
      const cache = load('src/lib/procoreWbsCache.ts', { '@/lib/prisma': { prisma: tx } });
      const records = [{ id: 'wbs', flat_code: '03-300-40-30.C' }];
      const key = { companyId: 'test-company', projectId: 'project', forceLive: true, load: async () => records };
      await cache.readCommitmentMakerWbs(key);
      assert.deepEqual(await cache.readCommitmentMakerWbs({ ...key, forceLive: false, load: async () => assert.fail('Cache miss') }), records);
      let otherLoaded = false;
      await cache.readCommitmentMakerWbs({ ...key, companyId: 'other-company', forceLive: false,
        load: async () => { otherLoaded = true; return records; },
      });
      assert.equal(otherLoaded, true);
      throw rollback;
    }, { timeout: 15_000 });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await db.$disconnect();
  }
});
