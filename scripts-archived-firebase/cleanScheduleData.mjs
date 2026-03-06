import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanScheduleData() {
  console.log('Starting clean slate for scheduling data...\n');

  // 1. Delete all allocations first
  const allocCount = await prisma.scheduleAllocation.deleteMany({});
  console.log(`✓ Deleted ${allocCount.count} schedule allocations`);

  // 2. Delete all schedules
  const scheduleCount = await prisma.schedule.deleteMany({});
  console.log(`✓ Deleted ${scheduleCount.count} schedules`);

  // 3. Verify cleanup
  const remainingSchedules = await prisma.schedule.count();
  const remainingAllocations = await prisma.scheduleAllocation.count();

  console.log(`\nVerification:`);
  console.log(`  Remaining schedules: ${remainingSchedules}`);
  console.log(`  Remaining allocations: ${remainingAllocations}`);

  // 4. Check project and scope counts
  const projectCount = await prisma.project.count();
  const scopeCount = await prisma.projectScope.count();

  console.log(`\nIntact tables:`);
  console.log(`  Projects: ${projectCount}`);
  console.log(`  Project Scopes: ${scopeCount}`);

  console.log(`\n✓ Clean slate ready for fresh import`);

  await prisma.$disconnect();
  process.exit(0);
}

cleanScheduleData().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
