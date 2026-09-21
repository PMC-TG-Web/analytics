import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';

test('estimate read SQL persists responses and isolates preview/create, company and project', {
  skip: process.env.PROCORE_ESTIMATE_DATABASE_TEST !== '1',
}, async () => {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ log: [] });
  const rollback = new Error('Rollback temporary estimate read test');
  try {
    await db.$transaction(async tx => {
      const migration = readFileSync('prisma/migrations/20260921110000_commitment_estimate_reads/migration.sql', 'utf8');
      for (const statement of migration.split(';').map(value => value.trim()).filter(Boolean)) {
        await tx.$executeRawUnsafe(statement.replace(/CREATE TABLE/g, 'CREATE TEMP TABLE'));
      }
      const module = { exports: {} };
      const dependencies = { 'node:crypto': { randomUUID }, '@/lib/prisma': { prisma: tx },
        '@/lib/procoreCommitmentMakerClient': { CommitmentMakerRateLimitError: class extends Error {} },
        '@/lib/procore/commitmentMakerEstimate': { PrimaryEstimateError: Error } };
      new Function('require', 'module', 'exports', ts.transpileModule(readFileSync('src/lib/procoreCommitmentEstimateRead.ts', 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(id => dependencies[id], module, module.exports);
      const api = module.exports;
      const options = { companyId: 'test', projectId: 'project', boardId: 'board', mode: 'preview' };
      const read = await api.openCommitmentEstimateRead(options);
      await read.read('/catalog/1?page=1', async () => ({ id: '1', cost_code: '03-300-00-20' }));
      const resumed = await api.openCommitmentEstimateRead({ ...options, preparationId: read.id });
      assert.equal((await resumed.read('/catalog/1?page=1', async () => assert.fail('cached'))).id, '1');
      await assert.rejects(api.openCommitmentEstimateRead({ ...options, preparationId: read.id, mode: 'create' }), /another request/);
      await assert.rejects(api.openCommitmentEstimateRead({ ...options, preparationId: read.id, companyId: 'other' }), /another request/);
      await assert.rejects(api.openCommitmentEstimateRead({ ...options, preparationId: read.id, projectId: 'other' }), /another request/);
      await assert.rejects(resumed.complete({ proposal: { id: 'primary' } }), api.EstimateReadPending);
      assert.equal((await api.openCommitmentEstimateRead({ ...options, preparationId: read.id })).snapshot.proposal.id, 'primary');
      await tx.$executeRaw`UPDATE commitment_maker_estimate_reads SET expires_at = NOW() - INTERVAL '1 second' WHERE id = ${read.id}`;
      await assert.rejects(api.openCommitmentEstimateRead({ ...options, preparationId: read.id }), /expired/);
      throw rollback;
    }, { timeout: 15000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.$disconnect(); }
});
