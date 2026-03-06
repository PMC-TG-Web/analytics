// Find Alexander Drive Addition project

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

const projects = await prisma.project.findMany({
  where: {
    projectName: {
      contains: 'Alexander'
    }
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

console.log(`\nAlexander projects in database: ${projects.length}\n`);
projects.forEach(p => {
  console.log(`  Customer: ${p.customer || '(blank)'}`);
  console.log(`  Project #: ${p.projectNumber || '(blank)'}`);
  console.log(`  Project Name: ${p.projectName}`);
  console.log(`  Status: ${p.status}`);
  console.log(`  Hours: ${p.hours}`);
  console.log('');
});

await prisma.$disconnect();
