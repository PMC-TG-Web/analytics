import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkZeroSchedules() {
  // Get all schedules
  const schedules = await prisma.schedule.findMany({
    select: {
      id: true,
      jobKey: true,
      customer: true,
      projectName: true,
      status: true,
      totalHours: true,
      allocationsList: {
        select: { period: true, percent: true },
      }
    }
  });

  console.log('Total schedules:', schedules.length);

  // Find schedules with no allocations
  const noAllocations = schedules.filter(s => s.allocationsList.length === 0);
  console.log(`\nSchedules with NO allocations: ${noAllocations.length}`);

  if (noAllocations.length > 0) {
    console.log('\nSchedules with zero scheduled hours:');
    noAllocations.forEach((s, i) => {
      console.log(`  [${i+1}] ${s.customer} ~ ${s.projectName}`);
      console.log(`       Status: ${s.status}, Hours: ${s.totalHours}`);
      console.log(`       jobKey: ${s.jobKey}`);
    });
  }

  // Also find schedules that are "In Progress" but have old allocations only
  const oldOnlySchedules = schedules.filter(s => {
    if (s.status !== 'In Progress') return false;
    const has2026 = s.allocationsList.some(a => a.period.startsWith('2026'));
    const hasNon2026 = s.allocationsList.some(a => !a.period.startsWith('2026'));
    return hasNon2026 && !has2026; // Only has old allocations
  });

  console.log(`\nIn Progress schedules with NO 2026 allocations: ${oldOnlySchedules.length}`);
  if (oldOnlySchedules.length > 0) {
    oldOnlySchedules.forEach((s) => {
      const allocs = s.allocationsList.map(a => a.period).join(', ');
      console.log(`  ${s.customer} ~ ${s.projectName}`);
      console.log(`    Allocations: ${allocs}`);
    });
  }

  await prisma.$disconnect();
  process.exit(0);
}

checkZeroSchedules().catch(err => {
  console.error(err);
  process.exit(1);
});
