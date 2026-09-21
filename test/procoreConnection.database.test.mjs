import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import ts from 'typescript';
import * as connection from '../src/lib/procoreConnection.ts';

test('PM quota and worker SQL is isolated from shared controls without changing company identity', {
  skip: process.env.PROCORE_CAPACITY_DATABASE_TEST !== '1',
}, async () => {
  const db = new PrismaClient({ log: [] });
  const rollback = new Error('Rollback connection isolation test');
  function load(file, dependencies) {
    const module = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'module', 'exports', compiled)(id => {
      assert.ok(id in dependencies, `Unexpected dependency ${id}`);
      return dependencies[id];
    }, module, module.exports);
    return module.exports;
  }
  try {
    await db.$transaction(async tx => {
      // Shadow real tables; all writes are confined to this rolled-back transaction.
      await tx.$executeRawUnsafe('CREATE TEMP TABLE procore_sync_controls (LIKE public.procore_sync_controls INCLUDING ALL)');
      await tx.$executeRawUnsafe('CREATE TEMP TABLE procore_request_gates (LIKE public.procore_request_gates INCLUDING ALL)');
      await tx.$executeRawUnsafe('CREATE TEMP TABLE procore_api_usage (LIKE public.procore_api_usage INCLUDING ALL)');
      const migration = readFileSync('prisma/migrations/20260921140000_pm_dashboard_procore_connection/migration.sql', 'utf8');
      for (const statement of migration.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) {
        await tx.$executeRawUnsafe(statement.replace(/^CREATE TABLE/, 'CREATE TEMP TABLE'));
      }
      const dependencies = { '@/lib/prisma': { prisma: tx }, '@/lib/procoreConnection': connection,
        'node:crypto': { randomUUID }, '@prisma/client': { Prisma } };
      const quota = load('src/lib/procoreQuotaControl.ts', dependencies);
      const queue = load('src/lib/procoreSyncQueue.ts', { ...dependencies, '@/lib/procoreQuotaControl': quota });
      const company = 'test-company';
      const shared = await queue.acquireProcoreWorker(company, 1);
      assert.equal(shared.acquired, true);
      const pm = await connection.withProcoreConnection('pm-dashboard', () => queue.acquireProcoreWorker(company, 1));
      assert.equal(pm.acquired, true, 'Different apps must acquire independent leases');
      const until = new Date(Date.now() + 600_000);
      await queue.setProcoreRateLimit({ companyId: company, until });
      assert.equal(await connection.withProcoreConnection('pm-dashboard', () => quota.getProcoreBackgroundCooldown(company)), null);
      await connection.withProcoreConnection('pm-dashboard', async () => {
        await queue.extendProcoreWorker(company, pm.leaseId, 2);
        await queue.releaseProcoreWorker(company, pm.leaseId);
        const next = await queue.acquireProcoreWorker(company, 1);
        assert.equal(next.acquired, true, 'Shared cooldown must not stop PM worker');
        await quota.recordProcoreQuotaObservation({ companyId: company, observation: {
          limit: 1000, remaining: 0, resetAt: until, cooldownUntil: until, rateLimited: true,
        } });
        await queue.releaseProcoreWorker(company, next.leaseId);
        assert.equal((await queue.acquireProcoreWorker(company, 1)).reason, 'rate_limit_cooldown');
      });
      const [sharedRow] = await tx.$queryRaw`SELECT * FROM procore_sync_controls WHERE company_id = ${company}`;
      const [pmRow] = await tx.$queryRaw`SELECT * FROM procore_pm_sync_controls WHERE company_id = ${company}`;
      assert.equal(sharedRow.worker_locked_by, shared.leaseId, 'PM release must not release shared worker');
      assert.equal(sharedRow.rate_limit_limit, null);
      assert.equal(pmRow.rate_limit_limit, 1000);
      assert.equal(pmRow.company_id, sharedRow.company_id);
      throw rollback;
    }, { timeout: 15_000 });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await db.$disconnect();
  }
});
