// Comprehensive check for Alexander Drive Addition visibility

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

console.log('\n========================================');
console.log('ALEXANDER DRIVE ADDITION VISIBILITY CHECK');
console.log('========================================\n');

// 1. Check Project table
console.log('1. PROJECT TABLE:');
const projects = await prisma.project.findMany({
  where: {
    projectName: {
      contains: 'Alexander Drive'
    }
  },
  select: {
    customer: true,
    projectNumber: true,
    projectName: true,
    status: true,
    hours: true,
  }
});

console.log(`   Found ${projects.length} project(s):\n`);
projects.forEach(p => {
  console.log(`   - ${p.customer || '(blank)'} / ${p.projectNumber || '(blank)'} / ${p.projectName}`);
  console.log(`     Status: "${p.status}" | Hours: ${p.hours}`);
});

// 2. Check Schedule table
console.log('\n2. SCHEDULE TABLE:');
const schedules = await prisma.schedule.findMany({
  where: {
    projectName: {
      contains: 'Alexander Drive'
    }
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

console.log(`   Found ${schedules.length} schedule(s):\n`);
schedules.forEach(s => {
  console.log(`   JobKey: ${s.jobKey}`);
  console.log(`   Customer: ${s.customer}`);
  console.log(`   Status: "${s.status}"`);
  console.log(`   Total Hours: ${s.totalHours}`);
  console.log(`   Allocations: ${JSON.stringify(s.allocations)}\n`);
});

// 3. Check ActiveSchedule table
console.log('3. ACTIVESCHEDULE TABLE:');
const activeSchedules = await prisma.activeSchedule.findMany({
  where: {
    jobKey: {
      contains: 'Alexander Drive'
    }
  },
  select: {
    jobKey: true,
    date: true,
    hours: true,
    scopeOfWork: true,
  }
});

console.log(`   Found ${activeSchedules.length} allocation(s):\n`);
activeSchedules.forEach(a => {
  console.log(`   ${a.date}: ${a.hours} hours (${a.scopeOfWork})`);
});

// 4. Check ProjectScope table
console.log('\n4. PROJECTSCOPE TABLE:');
const scopes = await prisma.projectScope.findMany({
  where: {
    jobKey: {
      contains: 'Alexander Drive'
    }
  },
  select: {
    jobKey: true,
    title: true,
    startDate: true,
    endDate: true,
  }
});

console.log(`   Found ${scopes.length} scope(s):\n`);
if (scopes.length > 0) {
  scopes.forEach(s => {
    console.log(`   ${s.title}: ${s.startDate} to ${s.endDate}`);
  });
  console.log('\n   ⚠️  NOTE: WIP page EXCLUDES projects with scopes!');
} else {
  console.log('   None (good - project should show on WIP page)');
}

console.log('\n========================================');
console.log('WIP PAGE FILTER REQUIREMENTS:');
console.log('========================================');
console.log('✓ Must have status = "in progress" (lowercase)');
console.log('✓ Must NOT have any ProjectScope records');
console.log('✓ Must have Schedule record');
console.log('✓ Project must exist in Project table');
console.log('========================================\n');

await prisma.$disconnect();
