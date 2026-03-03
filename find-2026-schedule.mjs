import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const schedules = await prisma.schedule.findMany({
    where: {
      allocationsList: {
        some: {
          period: { startsWith: '2026' }
        }
      }
    },
    include: { allocationsList: { orderBy: { period: 'asc' } } },
    take: 1
  });
  
  if (schedules.length > 0) {
    const s = schedules[0];
    console.log(`Schedule: ${s.jobKey}`);
    console.log(`Total allocations: ${s.allocationsList.length}`);
    console.log(`\nAllocations:`);
    s.allocationsList.forEach(a => {
      console.log(`  ${a.period}: ${a.percent}%`);
    });
    
    // Now check what the API returns for this schedule
    console.log(`\n\nNow checking what API returns for this schedule...`);
    // Get the schedule ID from the returned data
    console.log(`Schedule ID: ${s.id}`);
  }
  
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
