import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Check actual DB columns
  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_name = 'PmcGroupMapping'
     ORDER BY ordinal_position`
  );
  console.log("Columns:", JSON.stringify(cols, null, 2));

  // Try a direct test upsert
  try {
    const result = await prisma.pmcGroupMapping.upsert({
      where: {
        costItemNorm_costTypeNorm: {
          costItemNorm: "__test__",
          costTypeNorm: "__test__",
        },
      },
      update: { pmcGroup: "TEST" },
      create: {
        costItem: "__TEST__",
        costType: "__TEST__",
        pmcGroup: "TEST",
        costItemNorm: "__test__",
        costTypeNorm: "__test__",
        source: "test",
      },
    });
    console.log("Test upsert succeeded:", result.id);
    // Clean up
    await prisma.pmcGroupMapping.delete({ where: { id: result.id } });
    console.log("Test row cleaned up.");
  } catch (err) {
    console.error("Test upsert FAILED:", err.message);
    console.error(err);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
