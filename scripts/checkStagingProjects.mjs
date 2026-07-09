import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  // All staging sources
  const bySources = await prisma.$queryRawUnsafe(
    `SELECT source, COUNT(*) as count FROM "procore_project_staging" GROUP BY source ORDER BY count DESC`
  );
  console.log('Staging rows by source:');
  bySources.forEach(r => console.log(`  "${r.source}" → ${r.count} rows`));

  // All v1 staging projects
  const allV1 = await prisma.procoreProjectStaging.findMany({
    where: { source: 'procore_v1_projects' },
    select: { externalId: true, procoreProjectId: true, name: true, customer: true, projectNumber: true, status: true, bidBoardStatus: true },
    orderBy: { name: 'asc' },
  });
  console.log(`\nAll procore_v1_projects staging rows (${allV1.length}):`);
  allV1.forEach((p, i) => console.log(`  ${i+1}. ${p.name} | ${p.customer} | ${p.projectNumber} | ${p.status} | ${p.bidBoardStatus}`));

} finally {
  await prisma.$disconnect();
}
