import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

console.log('=== Sample customFields from Projects ===\n');

const projects = await prisma.project.findMany({
  where: {
    customFields: {
      not: prisma.project.fields.customFields === null
    }
  },
  select: {
    projectName: true,
    customer: true,
    customFields: true
  },
  take: 10
});

if (projects.length === 0) {
  console.log('No projects have customFields data.');
} else {
  projects.forEach((p, idx) => {
    console.log(`${idx + 1}. "${p.projectName}" (${p.customer})`);
    if (p.customFields) {
      console.log(`   customFields: ${JSON.stringify(p.customFields, null, 2)}`);
    }
    console.log();
  });
}

await prisma.$disconnect();
