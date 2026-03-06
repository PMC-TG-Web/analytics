import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAllTables() {
  console.log('=== DATABASE TABLE INVENTORY ===\n');

  const counts = {
    projects: await prisma.project.count(),
    projectScopes: await prisma.projectScope.count(),
    schedules: await prisma.schedule.count(),
    scheduleAllocations: await prisma.scheduleAllocation.count(),
    activeSchedules: await prisma.activeSchedule.count(),
    scopeTrackings: await prisma.scopeTracking.count(),
    productivityLogs: await prisma.productivityLog.count(),
  };

  Object.entries(counts).forEach(([table, count]) => {
    console.log(`${table}: ${count}`);
  });

  if (counts.activeSchedules > 0) {
    console.log('\n⚠️  Found ActiveSchedule records!');
    const samples = await prisma.activeSchedule.findMany({
      take: 5,
      select: {
        jobKey: true,
        date: true,
        hours: true,
        source: true,
      }
    });
    console.log('\nSample ActiveSchedule records:');
    samples.forEach(s => {
      console.log(`  ${s.jobKey} (~${s.date}): ${s.hours}h (source: ${s.source})`);
    });
  }

  await prisma.$disconnect();
  process.exit(0);
}

checkAllTables().catch(err => {
  console.error(err);
  process.exit(1);
});
