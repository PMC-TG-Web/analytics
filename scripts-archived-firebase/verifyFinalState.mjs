// Verify final schedule state

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

console.log('\n========================================');
console.log('FINAL SCHEDULE VERIFICATION');
console.log('========================================\n');

// Get all schedules
const schedules = await prisma.schedule.findMany({
  select: {
    customer: true,
    projectNumber: true,
    projectName: true,
    status: true,
    totalHours: true,
    allocations: true,
  },
  orderBy: {
    projectName: 'asc'
  }
});

console.log(`Total schedules: ${schedules.length}\n`);

// Group by project name to find any duplicates
const byName = new Map();

for (const sched of schedules) {
  if (!byName.has(sched.projectName)) {
    byName.set(sched.projectName, []);
  }
  byName.get(sched.projectName).push(sched);
}

// Check for duplicates
const duplicates = Array.from(byName.entries()).filter(([_, schedules]) => schedules.length > 1);

if (duplicates.length > 0) {
  console.log(`⚠️  Found ${duplicates.length} project(s) with multiple schedules:\n`);
  
  for (const [name, schedules] of duplicates) {
    console.log(`📋 ${name} (${schedules.length} entries):`);
    schedules.forEach((s, i) => {
      console.log(`   ${i + 1}. Customer: ${s.customer || '(blank)'} | Project #: ${s.projectNumber || '(blank)'} | Hours: ${s.totalHours}`);
    });
    console.log('');
  }
} else {
  console.log('✅ No duplicate project schedules found!');
}

// Show Alexander Drive Addition status
console.log('\n========================================');
console.log('ALEXANDER DRIVE ADDITION STATUS');
console.log('========================================\n');

const alexander = schedules.filter(s => s.projectName.includes('Alexander Drive'));

if (alexander.length > 0) {
  alexander.forEach((s, i) => {
    console.log(`${i + 1}. ${s.customer} - ${s.projectNumber} - ${s.projectName}`);
    console.log(`   Status: ${s.status}`);
    console.log(`   Hours: ${s.totalHours}`);
    console.log(`   Allocations: ${JSON.stringify(s.allocations)}\n`);
  });
} else {
  console.log('No Alexander Drive schedules found.');
}

await prisma.$disconnect();

console.log('========================================');
console.log('DONE');
console.log('========================================\n');
