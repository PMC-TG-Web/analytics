import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const qualifyingStatuses = ['In Progress', 'Accepted', 'Complete'];

async function main() {
  // Get all allocations for 2026
  const alloc2026 = await prisma.scheduleAllocation.findMany({
    where: { period: { startsWith: '2026' } },
    include: {
      schedule: {
        select: {
          jobKey: true,
          customer: true,
          projectName: true,
        }
      }
    }
  });
  
  console.log(`Total 2026 allocations remaining: ${alloc2026.length}`);
  
  const bySchedule = {};
  alloc2026.forEach(a => {
    const key = a.schedule.jobKey || `${a.schedule.customer}~${a.schedule.projectName}`;
    if (!bySchedule[key]) bySchedule[key] = [];
    bySchedule[key].push(a.period);
  });
  
  console.log(`Schedules with 2026 allocations: ${Object.keys(bySchedule).length}\n`);
  
  // Show distribution of allocations per schedule
  const counts = Object.entries(bySchedule).map(([_, months]) => months.length);
  console.log(`Allocations per schedule: `);
  console.log(`  Min: ${Math.min(...counts)}`);
  console.log(`  Max: ${Math.max(...counts)}`);
  console.log(`  Avg: ${(counts.reduce((a,b)=>a+b,0)/counts.length).toFixed(1)}`);
  
  // Count schedules by allocation count
  const countDist = {};
  counts.forEach(count => {
    countDist[count] = (countDist[count] || 0) + 1;
  });
  console.log(`\nSchedules grouped by number of months:`);
  Object.keys(countDist).sort((a,b) => a-b).forEach(numMonths => {
    console.log(`  ${numMonths} months: ${countDist[numMonths]} schedules`);
  });
  
  // Total allocations being used
  const totalUsed = alloc2026.length;
  console.log(`\n Total 2026 allocations being used: ${totalUsed}`);
  console.log(`  (Before cleanup: 77 valid + 43 NULL = 120 total)`);
  console.log(`  (After cleanup: ${totalUsed} valid only)`);
  
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
