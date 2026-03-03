import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find the first few NULL allocations
  const nullAllocs = await prisma.scheduleAllocation.findMany({
    where: {
      AND: [
        { period: { startsWith: '2026' } },
        { percent: null }
      ]
    },
    include: {
      schedule: {
        select: {
          id: true,
          jobKey: true,
          customer: true,
          projectNumber: true,
          projectName: true,
        }
      }
    },
    take: 5
  });
  
  console.log('Sample NULL allocations:');
  nullAllocs.forEach(alloc => {
    const sched = alloc.schedule;
    console.log(`\n  Period: ${alloc.period}`);
    console.log(`  Schedule ID: ${sched.id}`);
    console.log(`  Customer: "${sched.customer}"`);
    console.log(`  ProjectName: "${sched.projectName}"`);
    console.log(`  ProjectNumber: "${sched.projectNumber}"`);
    console.log(`  JobKey: "${sched.jobKey}"`);
    
    // Try to find matching project
    const [year, month] = alloc.period.split('-');
    console.log(`  Looking in WIP3.csv for customer="${sched.customer}" projectName="${sched.projectName}"`);
  });
  
  // Check if there's another set of schedules with different names that DO have percentages
  const allocsWithPercent = await prisma.scheduleAllocation.findMany({
    where: {
      AND: [
        { period: '2026-04' },
        { percent: { not: null, gt: 0 } }
      ]
    },
    include: {
      schedule: {
        select: {
          customer: true,
          projectName: true,
        }
      }
    },
    distinct: ['scheduleId']
  });
  
  console.log(`\n\nSchedules WITH valid 2026-04 allocations:  `);
  allocsWithPercent.forEach(a => {
    console.log(`  ${a.schedule.customer}~${a.schedule.projectName}`);
  });
  
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
