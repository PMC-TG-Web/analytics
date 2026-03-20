import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Dropping and recreating PmcGroupMapping table with clean schema...");

  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "PmcGroupMapping" CASCADE`);
  console.log("Dropped old table");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "PmcGroupMapping" (
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
  console.log("Created clean table");

  await prisma.$executeRawUnsafe(
    `ALTER TABLE "PmcGroupMapping" ADD CONSTRAINT "PmcGroupMapping_costItemNorm_costTypeNorm_key" UNIQUE ("costItemNorm", "costTypeNorm")`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX "PmcGroupMapping_costitem_idx" ON "PmcGroupMapping"("costItemNorm")`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX "PmcGroupMapping_costtype_idx" ON "PmcGroupMapping"("costTypeNorm")`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX "PmcGroupMapping_group_idx" ON "PmcGroupMapping"("pmcGroup")`
  );
  console.log("Indexes created");

  // Verify with a test upsert
  const { PrismaClient: PC2 } = await import("@prisma/client");
  const p2 = new PC2();
  const test = await p2.pmcGroupMapping.upsert({
    where: { costItemNorm_costTypeNorm: { costItemNorm: "__test__", costTypeNorm: "__test__" } },
    update: { pmcGroup: "TEST" },
    create: { id: "test-id-001", costItem: "__TEST__", costType: "__TEST__", pmcGroup: "TEST", costItemNorm: "__test__", costTypeNorm: "__test__", source: "test" },
  });
  console.log("Test upsert succeeded:", test.id);
  await p2.pmcGroupMapping.delete({ where: { id: test.id } });
  console.log("Test row cleaned up. Table is ready.");
  await p2.$disconnect();
}

main().catch(console.error).finally(() => prisma.$disconnect());
