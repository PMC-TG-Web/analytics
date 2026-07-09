import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  // Check staging data
  const stagingCount = await prisma.procoreProjectStaging.count({
    where: { source: 'procore_v1_projects', name: { not: null } },
  });
  console.log(`procoreProjectStaging (v1_projects with name): ${stagingCount}`);

  // Check gantt_v2 tables
  const g2projects = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM gantt_v2_projects`);
  const g2scopes = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM gantt_v2_scopes`);
  console.log(`gantt_v2_projects: ${g2projects[0].count}`);
  console.log(`gantt_v2_scopes: ${g2scopes[0].count}`);

  // Sample staging projects
  const staging = await prisma.procoreProjectStaging.findMany({
    where: { source: 'procore_v1_projects', name: { not: null } },
    select: { externalId: true, procoreProjectId: true, name: true, customer: true, projectNumber: true, bidBoardStatus: true, status: true },
    take: 5,
    orderBy: { name: 'asc' },
  });
  console.log('\nSample staging projects (first 5):');
  console.log(JSON.stringify(staging, null, 2));

} finally {
  await prisma.$disconnect();
}
