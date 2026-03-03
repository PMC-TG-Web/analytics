import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient ();

async function main() {
  // Find schedules with NULL percent allocations for 2026
  const scheduleAllocs = await prisma.scheduleAllocation.findMany({
    where: {
      AND: [
        { period: { startsWith: '2026' } },
        { percent: null }
      ]
    },
    include: {
      schedule: {
        select: {
          jobKey: true,
          customer: true,
          projectNumber: true,
          projectName: true,
        }
      }
    }
  });
  
  console.log(`\nSchedules with NULL percent allocations for 2026: ${scheduleAllocs.length}\n`);
  
  const bySchedule = {};
  scheduleAllocs.forEach(alloc => {
    const key = alloc.schedule.jobKey || `${alloc.schedule.customer}~${alloc.schedule.projectNumber}~${alloc.schedule.projectName}`;
    if (!bySchedule[key]) {
      bySchedule[key] = [];
    }
    bySchedule[key].push(alloc.period);
  });
  
  Object.entries(bySchedule).sort().forEach(([key, months]) => {
    console.log(`${key}`);
    console.log(`  Missing percent for: ${months.join(', ')}`);
  });
  
  console.log(`\n\nSummary:`);
  console.log(`Total schedules with NULL allocations: ${Object.keys(bySchedule).length}`);
  console.log(`Total NULL allocations: ${scheduleAllocs.length}`);
  
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
