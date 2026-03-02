// Find Paneling Sales Pine Building project

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

console.log('\nSearching for Paneling Sales Pine Building projects...\n');

const projects = await prisma.project.findMany({
  where: {
    OR: [
      { projectName: { contains: 'Paneling Sales' } },
      { projectName: { contains: 'Pine Building' } },
      { projectNumber: { contains: 'Pine Building' } },
    ]
  },
  select: {
    id: true,
    customer: true,
    projectNumber: true,
    projectName: true,
    status: true,
    hours: true,
  }
});

console.log(`Found ${projects.length} matching project(s):\n`);

projects.forEach((p, i) => {
  console.log(`${i + 1}. Customer: ${p.customer || '(blank)'}`);
  console.log(`   Project #: ${p.projectNumber || '(blank)'}`);
  console.log(`   Project Name: ${p.projectName}`);
  console.log(`   Status: ${p.status}`);
  console.log(`   Hours: ${p.hours || 0}`);
  console.log(`   ID: ${p.id}\n`);
});

await prisma.$disconnect();
