import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Fixing unique constraint to include pmcGroup...");

  // Drop the current constraint
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "PmcGroupMapping" DROP CONSTRAINT IF EXISTS "PmcGroupMapping_costItemNorm_costTypeNorm_key"`
  );
  console.log("Dropped old constraint");

  // Add new constraint that includes pmcGroup - allows same costItem+costType to map to multiple groups
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "PmcGroupMapping" ADD CONSTRAINT "PmcGroupMapping_costItemNorm_costTypeNorm_pmcGroup_key" UNIQUE ("costItemNorm", "costTypeNorm", "pmcGroup")`
  );
  console.log('Created new constraint: (costItemNorm, costTypeNorm, pmcGroup)');

  const count = await prisma.pmcGroupMapping.count();
  console.log(`Current row count: ${count}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
