// Remove duplicate Alexander Drive Addition schedules with blank customer

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

async function removeDuplicates() {
  console.log('\n========================================');
  console.log('REMOVING DUPLICATE SCHEDULES');
  console.log('========================================\n');

  // Find all Alexander Drive Addition schedules
  const schedules = await prisma.schedule.findMany({
    where: {
      projectName: 'Alexander Drive Addition'
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

  console.log(`Found ${schedules.length} schedules for "Alexander Drive Addition":\n`);

  schedules.forEach((s, idx) => {
    console.log(`${idx + 1}. ID: ${s.id}`);
    console.log(`   JobKey: ${s.jobKey}`);
    console.log(`   Customer: "${s.customer || '(blank)'}"`);
    console.log(`   Status: ${s.status}`);
    console.log(`   Total Hours: ${s.totalHours}`);
    console.log('');
  });

  // Delete schedules with blank/empty customer or "Unknown" customer
  const toDelete = schedules.filter(s => 
    !s.customer || 
    s.customer.trim() === '' || 
    s.customer === 'Unknown' ||
    !s.jobKey.includes('~')  // Also check for malformed jobKeys
  );

  if (toDelete.length === 0) {
    console.log('✅ No duplicate schedules to delete');
    await prisma.$disconnect();
    return;
  }

  console.log(`\n🗑️  Deleting ${toDelete.length} schedule(s) with blank/unknown customer:\n`);

  for (const schedule of toDelete) {
    console.log(`   Deleting: ${schedule.jobKey}`);
    await prisma.schedule.delete({
      where: { id: schedule.id }
    });
  }

  console.log(`\n✅ Successfully deleted ${toDelete.length} duplicate schedule(s)`);
  
  // Also clean up duplicate ActiveSchedule records
  console.log('\n========================================');
  console.log('CLEANING UP ACTIVESCHEDULE TABLE');
  console.log('========================================\n');

  const activeSchedules = await prisma.activeSchedule.findMany({
    where: {
      jobKey: {
        startsWith: '~Alexander Drive Addition'
      }
    }
  });

  if (activeSchedules.length > 0) {
    console.log(`Found ${activeSchedules.length} ActiveSchedule records with blank customer`);
    await prisma.activeSchedule.deleteMany({
      where: {
        jobKey: {
          startsWith: '~Alexander Drive Addition'
        }
      }
    });
    console.log(`✅ Deleted ${activeSchedules.length} ActiveSchedule records`);
  } else {
    console.log('✅ No ActiveSchedule records to clean up');
  }

  await prisma.$disconnect();
}

removeDuplicates().catch(console.error);
