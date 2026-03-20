import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [feedCount, packageCount, formCount, distinctProjects] = await Promise.all([
    prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM procore_project_feed`),
    prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM bidpackages`),
    prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM bidforms`),
    prisma.$queryRawUnsafe(`SELECT COUNT(DISTINCT procore_id)::int AS n FROM procore_project_feed WHERE company_id = $1 AND soft_deleted = FALSE AND procore_id IS NOT NULL`, '598134325658789'),
  ]);

  console.log(JSON.stringify({
    procore_project_feed_rows: feedCount[0]?.n ?? 0,
    bidpackages_rows: packageCount[0]?.n ?? 0,
    bidforms_rows: formCount[0]?.n ?? 0,
    distinct_project_ids_for_company: distinctProjects[0]?.n ?? 0,
  }, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
