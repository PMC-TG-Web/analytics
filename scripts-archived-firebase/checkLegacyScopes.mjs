import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const scopeCount = await prisma.projectScope.count();
console.log('ProjectScope records in legacy table:', scopeCount);

if (scopeCount > 0) {
  const samples = await prisma.projectScope.findMany({
    take: 5,
    select: { id: true, title: true, hours: true, projectId: true }
  });
  console.log('\nSample scopes:');
  samples.forEach(s => {
    console.log(`  - "${s.title}" (${s.hours} hours, projectId: ${s.projectId})`);
  });
}

await prisma.$disconnect();
