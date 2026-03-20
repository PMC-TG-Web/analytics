import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Creating PmcGroupMapping table...");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PmcGroupMapping" (
      id TEXT PRIMARY KEY,
      "costItem" TEXT NOT NULL,
      "costType" TEXT,
      "pmcGroup" TEXT NOT NULL,
      "costItemNorm" TEXT NOT NULL,
      "costTypeNorm" TEXT NOT NULL,
      source TEXT DEFAULT 'manual',
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`ALTER TABLE "PmcGroupMapping" ADD COLUMN IF NOT EXISTS "costItem" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PmcGroupMapping" ADD COLUMN IF NOT EXISTS "costType" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PmcGroupMapping" ADD COLUMN IF NOT EXISTS "costItemNorm" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PmcGroupMapping" ADD COLUMN IF NOT EXISTS "costTypeNorm" TEXT`);

  await prisma.$executeRawUnsafe(`UPDATE "PmcGroupMapping" SET "costItem" = COALESCE("costItem", "projectName", '')`);
  await prisma.$executeRawUnsafe(`UPDATE "PmcGroupMapping" SET "costType" = COALESCE("costType", '')`);
  await prisma.$executeRawUnsafe(`UPDATE "PmcGroupMapping" SET "costItemNorm" = COALESCE("costItemNorm", lower(trim("costItem")))`);
  await prisma.$executeRawUnsafe(`UPDATE "PmcGroupMapping" SET "costTypeNorm" = COALESCE("costTypeNorm", lower(trim("costType")))`);

  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "PmcGroupMapping_costitem_costtype_unique" ON "PmcGroupMapping"("costItemNorm", "costTypeNorm")`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "PmcGroupMapping_costitem_idx" ON "PmcGroupMapping"("costItemNorm")`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "PmcGroupMapping_costtype_idx" ON "PmcGroupMapping"("costTypeNorm")`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "PmcGroupMapping_group_idx" ON "PmcGroupMapping"("pmcGroup")`
  );

  console.log("PmcGroupMapping table created.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
