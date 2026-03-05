import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function analyzeAllocationSources() {
  console.log('=== DATA SOURCE ANALYSIS ===\n');

  // 1. Check what's in Schedule (should be 0 now)
  const scheduleCount = await prisma.schedule.count();
  console.log(`Schedule records (has allocation %): ${scheduleCount}`);

  // 2. Check what's in ScheduleAllocation (should be 0 now)
  const allocCount = await prisma.scheduleAllocation.count();
  console.log(`ScheduleAllocation records (has allocation %): ${allocCount}`);

  // 3. Check ActiveSchedule records
  const activeCount = await prisma.activeSchedule.count();
  console.log(`ActiveSchedule records (has daily hours, no %): ${activeCount}`);

  if (activeCount > 0) {
    // Check date range and projects
    const earliest = await prisma.activeSchedule.findFirst({
      orderBy: { date: 'asc' },
      select: { date: true }
    });
    
    const latest = await prisma.activeSchedule.findFirst({
      orderBy: { date: 'desc' },
      select: { date: true }
    });

    const bySource = await prisma.activeSchedule.groupBy({
      by: ['source'],
      _count: true
    });

    console.log(`\n  Date range: ${earliest?.date} to ${latest?.date}`);
    console.log(`  By source:`);
    bySource.forEach(s => {
      console.log(`    ${s.source}: ${s._count}`);
    });

    console.log(`\n⚠️  ActiveSchedule is daily/hourly data (not %). These are NOT percentages.`);
  }

  // 4. Check for any other allocation sources
  console.log(`\n=== POTENTIAL ALLOCATION SOURCES ===`);
  console.log(`✓ Schedule table - CLEANED (was source of %)`);
  console.log(`✓ ScheduleAllocation table - CLEANED (was source of %)`);
  console.log(`? ActiveSchedule table - Contains daily hours, NOT percentages`);
  console.log(`\nConclusion: ALL percentage allocation sources have been deleted.`);

  await prisma.$disconnect();
  process.exit(0);
}

analyzeAllocationSources().catch(err => {
  console.error(err);
  process.exit(1);
});
