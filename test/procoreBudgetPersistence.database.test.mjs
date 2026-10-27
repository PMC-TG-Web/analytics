import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

test('budget snapshot migration and persistence preserve evidence and scope in PostgreSQL', {
  skip: process.env.BUDGET_SNAPSHOT_DATABASE_TEST !== '1',
}, async () => {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ log: [] });
  const rollback = new Error('Roll back isolated budget test');
  try {
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
      await tx.$executeRawUnsafe('CREATE TEMP TABLE budgetlineitems (LIKE public.budgetlineitems INCLUDING ALL)');
      async function assertTemporary(names) {
        for (const name of names) {
          const result = await tx.$queryRawUnsafe('SELECT relnamespace = pg_my_temp_schema() AS isolated FROM pg_class WHERE oid = $1::regclass', name);
          assert.equal(result[0]?.isolated, true, `Write target must be temporary: ${name}`);
        }
      }
      await assertTemporary(['budgetlineitems']);
      const migration = readFileSync('prisma/migrations/20261026190000_budget_snapshot_completeness/migration.sql', 'utf8')
        .replace(/^--.*$/gm, '').replace(/CREATE TABLE IF NOT EXISTS/g, 'CREATE TEMP TABLE IF NOT EXISTS')
        .replace(/CREATE OR REPLACE VIEW/g, 'CREATE OR REPLACE TEMP VIEW');
      for (const statement of migration.split(';').map(s => s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
      await assertTemporary(['budgetlineitems', 'procore_budget_snapshot_states', 'budgetlineitems_active']);

      const prisma = {
        $queryRawUnsafe: tx.$queryRawUnsafe.bind(tx),
        $transaction: async operation => {
          await tx.$executeRawUnsafe('SAVEPOINT budget_test_case');
          try {
            const result = await operation(tx);
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT budget_test_case');
            return result;
          } catch (error) {
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT budget_test_case');
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT budget_test_case');
            throw error;
          }
        },
      };
      const compiled = ts.transpileModule(readFileSync('src/lib/procoreBudgetLineItems.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      const module = { exports: {} };
      new Function('require', 'module', 'exports', compiled)(id => {
        assert.equal(id, '@/lib/prisma'); return { prisma };
      }, module, module.exports);
      const api = module.exports;
      const line = (id, projectId = 'test-project', amount = 100) => ({ projectId, budgetLineItemId: id,
        amount, quantity: 5, costCode: '03-300.L', payload: { id, retained: true } });
      const persist = async (items, extra = {}) => {
        // JavaScript Date precision is milliseconds; let the previous write's
        // microsecond timestamp fall before the next captured read start.
        await new Promise(resolve => setTimeout(resolve, 2));
        return api.persistBudgetSnapshot({ companyId: 'test-company', projectId: 'test-project',
          items, startedAt: await api.startBudgetSnapshot(), complete: true, reconcileAbsent: true, ...extra });
      };
      await api.batchUpsertBudgetLineItems('test-company', [line('present'), line('absent'), line('other-project-row', 'other-project')]);
      await api.batchUpsertBudgetLineItems('other-company', [line('other-company-row')]);
      assert.deepEqual(await persist([line('present', 'test-project', 125)]), { upserted: 1, missing: 1, reconciled: true, complete: true });
      const all = await tx.$queryRawUnsafe('SELECT company_id, project_id, budget_line_item_id, amount::float8, source_missing_at, payload FROM budgetlineitems');
      assert.equal(all.length, 4, 'Historical row is retained');
      assert.ok(all.find(row => row.budget_line_item_id === 'absent').source_missing_at);
      assert.equal(all.find(row => row.budget_line_item_id === 'absent').payload.retained, true);
      assert.equal(all.find(row => row.budget_line_item_id === 'present').amount, 125);
      assert.equal(all.filter(row => row.company_id === 'other-company' || row.project_id === 'other-project').every(row => row.source_missing_at === null), true);
      assert.equal((await tx.$queryRawUnsafe('SELECT COUNT(*)::integer AS count FROM budgetlineitems_active'))[0].count, 3);
      await assert.rejects(persist([], {}), /unexpectedly empty/);
      await assert.rejects(persist([line('bad')], { startedAt: new Date('2000-01-01') }), /superseded/);
      await persist([line('partial')], { complete: false, reconcileAbsent: false });
      assert.equal((await tx.$queryRawUnsafe("SELECT COUNT(*)::integer AS count FROM budgetlineitems_active WHERE company_id='test-company' AND project_id='test-project'"))[0].count, 2);
      await persist([line('present'), line('absent'), line('partial')]);
      assert.equal((await tx.$queryRawUnsafe('SELECT COUNT(*)::integer AS count FROM budgetlineitems WHERE source_missing_at IS NOT NULL'))[0].count, 0);
      throw rollback;
    }, { timeout: 30000, maxWait: 10000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.$disconnect(); }
});
