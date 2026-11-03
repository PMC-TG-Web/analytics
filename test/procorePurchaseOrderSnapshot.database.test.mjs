import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_PRODUCTIVITY_PO_SQL } from '../src/lib/procorePurchaseOrderSnapshot.ts';

test('Analytics filtering excludes retired POs while preserving current, restored and unrelated source identities', {
  skip: process.env.PO_SNAPSHOT_DATABASE_TEST !== '1',
}, async () => {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ log: [] });
  const rollback = new Error('Rollback isolated PO fixtures');
  try {
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE "PurchaseOrderContract" (
        id text PRIMARY KEY, "procoreCompanyId" text, "procoreProjectId" text, "procoreId" text,
        "procoreDeletedAt" timestamptz, "updatedAt" timestamptz
      )`);
      const [table] = await tx.$queryRawUnsafe(`SELECT relnamespace = pg_my_temp_schema() AS isolated
        FROM pg_class WHERE oid = '"PurchaseOrderContract"'::regclass`);
      assert.equal(table.isolated, true, 'PO writes must target temporary fixtures only');
      await tx.$executeRawUnsafe(`INSERT INTO "PurchaseOrderContract" VALUES
        ('old','c','p','old-po','2026-02-01','2026-01-01'),
        ('replacement','c','p','new-po',NULL,'2026-01-01'),
        ('unrelated-project','c','other','old-po',NULL,'2026-01-01'),
        ('unrelated-company','other','p','old-po',NULL,'2026-01-01'),
        ('concurrent','c','p','newer-po',NULL,'2026-03-01')`);
      const active = await tx.$queryRawUnsafe(`SELECT v.contract_id, v.company_id, v.project_id FROM (
        VALUES ('c','p','old-po'), ('c','p','new-po'), ('c','other','old-po'), ('other','p','old-po'), ('c','p','newer-po')
      ) v(company_id,project_id,contract_id) WHERE ${ACTIVE_PRODUCTIVITY_PO_SQL}`);
      assert.equal(active.length, 4);
      assert.ok(!active.some(row => row.company_id === 'c' && row.project_id === 'p' && row.contract_id === 'old-po'));
      // Raw SQL resolves to the verified temporary table; Prisma model CRUD
      // explicitly qualifies public and must never be used for these fixtures.
      await tx.$executeRawUnsafe(`UPDATE "PurchaseOrderContract" SET "procoreDeletedAt" = NULL WHERE id = 'old'`);
      const restored = await tx.$queryRawUnsafe(`SELECT 1 FROM (VALUES ('c','p','old-po')) v(company_id,project_id,contract_id) WHERE ${ACTIVE_PRODUCTIVITY_PO_SQL}`);
      assert.equal(restored.length, 1, 'a restored PO can become visible again');
      throw rollback;
    }, { timeout: 30000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.$disconnect(); }
});
