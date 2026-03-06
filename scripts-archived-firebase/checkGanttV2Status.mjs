import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const counts = await prisma.$queryRaw`
  SELECT 
    (SELECT COUNT(*) FROM gantt_v2_projects) as projects,
    (SELECT COUNT(*) FROM gantt_v2_scopes) as scopes
`;

console.log('✓ Gantt V2 Database Status:');
console.log(`  Projects: ${counts[0].projects}`);
console.log(`  Scopes: ${counts[0].scopes}`);

await prisma.$disconnect();
