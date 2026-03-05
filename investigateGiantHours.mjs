import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  const schedules = await prisma.schedule.findMany({
    where: {
      projectName: { contains: 'Giant' }
    },
    select: {
      jobKey: true,
      projectName: true,
      totalHours: true,
      allocationsList: {
        select: {
          period: true,
          hours: true,
          percent: true,
        },
        orderBy: { period: 'asc' }
      }
    }
  });
  
  console.log('Found schedules:');
  schedules.forEach(s => {
    console.log(`\n${s.jobKey} - ${s.projectName}`);
    console.log(`  Total Hours: ${s.totalHours}`);
    console.log(`  Allocations:`);
    s.allocationsList.forEach(alloc => {
      console.log(`    ${alloc.period}: ${alloc.hours}h (${alloc.percent}%)`);
    });
  });
  
  // Check for duplicate jobKeys
  const jobKeyCounts = await prisma.schedule.groupBy({
    by: ['jobKey'],
    where: {
      projectName: { contains: 'Giant' }
    },
    _count: true
  });
  
  console.log('\n\nDuplicate jobKey check:');
  jobKeyCounts.forEach(count => {
    if (count._count > 1) {
      console.log(`  ${count.jobKey}: ${count._count} schedules`);
    }
  });
  
  await prisma.$disconnect();
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
