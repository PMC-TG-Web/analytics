// Find schedules with Unknown or blank customers

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

console.log('\n========================================');
console.log('CHECKING SCHEDULES FOR CUSTOMER ISSUES');
console.log('========================================\n');

// Find all schedules with Unknown or blank customers
const problematicSchedules = await prisma.schedule.findMany({
  where: {
    OR: [
      { customer: 'Unknown' },
      { customer: null },
      { customer: '' },
    ]
  },
  select: {
    id: true,
    jobKey: true,
    customer: true,
    projectNumber: true,
    projectName: true,
    status: true,
    totalHours: true,
    allocations: true,
  }
});

console.log(`Found ${problematicSchedules.length} schedule(s) with Unknown/blank customer:\n`);

if (problematicSchedules.length > 0) {
  for (const sched of problematicSchedules) {
    console.log(`📋 ${sched.projectName}`);
    console.log(`   Customer: ${sched.customer || '(blank)'}`);
    console.log(`   Project #: ${sched.projectNumber || '(blank)'}`);
    console.log(`   JobKey: ${sched.jobKey}`);
    console.log(`   Hours: ${sched.totalHours}`);
    
    // Try to find matching project
    const matchingProject = await prisma.project.findFirst({
      where: {
        projectName: sched.projectName
      },
      select: {
        customer: true,
        projectNumber: true,
        projectName: true,
        status: true,
      }
    });
    
    if (matchingProject && matchingProject.customer) {
      console.log(`   ✅ Found project with customer: ${matchingProject.customer}`);
      console.log(`      Should update to: ${matchingProject.customer}~${matchingProject.projectNumber}~${matchingProject.projectName}`);
    } else {
      console.log(`   ⚠️  No matching project found with valid customer`);
    }
    console.log('');
  }
} else {
  console.log('✅ All schedules have valid customers!');
}

await prisma.$disconnect();

console.log('========================================');
console.log('DONE');
console.log('========================================\n');
