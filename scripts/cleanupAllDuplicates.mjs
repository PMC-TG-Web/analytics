// Clean up all duplicate schedules and projects

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

console.log('\n========================================');
console.log('CLEANING UP DUPLICATE SCHEDULES & PROJECTS');
console.log('========================================\n');

let deletedSchedules = 0;
let deletedProjects = 0;
let updatedSchedules = 0;

// 1. Delete duplicate Ducklings schedules (keep none - we'll fix later if needed)
console.log('🗑️  Cleaning up Ducklings Ambassador Circle schedules...');
const ducklingsSchedules = await prisma.schedule.findMany({
  where: {
    projectName: 'Ducklings Ambassador Circle',
    customer: 'Unknown'
  }
});

for (const sched of ducklingsSchedules) {
  await prisma.schedule.delete({ where: { id: sched.id } });
  console.log(`   Deleted schedule: ${sched.jobKey}`);
  deletedSchedules++;
}

// 2. Delete duplicate Paneling Sales schedules  
console.log('\n🗑️  Cleaning up Paneling Sales Pine Building schedules...');
const panelingSchedules = await prisma.schedule.findMany({
  where: {
    projectName: 'Paneling Sales Pine Building',
    customer: 'Unknown'
  }
});

for (const sched of panelingSchedules) {
  await prisma.schedule.delete({ where: { id: sched.id } });
  console.log(`   Deleted schedule: ${sched.jobKey}`);
  deletedSchedules++;
}

// 3. Delete duplicate Paneling Sales project
console.log('\n🗑️  Deleting duplicate Paneling Sales Pine Building project...');
const panelingProject = await prisma.project.findFirst({
  where: {
    projectName: 'Paneling Sales Pine Building',
    customer: null
  }
});

if (panelingProject) {
  await prisma.project.delete({ where: { id: panelingProject.id } });
  console.log(`   Deleted project: ${panelingProject.projectName}`);
  deletedProjects++;
}

// 4. Delete duplicate Ducklings project if exists
console.log('\n🗑️  Checking for duplicate Ducklings project...');
const ducklingsProject = await prisma.project.findFirst({
  where: {
 projectName: 'Ducklings Ambassador Circle',
    customer: null
  }
});

if (ducklingsProject) {
  await prisma.project.delete({ where: { id: ducklingsProject.id } });
  console.log(`   Deleted project: ${ducklingsProject.projectName}`);
  deletedProjects++;
} else {
  console.log(`   No duplicate Ducklings project found`);
}

console.log('\n========================================');
console.log('SUMMARY');
console.log('========================================');
console.log(`Deleted schedules:  ${deletedSchedules}`);
console.log(`Deleted projects:   ${deletedProjects}`);
console.log(`Updated schedules:  ${updatedSchedules}`);
console.log('========================================\n');

// Verify remaining Unknown/blank customer schedules
const remaining = await prisma.schedule.findMany({
  where: {
    OR: [
      { customer: 'Unknown' },
      { customer: null },
      { customer: '' },
    ]
  },
  select: {
    jobKey: true,
    customer: true,
    projectName: true,
  }
});

if (remaining.length > 0) {
  console.log(`⚠️  Still ${remaining.length} schedule(s) with Unknown/blank customer:\n`);
  remaining.forEach(r => {
    console.log(`   ${r.projectName} (${r.customer || 'blank'})`);
  });
} else {
  console.log('✅ All schedules now have valid customers!');
}

await prisma.$disconnect();

console.log('\n========================================');
console.log('DONE');
console.log('========================================\n');
