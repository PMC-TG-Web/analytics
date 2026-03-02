// Remove exact duplicate schedules (keep first, delete rest)

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

console.log('\n========================================');
console.log('REMOVING EXACT DUPLICATE SCHEDULES');
console.log('========================================\n');

const projectsWithDuplicates = [
  'Gables 833 Patio',
  'Greenfield Clubhouse',
  'Paneling Sales- North Building'
];

let totalDeleted = 0;

for (const projectName of projectsWithDuplicates) {
  console.log(`📋 Processing: ${projectName}`);
  
  const schedules = await prisma.schedule.findMany({
    where: { projectName },
    select: {
      id: true,
      customer: true,
      projectNumber: true,
      totalHours: true,
    },
    orderBy: { id: 'asc' }
  });
  
  if (schedules.length > 1) {
    console.log(`   Found ${schedules.length} duplicates`);
    console.log(`   Keeping first (ID: ${schedules[0].id})`);
    
    // Delete all except the first one
    for (let i = 1; i < schedules.length; i++) {
      await prisma.schedule.delete({ where: { id: schedules[i].id } });
      console.log(`   ✅ Deleted duplicate (ID: ${schedules[i].id})`);
      totalDeleted++;
    }
  } else {
    console.log(`   Only 1 schedule found (already clean)`);
  }
  console.log('');
}

console.log('========================================');
console.log(`TOTAL DELETED: ${totalDeleted} duplicate schedule(s)`);
console.log('========================================\n');

// Verify no duplicates remain
const allSchedules = await prisma.schedule.findMany({
  select: { projectName: true }
});

const byName = new Map();
for (const sched of allSchedules) {
  byName.set(sched.projectName, (byName.get(sched.projectName) || 0) + 1);
}

const duplicatesRemaining = Array.from(byName.entries()).filter(([_, count]) => count > 1);

if (duplicatesRemaining.length > 0) {
  console.log(`⚠️  ${duplicatesRemaining.length} project(s) still have duplicates:`);
  duplicatesRemaining.forEach(([name, count]) => {
    console.log(`   ${name}: ${count} entries`);
  });
} else {
  console.log('✅ All duplicates removed! Each project now has exactly 1 schedule.');
}

await prisma.$disconnect();

console.log('\n========================================');
console.log('DONE');
console.log('========================================\n');
