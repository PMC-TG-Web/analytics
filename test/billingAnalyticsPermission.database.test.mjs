import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('permission migration preserves only existing active pilot access and is idempotent', {
  skip: process.env.BILLING_PERMISSION_DATABASE_TEST !== '1',
}, async () => {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ log: [] });
  const rollback = new Error('Roll back isolated permission test');
  try {
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE "User" (
        id integer PRIMARY KEY, email text, permissions text[], "isActive" boolean,
        "updatedAt" timestamptz DEFAULT '2000-01-01'
      )`);
      const isolated = await tx.$queryRawUnsafe(`SELECT relnamespace = pg_my_temp_schema() AS isolated
        FROM pg_class WHERE oid = '"User"'::regclass`);
      assert.equal(isolated[0]?.isolated, true, 'All writes must resolve to the temporary User table');
      const fixtures = [
        ['todd@pmcdecor.com', ['OWNER'], true, true],
        ['SHELLY@pmcdecor.com', [' analytics '], true, true],
        ['david@pmcdecor.com', ['ESTIMATOR'], true, true],
        ['david@pmcdecor.com', ['admin'], true, true],
        ['other@pmcdecor.com', ['OWNER', 'analytics'], true, false],
        ['todd@pmcdecor.com', ['analytics'], false, false],
        ['shelly@pmcdecor.com', ['employees'], true, false],
        ['david@pmcdecor.com', ['analytics', 'billing-analytics'], true, false],
        ['todd@pmcdecor.com.example', ['analytics'], true, false],
      ];
      for (const [index, [email, assigned, active]] of fixtures.entries()) {
        await tx.$executeRawUnsafe('INSERT INTO "User" (id,email,permissions,"isActive") VALUES ($1,$2,$3::text[],$4)', index, email, assigned, active);
      }
      const migration = readFileSync('prisma/migrations/20261103150000_billing_analytics_permission/migration.sql', 'utf8');
      assert.equal(await tx.$executeRawUnsafe(migration), 4);
      const rows = await tx.$queryRawUnsafe('SELECT * FROM "User" ORDER BY id');
      for (const [index, row] of rows.entries()) {
        const [, original, , changed] = fixtures[index];
        assert.deepEqual(row.permissions, changed ? [...original, 'billing-analytics'] : original);
        assert.equal(row.updatedAt.getUTCFullYear() === 2000, !changed);
      }
      assert.equal(await tx.$executeRawUnsafe(migration), 0);
      assert.deepEqual(await tx.$queryRawUnsafe('SELECT * FROM "User" ORDER BY id'), rows);
      throw rollback;
    }, { timeout: 30000 });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await db.$disconnect();
  }
});
