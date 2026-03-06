// Fix Alexander Drive Addition status to lowercase

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

console.log('\nFixing status to lowercase "in progress"...\n');

// Update Project table
const projectUpdate = await prisma.project.updateMany({
  where: {
    customer: 'Scenic Ridge Construction',
    projectNumber: '2508 - ADA',
    projectName: 'Alexander Drive Addition'
  },
  data: {
    status: 'in progress'
  }
});

console.log(`✅ Updated ${projectUpdate.count} project(s)`);

// Update Schedule table
const scheduleUpdate = await prisma.schedule.updateMany({
  where: {
    customer: 'Scenic Ridge Construction',
    projectName: 'Alexander Drive Addition'
  },
  data: {
    status: 'in progress'
  }
});

console.log(`✅ Updated ${scheduleUpdate.count} schedule(s)`);

// Verify
const schedule = await prisma.schedule.findFirst({
  where: {
    customer: 'Scenic Ridge Construction',
    projectName: 'Alexander Drive Addition'
  },
  select: {
    projectName: true,
    status: true,
    totalHours: true,
    allocations: true,
  }
});

console.log('\nVerified:');
console.log(`  Project: ${schedule.projectName}`);
console.log(`  Status: "${schedule.status}"`);
console.log(`  Hours: ${schedule.totalHours}`);
console.log(`  Allocations: ${JSON.stringify(schedule.allocations)}`);

await prisma.$disconnect();

console.log('\n✅ Done! Should now appear on WIP page.\n');
