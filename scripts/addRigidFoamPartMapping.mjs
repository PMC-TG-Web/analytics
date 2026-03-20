import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function normalize(value) {
  return (value ?? "").toString().trim().replace(/^"+|"+$/g, "").trim().toLowerCase();
}

async function main() {
  const costItem = "4” Rigid Foam Expansion";
  const costType = "Part";
  const pmcGroup = "Part";

  const row = await prisma.pmcGroupMapping.upsert({
    where: {
      costItem_costTypeNorm_pmcGroup: {
        costItem,
        costTypeNorm: normalize(costType),
        pmcGroup,
      },
    },
    update: {
      costType,
      source: "manual-fix",
      costItemNorm: normalize(costItem),
      costTypeNorm: normalize(costType),
      updatedAt: new Date(),
    },
    create: {
      costItem,
      costType,
      pmcGroup,
      source: "manual-fix",
      costItemNorm: normalize(costItem),
      costTypeNorm: normalize(costType),
    },
  });

  console.log("Upserted mapping:", JSON.stringify({
    id: row.id,
    costItem: row.costItem,
    costType: row.costType,
    pmcGroup: row.pmcGroup,
    source: row.source,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
