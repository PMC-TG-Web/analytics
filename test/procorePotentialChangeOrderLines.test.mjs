import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function writer(client) {
  const compiled = ts.transpileModule(readFileSync('src/lib/procorePotentialChangeOrders.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(() => ({ prisma: client }), module, module.exports);
  return module.exports.upsertPotentialChangeOrderLines;
}

const scope = { companyId: 'company', projectId: 'project', changeOrderId: 'order', changeOrderStatus: 'approved' };

test('a large order writes bounded batches and preserves fallback IDs and duplicate ordering', async () => {
  const batches = [];
  const save = writer({ $executeRawUnsafe: async (_sql, ...args) => {
    assert.deepEqual(args.slice(0, 4), ['company', 'project', 'order', 'approved']);
    batches.push(JSON.parse(args[4]));
  } });
  const records = Array.from({ length: 235 }, (_, i) => ({ id: i + 1 }));
  records.push({ quantity: '4', wbs_code: { flat_code: '03-100.L' } }, { id: 1, total_amount: '12.50' });
  const ids = await save({ ...scope, records });
  assert.deepEqual(batches.map(rows => rows.length), [100, 100, 36]);
  assert.equal(batches[0][0].amount, 12.5);
  assert.equal(batches[2].at(-1).labor_hours, 4);
  assert.deepEqual(ids.slice(-2), ['position:236', '1']);
  assert.deepEqual(await save({ ...scope, records: [] }), []);
  assert.equal(batches.length, 3);
});

test('PostgreSQL upserts lines under the correct project and retains source values', {
  skip: process.env.PCO_LINES_DATABASE_TEST !== '1',
}, async () => {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  try {
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE procore_potential_change_order_lines (LIKE public.procore_potential_change_order_lines) ON COMMIT DROP');
      const [table] = await tx.$queryRawUnsafe("SELECT relnamespace = pg_my_temp_schema() AS isolated FROM pg_class WHERE oid = 'procore_potential_change_order_lines'::regclass");
      assert.equal(table.isolated, true);
      await tx.$executeRawUnsafe('ALTER TABLE procore_potential_change_order_lines ALTER COLUMN id SET DEFAULT 0, ALTER COLUMN created_at SET DEFAULT now(), ADD UNIQUE(company_id, project_id, change_order_id, line_item_id)');
      const save = writer(tx);
      const records = [{ id: 7, wbs_code: { flat_code: '03-100.L' }, quantity: '8', total_amount: 40, updated_at: '2026-11-15T12:00:00Z' }];
      await save({ ...scope, records });
      await save({ ...scope, projectId: 'another', records });
      await save({ ...scope, records: [{ ...records[0], quantity: '10' }] });
      const rows = await tx.$queryRawUnsafe('SELECT project_id, labor_hours::float8 AS hours, amount::float8 AS amount, payload, source_updated_at FROM procore_potential_change_order_lines ORDER BY project_id');
      assert.deepEqual(rows.map(r => [r.project_id, r.hours, r.amount]), [['another', 8, 40], ['project', 10, 40]]);
      assert.equal(rows[1].payload.quantity, '10');
      assert.equal(rows[1].source_updated_at.toISOString(), '2026-11-15T12:00:00.000Z');
    });
  } finally { await db.$disconnect(); }
});
