import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';

test('primary estimate claims preserve PO targets, reject duplicate ownership and require an identical resume', {
  skip: process.env.PROCORE_ESTIMATE_DATABASE_TEST !== '1',
}, async () => {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ log: [] });
  const rollback = new Error('Rollback isolated estimate test');
  try {
    await db.$transaction(async tx => {
      const migration = readFileSync('prisma/migrations/20260918160000_commitment_primary_estimate/migration.sql', 'utf8');
      for (const statement of migration.split(';').map(value => value.trim()).filter(Boolean)) {
        await tx.$executeRawUnsafe(statement.replace(/CREATE TABLE/g, 'CREATE TEMP TABLE'));
      }
      const module = { exports: {} };
      const code = ts.transpileModule(readFileSync('src/lib/procoreCommitmentMakerEstimateImport.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      new Function('require', 'module', 'exports', code)(id => {
        if (id === 'node:crypto') return { randomUUID };
        if (id === '@/lib/prisma') return { prisma: { $queryRaw: tx.$queryRaw.bind(tx), $executeRaw: tx.$executeRaw.bind(tx), auditLog: { findMany: async () => [] } } };
        if (id === '@/lib/procore/commitmentMakerEstimate') return { PrimaryEstimateError: Error };
        assert.fail(`Unexpected dependency ${id}`);
      }, module, module.exports);
      const api = module.exports;
      const identity = { companyId: 'test', projectId: 'project', fingerprint: 'f1', combinations: [] };
      assert.equal(await api.readPrimaryEstimateImport(identity), null);
      const claim = await api.claimPrimaryEstimateImport(identity);
      await assert.rejects(api.claimPrimaryEstimateImport(identity), /already being imported/);
      const targets = [{ name: 'Slabs', id: '123', number: '001' }];
      await api.savePrimaryEstimateImport(claim, targets);
      assert.deepEqual((await api.readPrimaryEstimateImport(identity)).targets, targets);
      await api.savePrimaryEstimateImport(claim, targets, 'retryable');
      await assert.rejects(api.claimPrimaryEstimateImport({ ...identity, fingerprint: 'different' }), /already being imported/);
      const resumed = await api.claimPrimaryEstimateImport(identity);
      assert.notEqual(resumed.owner, claim.owner);
      assert.deepEqual((await api.readPrimaryEstimateImport(identity)).targets, targets);
      await assert.rejects(api.savePrimaryEstimateImport(claim, []), /ownership could not be saved/);
      await api.savePrimaryEstimateImport(resumed, targets, 'completed');
      await assert.rejects(api.claimPrimaryEstimateImport(identity), /already being imported/);
      assert.equal(await api.readPrimaryEstimateImport({ ...identity, companyId: 'another' }), null);
      throw rollback;
    }, { timeout: 15000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.$disconnect(); }
});
