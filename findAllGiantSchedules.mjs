import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  // Get ALL schedules with Giant in the name
  const schedules = await prisma.schedule.findMany({
    where: {
      projectName: {
        contains: 'Giant'
      }
    },
    select: {
      id: true,
      jobKey: true,
      projectName: true,
      customer: true,
      totalHours: true,
      allocationsList: {
        select: {
          period: true,
          hours: true,
          percent: true,
        },
        orderBy: { period: 'asc' }
      }
    },
    orderBy: { jobKey: 'asc' }
  });
  
  console.log(`Found ${schedules.length} schedules with "Giant" in projectName\n`);
  
  let totalJan = 0;
  
  schedules.forEach((s, idx) => {
    console.log(`[${idx + 1}] ${s.jobKey}`);
    console.log(`    Customer: ${s.customer}`);
    console.log(`    Total Hours: ${s.totalHours}`);
    const janAlloc = s.allocationsList.find(a => a.period === '2026-01');
    if (janAlloc) {
      console.log(`    Jan 2026: ${janAlloc.hours}h (${janAlloc.percent}%)`);
      totalJan += janAlloc.hours;
    } else {
      console.log(`    Jan 2026: No allocation`);
    }
  });
  
  console.log(`\n=== TOTAL JANUARY HOURS (All Giant schedules): ${totalJan}h ===`);
  
  // Check if the frontend is somehow seeing all these together as one job
  console.log('\nChecking if these are grouped as one "job" in frontend...');
  
  // Also sum ALL allocations across all Giant schedules
  let totalHours2026 = 0;
  schedules.forEach(s => {
    const allocSum = s.allocationsList.reduce((sum, a) => sum + a.hours, 0);
    totalHours2026 += allocSum;
  });
  console.log(`Total 2026 hours across all Giant schedules: ${totalHours2026}h`);
  
  await prisma.$disconnect();
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
