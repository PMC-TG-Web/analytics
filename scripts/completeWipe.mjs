import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function completeWipe() {
  console.log('Starting complete data wipe...\n');

  // 1. Delete all allocations
  const allocCount = await prisma.scheduleAllocation.deleteMany({});
  console.log(`✓ Deleted ${allocCount.count} schedule allocations`);

  // 2. Delete all schedules
  const scheduleCount = await prisma.schedule.deleteMany({});
  console.log(`✓ Deleted ${scheduleCount.count} schedules`);

  // 3. Delete all scopes
  const scopeCount = await prisma.projectScope.deleteMany({});
  console.log(`✓ Deleted ${scopeCount.count} project scopes`);

  // 4. Verify cleanup
  const remainingSchedules = await prisma.schedule.count();
  const remainingAllocations = await prisma.scheduleAllocation.count();
  const remainingScopes = await prisma.projectScope.count();

  console.log(`\nVerification:`);
  console.log(`  Remaining schedules: ${remainingSchedules}`);
  console.log(`  Remaining allocations: ${remainingAllocations}`);
  console.log(`  Remaining scopes: ${remainingScopes}`);

  // 5. Check project count
  const projectCount = await prisma.project.count();

  console.log(`\nRemaining:`);
  console.log(`  Projects: ${projectCount}`);

  console.log(`\n✓ Complete fresh start - only projects remain`);

  await prisma.$disconnect();
  process.exit(0);
}

completeWipe().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
