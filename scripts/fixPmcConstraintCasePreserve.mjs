import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Fixing unique constraint to use original costItem (case-preserving)...");

  // Drop the normalized constraint
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "PmcGroupMapping" DROP CONSTRAINT IF EXISTS "PmcGroupMapping_costItemNorm_costTypeNorm_pmcGroup_key"`
  );
  console.log("Dropped old constraint");

  // New constraint on original costItem (trimmed, case-preserved) + costTypeNorm (null-safe) + pmcGroup
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "PmcGroupMapping" ADD CONSTRAINT "PmcGroupMapping_costItem_costTypeNorm_pmcGroup_key" UNIQUE ("costItem", "costTypeNorm", "pmcGroup")`
  );
  console.log('Created new constraint: (costItem, costTypeNorm, pmcGroup)');

  const count = await prisma.pmcGroupMapping.count();
  console.log(`Current row count: ${count}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
