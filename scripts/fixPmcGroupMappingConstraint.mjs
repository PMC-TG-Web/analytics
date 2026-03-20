import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Drop the old wrongly-named index created by the raw SQL setup script
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "PmcGroupMapping_costitem_costtype_unique"`);
  console.log("Dropped old index (if it existed)");

  // Also drop the constraint in case it already exists under the wrong name
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "PmcGroupMapping" DROP CONSTRAINT IF EXISTS "PmcGroupMapping_costItemNorm_costTypeNorm_key"`
  );

  // Add the unique constraint with the exact name Prisma expects
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "PmcGroupMapping" ADD CONSTRAINT "PmcGroupMapping_costItemNorm_costTypeNorm_key" UNIQUE ("costItemNorm", "costTypeNorm")`
  );
  console.log('Created constraint "PmcGroupMapping_costItemNorm_costTypeNorm_key"');

  // Verify
  const indexes = await prisma.$queryRawUnsafe(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'PmcGroupMapping' ORDER BY indexname`
  );
  console.log("Current indexes:", JSON.stringify(indexes, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
