// Check Alexander Drive Addition schedule status

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

console.log('\nChecking Alexander Drive Addition...\n');

// Check in Project table
const project = await prisma.project.findFirst({
  where: {
    customer: 'Scenic Ridge Construction',
    projectNumber: '2508 - ADA',
    projectName: 'Alexander Drive Addition'
  },
  select: {
    customer: true,
    projectNumber: true,
    projectName: true,
    status: true,
    hours: true,
  }
});

console.log('PROJECT TABLE:');
if (project) {
  console.log(`  Customer: ${project.customer}`);
  console.log(`  Project #: ${project.projectNumber}`);
  console.log(`  Project Name: ${project.projectName}`);
  console.log(`  Status: "${project.status}"`);
  console.log(`  Hours: ${project.hours}`);
} else {
  console.log('  Not found');
}

// Check in Schedule table
const schedule = await prisma.schedule.findFirst({
  where: {
    customer: 'Scenic Ridge Construction',
    projectName: 'Alexander Drive Addition'
  },
  select: {
    jobKey: true,
    customer: true,
    projectNumber: true,
    projectName: true,
    status: true,
    totalHours: true,
    allocations: true,
  }
});

console.log('\nSCHEDULE TABLE:');
if (schedule) {
  console.log(`  JobKey: ${schedule.jobKey}`);
  console.log(`  Customer: ${schedule.customer}`);
  console.log(`  Project #: ${schedule.projectNumber}`);
  console.log(`  Status: "${schedule.status}"`);
  console.log(`  Total Hours: ${schedule.totalHours}`);
  console.log(`  Allocations: ${JSON.stringify(schedule.allocations)}`);
} else {
  console.log('  Not found');
}

console.log('\nNOTE: WIP page filters for status = "in progress" (lowercase)');

await prisma.$disconnect();
