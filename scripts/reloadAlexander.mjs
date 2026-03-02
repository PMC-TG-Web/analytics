// Reload Alexander Drive Addition with correct customer

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

console.log('\n========================================');
console.log('RELOADING ALEXANDER DRIVE ADDITION');
console.log('========================================\n');

const customer = 'Scenic Ridge Construction';
const projectNumber = '2508 - ADA';
const projectName = 'Alexander Drive Addition';
const jobKey = `${customer}~${projectNumber}~${projectName}`;

// Create Schedule record
const scheduleData = {
  jobKey,
  customer,
  projectNumber,
  projectName,
  status: 'In Progress',
  totalHours: 262,
  allocations: [
    { month: '2025-09', percent: 100 }
  ]
};

console.log('Creating schedule:');
console.log(`  JobKey: ${jobKey}`);
console.log(`  Status: ${scheduleData.status}`);
console.log(`  Total Hours: ${scheduleData.totalHours}`);
console.log(`  Allocations: Sept 2025 (100%)`);

try {
  const schedule = await prisma.schedule.create({
    data: scheduleData
  });
  console.log(`\n✅ Successfully created schedule (ID: ${schedule.id})`);
} catch (error) {
  console.error(`\n❌ Failed to create schedule:`, error.message);
}

// Also create ActiveSchedule record for first weekday of Sept 2025
// Sept 1, 2025 is a Monday, so that's the first weekday
const allocationDate = '2025-09-01';

console.log(`\n📅 Creating ActiveSchedule for ${allocationDate}...`);

try {
  const activeSchedule = await prisma.activeSchedule.create({
    data: {
      jobKey,
      date: allocationDate,
      hours: 262,
      scopeOfWork: 'Scheduled Work',
      source: 'schedule',
      foreman: null,
      manpower: null,
    }
  });
  console.log(`✅ Successfully created ActiveSchedule (ID: ${activeSchedule.id})`);
} catch (error) {
  console.error(`❌ Failed to create ActiveSchedule:`, error.message);
}

await prisma.$disconnect();

console.log('\n========================================');
console.log('DONE');
console.log('========================================\n');
